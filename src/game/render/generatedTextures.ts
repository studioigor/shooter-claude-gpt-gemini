import { TEX_SIZE } from '../core/config';
import { clamp, hash2d, rgbToABGR } from '../core/math';

// ---------------------------------------------------------------------------
// Noise helpers
// ---------------------------------------------------------------------------

/** Smooth interpolation curve (3t^2 - 2t^3) */
function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

/** Smooth value noise using hash2d as basis, returns 0..1 */
function noise2d(x: number, y: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const sx = smoothstep(fx);
  const sy = smoothstep(fy);
  const a = hash2d(ix, iy) / 255;
  const b = hash2d(ix + 1, iy) / 255;
  const c = hash2d(ix, iy + 1) / 255;
  const d = hash2d(ix + 1, iy + 1) / 255;
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

/** Fractal Brownian motion – multi-octave noise, returns ~0..1 */
function fbm(x: number, y: number, octaves: number, lacunarity = 2.0, gain = 0.5): number {
  // Cap octaves at 2 for startup performance (128px textures don't need more detail)
  const oct = octaves > 2 ? 2 : octaves;
  let value = 0;
  let amplitude = 0.5;
  let frequency = 1;
  let maxVal = 0;
  for (let i = 0; i < oct; i++) {
    value += amplitude * noise2d(x * frequency, y * frequency);
    maxVal += amplitude;
    amplitude *= gain;
    frequency *= lacunarity;
  }
  return value / maxVal;
}

/** Ridged noise – absolute-value folded fbm, returns ~0..1 */
function ridged(x: number, y: number, octaves: number): number {
  const oct = octaves > 2 ? 2 : octaves;
  let value = 0;
  let amplitude = 0.5;
  let frequency = 1;
  let maxVal = 0;
  for (let i = 0; i < oct; i++) {
    const n = 1 - Math.abs(noise2d(x * frequency, y * frequency) * 2 - 1);
    value += amplitude * n * n;
    maxVal += amplitude;
    amplitude *= 0.5;
    frequency *= 2;
  }
  return value / maxVal;
}

/** Voronoi / cellular distance (returns distance to nearest cell center, 0..~1) */
function voronoi(x: number, y: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  let minDistSq = 999;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const cx = ix + dx + hash2d(ix + dx, iy + dy) / 255;
      const cy = iy + dy + hash2d(iy + dy + 50, ix + dx + 50) / 255;
      const ddx = x - cx;
      const ddy = y - cy;
      const distSq = ddx * ddx + ddy * ddy;
      if (distSq < minDistSq) minDistSq = distSq;
    }
  }
  // Single sqrt on final result instead of per-cell
  return clamp(Math.sqrt(minDistSq), 0, 1);
}

/** Linear interpolation */
function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Mix two RGB colors given as [r,g,b] arrays by factor t */
function mixRGB(
  r1: number, g1: number, b1: number,
  r2: number, g2: number, b2: number,
  t: number,
): [number, number, number] {
  return [
    lerp(r1, r2, t),
    lerp(g1, g2, t),
    lerp(b1, b2, t),
  ];
}

/** Apply ambient-occlusion-style darkening near edges of a sub-region */
function edgeDarken(localX: number, localY: number, w: number, h: number, strength = 0.15): number {
  const ex = Math.min(localX, w - 1 - localX) / (w * 0.5);
  const ey = Math.min(localY, h - 1 - localY) / (h * 0.5);
  const e = Math.min(ex, ey);
  return 1 - (1 - clamp(e, 0, 1)) * strength;
}

// ---------------------------------------------------------------------------
// Texture generation
// ---------------------------------------------------------------------------

let _textureCache: Uint32Array[] | null = null;

export function generateTextures(): Uint32Array[] {
  if (_textureCache) return _textureCache;
  const textures: Uint32Array[] = [];
  const S = TEX_SIZE; // alias

  function createTex(fn: (x: number, y: number) => number): void {
    const data = new Uint32Array(S * S);
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        data[y * S + x] = fn(x, y);
      }
    }
    textures.push(data);
  }

  // =========================================================================
  // 0 – Classic Brick Wall (tile type 1)
  // =========================================================================
  createTex((x, y) => {
    const bw = 32;
    const bh = 16;
    const row = Math.floor(y / bh);
    const offset = (row % 2) * (bw / 2);
    const bx = (x + offset) % bw;
    const by = y % bh;
    const brickCol = Math.floor((x + offset) / bw);

    // Mortar / grout
    const mortarW = 2;
    const isMortar = bx < mortarW || by < mortarW;
    if (isMortar) {
      const mn = fbm(x * 0.3, y * 0.3, 3) * 20 - 10;
      const depth = (bx < 1 || by < 1) ? -10 : 10; // inset shadow then highlight
      return rgbToABGR(
        clamp(55 + mn + depth, 0, 255),
        clamp(52 + mn + depth, 0, 255),
        clamp(50 + mn + depth, 0, 255),
      );
    }

    // Per-brick color variation using brick ID
    const brickId = brickCol * 31 + row * 17;
    const brickHash = hash2d(brickId, row * 5);
    const warmShift = (brickHash & 31) - 12;
    const coolShift = ((brickHash >> 3) & 15) - 6;

    // Surface noise – multi-scale
    const coarseNoise = fbm(x * 0.08 + brickId * 3, y * 0.08, 3) * 30 - 15;
    const fineNoise = (hash2d(x * 3, y * 7) & 15) - 8;
    const surfaceVar = coarseNoise + fineNoise * 0.5;

    // Beveling: highlight on top-left edges, shadow on bottom-right
    let bevel = 0;
    if (bx < 4) bevel += (4 - bx) * 4;
    if (by < 4) bevel += (4 - by) * 5;
    if (bx > bw - 5) bevel -= (bx - (bw - 5)) * 4;
    if (by > bh - 4) bevel -= (by - (bh - 4)) * 5;

    // Occasional crack on some bricks
    const hasCrack = hash2d(brickId * 3, row * 7) < 25;
    if (hasCrack) {
      const crackPath = Math.abs(bx - bw * 0.5 + Math.sin(by * 0.8) * 3);
      if (crackPath < 1.2) {
        return rgbToABGR(40, 38, 35);
      }
    }

    // Occasional dark stain spots
    const stainNoise = fbm(x * 0.05 + 100, y * 0.05 + 100, 2);
    const stain = stainNoise > 0.65 ? -(stainNoise - 0.65) * 60 : 0;

    // Base brick color (warm reddish-brown with per-brick tint)
    const r = clamp(135 + warmShift + surfaceVar + bevel + stain, 0, 255);
    const g = clamp(105 + coolShift + surfaceVar * 0.8 + bevel * 0.8 + stain, 0, 255);
    const b = clamp(85 + coolShift * 0.5 + surfaceVar * 0.6 + bevel * 0.6 + stain, 0, 255);
    return rgbToABGR(r, g, b);
  });

  // =========================================================================
  // 1 – Tech / Sci-fi Metal Panel (tile type 2)
  // =========================================================================
  createTex((x, y) => {
    // Outer frame border with bevel
    const outerBevel = 5;
    const isOuterEdge = x < outerBevel || x >= S - outerBevel || y < outerBevel || y >= S - outerBevel;
    if (isOuterEdge) {
      const distFromEdge = Math.min(x, y, S - 1 - x, S - 1 - y);
      const highlight = distFromEdge < outerBevel / 2;
      const base = highlight ? 55 : 30;
      const n = (hash2d(x, y) & 7) - 3;
      return rgbToABGR(base + n, base + 8 + n, base + 20 + n);
    }

    // Inner panel area
    const ix = x - outerBevel;
    const iy = y - outerBevel;
    const innerW = S - outerBevel * 2;
    const innerH = S - outerBevel * 2;

    // Panel grid: 3 columns x 3 rows of sub-panels
    const panelCols = 3;
    const panelRows = 3;
    const pw = innerW / panelCols;
    const ph = innerH / panelRows;
    const pc = Math.floor(ix / pw);
    const pr = Math.floor(iy / ph);
    const px = ix - pc * pw;
    const py = iy - pr * ph;
    const panelId = pc + pr * panelCols;

    // Panel groove lines (inset seams)
    const grooveW = 2;
    const isGroove = px < grooveW || py < grooveW;
    if (isGroove) {
      const depth = (px < 1 || py < 1) ? 18 : 42;
      return rgbToABGR(depth, depth + 4, depth + 10);
    }

    // Sub-panel bevel
    let bevelShade = 0;
    if (px < grooveW + 3) bevelShade += (grooveW + 3 - px) * 3;
    if (py < grooveW + 3) bevelShade += (grooveW + 3 - py) * 4;
    if (px > pw - 4) bevelShade -= (px - (pw - 4)) * 3;
    if (py > ph - 4) bevelShade -= (py - (ph - 4)) * 4;

    // Brushed metal grain (horizontal)
    const grain = Math.sin(y * 3.5 + fbm(x * 0.1, y * 0.5, 2) * 6) * 4;

    // LED indicators on specific panels
    // Panel (1,0) = top-center: green LED array
    if (panelId === 1) {
      const ledY = py > ph * 0.35 && py < ph * 0.65;
      if (ledY) {
        for (let i = 0; i < 4; i++) {
          const ledCx = pw * 0.2 + i * pw * 0.2;
          const dx = px - ledCx;
          const dy = py - ph * 0.5;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < 2.5) {
            const glow = 1 - dist / 2.5;
            const active = hash2d(i * 17, panelId * 31) > 80;
            if (active) {
              return rgbToABGR(
                clamp(20 + glow * 40, 0, 255),
                clamp(80 + glow * 175, 0, 255),
                clamp(20 + glow * 50, 0, 255),
              );
            } else {
              return rgbToABGR(
                clamp(15 + glow * 20, 0, 255),
                clamp(25 + glow * 20, 0, 255),
                clamp(15 + glow * 10, 0, 255),
              );
            }
          }
          // LED glow halo
          if (dist < 5 && hash2d(i * 17, panelId * 31) > 80) {
            bevelShade += (5 - dist) * 1.5;
          }
        }
      }
    }

    // Panel (0,1) = middle-left: red warning indicator
    if (panelId === 3) {
      const cx = pw * 0.5;
      const cy = ph * 0.5;
      const dx = px - cx;
      const dy = py - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < 6) {
        const glow = 1 - dist / 6;
        return rgbToABGR(
          clamp(80 + glow * 175, 0, 255),
          clamp(10 + glow * 20, 0, 255),
          clamp(10 + glow * 15, 0, 255),
        );
      }
    }

    // Panel (2,2) = bottom-right: ventilation grille
    if (panelId === 8) {
      const slat = py % 5;
      if (slat < 2 && px > 4 && px < pw - 4) {
        const ventDepth = slat === 0 ? 15 : 35;
        return rgbToABGR(ventDepth, ventDepth + 2, ventDepth + 5);
      }
    }

    // Scratches
    const scratchNoise = hash2d(x * 13 + 200, y * 7 + 200);
    const scratch = scratchNoise < 8 ? 15 : 0;

    // Base metal color: dark blue-gray
    const n = fbm(x * 0.05, y * 0.05, 2) * 15 - 7;
    const r = clamp(62 + n + bevelShade + grain + scratch, 0, 255);
    const g = clamp(68 + n + bevelShade + grain + scratch, 0, 255);
    const b = clamp(82 + n + bevelShade * 1.2 + grain + scratch, 0, 255);
    return rgbToABGR(r, g, b);
  });

  // =========================================================================
  // 2 – Red / Terracotta Brick (tile type 3)
  // =========================================================================
  createTex((x, y) => {
    const bw = 30;
    const bh = 14;
    const row = Math.floor(y / bh);
    const offset = (row % 2) * (bw / 2);
    const bx = (x + offset) % bw;
    const by = y % bh;
    const brickCol = Math.floor((x + offset) / bw);
    const brickId = brickCol * 23 + row * 13;
    const brickHash = hash2d(brickId, row * 11);

    // Mortar
    if (bx < 2 || by < 2) {
      const mn = (hash2d(x * 5, y * 3) & 15) - 8;
      const depth = (bx === 0 || by === 0) ? -8 : 8;
      return rgbToABGR(
        clamp(85 + mn + depth, 0, 255),
        clamp(80 + mn + depth, 0, 255),
        clamp(72 + mn + depth, 0, 255),
      );
    }

    // Per-brick color variation
    const hueShift = (brickHash & 31) - 10;
    const satShift = ((brickHash >> 4) & 15) - 6;

    // Surface detail
    const coarse = fbm(x * 0.06 + brickId * 2, y * 0.06, 4) * 35 - 18;
    const fine = (hash2d(x * 7, y * 13) & 15) - 8;
    const surf = coarse + fine * 0.4;

    // Bevel
    let bevel = 0;
    if (bx < 4) bevel += (4 - bx) * 3.5;
    if (by < 4) bevel += (4 - by) * 4;
    if (bx > bw - 5) bevel -= (bx - (bw - 5)) * 3.5;
    if (by > bh - 4) bevel -= (by - (bh - 4)) * 4;

    // Weathering / discoloration patches
    const weathering = fbm(x * 0.04 + 50, y * 0.04 + 50, 3);
    const weatherMod = weathering > 0.6 ? -(weathering - 0.6) * 40 : 0;

    // Small chips
    const chip = noise2d(x * 0.4, y * 0.4) > 0.88;
    if (chip) {
      return rgbToABGR(
        clamp(100 + surf * 0.5, 0, 255),
        clamp(70 + surf * 0.3, 0, 255),
        clamp(55 + surf * 0.2, 0, 255),
      );
    }

    // Rich terracotta-red base
    const r = clamp(175 + hueShift + surf + bevel + weatherMod, 0, 255);
    const g = clamp(72 + satShift + surf * 0.6 + bevel * 0.7 + weatherMod * 0.7, 0, 255);
    const b = clamp(55 + satShift * 0.5 + surf * 0.4 + bevel * 0.5 + weatherMod * 0.5, 0, 255);
    return rgbToABGR(r, g, b);
  });

  // =========================================================================
  // 3 – Wood Planking (tile type 4)
  // =========================================================================
  createTex((x, y) => {
    // Vertical planks, each ~25px wide
    const plankW = 25;
    const plankIdx = Math.floor(x / plankW);
    const px = x % plankW; // local x within plank
    const plankHash = hash2d(plankIdx * 37, 0);

    // Plank gap / edge
    if (px < 1) {
      return rgbToABGR(22, 12, 6);
    }
    if (px === 1) {
      return rgbToABGR(55, 32, 15); // shadow side
    }
    if (px === plankW - 1) {
      return rgbToABGR(80, 50, 25); // slight highlight
    }

    // Per-plank tint variation
    const tintR = (plankHash & 15) - 6;
    const tintG = ((plankHash >> 3) & 11) - 4;
    const tintB = ((plankHash >> 5) & 7) - 3;

    // Wood grain: wavy vertical lines modulated by noise
    const grainFreq = 0.3 + (plankHash & 7) * 0.02;
    const grainWave = Math.sin((y + plankIdx * 40) * grainFreq + Math.sin(x * 0.15 + plankIdx * 20) * 2);
    const grain = grainWave * 12;

    // Fine grain lines
    const fineGrain = Math.sin(y * 1.8 + noise2d(x * 0.2 + plankIdx * 10, y * 0.02) * 8) * 5;

    // Fbm surface variation
    const surf = fbm(x * 0.06 + plankIdx * 50, y * 0.04, 3) * 20 - 10;

    // Knots (1-2 per plank randomly)
    let knotDarken = 0;
    const numKnots = (plankHash & 3) === 0 ? 1 : 0;
    for (let k = 0; k < numKnots; k++) {
      const knotY = (hash2d(plankIdx * 7 + k, 99) / 255) * S;
      const knotX = plankW * 0.5 + ((hash2d(plankIdx * 11 + k, 77) & 7) - 3);
      const dx = px - knotX;
      const dy = y - knotY;
      const knotR = 4 + (hash2d(plankIdx + k, 55) & 3);
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < knotR) {
        const ring = Math.sin(dist * 1.5) * 8;
        knotDarken = -(knotR - dist) * 5 + ring;
      } else if (dist < knotR + 3) {
        // Grain warping near knot
        knotDarken = Math.sin(dist * 2) * 4;
      }
    }

    // Nails at plank junctions (top and bottom)
    for (let nailY = 16; nailY < S; nailY += 64) {
      const nx = plankW / 2;
      const dx = px - nx;
      const dy = y - nailY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < 2.5) {
        const shade = dist < 1.5 ? 40 : 55;
        return rgbToABGR(shade, shade + 2, shade + 5);
      }
      // Nail shadow
      if (dist < 3.5 && dy > 0) {
        knotDarken -= 8;
      }
    }

    // Scratches / wear
    const scratchVal = hash2d(x * 19 + 300, y * 3 + 300);
    const scratch = scratchVal < 6 ? 12 : 0;

    // Base wood color (warm brown)
    const r = clamp(125 + tintR + grain + fineGrain + surf + knotDarken + scratch, 0, 255);
    const g = clamp(80 + tintG + grain * 0.7 + fineGrain * 0.6 + surf * 0.7 + knotDarken * 0.8 + scratch * 0.5, 0, 255);
    const b = clamp(40 + tintB + grain * 0.3 + fineGrain * 0.3 + surf * 0.4 + knotDarken * 0.5 + scratch * 0.3, 0, 255);
    return rgbToABGR(r, g, b);
  });

  // =========================================================================
  // 4 – Metal Door with handle
  // =========================================================================
  createTex((x, y) => {
    // Outer frame
    const frameW = 6;
    const isFrame = x < frameW || x >= S - frameW || y < frameW || y >= S - frameW;

    if (isFrame) {
      const distFromOuter = Math.min(x, y, S - 1 - x, S - 1 - y);
      const highlight = (x < S / 2 && distFromOuter === x) || (y < S / 2 && distFromOuter === y);
      const base = highlight ? 65 : 35;
      const n = (hash2d(x + 500, y + 500) & 7) - 3;
      return rgbToABGR(base + n, base + n + 2, base + n + 6);
    }

    // Door inner area
    const ix = x - frameW;
    const iy = y - frameW;
    const iw = S - frameW * 2;
    const ih = S - frameW * 2;

    // Two recessed panels: top and bottom
    const panelInset = 4;
    const panelGap = 6; // gap between the two panels
    const midY = ih / 2;
    const topPanelBot = midY - panelGap / 2;
    const botPanelTop = midY + panelGap / 2;

    const inTopPanel = ix >= panelInset && ix < iw - panelInset && iy >= panelInset && iy < topPanelBot;
    const inBotPanel = ix >= panelInset && ix < iw - panelInset && iy >= botPanelTop && iy < ih - panelInset;

    let bevel = 0;
    if (inTopPanel || inBotPanel) {
      const plx = ix - panelInset;
      const pw = iw - panelInset * 2;
      const ply = inTopPanel ? (iy - panelInset) : (iy - botPanelTop);
      const ph = inTopPanel ? (topPanelBot - panelInset) : (ih - panelInset - botPanelTop);
      // Inset bevel (reversed - shadow on top/left, highlight on bottom/right for inset)
      if (plx < 3) bevel -= (3 - plx) * 4;
      if (ply < 3) bevel -= (3 - ply) * 4;
      if (plx > pw - 4) bevel += (plx - (pw - 4)) * 3;
      if (ply > ph - 4) bevel += (ply - (ph - 4)) * 3;
      bevel -= 8; // overall inset darkening
    }

    // Handle area (right side, vertically centered)
    const handleX = iw * 0.72;
    const handleY = midY;
    const handleW = 8;
    const handleH = 16;
    const hx = ix - (handleX - handleW / 2);
    const hy = iy - (handleY - handleH / 2);
    if (hx >= 0 && hx < handleW && hy >= 0 && hy < handleH) {
      // Handle body
      const handleBevel = hx < 2 ? 25 : hx > handleW - 3 ? -15 : 0;
      const shine = (hx > 2 && hx < 5 && hy > 2 && hy < handleH - 2) ? 30 : 0;
      return rgbToABGR(
        clamp(180 + handleBevel + shine, 0, 255),
        clamp(165 + handleBevel + shine, 0, 255),
        clamp(50 + handleBevel + shine * 0.3, 0, 255),
      );
    }
    // Handle mounting plate
    const plateR = 5;
    const plateDist = Math.sqrt((ix - handleX) * (ix - handleX) + (iy - (handleY - handleH / 2 - 3)) * (iy - (handleY - handleH / 2 - 3)));
    const plateDist2 = Math.sqrt((ix - handleX) * (ix - handleX) + (iy - (handleY + handleH / 2 + 3)) * (iy - (handleY + handleH / 2 + 3)));
    if (plateDist < plateR || plateDist2 < plateR) {
      const d = Math.min(plateDist, plateDist2);
      const pBevel = d < 2 ? 15 : d < plateR - 1 ? 0 : -10;
      return rgbToABGR(85 + pBevel, 88 + pBevel, 95 + pBevel);
    }

    // Latch / lock (small keyhole near handle)
    const lockDx = ix - (handleX + 2);
    const lockDy = iy - (handleY + handleH / 2 + 14);
    const lockDist = Math.sqrt(lockDx * lockDx + lockDy * lockDy);
    if (lockDist < 3.5) {
      if (lockDist < 1.8) return rgbToABGR(15, 15, 18); // keyhole dark
      return rgbToABGR(70, 65, 30); // brass surround
    }

    // Brushed metal surface
    const grain = Math.sin(y * 2.5 + fbm(x * 0.08, y * 0.3, 2) * 4) * 3;
    const n = fbm(x * 0.04, y * 0.04, 3) * 16 - 8;
    const fineN = (hash2d(x * 3 + 700, y * 5 + 700) & 11) - 5;

    // Small dents
    const dent = noise2d(x * 0.2 + 30, y * 0.2 + 30) > 0.9 ? -12 : 0;

    const r = clamp(105 + n + fineN + bevel + grain + dent, 0, 255);
    const g = clamp(110 + n + fineN + bevel + grain + dent, 0, 255);
    const b = clamp(120 + n + fineN + bevel * 1.2 + grain + dent, 0, 255);
    return rgbToABGR(r, g, b);
  });

  // =========================================================================
  // 5 – Exit Sign (green with arrow + running figure)
  // =========================================================================
  createTex((x, y) => {
    // Sign border (white frame)
    const borderW = 5;
    const isBorder = x < borderW || x >= S - borderW || y < borderW || y >= S - borderW;
    if (isBorder) {
      const distFromEdge = Math.min(x, y, S - 1 - x, S - 1 - y);
      // Outer metal edge
      if (distFromEdge < 2) {
        return rgbToABGR(45, 45, 50);
      }
      // White border stripe
      return rgbToABGR(210, 215, 210);
    }

    // Interior green background
    const ix = x - borderW;
    const iy = y - borderW;
    const iw = S - borderW * 2;
    const ih = S - borderW * 2;

    // Subtle background gradient (brighter in center for backlit effect)
    const cx = iw / 2;
    const cy = ih / 2;
    const distFromCenter = Math.sqrt((ix - cx) * (ix - cx) + (iy - cy) * (iy - cy));
    const glow = Math.max(0, 1 - distFromCenter / (iw * 0.7)) * 30;

    // Running figure (left side of sign, centered vertically)
    const figCx = iw * 0.32;
    const figCy = ih * 0.5;
    let isFigure = false;

    // Head (circle)
    const headDx = ix - figCx;
    const headDy = iy - (figCy - 18);
    if (headDx * headDx + headDy * headDy < 16) isFigure = true;

    // Body (angled torso)
    const bodyTop = figCy - 13;
    const bodyBot = figCy + 2;
    if (iy >= bodyTop && iy <= bodyBot) {
      const bodyProgress = (iy - bodyTop) / (bodyBot - bodyTop);
      const bodyX = figCx + bodyProgress * 4;
      if (Math.abs(ix - bodyX) < 2.5) isFigure = true;
    }

    // Leading arm (extended forward and up)
    if (iy >= figCy - 15 && iy <= figCy - 8) {
      const armProgress = (iy - (figCy - 15)) / 7;
      const armX = figCx + 2 + armProgress * 10;
      if (Math.abs(ix - armX) < 2) isFigure = true;
    }

    // Trailing arm (behind, slightly down)
    if (iy >= figCy - 10 && iy <= figCy - 3) {
      const armProgress = (iy - (figCy - 10)) / 7;
      const armX = figCx - 2 - armProgress * 6;
      if (Math.abs(ix - armX) < 2) isFigure = true;
    }

    // Front leg (extended forward)
    if (iy >= figCy + 2 && iy <= figCy + 18) {
      const legProgress = (iy - (figCy + 2)) / 16;
      const legX = figCx + 4 + legProgress * 8;
      if (Math.abs(ix - legX) < 2.2) isFigure = true;
    }

    // Back leg (extended backward)
    if (iy >= figCy + 2 && iy <= figCy + 18) {
      const legProgress = (iy - (figCy + 2)) / 16;
      const legX = figCx + 2 - legProgress * 8;
      if (Math.abs(ix - legX) < 2.2) isFigure = true;
    }

    // Arrow (right side of sign) pointing right
    const arrowCx = iw * 0.72;
    const arrowCy = ih * 0.5;

    // Arrow shaft
    let isArrow = false;
    if (Math.abs(iy - arrowCy) < 3 && ix > arrowCx - 18 && ix < arrowCx + 8) {
      isArrow = true;
    }
    // Arrow head (triangle pointing right)
    if (ix >= arrowCx + 4 && ix < arrowCx + 20) {
      const headProgress = (ix - (arrowCx + 4)) / 16;
      const halfHeight = 12 * (1 - headProgress);
      if (Math.abs(iy - arrowCy) < halfHeight) {
        isArrow = true;
      }
    }

    // "EXIT" text area (top portion, simplified block letters)
    let isText = false;
    const textY = ih * 0.12;
    const textH = 10;
    if (iy >= textY && iy < textY + textH) {
      const ty = iy - textY;
      // Simplified "EXIT" using block segments
      // E
      const eLeft = iw * 0.2;
      if (ix >= eLeft && ix < eLeft + 8) {
        if (ix < eLeft + 2) isText = true; // vertical bar
        if (ty < 2 || ty > textH - 2 || (ty >= 4 && ty <= 6)) isText = true; // horizontals
      }
      // X
      const xLeft = iw * 0.34;
      if (ix >= xLeft && ix < xLeft + 8) {
        const xLocal = ix - xLeft;
        const diagProgress = ty / textH;
        if (Math.abs(xLocal - diagProgress * 8) < 1.8 || Math.abs(xLocal - (1 - diagProgress) * 8) < 1.8) isText = true;
      }
      // I
      const iLeft = iw * 0.5;
      if (ix >= iLeft && ix < iLeft + 6) {
        const iLocal = ix - iLeft;
        if (ty < 2 || ty > textH - 2) isText = true; // top/bottom bars
        if (Math.abs(iLocal - 3) < 1.5) isText = true; // vertical
      }
      // T
      const tLeft = iw * 0.63;
      if (ix >= tLeft && ix < tLeft + 8) {
        const tLocal = ix - tLeft;
        if (ty < 2) isText = true; // top bar
        if (Math.abs(tLocal - 4) < 1.5) isText = true; // vertical
      }
    }

    if (isFigure || isArrow || isText) {
      // Bright white/green symbol
      return rgbToABGR(
        clamp(200 + glow * 0.5, 0, 255),
        clamp(255, 0, 255),
        clamp(200 + glow * 0.5, 0, 255),
      );
    }

    // Green background with subtle noise
    const n = fbm(x * 0.05, y * 0.05, 2) * 10 - 5;
    return rgbToABGR(
      clamp(15 + n + glow * 0.1, 0, 255),
      clamp(90 + n + glow * 0.6, 0, 255),
      clamp(25 + n + glow * 0.15, 0, 255),
    );
  });

  // =========================================================================
  // 6 – Stone Blocks (tile type 6) with moss
  // =========================================================================
  createTex((x, y) => {
    // Large stone blocks ~64px wide, variable height
    const blockW = 64;
    const blockH = 42;
    const row = Math.floor(y / blockH);
    const offset = (row % 2) * (blockW * 0.45);
    const bx = ((x + offset) % blockW + blockW) % blockW;
    const by = y % blockH;
    const blockCol = Math.floor((x + offset) / blockW);
    const blockId = blockCol * 17 + row * 29;
    const blockHash = hash2d(blockId, row * 13);

    // Mortar between blocks
    const mortarW = 3;
    if (bx < mortarW || by < mortarW) {
      const depth = (bx < 1 || by < 1) ? -8 : 5;
      const mn = (hash2d(x * 11, y * 7) & 11) - 5;
      return rgbToABGR(
        clamp(48 + mn + depth, 0, 255),
        clamp(45 + mn + depth, 0, 255),
        clamp(42 + mn + depth, 0, 255),
      );
    }

    // Per-block color variation (natural stone variety)
    const warmth = (blockHash & 15) - 6;
    const brightness = ((blockHash >> 4) & 15) - 6;

    // Multi-scale stone surface
    const coarse = fbm(x * 0.04 + blockId * 5, y * 0.04, 4) * 35 - 18;
    const medium = fbm(x * 0.12 + blockId * 3, y * 0.12, 3) * 18 - 9;
    const fine = (hash2d(x * 5, y * 9) & 15) - 8;
    const surf = coarse + medium * 0.6 + fine * 0.3;

    // Stone pitting / texture
    const pitting = voronoi(x * 0.15, y * 0.15);
    const pitEffect = pitting < 0.15 ? -15 : pitting < 0.25 ? -5 : 0;

    // Block edge beveling
    let bevel = 0;
    if (bx < mortarW + 4) bevel += (mortarW + 4 - bx) * 3;
    if (by < mortarW + 4) bevel += (mortarW + 4 - by) * 3.5;
    if (bx > blockW - 5) bevel -= (bx - (blockW - 5)) * 3;
    if (by > blockH - 5) bevel -= (by - (blockH - 5)) * 3.5;

    // Cracks (occasional, following noisy paths)
    const hasCrack = hash2d(blockId * 5, row * 3) < 18;
    if (hasCrack) {
      const crackPath = Math.abs(bx * 0.7 - blockW * 0.35 + Math.sin(by * 0.3 + blockId) * 8 + fbm(x * 0.1, y * 0.1, 2) * 10);
      if (crackPath < 1.5) {
        return rgbToABGR(30, 28, 25);
      }
      if (crackPath < 2.5) {
        return rgbToABGR(45, 42, 38);
      }
    }

    // Moss patches (especially in mortar-adjacent areas and lower parts)
    const mossNoise = fbm(x * 0.035 + 200, y * 0.035 + 200, 4);
    const mossProximity = Math.min(bx, by) < 8 ? 0.15 : 0;
    const mossAmount = mossNoise + mossProximity + (y > S * 0.6 ? 0.1 : 0);
    if (mossAmount > 0.6) {
      const mossIntensity = clamp((mossAmount - 0.6) * 3, 0, 1);
      const mossDetail = fbm(x * 0.15, y * 0.15, 3) * 15;
      const mr = clamp(40 + mossDetail + surf * 0.3, 0, 255);
      const mg = clamp(65 + mossDetail * 1.5 + mossIntensity * 25, 0, 255);
      const mb = clamp(30 + mossDetail * 0.5, 0, 255);
      // Blend with base stone
      const baseR = 80 + warmth + brightness;
      const baseG = 78 + brightness;
      const baseB = 72 + brightness;
      const [fr, fg, fb] = mixRGB(baseR, baseG, baseB, mr, mg, mb, mossIntensity * 0.7);
      return rgbToABGR(clamp(fr, 0, 255), clamp(fg, 0, 255), clamp(fb, 0, 255));
    }

    // Base stone color (gray with warm tint)
    const r = clamp(82 + warmth + brightness + surf + bevel + pitEffect, 0, 255);
    const g = clamp(80 + brightness + surf * 0.9 + bevel * 0.9 + pitEffect, 0, 255);
    const b = clamp(75 + brightness + surf * 0.8 + bevel * 0.8 + pitEffect, 0, 255);
    return rgbToABGR(r, g, b);
  });

  // =========================================================================
  // 7 – Floor Texture (concrete with metal grating / tile pattern)
  // =========================================================================
  createTex((x, y) => {
    // Floor tiles: 32x32 grid
    const tileSize = 32;
    const tx = x % tileSize;
    const ty = y % tileSize;
    const tileCol = Math.floor(x / tileSize);
    const tileRow = Math.floor(y / tileSize);
    const tileId = tileCol + tileRow * 4;
    const tileHash = hash2d(tileId * 13, tileId * 7 + 50);

    // Tile edge grooves with bevel
    const grooveW = 2;
    if (tx < grooveW || ty < grooveW) {
      const isInnerEdge = tx === grooveW - 1 || ty === grooveW - 1;
      return rgbToABGR(
        isInnerEdge ? 50 : 28,
        isInnerEdge ? 52 : 28,
        isInnerEdge ? 55 : 30,
      );
    }
    // Outer bevel highlight opposite side
    if (tx >= tileSize - 2 || ty >= tileSize - 2) {
      return rgbToABGR(42, 43, 46);
    }

    // Some tiles have a diamond-plate pattern (metal grating)
    const isDiamondTile = (tileCol + tileRow) % 2 === 0;

    let surf = 0;
    if (isDiamondTile) {
      // Diamond plate pattern: offset grid of small raised diamonds
      const dx = (x + y) % 12;
      const dy = (x - y + 128) % 12; // +128 to keep positive
      const diamondDist = Math.min(
        Math.abs(dx - 6) + Math.abs(dy - 6),
        Math.abs(dx) + Math.abs(dy),
        Math.abs(dx - 12) + Math.abs(dy - 12),
      );
      if (diamondDist < 3) {
        surf += (3 - diamondDist) * 6;
      }
    }

    // Per-tile slight brightness variation
    const tileVar = (tileHash & 11) - 5;

    // Surface noise
    const coarseN = fbm(x * 0.06, y * 0.06, 3) * 18 - 9;
    const fineN = (hash2d(x * 7 + 100, y * 11 + 100) & 11) - 5;

    // Tile inner bevel
    let bevel = 0;
    if (tx < grooveW + 3) bevel += (grooveW + 3 - tx) * 2;
    if (ty < grooveW + 3) bevel += (grooveW + 3 - ty) * 2;
    if (tx > tileSize - 5) bevel -= (tx - (tileSize - 5)) * 2;
    if (ty > tileSize - 5) bevel -= (ty - (tileSize - 5)) * 2;

    // Scuff marks
    const scuff = fbm(x * 0.08 + 300, y * 0.08 + 300, 2);
    const scuffMod = scuff > 0.7 ? -(scuff - 0.7) * 30 : 0;

    // Oil stain (one spot)
    const oilDist = Math.sqrt((x - 80) * (x - 80) + (y - 45) * (y - 45));
    const oilStain = oilDist < 12 ? -(12 - oilDist) * 1.2 : 0;

    // Painted service lane markings
    if (tileRow % 3 === 1 && ty > 23 && ty < 28 && tx > 4 && tx < tileSize - 4) {
      const dash = ((tx + tileCol * 7) % 20) < 11;
      if (dash) {
        return rgbToABGR(
          clamp(170 + bevel + coarseN * 0.4, 0, 255),
          clamp(145 + bevel + coarseN * 0.35, 0, 255),
          clamp(78 + bevel * 0.6, 0, 255),
        );
      }
      return rgbToABGR(46, 44, 42);
    }

    // Coolant puddle sheen on flat tiles
    const coolant = !isDiamondTile && fbm(x * 0.09 + 700, y * 0.09 + 700, 2) > 0.78;
    if (coolant) {
      const reflection = Math.sin((x + y) * 0.24) * 8;
      return rgbToABGR(
        clamp(58 + tileVar + reflection + coarseN * 0.5, 0, 255),
        clamp(70 + tileVar + reflection * 0.8 + coarseN * 0.45, 0, 255),
        clamp(92 + tileVar + reflection * 1.4 + coarseN * 0.6, 0, 255),
      );
    }

    const base = isDiamondTile ? 72 : 65;
    const r = clamp(base + tileVar + coarseN + fineN + bevel + surf + scuffMod + oilStain, 0, 255);
    const g = clamp(base + tileVar + coarseN + fineN + bevel + surf + scuffMod + oilStain, 0, 255);
    const b = clamp(base + 5 + tileVar + coarseN + fineN + bevel + surf * 0.8 + scuffMod + oilStain, 0, 255);
    return rgbToABGR(r, g, b);
  });

  // =========================================================================
  // 8 – Ceiling Texture (dark panels with inset light strips)
  // =========================================================================
  createTex((x, y) => {
    // Panel grid: 32x32 panels
    const panelSize = 32;
    const px = x % panelSize;
    const py = y % panelSize;
    const panelCol = Math.floor(x / panelSize);
    const panelRow = Math.floor(y / panelSize);
    const panelId = panelCol + panelRow * 4;

    // Panel edge seams
    const seamW = 1;
    if (px < seamW || py < seamW) {
      return rgbToABGR(15, 15, 18);
    }
    if (px === seamW || py === seamW) {
      return rgbToABGR(22, 22, 26);
    }

    // Bevel on panel edges
    let bevel = 0;
    if (px < 4) bevel += (4 - px) * 2;
    if (py < 4) bevel += (4 - py) * 2;
    if (px > panelSize - 4) bevel -= (px - (panelSize - 4)) * 2;
    if (py > panelSize - 4) bevel -= (py - (panelSize - 4)) * 2;

    // Light strip: horizontal strip running through the middle of certain rows
    const isLightRow = panelRow % 2 === 0;
    if (isLightRow) {
      const lightInset = 8;
      const lightH = 6;
      const lightTop = (panelSize - lightH) / 2;
      if (px > lightInset && px < panelSize - lightInset && py > lightTop && py < lightTop + lightH) {
        // Light fixture with glow falloff
        const lightLocalY = py - lightTop;
        const lightLocalX = px - lightInset;
        const lightW = panelSize - lightInset * 2;
        const edgeFade = Math.min(lightLocalX, lightW - lightLocalX, lightLocalY, lightH - lightLocalY) / 2;
        const intensity = clamp(edgeFade, 0, 1);

        // Fluorescent light color (warm white)
        const flicker = 1 - (hash2d(panelId * 7 + 99, panelId * 3 + 33) & 1) * 0.03;
        return rgbToABGR(
          clamp(180 + intensity * 70 * flicker, 0, 255),
          clamp(195 + intensity * 55 * flicker, 0, 255),
          clamp(210 + intensity * 40 * flicker, 0, 255),
        );
      }
      // Light glow bleed onto surrounding ceiling
      const distToLight = Math.abs(py - panelSize / 2);
      if (distToLight < 10 && px > lightInset - 2 && px < panelSize - lightInset + 2) {
        bevel += (10 - distToLight) * 0.8;
      }
    }

    // Vent cassette panels
    const isVentPanel = panelId % 5 === 2 && px > 8 && px < 24 && py > 8 && py < 24;
    if (isVentPanel) {
      const slat = (py - 9) % 4;
      if (slat < 2) {
        return rgbToABGR(42, 44, 50);
      }
      bevel -= 5;
    }

    // Emergency node with red backlight
    if ((panelCol + panelRow) % 4 === 1) {
      const nodeDx = px - 24;
      const nodeDy = py - 8;
      const nodeDist = Math.sqrt(nodeDx * nodeDx + nodeDy * nodeDy);
      if (nodeDist < 4) {
        const glow = 1 - nodeDist / 4;
        return rgbToABGR(
          clamp(130 + glow * 95, 0, 255),
          clamp(25 + glow * 22, 0, 255),
          clamp(28 + glow * 18, 0, 255),
        );
      }
      if (nodeDist < 8) {
        bevel += (8 - nodeDist) * 0.7;
      }
    }

    // Subtle panel texture
    const n = fbm(x * 0.05, y * 0.05, 3) * 10 - 5;
    const fineN = (hash2d(x * 3 + 900, y * 7 + 900) & 7) - 3;

    // Stain / discoloration near lights
    const stain = fbm(x * 0.03 + 500, y * 0.03 + 500, 2);
    const stainMod = stain > 0.65 ? -(stain - 0.65) * 15 : 0;

    // Dark acoustic tile base color
    const r = clamp(38 + n + fineN + bevel + stainMod, 0, 255);
    const g = clamp(38 + n + fineN + bevel + stainMod, 0, 255);
    const b = clamp(42 + n + fineN + bevel * 1.1 + stainMod, 0, 255);
    return rgbToABGR(r, g, b);
  });

  // =========================================================================
  // 9 – Stained Concrete (smooth with cracks and stains)
  // =========================================================================
  createTex((x, y) => {
    // Multi-scale concrete surface
    const coarse = fbm(x * 0.03, y * 0.03, 4) * 30 - 15;
    const medium = fbm(x * 0.08 + 100, y * 0.08 + 100, 3) * 18 - 9;
    const fine = (hash2d(x * 3, y * 5) & 15) - 8;
    const surf = coarse + medium * 0.5 + fine * 0.3;

    // Aggregate specks (tiny light/dark spots like concrete aggregate)
    const aggregate = hash2d(x * 17 + 400, y * 13 + 400);
    let speck = 0;
    if (aggregate < 12) speck = 12;
    else if (aggregate > 240) speck = -10;

    // Crack network using ridged noise
    const crackNoise1 = ridged(x * 0.02 + 50, y * 0.025 + 50, 3);
    const crackNoise2 = ridged(x * 0.03 + 200, y * 0.015 + 200, 3);

    // Major crack
    if (crackNoise1 > 0.88) {
      const crackDepth = (crackNoise1 - 0.88) * 200;
      const shadow = clamp(crackDepth, 0, 40);
      return rgbToABGR(
        clamp(40 - shadow, 0, 255),
        clamp(38 - shadow, 0, 255),
        clamp(36 - shadow, 0, 255),
      );
    }
    // Secondary hairline cracks
    if (crackNoise2 > 0.9) {
      return rgbToABGR(
        clamp(65 + surf * 0.3, 0, 255),
        clamp(62 + surf * 0.3, 0, 255),
        clamp(60 + surf * 0.3, 0, 255),
      );
    }

    // Water stains (darker patches, organic shapes)
    const stain1 = fbm(x * 0.025 + 300, y * 0.025 + 300, 4);
    const stain2 = fbm(x * 0.04 + 500, y * 0.04 + 500, 3);
    let stainMod = 0;
    if (stain1 > 0.58) stainMod -= (stain1 - 0.58) * 50;
    if (stain2 > 0.62) stainMod -= (stain2 - 0.62) * 35;

    // Rust drip stain (vertical streak)
    const rustX = 85;
    const rustWidth = 6 + fbm(y * 0.02, 0, 2) * 8;
    const rustDist = Math.abs(x - rustX);
    if (rustDist < rustWidth && y > 20) {
      const rustIntensity = clamp(1 - rustDist / rustWidth, 0, 1) * clamp((y - 20) / 30, 0, 1);
      if (rustIntensity > 0.2) {
        const rustN = fbm(x * 0.1, y * 0.06, 3) * 20;
        const r = clamp(95 + surf + rustN + rustIntensity * 40, 0, 255);
        const g = clamp(82 + surf * 0.5 + rustN * 0.5, 0, 255);
        const b = clamp(72 + surf * 0.3, 0, 255);
        const baseR = 95 + surf + stainMod;
        const baseG = 92 + surf * 0.9 + stainMod * 0.8;
        const baseB = 88 + surf * 0.8 + stainMod * 0.7;
        const [mr, mg, mb] = mixRGB(baseR, baseG, baseB, r, g, b, rustIntensity * 0.6);
        return rgbToABGR(clamp(mr, 0, 255), clamp(mg, 0, 255), clamp(mb, 0, 255));
      }
    }

    // Base concrete color
    const r = clamp(95 + surf + stainMod + speck, 0, 255);
    const g = clamp(92 + surf * 0.95 + stainMod * 0.85 + speck, 0, 255);
    const b = clamp(88 + surf * 0.85 + stainMod * 0.75 + speck, 0, 255);
    return rgbToABGR(r, g, b);
  });

  // =========================================================================
  // 10 – Rusty Industrial Metal (plates with rivets, rust patches, seams)
  // =========================================================================
  createTex((x, y) => {
    // Metal plates: 64 wide, 32 tall
    const plateW = 64;
    const plateH = 32;
    const px = x % plateW;
    const py = y % plateH;
    const plateCol = Math.floor(x / plateW);
    const plateRow = Math.floor(y / plateH);
    const plateId = plateCol + plateRow * 2;

    // Seam lines (welded joints)
    const isHSeam = py < 2;
    const isVSeam = px < 2;
    if (isHSeam || isVSeam) {
      // Weld bead: slightly raised, rough texture
      const weldN = (hash2d(x * 13 + 800, y * 17 + 800) & 15) - 7;
      const weldHighlight = (isHSeam && py === 0) || (isVSeam && px === 0) ? 12 : -5;
      return rgbToABGR(
        clamp(50 + weldN + weldHighlight, 0, 255),
        clamp(48 + weldN + weldHighlight, 0, 255),
        clamp(45 + weldN + weldHighlight, 0, 255),
      );
    }
    // Shadow beside seam
    if (py === 2 || px === 2) {
      return rgbToABGR(38, 37, 35);
    }

    // Rivets (at corners of each plate, plus mid-edges)
    const rivetPositions: [number, number][] = [
      [6, 6], [plateW - 7, 6], [6, plateH - 7], [plateW - 7, plateH - 7],
      [plateW / 2, 6], [plateW / 2, plateH - 7],
    ];
    for (const [rx, ry] of rivetPositions) {
      const dx = px - rx;
      const dy = py - ry;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < 3.5) {
        // Rivet dome with highlight
        const rivetShade = dist < 1.5 ? 25 : dist < 2.5 ? 10 : -8;
        // Highlight on top-left
        const highlight = (dx < 0 && dy < 0) ? 15 : -5;
        return rgbToABGR(
          clamp(70 + rivetShade + highlight, 0, 255),
          clamp(68 + rivetShade + highlight, 0, 255),
          clamp(65 + rivetShade + highlight, 0, 255),
        );
      }
      // Rivet shadow ring
      if (dist < 4.5 && dist >= 3.5) {
        return rgbToABGR(45, 44, 42);
      }
    }

    // Rust pattern: large organic patches using multi-scale noise
    const rustNoise = fbm(x * 0.025 + plateId * 30, y * 0.03, 5);
    const rustDetail = fbm(x * 0.08 + 150, y * 0.08 + 150, 3);
    const isRusty = rustNoise > 0.42;
    const rustAmount = isRusty ? clamp((rustNoise - 0.42) * 3.5, 0, 1) : 0;

    // Surface scratches
    const scratchAngle = fbm(x * 0.01, y * 0.01, 2) * 6.28;
    const scratchVal = Math.sin(x * Math.cos(scratchAngle) * 0.5 + y * Math.sin(scratchAngle) * 0.5);
    const isScratch = Math.abs(scratchVal) < 0.04 && hash2d(x * 7, y * 11) < 80;
    const scratchMod = isScratch ? 15 : 0;

    // Dents
    const dentNoise = noise2d(x * 0.12 + 400, y * 0.12 + 400);
    const dent = dentNoise > 0.85 ? -(dentNoise - 0.85) * 80 : 0;

    // Brushed metal base
    const grain = Math.sin(x * 1.2 + fbm(x * 0.05, y * 0.3, 2) * 3) * 3;
    const n = fbm(x * 0.04, y * 0.04, 3) * 14 - 7;
    const fineN = (hash2d(x * 5 + 600, y * 3 + 600) & 9) - 4;

    // Plate inner bevel
    let bevel = 0;
    if (px < 6) bevel += (6 - px) * 1.5;
    if (py < 6) bevel += (6 - py) * 1.5;
    if (px > plateW - 5) bevel -= (px - (plateW - 5)) * 1.5;
    if (py > plateH - 5) bevel -= (py - (plateH - 5)) * 1.5;

    if (isRusty) {
      // Rust color: orange-brown with texture
      const rustR = clamp(140 + rustDetail * 40 + n + dent, 0, 255);
      const rustG = clamp(65 + rustDetail * 25 + n * 0.5 + dent * 0.5, 0, 255);
      const rustB = clamp(25 + rustDetail * 10 + dent * 0.3, 0, 255);
      // Clean metal color
      const metalR = clamp(78 + n + grain + bevel + fineN + scratchMod + dent, 0, 255);
      const metalG = clamp(80 + n + grain + bevel + fineN + scratchMod + dent, 0, 255);
      const metalB = clamp(85 + n + grain + bevel * 1.1 + fineN + scratchMod + dent, 0, 255);
      // Blend by rust amount
      const [fr, fg, fb] = mixRGB(metalR, metalG, metalB, rustR, rustG, rustB, rustAmount);
      return rgbToABGR(clamp(fr, 0, 255), clamp(fg, 0, 255), clamp(fb, 0, 255));
    }

    // Clean metal
    const r = clamp(78 + n + grain + bevel + fineN + scratchMod + dent, 0, 255);
    const g = clamp(80 + n + grain + bevel + fineN + scratchMod + dent, 0, 255);
    const b = clamp(85 + n + grain + bevel * 1.1 + fineN + scratchMod + dent, 0, 255);
    return rgbToABGR(r, g, b);
  });

  // =========================================================================
  // Helper: generate a locked door texture with a colored stripe
  // =========================================================================
  function createDoorTex(
    stripeR: number, stripeG: number, stripeB: number,
    stripeDarkR: number, stripeDarkG: number, stripeDarkB: number,
  ): (x: number, y: number) => number {
    return (x: number, y: number): number => {
      const frameW = 6;
      const isFrame = x < frameW || x >= S - frameW || y < frameW || y >= S - frameW;

      // Outer frame with bevel
      if (isFrame) {
        const distFromOuter = Math.min(x, y, S - 1 - x, S - 1 - y);
        const highlight = (distFromOuter === x && x < S / 2) || (distFromOuter === y && y < S / 2);
        const base = highlight ? 60 : 32;
        const n = (hash2d(x + 1000, y + 1000) & 7) - 3;
        return rgbToABGR(base + n, base + n + 2, base + n + 5);
      }

      const ix = x - frameW;
      const iy = y - frameW;
      const iw = S - frameW * 2;
      const ih = S - frameW * 2;
      const midY = ih / 2;

      // Colored stripe / band across middle
      const stripeTop = midY - 14;
      const stripeBotY = midY + 14;
      if (iy >= stripeTop && iy < stripeBotY) {
        const sy = iy - stripeTop;
        const stripeH = stripeBotY - stripeTop;

        // Bevel on stripe edges
        let sBevel = 0;
        if (sy < 3) sBevel += (3 - sy) * 5;
        if (sy > stripeH - 4) sBevel -= (sy - (stripeH - 4)) * 5;
        if (ix < 3) sBevel += (3 - ix) * 3;
        if (ix > iw - 4) sBevel -= (ix - (iw - 4)) * 3;

        // Stripe surface noise
        const sn = fbm(x * 0.06, y * 0.06, 2) * 12 - 6;
        const sfn = (hash2d(x * 5 + 1100, y * 3 + 1100) & 9) - 4;

        // Hazard stripes (diagonal lines within the band) for visual interest
        const diagStripe = ((ix + iy) % 24 < 12);
        const baseR = diagStripe ? stripeR : stripeDarkR;
        const baseG = diagStripe ? stripeG : stripeDarkG;
        const baseB = diagStripe ? stripeB : stripeDarkB;

        return rgbToABGR(
          clamp(baseR + sn + sfn + sBevel, 0, 255),
          clamp(baseG + sn * 0.8 + sfn * 0.8 + sBevel * 0.8, 0, 255),
          clamp(baseB + sn * 0.6 + sfn * 0.6 + sBevel * 0.6, 0, 255),
        );
      }

      // Two recessed panels (above and below stripe)
      const panelInset = 5;
      const panelGap = 4;
      const topPanelBot = stripeTop - panelGap;
      const botPanelTop = stripeBotY + panelGap;
      const inTopPanel = ix >= panelInset && ix < iw - panelInset && iy >= panelInset && iy < topPanelBot;
      const inBotPanel = ix >= panelInset && ix < iw - panelInset && iy >= botPanelTop && iy < ih - panelInset;

      let bevel = 0;
      if (inTopPanel || inBotPanel) {
        const plx = ix - panelInset;
        const pw = iw - panelInset * 2;
        const ply = inTopPanel ? (iy - panelInset) : (iy - botPanelTop);
        const ph = inTopPanel ? (topPanelBot - panelInset) : (ih - panelInset - botPanelTop);
        if (plx < 3) bevel -= (3 - plx) * 3;
        if (ply < 3) bevel -= (3 - ply) * 3;
        if (plx > pw - 4) bevel += (plx - (pw - 4)) * 2.5;
        if (ply > ph - 4) bevel += (ply - (ph - 4)) * 2.5;
        bevel -= 6;
      }

      // Handle (right side)
      const handleX = iw * 0.73;
      const handleY = midY;
      const handleW = 7;
      const handleH = 14;
      const hx = ix - (handleX - handleW / 2);
      const hy = iy - (handleY - handleH / 2);
      if (hx >= 0 && hx < handleW && hy >= 0 && hy < handleH) {
        const hBevel = hx < 2 ? 20 : hx > handleW - 3 ? -12 : 0;
        const shine = (hx > 1 && hx < 4 && hy > 2) ? 25 : 0;
        return rgbToABGR(
          clamp(170 + hBevel + shine, 0, 255),
          clamp(155 + hBevel + shine, 0, 255),
          clamp(45 + hBevel + shine * 0.3, 0, 255),
        );
      }

      // Lock indicator (small colored circle above handle)
      const lockDx = ix - handleX;
      const lockDy = iy - (handleY - handleH / 2 - 8);
      const lockDist = Math.sqrt(lockDx * lockDx + lockDy * lockDy);
      if (lockDist < 4) {
        const glow = 1 - lockDist / 4;
        return rgbToABGR(
          clamp(stripeR * 0.4 + glow * stripeR * 0.6, 0, 255),
          clamp(stripeG * 0.4 + glow * stripeG * 0.6, 0, 255),
          clamp(stripeB * 0.4 + glow * stripeB * 0.6, 0, 255),
        );
      }

      // Brushed metal surface
      const grain = Math.sin(y * 2.2 + fbm(x * 0.06, y * 0.25, 2) * 3) * 3;
      const n = fbm(x * 0.04, y * 0.04, 3) * 14 - 7;
      const fineN = (hash2d(x * 3 + 1200, y * 5 + 1200) & 9) - 4;

      const r = clamp(95 + n + fineN + bevel + grain, 0, 255);
      const g = clamp(98 + n + fineN + bevel + grain, 0, 255);
      const b = clamp(108 + n + fineN + bevel * 1.1 + grain, 0, 255);
      return rgbToABGR(r, g, b);
    };
  }

  // =========================================================================
  // 11 – Red Locked Door
  // =========================================================================
  createTex(createDoorTex(190, 40, 35, 130, 25, 22));

  // =========================================================================
  // 12 – Blue Locked Door
  // =========================================================================
  createTex(createDoorTex(45, 70, 200, 30, 48, 140));

  // =========================================================================
  // 13 – Yellow Locked Door
  // =========================================================================
  createTex(createDoorTex(210, 185, 40, 150, 130, 25));

  _textureCache = textures;
  return textures;
}
