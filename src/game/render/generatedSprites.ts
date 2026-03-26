import { clamp, rgbToABGR } from '../core/math';

export interface PixelSprite {
  data: Uint32Array;
  w: number;
  h: number;
}

type SpriteMap = Record<string, PixelSprite>;

/* ------------------------------------------------------------------ */
/*  Helper utilities                                                   */
/* ------------------------------------------------------------------ */

function createSprite(w: number, h: number, fn: (x: number, y: number, w: number, h: number) => number): PixelSprite {
  const data = new Uint32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      data[y * w + x] = fn(x, y, w, h);
    }
  }
  return { data, w, h };
}

function fillRect(data: Uint32Array, sw: number, sh: number, x: number, y: number, w: number, h: number, color: number): void {
  for (let py = Math.max(0, y | 0); py < Math.min(sh, (y + h) | 0); py++) {
    for (let px = Math.max(0, x | 0); px < Math.min(sw, (x + w) | 0); px++) {
      data[py * sw + px] = color;
    }
  }
}

function tintRed(sprite: PixelSprite): PixelSprite {
  return createSprite(sprite.w, sprite.h, (x, y) => {
    const pixel = sprite.data[y * sprite.w + x];
    if (!pixel) return 0;
    const r = pixel & 255;
    const g = (pixel >> 8) & 255;
    const b = (pixel >> 16) & 255;
    return rgbToABGR(clamp(r + 55, 0, 255), clamp(g - 32, 0, 255), clamp(b - 32, 0, 255));
  });
}

function generateWeaponVM(draw: (data: Uint32Array, sw: number, sh: number, frame: number) => void): PixelSprite[] {
  const frames: PixelSprite[] = [];
  for (let frame = 0; frame < 3; frame++) {
    const sprite = createSprite(128, 128, () => 0);
    draw(sprite.data, sprite.w, sprite.h, frame);
    frames.push(sprite);
  }
  return frames;
}

/** Test if point (x,y) is inside ellipse centered at (cx,cy) with radii (rx,ry) */
function ellipse(x: number, y: number, cx: number, cy: number, rx: number, ry: number): boolean {
  const dx = (x - cx) / rx;
  const dy = (y - cy) / ry;
  return dx * dx + dy * dy <= 1.0;
}

/** Fill an ellipse region */
function fillEllipse(data: Uint32Array, sw: number, sh: number, cx: number, cy: number, rx: number, ry: number, color: number): void {
  const x0 = Math.max(0, Math.floor(cx - rx));
  const x1 = Math.min(sw - 1, Math.ceil(cx + rx));
  const y0 = Math.max(0, Math.floor(cy - ry));
  const y1 = Math.min(sh - 1, Math.ceil(cy + ry));
  for (let py = y0; py <= y1; py++) {
    for (let px = x0; px <= x1; px++) {
      if (ellipse(px, py, cx, cy, rx, ry)) {
        data[py * sw + px] = color;
      }
    }
  }
}

/** Rectangle with shading gradient for 3D illusion.
 *  highlightDir: 0=top, 1=left, 2=bottom, 3=right */
function shadedRect(
  data: Uint32Array, sw: number, sh: number,
  x: number, y: number, w: number, h: number,
  baseR: number, baseG: number, baseB: number,
  highlightDir: number
): void {
  for (let py = Math.max(0, y | 0); py < Math.min(sh, (y + h) | 0); py++) {
    for (let px = Math.max(0, x | 0); px < Math.min(sw, (x + w) | 0); px++) {
      let t: number;
      if (highlightDir === 0) t = 1 - (py - y) / h;
      else if (highlightDir === 1) t = 1 - (px - x) / w;
      else if (highlightDir === 2) t = (py - y) / h;
      else t = (px - x) / w;
      const shade = 0.6 + 0.4 * t;
      data[py * sw + px] = rgbToABGR(
        clamp(Math.floor(baseR * shade), 0, 255),
        clamp(Math.floor(baseG * shade), 0, 255),
        clamp(Math.floor(baseB * shade), 0, 255)
      );
    }
  }
}

/** Draw a line between two points (Bresenham-like, with thickness) */
function drawLine(data: Uint32Array, sw: number, sh: number, x0: number, y0: number, x1: number, y1: number, thickness: number, color: number): void {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const steps = Math.max(Math.abs(dx), Math.abs(dy), 1);
  const r = thickness / 2;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const cx = Math.round(x0 + dx * t);
    const cy = Math.round(y0 + dy * t);
    for (let py = Math.max(0, cy - Math.ceil(r)); py <= Math.min(sh - 1, cy + Math.ceil(r)); py++) {
      for (let px = Math.max(0, cx - Math.ceil(r)); px <= Math.min(sw - 1, cx + Math.ceil(r)); px++) {
        if ((px - cx) * (px - cx) + (py - cy) * (py - cy) <= r * r) {
          data[py * sw + px] = color;
        }
      }
    }
  }
}

/** Shaded ellipse with highlight for 3D roundness */
function shadedEllipse(
  data: Uint32Array, sw: number, sh: number,
  cx: number, cy: number, rx: number, ry: number,
  baseR: number, baseG: number, baseB: number,
  highlightX: number, highlightY: number
): void {
  const x0 = Math.max(0, Math.floor(cx - rx));
  const x1 = Math.min(sw - 1, Math.ceil(cx + rx));
  const y0 = Math.max(0, Math.floor(cy - ry));
  const y1 = Math.min(sh - 1, Math.ceil(cy + ry));
  for (let py = y0; py <= y1; py++) {
    for (let px = x0; px <= x1; px++) {
      const ndx = (px - cx) / rx;
      const ndy = (py - cy) / ry;
      if (ndx * ndx + ndy * ndy <= 1.0) {
        // distance from highlight point determines brightness
        const hdx = (px - highlightX) / rx;
        const hdy = (py - highlightY) / ry;
        const hdist = Math.sqrt(hdx * hdx + hdy * hdy);
        const shade = clamp(1.2 - hdist * 0.5, 0.5, 1.3);
        data[py * sw + px] = rgbToABGR(
          clamp(Math.floor(baseR * shade), 0, 255),
          clamp(Math.floor(baseG * shade), 0, 255),
          clamp(Math.floor(baseB * shade), 0, 255)
        );
      }
    }
  }
}

/** Set a single pixel if in bounds */
function setPixel(data: Uint32Array, sw: number, sh: number, x: number, y: number, color: number): void {
  const px = x | 0;
  const py = y | 0;
  if (px >= 0 && px < sw && py >= 0 && py < sh) {
    data[py * sw + px] = color;
  }
}

function drawArmoredGlove(
  data: Uint32Array,
  sw: number,
  sh: number,
  x: number,
  y: number,
  w: number,
  h: number,
  side: 'left' | 'right',
): void {
  const palmCx = x + w * 0.5;
  const palmCy = y + h - 5;
  shadedRect(data, sw, sh, x, y, w, h, 64, 70, 84, 2);
  shadedRect(data, sw, sh, x + 1, y + 3, Math.max(4, w - 2), Math.max(8, h - 8), 82, 90, 108, side === 'left' ? 1 : 3);
  fillEllipse(data, sw, sh, palmCx, palmCy, Math.max(4, w * 0.38), Math.max(3, h * 0.15), rgbToABGR(104, 116, 136));
  shadedRect(data, sw, sh, x - 1, y + h - 6, w + 2, 6, 52, 56, 68, 0);
  const fingerSpacing = Math.max(2, Math.floor((w - 4) / 3));
  for (let finger = 0; finger < 3; finger++) {
    const fx = side === 'left'
      ? x + 1 + finger * fingerSpacing
      : x + w - 3 - finger * fingerSpacing;
    fillRect(data, sw, sh, fx, y + 4, 2, Math.max(4, h * 0.28), rgbToABGR(110, 122, 142));
  }
  fillRect(data, sw, sh, x + 2, y + 2, Math.max(4, w - 4), 2, rgbToABGR(120, 132, 150));
}

/* ------------------------------------------------------------------ */
/*  GENERATE ALL SPRITES                                               */
/* ------------------------------------------------------------------ */

let _spriteCache: SpriteMap | null = null;

export function generateSprites(): SpriteMap {
  if (_spriteCache) return _spriteCache;
  const sprites: SpriteMap = {};

  /* ================================================================ */
  /*  TROOPER (64x96) - Futuristic soldier                             */
  /* ================================================================ */
  sprites.trooper = createSprite(64, 96, () => 0);
  {
    const d = sprites.trooper.data;
    const sw = 64, sh = 96;
    const cx = 32;

    // Heavy boots
    shadedRect(d, sw, sh, cx - 11, 86, 9, 10, 50, 50, 55, 0);   // left boot
    shadedRect(d, sw, sh, cx + 2, 86, 9, 10, 50, 50, 55, 0);    // right boot
    // Boot soles
    fillRect(d, sw, sh, cx - 12, 93, 11, 3, rgbToABGR(35, 35, 40));
    fillRect(d, sw, sh, cx + 1, 93, 11, 3, rgbToABGR(35, 35, 40));

    // Armored legs with knee pads
    shadedRect(d, sw, sh, cx - 9, 62, 8, 24, 74, 90, 61, 1);    // left leg
    shadedRect(d, sw, sh, cx + 1, 62, 8, 24, 74, 90, 61, 3);    // right leg
    // Knee pads
    shadedRect(d, sw, sh, cx - 10, 70, 10, 6, 90, 100, 75, 0);
    shadedRect(d, sw, sh, cx + 0, 70, 10, 6, 90, 100, 75, 0);

    // Tactical vest / torso
    shadedRect(d, sw, sh, cx - 13, 32, 26, 30, 92, 107, 80, 0);
    // Chest plate (center armor)
    shadedRect(d, sw, sh, cx - 8, 34, 16, 18, 110, 120, 95, 0);
    // Belt
    fillRect(d, sw, sh, cx - 13, 58, 26, 4, rgbToABGR(60, 55, 45));
    // Belt buckle
    fillRect(d, sw, sh, cx - 2, 58, 4, 4, rgbToABGR(140, 130, 80));

    // Shoulder pads
    shadedEllipse(d, sw, sh, cx - 15, 36, 6, 5, 100, 110, 85, cx - 17, 33);
    shadedEllipse(d, sw, sh, cx + 15, 36, 6, 5, 100, 110, 85, cx + 13, 33);

    // Arms
    shadedRect(d, sw, sh, cx - 20, 38, 7, 20, 74, 90, 61, 1);   // left upper arm
    shadedRect(d, sw, sh, cx + 13, 38, 7, 20, 74, 90, 61, 3);   // right upper arm
    // Forearms
    shadedRect(d, sw, sh, cx - 20, 52, 7, 10, 80, 95, 68, 1);   // left forearm
    shadedRect(d, sw, sh, cx + 13, 52, 7, 10, 80, 95, 68, 3);   // right forearm

    // Rifle held across body
    fillRect(d, sw, sh, cx + 16, 46, 14, 3, rgbToABGR(70, 70, 78));  // barrel
    fillRect(d, sw, sh, cx + 13, 49, 8, 6, rgbToABGR(65, 65, 72));   // receiver
    fillRect(d, sw, sh, cx + 12, 55, 5, 4, rgbToABGR(90, 65, 40));   // grip

    // Neck
    shadedRect(d, sw, sh, cx - 4, 24, 8, 8, 120, 105, 90, 0);

    // Helmet
    shadedEllipse(d, sw, sh, cx, 14, 12, 14, 100, 105, 120, cx - 3, 6);
    // Visor (glowing cyan line)
    fillRect(d, sw, sh, cx - 8, 16, 16, 2, rgbToABGR(60, 200, 240));
    fillRect(d, sw, sh, cx - 7, 17, 14, 1, rgbToABGR(100, 230, 255));
    // Helmet top ridge
    fillRect(d, sw, sh, cx - 2, 2, 4, 4, rgbToABGR(85, 90, 105));
    // Helmet chin guard
    fillRect(d, sw, sh, cx - 6, 22, 12, 3, rgbToABGR(80, 85, 100));

    // Vest pouches detail
    fillRect(d, sw, sh, cx - 11, 45, 4, 5, rgbToABGR(70, 80, 55));
    fillRect(d, sw, sh, cx - 6, 45, 4, 5, rgbToABGR(70, 80, 55));
    fillRect(d, sw, sh, cx + 2, 45, 4, 5, rgbToABGR(70, 80, 55));
    fillRect(d, sw, sh, cx + 7, 45, 4, 5, rgbToABGR(70, 80, 55));
  }
  sprites.trooperHurt = tintRed(sprites.trooper);

  /* ================================================================ */
  /*  STALKER (64x96) - Fast alien creature                            */
  /* ================================================================ */
  sprites.stalker = createSprite(64, 96, () => 0);
  {
    const d = sprites.stalker.data;
    const sw = 64, sh = 96;
    const cx = 32;

    // Digitigrade legs (reverse-knee style)
    // Left leg: thigh goes forward-down, shin goes back-down
    shadedRect(d, sw, sh, cx - 10, 64, 6, 14, 106, 53, 53, 1);  // left thigh (angled)
    shadedRect(d, sw, sh, cx - 12, 74, 5, 4, 120, 60, 60, 0);   // left knee joint
    shadedRect(d, sw, sh, cx - 14, 78, 5, 12, 90, 40, 40, 1);   // left shin
    fillRect(d, sw, sh, cx - 16, 88, 7, 3, rgbToABGR(74, 26, 26)); // left foot/claw
    fillRect(d, sw, sh, cx - 18, 89, 3, 2, rgbToABGR(60, 20, 20)); // left claw tip

    // Right leg
    shadedRect(d, sw, sh, cx + 4, 64, 6, 14, 106, 53, 53, 3);
    shadedRect(d, sw, sh, cx + 7, 74, 5, 4, 120, 60, 60, 0);
    shadedRect(d, sw, sh, cx + 9, 78, 5, 12, 90, 40, 40, 3);
    fillRect(d, sw, sh, cx + 9, 88, 7, 3, rgbToABGR(74, 26, 26));
    fillRect(d, sw, sh, cx + 15, 89, 3, 2, rgbToABGR(60, 20, 20));

    // Lean torso (hunched forward) with rib texture
    shadedEllipse(d, sw, sh, cx + 2, 48, 12, 18, 106, 40, 40, cx - 2, 38);
    // Ribs / texture lines
    for (let rib = 0; rib < 5; rib++) {
      const ry = 40 + rib * 5;
      fillRect(d, sw, sh, cx - 6, ry, 14, 1, rgbToABGR(74, 26, 26));
    }

    // Hunched upper back
    shadedEllipse(d, sw, sh, cx + 4, 32, 10, 8, 120, 48, 48, cx, 28);

    // Long arms with claws
    // Left arm - extending down and forward
    shadedRect(d, sw, sh, cx - 16, 34, 5, 18, 100, 42, 42, 1);  // upper arm
    shadedRect(d, sw, sh, cx - 20, 48, 5, 16, 90, 38, 38, 1);   // forearm
    // Left claws (3 sharp lines)
    drawLine(d, sw, sh, cx - 22, 64, cx - 26, 72, 1.5, rgbToABGR(140, 50, 50));
    drawLine(d, sw, sh, cx - 20, 64, cx - 22, 73, 1.5, rgbToABGR(140, 50, 50));
    drawLine(d, sw, sh, cx - 18, 64, cx - 18, 72, 1.5, rgbToABGR(140, 50, 50));

    // Right arm
    shadedRect(d, sw, sh, cx + 12, 34, 5, 18, 100, 42, 42, 3);
    shadedRect(d, sw, sh, cx + 16, 48, 5, 16, 90, 38, 38, 3);
    drawLine(d, sw, sh, cx + 22, 64, cx + 26, 72, 1.5, rgbToABGR(140, 50, 50));
    drawLine(d, sw, sh, cx + 20, 64, cx + 22, 73, 1.5, rgbToABGR(140, 50, 50));
    drawLine(d, sw, sh, cx + 18, 64, cx + 18, 72, 1.5, rgbToABGR(140, 50, 50));

    // Elongated head
    shadedEllipse(d, sw, sh, cx + 4, 16, 8, 16, 130, 55, 55, cx + 1, 8);
    // Back of skull extends up
    shadedEllipse(d, sw, sh, cx + 6, 8, 5, 10, 120, 50, 50, cx + 3, 3);

    // Glowing red eyes (two dots)
    fillRect(d, sw, sh, cx, 16, 3, 2, rgbToABGR(255, 40, 40));
    fillRect(d, sw, sh, cx + 6, 16, 3, 2, rgbToABGR(255, 40, 40));
    // Eye glow
    setPixel(d, sw, sh, cx + 1, 15, rgbToABGR(255, 100, 80));
    setPixel(d, sw, sh, cx + 7, 15, rgbToABGR(255, 100, 80));

    // Jaw / mandible
    fillRect(d, sw, sh, cx + 1, 24, 7, 3, rgbToABGR(100, 35, 35));
    fillRect(d, sw, sh, cx - 1, 26, 3, 2, rgbToABGR(90, 30, 30));
    fillRect(d, sw, sh, cx + 7, 26, 3, 2, rgbToABGR(90, 30, 30));
  }
  sprites.stalkerHurt = tintRed(sprites.stalker);

  /* ================================================================ */
  /*  DRONE (64x64) - Flying robot                                     */
  /* ================================================================ */
  sprites.drone = createSprite(64, 64, () => 0);
  {
    const d = sprites.drone.data;
    const sw = 64, sh = 64;
    const cx = 32, cy = 30;

    // Antenna on top
    fillRect(d, sw, sh, cx - 1, 4, 2, 12, rgbToABGR(100, 110, 125));
    fillEllipse(d, sw, sh, cx, 4, 3, 3, rgbToABGR(64, 200, 255)); // antenna tip glow

    // Central spherical body with metallic sheen
    shadedEllipse(d, sw, sh, cx, cy, 16, 14, 90, 98, 115, cx - 5, cy - 6);

    // Metallic highlight band
    for (let px = cx - 12; px <= cx + 12; px++) {
      const ndx = (px - cx) / 14;
      if (ndx * ndx <= 1) {
        const bright = 1.0 + 0.3 * (1 - ndx * ndx);
        setPixel(d, sw, sh, px, cy - 3, rgbToABGR(
          clamp(Math.floor(120 * bright), 0, 255),
          clamp(Math.floor(130 * bright), 0, 255),
          clamp(Math.floor(150 * bright), 0, 255)
        ));
      }
    }

    // Scanner ring (horizontal blue glow)
    for (let px = cx - 22; px <= cx + 22; px++) {
      const dist = Math.abs(px - cx);
      if (dist > 14 || dist < 10) {
        const glow = clamp(1.0 - (dist - 16) * 0.08, 0.3, 1.0);
        const r = Math.floor(40 * glow);
        const g = Math.floor(180 * glow);
        const b = Math.floor(255 * glow);
        for (let t = -1; t <= 1; t++) {
          setPixel(d, sw, sh, px, cy + t, rgbToABGR(r, g, b));
        }
      }
    }
    // Inner ring glow
    fillRect(d, sw, sh, cx - 14, cy - 1, 28, 3, rgbToABGR(45, 170, 255));

    // Thruster pods (left and right)
    shadedRect(d, sw, sh, cx - 28, cy - 6, 10, 12, 75, 82, 100, 1);
    shadedRect(d, sw, sh, cx + 18, cy - 6, 10, 12, 75, 82, 100, 3);
    // Thruster glow
    fillRect(d, sw, sh, cx - 28, cy + 4, 10, 3, rgbToABGR(50, 160, 240));
    fillRect(d, sw, sh, cx + 18, cy + 4, 10, 3, rgbToABGR(50, 160, 240));
    // Thruster exhaust
    fillRect(d, sw, sh, cx - 26, cy + 7, 6, 2, rgbToABGR(40, 120, 200));
    fillRect(d, sw, sh, cx + 20, cy + 7, 6, 2, rgbToABGR(40, 120, 200));

    // Weapon port at bottom
    fillRect(d, sw, sh, cx - 3, cy + 12, 6, 6, rgbToABGR(60, 65, 75));
    fillRect(d, sw, sh, cx - 1, cy + 16, 2, 4, rgbToABGR(50, 55, 65));
    // Weapon glow
    setPixel(d, sw, sh, cx, cy + 19, rgbToABGR(64, 200, 255));

    // Eye / sensor in center
    fillEllipse(d, sw, sh, cx, cy - 2, 4, 3, rgbToABGR(64, 200, 255));
    fillEllipse(d, sw, sh, cx, cy - 2, 2, 1.5, rgbToABGR(180, 240, 255));
  }
  sprites.droneHurt = tintRed(sprites.drone);

  /* ================================================================ */
  /*  BRUISER (72x104) - Heavy armored tank                            */
  /* ================================================================ */
  sprites.bruiser = createSprite(72, 104, () => 0);
  {
    const d = sprites.bruiser.data;
    const sw = 72, sh = 104;
    const cx = 36;

    // Heavy boots
    shadedRect(d, sw, sh, cx - 16, 92, 14, 12, 50, 44, 60, 0);
    shadedRect(d, sw, sh, cx + 2, 92, 14, 12, 50, 44, 60, 0);
    // Boot treads
    fillRect(d, sw, sh, cx - 17, 100, 16, 4, rgbToABGR(35, 30, 42));
    fillRect(d, sw, sh, cx + 1, 100, 16, 4, rgbToABGR(35, 30, 42));

    // Thick legs
    shadedRect(d, sw, sh, cx - 14, 72, 12, 20, 74, 62, 92, 1);
    shadedRect(d, sw, sh, cx + 2, 72, 12, 20, 74, 62, 92, 3);
    // Knee armor
    shadedRect(d, sw, sh, cx - 15, 78, 14, 6, 85, 72, 100, 0);
    shadedRect(d, sw, sh, cx + 1, 78, 14, 6, 85, 72, 100, 0);

    // Massive wide body / chest armor
    shadedRect(d, sw, sh, cx - 22, 34, 44, 38, 74, 62, 92, 0);
    // Central armor plates
    shadedRect(d, sw, sh, cx - 16, 36, 32, 20, 85, 72, 105, 0);
    // Power indicator (orange glow) on chest
    fillEllipse(d, sw, sh, cx, 50, 5, 5, rgbToABGR(220, 140, 40));
    fillEllipse(d, sw, sh, cx, 50, 3, 3, rgbToABGR(255, 200, 80));
    // Armor panel lines
    fillRect(d, sw, sh, cx - 16, 46, 32, 1, rgbToABGR(58, 50, 72));
    fillRect(d, sw, sh, cx, 36, 1, 20, rgbToABGR(58, 50, 72));

    // Belt / waist
    fillRect(d, sw, sh, cx - 20, 68, 40, 4, rgbToABGR(60, 52, 72));

    // Huge angular shoulder pauldrons
    // Left pauldron
    for (let py = 24; py < 38; py++) {
      const pw = 14 - (py - 24) * 0.5;
      shadedRect(d, sw, sh, cx - 24 - (pw > 10 ? 2 : 0), py, Math.floor(pw), 1, 90, 78, 110, 0);
    }
    // Right pauldron
    for (let py = 24; py < 38; py++) {
      const pw = 14 - (py - 24) * 0.5;
      shadedRect(d, sw, sh, cx + 22 - Math.floor(pw) + (pw > 10 ? 2 : 0) + 2, py, Math.floor(pw), 1, 90, 78, 110, 0);
    }
    // Pauldron top surfaces
    shadedRect(d, sw, sh, cx - 28, 24, 16, 4, 100, 88, 120, 0);
    shadedRect(d, sw, sh, cx + 12, 24, 16, 4, 100, 88, 120, 0);

    // Thick arms
    shadedRect(d, sw, sh, cx - 28, 36, 8, 22, 74, 62, 92, 1);  // left arm
    shadedRect(d, sw, sh, cx + 20, 36, 8, 22, 74, 62, 92, 3);  // right arm

    // Multi-barrel weapon on right arm
    fillRect(d, sw, sh, cx + 26, 44, 8, 3, rgbToABGR(65, 65, 75));
    fillRect(d, sw, sh, cx + 32, 42, 4, 2, rgbToABGR(55, 55, 65));
    fillRect(d, sw, sh, cx + 32, 46, 4, 2, rgbToABGR(55, 55, 65));
    fillRect(d, sw, sh, cx + 32, 44, 4, 2, rgbToABGR(60, 60, 70));

    // Left fist
    fillRect(d, sw, sh, cx - 30, 56, 10, 6, rgbToABGR(65, 55, 80));

    // Neck
    shadedRect(d, sw, sh, cx - 6, 22, 12, 6, 60, 55, 70, 0);

    // Head / helmet
    shadedEllipse(d, sw, sh, cx, 14, 12, 13, 74, 62, 92, cx - 4, 6);
    // Visor (T-shaped, dim orange)
    fillRect(d, sw, sh, cx - 8, 12, 16, 3, rgbToABGR(180, 100, 40));
    fillRect(d, sw, sh, cx - 2, 14, 4, 6, rgbToABGR(180, 100, 40));
    // Helmet top
    fillRect(d, sw, sh, cx - 4, 2, 8, 4, rgbToABGR(65, 55, 80));
  }
  sprites.bruiserHurt = tintRed(sprites.bruiser);

  /* ================================================================ */
  /*  BOSS (96x128) - Power-armored commander                          */
  /* ================================================================ */
  sprites.boss = createSprite(96, 128, () => 0);
  {
    const d = sprites.boss.data;
    const sw = 96, sh = 128;
    const cx = 48;

    // Heavy armored boots
    shadedRect(d, sw, sh, cx - 18, 114, 16, 14, 58, 62, 74, 0);
    shadedRect(d, sw, sh, cx + 2, 114, 16, 14, 58, 62, 74, 0);
    fillRect(d, sw, sh, cx - 20, 124, 20, 4, rgbToABGR(40, 42, 50));
    fillRect(d, sw, sh, cx, 124, 20, 4, rgbToABGR(40, 42, 50));

    // Armored legs
    shadedRect(d, sw, sh, cx - 16, 88, 14, 26, 64, 68, 80, 1);
    shadedRect(d, sw, sh, cx + 2, 88, 14, 26, 64, 68, 80, 3);
    // Knee guards
    shadedRect(d, sw, sh, cx - 17, 96, 16, 7, 78, 82, 94, 0);
    shadedRect(d, sw, sh, cx + 1, 96, 16, 7, 78, 82, 94, 0);

    // Massive power armor frame / torso
    shadedRect(d, sw, sh, cx - 28, 42, 56, 44, 58, 62, 74, 0);
    // Upper chest plate
    shadedRect(d, sw, sh, cx - 22, 44, 44, 22, 70, 74, 86, 0);
    // Lower abdomen armor
    shadedRect(d, sw, sh, cx - 20, 66, 40, 16, 55, 58, 68, 0);

    // Glowing red core on chest plate
    fillEllipse(d, sw, sh, cx, 58, 7, 7, rgbToABGR(200, 50, 50));
    fillEllipse(d, sw, sh, cx, 58, 4, 4, rgbToABGR(255, 80, 60));
    fillEllipse(d, sw, sh, cx, 58, 2, 2, rgbToABGR(255, 160, 140));

    // Belt / waist
    fillRect(d, sw, sh, cx - 26, 82, 52, 6, rgbToABGR(50, 52, 62));
    fillRect(d, sw, sh, cx - 4, 82, 8, 6, rgbToABGR(160, 50, 40)); // belt buckle

    // Massive shoulder armor
    // Left shoulder
    shadedRect(d, sw, sh, cx - 38, 30, 18, 18, 70, 74, 86, 0);
    shadedRect(d, sw, sh, cx - 40, 28, 22, 6, 80, 84, 96, 0);
    // Right shoulder
    shadedRect(d, sw, sh, cx + 20, 30, 18, 18, 70, 74, 86, 0);
    shadedRect(d, sw, sh, cx + 18, 28, 22, 6, 80, 84, 96, 0);

    // Arms with energy lines
    shadedRect(d, sw, sh, cx - 36, 46, 10, 24, 58, 62, 74, 1);  // left upper arm
    shadedRect(d, sw, sh, cx + 26, 46, 10, 24, 58, 62, 74, 3);  // right upper arm
    // Energy lines on arms (subtle red glow)
    for (let i = 0; i < 4; i++) {
      fillRect(d, sw, sh, cx - 32, 48 + i * 5, 2, 2, rgbToABGR(200, 60, 60));
      fillRect(d, sw, sh, cx + 30, 48 + i * 5, 2, 2, rgbToABGR(200, 60, 60));
    }

    // Arm-mounted cannons (both sides)
    // Left cannon
    shadedRect(d, sw, sh, cx - 42, 56, 8, 18, 55, 58, 68, 1);
    fillRect(d, sw, sh, cx - 44, 54, 4, 6, rgbToABGR(50, 52, 62));
    fillRect(d, sw, sh, cx - 44, 60, 4, 3, rgbToABGR(50, 52, 62));
    fillRect(d, sw, sh, cx - 44, 66, 4, 3, rgbToABGR(50, 52, 62));
    // Cannon muzzle glow
    fillRect(d, sw, sh, cx - 44, 56, 2, 2, rgbToABGR(180, 50, 40));

    // Right cannon
    shadedRect(d, sw, sh, cx + 34, 56, 8, 18, 55, 58, 68, 3);
    fillRect(d, sw, sh, cx + 40, 54, 4, 6, rgbToABGR(50, 52, 62));
    fillRect(d, sw, sh, cx + 40, 60, 4, 3, rgbToABGR(50, 52, 62));
    fillRect(d, sw, sh, cx + 40, 66, 4, 3, rgbToABGR(50, 52, 62));
    fillRect(d, sw, sh, cx + 42, 56, 2, 2, rgbToABGR(180, 50, 40));

    // Fists / gauntlets
    fillRect(d, sw, sh, cx - 38, 68, 12, 6, rgbToABGR(60, 64, 76));
    fillRect(d, sw, sh, cx + 26, 68, 12, 6, rgbToABGR(60, 64, 76));

    // Neck
    shadedRect(d, sw, sh, cx - 6, 26, 12, 8, 55, 55, 65, 0);

    // Large helmet
    shadedEllipse(d, sw, sh, cx, 16, 16, 16, 58, 62, 74, cx - 5, 6);

    // Crown / crest on top of helmet
    fillRect(d, sw, sh, cx - 3, 0, 6, 6, rgbToABGR(70, 74, 86));
    fillRect(d, sw, sh, cx - 6, 2, 12, 3, rgbToABGR(75, 78, 90));
    // Crest glow
    fillRect(d, sw, sh, cx - 1, 1, 2, 3, rgbToABGR(200, 60, 50));

    // T-shaped glowing red visor
    fillRect(d, sw, sh, cx - 12, 14, 24, 3, rgbToABGR(255, 64, 64));  // horizontal bar
    fillRect(d, sw, sh, cx - 3, 16, 6, 8, rgbToABGR(255, 64, 64));    // vertical bar
    // Visor glow edges
    fillRect(d, sw, sh, cx - 13, 13, 26, 1, rgbToABGR(180, 40, 40));
    fillRect(d, sw, sh, cx - 4, 24, 8, 1, rgbToABGR(180, 40, 40));

    // Helmet chin guard
    fillRect(d, sw, sh, cx - 10, 26, 20, 3, rgbToABGR(50, 54, 64));

    // Armor plate edge highlights on torso
    fillRect(d, sw, sh, cx - 22, 44, 44, 1, rgbToABGR(80, 84, 96));
    fillRect(d, sw, sh, cx - 22, 65, 44, 1, rgbToABGR(45, 48, 58));
  }
  sprites.bossHurt = tintRed(sprites.boss);

  /* ================================================================ */
  /*  ENEMY DEAD (96x32) - Fallen body                                 */
  /* ================================================================ */
  sprites.enemyDead = createSprite(96, 32, (x, y, w) => {
    const cx = w / 2;
    const dx = Math.abs(x - cx);
    // Torso / main body
    if (y > 6 && y < 20 && dx < 30 - (y - 6) * 0.5) {
      const shade = 0.7 + 0.3 * (1 - y / 20);
      return rgbToABGR(
        Math.floor(65 * shade), Math.floor(48 * shade), Math.floor(48 * shade)
      );
    }
    // Limbs splayed
    if (y > 10 && y < 16 && dx > 28 && dx < 40) return rgbToABGR(55, 38, 38);
    // Head
    if (y > 4 && y < 12 && dx > 30 && dx < 38) return rgbToABGR(75, 58, 58);
    // Blood pool
    if (y > 16 && y < 28 && dx < 24 - (y - 16) * 0.8) return rgbToABGR(80, 20, 20);
    return 0;
  });

  /* ================================================================ */
  /*  PICKUPS                                                          */
  /* ================================================================ */

  // Health pack (32x32) - red cross with white border
  sprites.health = createSprite(32, 32, (x, y) => {
    const cx = 16, cy = 16;
    const dx = Math.abs(x - cx);
    const dy = Math.abs(y - cy);
    // White box background
    if (dx < 13 && dy < 13 && dx + dy < 22) {
      // Red cross
      if ((dx < 3 && dy < 10) || (dy < 3 && dx < 10)) {
        // Interior highlight
        const shade = 1.0 + 0.15 * (1 - (dx + dy) / 13);
        return rgbToABGR(
          clamp(Math.floor(230 * shade), 0, 255),
          clamp(Math.floor(50 * shade), 0, 255),
          clamp(Math.floor(55 * shade), 0, 255)
        );
      }
      if ((dx < 4 && dy < 11) || (dy < 4 && dx < 11)) {
        return rgbToABGR(200, 40, 45);
      }
      return rgbToABGR(220, 220, 225);
    }
    return 0;
  });

  // Ammo box (32x32)
  sprites.ammo = createSprite(32, 32, () => 0);
  {
    const d = sprites.ammo.data;
    const sw = 32, sh = 32;
    // Box body
    shadedRect(d, sw, sh, 6, 6, 20, 20, 80, 85, 90, 0);
    // Box lid
    shadedRect(d, sw, sh, 5, 4, 22, 4, 95, 100, 108, 0);
    // Bullets visible inside
    for (let i = 0; i < 4; i++) {
      fillRect(d, sw, sh, 10 + i * 4, 10, 2, 10, rgbToABGR(220, 180, 70));
      fillRect(d, sw, sh, 10 + i * 4, 8, 2, 3, rgbToABGR(200, 110, 50));
    }
    // Latch
    fillRect(d, sw, sh, 14, 22, 4, 3, rgbToABGR(140, 130, 70));
  }

  // Armor shard (32x32) - shield shape
  sprites.armor = createSprite(32, 32, (x, y) => {
    const cx = 16;
    const dx = Math.abs(x - cx);
    const maxW = y < 8 ? 11 : 11 - (y - 8) * 0.45;
    if (y > 3 && y < 28 && dx < maxW) {
      const shade = 0.8 + 0.4 * (1 - dx / 11);
      const edgeDist = maxW - dx;
      if (edgeDist < 2) {
        return rgbToABGR(100, 170, 255);
      }
      if (dx < 3 && y > 8 && y < 20) {
        return rgbToABGR(
          clamp(Math.floor(170 * shade), 0, 255),
          clamp(Math.floor(220 * shade), 0, 255),
          255
        );
      }
      return rgbToABGR(
        clamp(Math.floor(65 * shade), 0, 255),
        clamp(Math.floor(140 * shade), 0, 255),
        clamp(Math.floor(255 * shade), 0, 255)
      );
    }
    return 0;
  });

  /* ================================================================ */
  /*  WEAPON PICKUPS                                                   */
  /* ================================================================ */

  // Shotgun pickup (48x32)
  sprites.shotgunPickup = createSprite(48, 32, () => 0);
  {
    const d = sprites.shotgunPickup.data;
    const sw = 48, sh = 32;
    // Barrels (two tubes)
    shadedRect(d, sw, sh, 4, 12, 28, 3, 100, 100, 112, 0);
    shadedRect(d, sw, sh, 4, 16, 28, 3, 95, 95, 108, 0);
    // Barrel tips
    fillRect(d, sw, sh, 2, 12, 3, 7, rgbToABGR(85, 85, 95));
    // Receiver
    shadedRect(d, sw, sh, 28, 11, 8, 10, 80, 85, 95, 0);
    // Wooden foregrip
    shadedRect(d, sw, sh, 18, 20, 12, 5, 130, 90, 50, 0);
    // Stock
    shadedRect(d, sw, sh, 34, 12, 10, 8, 120, 80, 45, 3);
    shadedRect(d, sw, sh, 40, 14, 4, 10, 110, 75, 40, 3);
    // Trigger guard
    fillRect(d, sw, sh, 30, 21, 6, 1, rgbToABGR(70, 70, 80));
    fillRect(d, sw, sh, 30, 22, 1, 4, rgbToABGR(70, 70, 80));
    fillRect(d, sw, sh, 35, 22, 1, 3, rgbToABGR(70, 70, 80));
  }

  // Machinegun pickup (48x32)
  sprites.machinegunPickup = createSprite(48, 32, () => 0);
  {
    const d = sprites.machinegunPickup.data;
    const sw = 48, sh = 32;
    // Barrel with shroud
    shadedRect(d, sw, sh, 2, 11, 20, 5, 68, 72, 84, 0);
    // Barrel vents
    for (let v = 0; v < 3; v++) {
      fillRect(d, sw, sh, 6 + v * 5, 12, 2, 3, rgbToABGR(40, 42, 52));
    }
    // Upper receiver / rail
    shadedRect(d, sw, sh, 18, 9, 16, 3, 60, 65, 75, 0);
    // Lower receiver
    shadedRect(d, sw, sh, 18, 12, 16, 7, 55, 60, 72, 0);
    // Magazine
    shadedRect(d, sw, sh, 24, 19, 6, 10, 50, 55, 65, 0);
    // Stock
    shadedRect(d, sw, sh, 32, 10, 12, 6, 55, 60, 68, 3);
    fillRect(d, sw, sh, 42, 12, 4, 8, rgbToABGR(50, 55, 62));
    // Front sight
    fillRect(d, sw, sh, 3, 9, 2, 3, rgbToABGR(75, 78, 88));
    // Trigger
    fillRect(d, sw, sh, 28, 19, 1, 3, rgbToABGR(60, 60, 70));
  }

  // Plasma pickup (48x32)
  sprites.plasmaPickup = createSprite(48, 32, () => 0);
  {
    const d = sprites.plasmaPickup.data;
    const sw = 48, sh = 32;
    // Main body
    shadedRect(d, sw, sh, 8, 10, 24, 12, 60, 68, 88, 0);
    // Wide barrel
    shadedRect(d, sw, sh, 2, 12, 8, 8, 55, 62, 82, 0);
    // Energy core (glowing)
    fillEllipse(d, sw, sh, 20, 16, 5, 4, rgbToABGR(60, 200, 255));
    fillEllipse(d, sw, sh, 20, 16, 3, 2, rgbToABGR(160, 235, 255));
    // Side pylons
    shadedRect(d, sw, sh, 10, 6, 4, 6, 55, 60, 78, 0);
    shadedRect(d, sw, sh, 28, 6, 4, 6, 55, 60, 78, 0);
    // Grip
    shadedRect(d, sw, sh, 30, 14, 8, 8, 50, 55, 70, 3);
    fillRect(d, sw, sh, 36, 18, 4, 8, rgbToABGR(45, 50, 62));
    // Barrel glow
    fillRect(d, sw, sh, 2, 14, 2, 4, rgbToABGR(50, 160, 240));
  }

  /* ================================================================ */
  /*  KEYS                                                             */
  /* ================================================================ */

  function makeKey(r: number, g: number, b: number): PixelSprite {
    const s = createSprite(24, 24, () => 0);
    const d = s.data;
    const sw = 24, sh = 24;
    // Key head (ring)
    for (let py = 0; py < sh; py++) {
      for (let px = 0; px < sw; px++) {
        const kx = px - 8, ky = py - 8;
        const dist = Math.sqrt(kx * kx + ky * ky);
        if (dist < 7 && dist > 3) {
          const shade = 0.8 + 0.4 * (1 - dist / 7);
          setPixel(d, sw, sh, px, py, rgbToABGR(
            clamp(Math.floor(r * shade), 0, 255),
            clamp(Math.floor(g * shade), 0, 255),
            clamp(Math.floor(b * shade), 0, 255)
          ));
        }
      }
    }
    // Key shaft
    shadedRect(d, sw, sh, 13, 7, 8, 2, r, g, b, 0);
    // Key teeth
    fillRect(d, sw, sh, 18, 5, 2, 4, rgbToABGR(r, g, b));
    fillRect(d, sw, sh, 16, 5, 2, 3, rgbToABGR(
      clamp(r - 30, 0, 255), clamp(g - 30, 0, 255), clamp(b - 30, 0, 255)
    ));
    fillRect(d, sw, sh, 20, 6, 2, 3, rgbToABGR(
      clamp(r - 20, 0, 255), clamp(g - 20, 0, 255), clamp(b - 20, 0, 255)
    ));
    // Highlight on key ring
    setPixel(d, sw, sh, 6, 5, rgbToABGR(
      clamp(r + 60, 0, 255), clamp(g + 60, 0, 255), clamp(b + 60, 0, 255)
    ));
    return s;
  }

  sprites.keyRed = makeKey(255, 64, 64);
  sprites.keyBlue = makeKey(64, 128, 255);
  sprites.keyYellow = makeKey(255, 220, 84);

  /* ================================================================ */
  /*  BARREL & BROKEN BARREL                                           */
  /* ================================================================ */

  sprites.barrel = createSprite(40, 52, (x, y) => {
    const cx = 20;
    const dx = x - cx;
    const adx = Math.abs(dx);
    // Barrel profile: slightly narrower at top and bottom
    const radius = y < 6 ? 11 - (6 - y) * 0.6 : y > 44 ? 11 - (y - 44) * 0.6 : 11;
    if (adx < radius) {
      if (y > 18 && y < 25) {
        const warning = ((x + y) % 12) < 6;
        const shade = 0.68 + 0.5 * (1 - adx / radius);
        return warning
          ? rgbToABGR(
              clamp(Math.floor(220 * shade), 0, 255),
              clamp(Math.floor(180 * shade), 0, 255),
              clamp(Math.floor(60 * shade), 0, 255),
            )
          : rgbToABGR(
              clamp(Math.floor(56 * shade), 0, 255),
              clamp(Math.floor(54 * shade), 0, 255),
              clamp(Math.floor(58 * shade), 0, 255),
            );
      }
      // Metal bands
      const isBand = (y % 14 < 2) || y < 3 || y > 48;
      if (isBand) {
        const shade = 0.7 + 0.5 * (1 - adx / radius);
        return rgbToABGR(
          clamp(Math.floor(100 * shade), 0, 255),
          clamp(Math.floor(105 * shade), 0, 255),
          clamp(Math.floor(110 * shade), 0, 255)
        );
      }
      // Barrel body with cylindrical shading
      const cylShade = 0.6 + 0.6 * (1 - adx / radius);
      return rgbToABGR(
        clamp(Math.floor(140 * cylShade), 0, 255),
        clamp(Math.floor(80 * cylShade), 0, 255),
        clamp(Math.floor(40 * cylShade), 0, 255)
      );
    }
    if (y < 4 && adx < 8) return rgbToABGR(170, 190, 210);
    return 0;
  });

  sprites.barrelBroken = createSprite(40, 40, (x, y) => {
    const cx = 20;
    const dx = Math.abs(x - cx);
    // Broken top edge (jagged)
    const jaggedTop = 10 + Math.floor(Math.sin(x * 1.5) * 3 + Math.sin(x * 3.7) * 2);
    if (y > jaggedTop && y < 36 && dx < 12) {
      const shade = 0.6 + 0.5 * (1 - dx / 12);
      return rgbToABGR(
        clamp(Math.floor(100 * shade), 0, 255),
        clamp(Math.floor(60 * shade), 0, 255),
        clamp(Math.floor(35 * shade), 0, 255)
      );
    }
    // Metal band at bottom
    if (y > 33 && y < 36 && dx < 12) {
      return rgbToABGR(80, 85, 90);
    }
    // Base
    if (y > 35 && y < 40 && dx < 11) {
      return rgbToABGR(70, 50, 30);
    }
    // Debris pieces around base
    if (y > 30 && y < 38 && dx > 10 && dx < 16 && ((x + y) % 5 < 2)) {
      return rgbToABGR(90, 55, 30);
    }
    return 0;
  });

  /* ================================================================ */
  /*  PLASMA PROJECTILE (32x32)                                        */
  /* ================================================================ */
  sprites.plasma = createSprite(32, 32, (x, y) => {
    const cx = 16, cy = 16;
    const dx = x - cx, dy = y - cy;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < 12) {
      if (dist < 4) {
        return rgbToABGR(220, 250, 255); // bright white-blue core
      }
      if (dist < 7) {
        const t = (dist - 4) / 3;
        return rgbToABGR(
          Math.floor(220 - 120 * t),
          Math.floor(250 - 40 * t),
          255
        );
      }
      // Outer glow
      const t = (dist - 7) / 5;
      const alpha = 1 - t;
      return rgbToABGR(
        Math.floor(60 * alpha),
        Math.floor(180 * alpha),
        clamp(Math.floor(255 * alpha), 80, 255)
      );
    }
    return 0;
  });

  /* ================================================================ */
  /*  GENERATORS                                                       */
  /* ================================================================ */

  sprites.generatorOn = createSprite(48, 64, () => 0);
  {
    const d = sprites.generatorOn.data;
    const sw = 48, sh = 64;
    // Base / housing
    shadedRect(d, sw, sh, 10, 8, 28, 50, 72, 82, 95, 0);
    // Top cap
    shadedRect(d, sw, sh, 8, 4, 32, 6, 85, 95, 110, 0);
    // Screen area (glowing cyan)
    shadedRect(d, sw, sh, 16, 16, 16, 22, 40, 180, 230, 0);
    fillRect(d, sw, sh, 18, 18, 12, 18, rgbToABGR(60, 220, 255));
    // Screen lines
    for (let i = 0; i < 4; i++) {
      fillRect(d, sw, sh, 18, 20 + i * 4, 12, 1, rgbToABGR(100, 240, 255));
    }
    // Indicator lights
    fillRect(d, sw, sh, 14, 42, 3, 3, rgbToABGR(60, 255, 100));
    fillRect(d, sw, sh, 20, 42, 3, 3, rgbToABGR(60, 255, 100));
    fillRect(d, sw, sh, 26, 42, 3, 3, rgbToABGR(255, 200, 60));
    // Coils on sides
    for (let i = 0; i < 5; i++) {
      fillRect(d, sw, sh, 10, 12 + i * 8, 4, 3, rgbToABGR(95, 105, 120));
      fillRect(d, sw, sh, 34, 12 + i * 8, 4, 3, rgbToABGR(95, 105, 120));
    }
    // Base plate
    fillRect(d, sw, sh, 6, 56, 36, 4, rgbToABGR(60, 68, 80));
    // Top glow
    fillRect(d, sw, sh, 12, 6, 24, 2, rgbToABGR(100, 200, 240));
  }

  sprites.generatorOff = createSprite(48, 64, () => 0);
  {
    const d = sprites.generatorOff.data;
    const sw = 48, sh = 64;
    shadedRect(d, sw, sh, 10, 8, 28, 50, 60, 66, 78, 0);
    shadedRect(d, sw, sh, 8, 4, 32, 6, 72, 80, 92, 0);
    // Screen area (dark/off)
    shadedRect(d, sw, sh, 16, 16, 16, 22, 35, 40, 48, 0);
    fillRect(d, sw, sh, 18, 18, 12, 18, rgbToABGR(30, 35, 42));
    // Indicator lights (dim/off)
    fillRect(d, sw, sh, 14, 42, 3, 3, rgbToABGR(40, 50, 45));
    fillRect(d, sw, sh, 20, 42, 3, 3, rgbToABGR(40, 50, 45));
    fillRect(d, sw, sh, 26, 42, 3, 3, rgbToABGR(50, 45, 35));
    for (let i = 0; i < 5; i++) {
      fillRect(d, sw, sh, 10, 12 + i * 8, 4, 3, rgbToABGR(75, 82, 95));
      fillRect(d, sw, sh, 34, 12 + i * 8, 4, 3, rgbToABGR(75, 82, 95));
    }
    fillRect(d, sw, sh, 6, 56, 36, 4, rgbToABGR(50, 56, 65));
  }

  /* ================================================================ */
  /*  CHECKPOINTS                                                      */
  /* ================================================================ */

  sprites.checkpoint = createSprite(32, 64, () => 0);
  {
    const d = sprites.checkpoint.data;
    const sw = 32, sh = 64;
    // Pole
    shadedRect(d, sw, sh, 14, 12, 4, 50, 80, 90, 110, 1);
    // Base
    shadedRect(d, sw, sh, 10, 58, 12, 6, 70, 78, 95, 0);
    // Diamond indicator at top
    for (let py = 4; py < 20; py++) {
      for (let px = 8; px < 24; px++) {
        if (Math.abs(px - 16) + Math.abs(py - 12) < 8) {
          const dist = Math.abs(px - 16) + Math.abs(py - 12);
          const shade = 1.0 - dist * 0.08;
          setPixel(d, sw, sh, px, py, rgbToABGR(
            clamp(Math.floor(100 * shade), 0, 255),
            clamp(Math.floor(190 * shade), 0, 255),
            clamp(Math.floor(240 * shade), 0, 255)
          ));
        }
      }
    }
  }

  sprites.checkpointActive = createSprite(32, 64, () => 0);
  {
    const d = sprites.checkpointActive.data;
    const sw = 32, sh = 64;
    shadedRect(d, sw, sh, 14, 12, 4, 50, 90, 110, 130, 1);
    shadedRect(d, sw, sh, 10, 58, 12, 6, 80, 95, 110, 0);
    // Active diamond (green glow)
    for (let py = 3; py < 21; py++) {
      for (let px = 7; px < 25; px++) {
        if (Math.abs(px - 16) + Math.abs(py - 12) < 9) {
          const dist = Math.abs(px - 16) + Math.abs(py - 12);
          const shade = 1.2 - dist * 0.08;
          setPixel(d, sw, sh, px, py, rgbToABGR(
            clamp(Math.floor(80 * shade), 0, 255),
            clamp(Math.floor(255 * shade), 0, 255),
            clamp(Math.floor(140 * shade), 0, 255)
          ));
        }
      }
    }
    // Glow ring
    for (let py = 0; py < sh; py++) {
      for (let px = 0; px < sw; px++) {
        const dist = Math.abs(px - 16) + Math.abs(py - 12);
        if (dist >= 9 && dist < 11 && Math.abs(py - 12) < 10) {
          if (!d[py * sw + px]) {
            setPixel(d, sw, sh, px, py, rgbToABGR(40, 160, 80));
          }
        }
      }
    }
  }

  /* ================================================================ */
  /*  PROP SPRITES (decorative environment objects)                     */
  /* ================================================================ */

  // Wooden crate with slats (36x40)
  sprites.propCrate = createSprite(36, 40, () => 0);
  {
    const d = sprites.propCrate.data;
    const sw = 36, sh = 40;
    // Main crate body
    shadedRect(d, sw, sh, 2, 4, 32, 32, 140, 100, 55, 0);
    // Top face (lighter, perspective)
    shadedRect(d, sw, sh, 2, 2, 32, 4, 160, 120, 70, 0);
    // Wooden slats (horizontal lines)
    for (let s = 0; s < 4; s++) {
      fillRect(d, sw, sh, 2, 10 + s * 8, 32, 1, rgbToABGR(100, 70, 35));
    }
    // Cross brace
    drawLine(d, sw, sh, 4, 6, 32, 34, 2, rgbToABGR(120, 85, 45));
    drawLine(d, sw, sh, 32, 6, 4, 34, 2, rgbToABGR(120, 85, 45));
    // Edge highlights
    fillRect(d, sw, sh, 2, 4, 1, 32, rgbToABGR(165, 125, 75)); // left edge highlight
    fillRect(d, sw, sh, 33, 4, 1, 32, rgbToABGR(110, 75, 40)); // right edge shadow
    // Bottom shadow
    fillRect(d, sw, sh, 0, 36, 36, 4, rgbToABGR(40, 30, 20));
    // Nail heads
    setPixel(d, sw, sh, 6, 8, rgbToABGR(160, 160, 170));
    setPixel(d, sw, sh, 29, 8, rgbToABGR(160, 160, 170));
    setPixel(d, sw, sh, 6, 32, rgbToABGR(160, 160, 170));
    setPixel(d, sw, sh, 29, 32, rgbToABGR(160, 160, 170));
  }

  // Stacked crates (48x64)
  sprites.propCrateStack = createSprite(48, 64, () => 0);
  {
    const d = sprites.propCrateStack.data;
    const sw = 48, sh = 64;
    // Bottom crate (larger)
    shadedRect(d, sw, sh, 4, 34, 40, 26, 130, 92, 50, 0);
    fillRect(d, sw, sh, 4, 34, 40, 2, rgbToABGR(150, 112, 65));
    for (let s = 0; s < 3; s++) fillRect(d, sw, sh, 4, 40 + s * 7, 40, 1, rgbToABGR(95, 65, 30));
    drawLine(d, sw, sh, 6, 36, 42, 58, 2, rgbToABGR(115, 80, 42));
    fillRect(d, sw, sh, 0, 60, 48, 4, rgbToABGR(40, 30, 20));

    // Top crate (smaller, offset)
    shadedRect(d, sw, sh, 10, 6, 30, 28, 145, 105, 58, 0);
    fillRect(d, sw, sh, 10, 4, 30, 4, rgbToABGR(165, 125, 72));
    for (let s = 0; s < 3; s++) fillRect(d, sw, sh, 10, 12 + s * 7, 30, 1, rgbToABGR(105, 72, 35));
    drawLine(d, sw, sh, 12, 8, 38, 32, 1.5, rgbToABGR(125, 88, 48));
    // Edge details
    fillRect(d, sw, sh, 10, 6, 1, 28, rgbToABGR(165, 125, 72));
    fillRect(d, sw, sh, 39, 6, 1, 28, rgbToABGR(110, 78, 42));
  }

  // Computer terminal with screen glow (40x56)
  sprites.propTerminal = createSprite(40, 56, () => 0);
  {
    const d = sprites.propTerminal.data;
    const sw = 40, sh = 56;
    // Base / desk
    shadedRect(d, sw, sh, 6, 42, 28, 10, 65, 70, 80, 0);
    fillRect(d, sw, sh, 4, 50, 32, 6, rgbToABGR(55, 58, 68));
    // Screen housing
    shadedRect(d, sw, sh, 8, 6, 24, 36, 55, 60, 72, 0);
    // Screen bezel
    fillRect(d, sw, sh, 10, 8, 20, 28, rgbToABGR(25, 28, 35));
    // Screen content (green text lines on dark bg)
    for (let line = 0; line < 6; line++) {
      const lw = 8 + (line * 7) % 10;
      fillRect(d, sw, sh, 12, 10 + line * 4, lw, 2, rgbToABGR(40, 200, 100));
    }
    // Cursor blink
    fillRect(d, sw, sh, 12, 34, 4, 2, rgbToABGR(80, 255, 140));
    // Screen glow effect (faint around edges)
    for (let py = 6; py < 38; py++) {
      setPixel(d, sw, sh, 9, py, rgbToABGR(20, 60, 35));
      setPixel(d, sw, sh, 30, py, rgbToABGR(20, 60, 35));
    }
    // Keyboard on desk
    shadedRect(d, sw, sh, 10, 44, 20, 4, 50, 55, 65, 0);
    for (let k = 0; k < 8; k++) {
      setPixel(d, sw, sh, 12 + k * 2, 45, rgbToABGR(70, 75, 85));
    }
    // Power LED
    setPixel(d, sw, sh, 30, 40, rgbToABGR(50, 200, 80));
  }

  // Industrial pipe bundle (48x64)
  sprites.propPipes = createSprite(48, 64, () => 0);
  {
    const d = sprites.propPipes.data;
    const sw = 48, sh = 64;
    // Three vertical pipes
    const pipePositions = [12, 22, 32];
    const pipeRadii = [5, 6, 5];
    const pipeColors: [number, number, number][] = [[85, 95, 110], [75, 82, 95], [90, 100, 115]];

    for (let i = 0; i < 3; i++) {
      const pcx = pipePositions[i];
      const pr = pipeRadii[i];
      const [pr1, pg1, pb1] = pipeColors[i];
      for (let py = 2; py < 62; py++) {
        for (let px = pcx - pr; px <= pcx + pr; px++) {
          if (px >= 0 && px < sw) {
            const adx = Math.abs(px - pcx);
            const cylShade = 0.5 + 0.7 * (1 - adx / pr);
            setPixel(d, sw, sh, px, py, rgbToABGR(
              clamp(Math.floor(pr1 * cylShade), 0, 255),
              clamp(Math.floor(pg1 * cylShade), 0, 255),
              clamp(Math.floor(pb1 * cylShade), 0, 255)
            ));
          }
        }
      }
    }

    // Pipe clamps / brackets
    for (let bracket = 0; bracket < 3; bracket++) {
      const by = 10 + bracket * 20;
      fillRect(d, sw, sh, 6, by, 36, 3, rgbToABGR(100, 105, 115));
      fillRect(d, sw, sh, 6, by, 36, 1, rgbToABGR(120, 125, 135));
    }

    // Valve on middle pipe
    fillRect(d, sw, sh, 18, 28, 8, 3, rgbToABGR(140, 50, 45));
    fillRect(d, sw, sh, 20, 26, 4, 2, rgbToABGR(160, 60, 55));

    // Steam/drip detail
    setPixel(d, sw, sh, 16, 52, rgbToABGR(60, 120, 80));
    setPixel(d, sw, sh, 16, 54, rgbToABGR(50, 100, 70));
  }

  // Rubble / debris pile (48x24)
  sprites.propDebris = createSprite(48, 24, () => 0);
  {
    const d = sprites.propDebris.data;
    const sw = 48, sh = 24;
    // Irregular rubble shapes
    // Large chunks
    shadedEllipse(d, sw, sh, 14, 16, 8, 6, 90, 85, 80, 10, 12);
    shadedEllipse(d, sw, sh, 28, 14, 10, 7, 80, 78, 72, 24, 10);
    shadedEllipse(d, sw, sh, 40, 18, 6, 5, 95, 88, 82, 37, 14);
    // Smaller debris
    shadedEllipse(d, sw, sh, 8, 18, 5, 4, 75, 70, 65, 6, 15);
    shadedEllipse(d, sw, sh, 22, 20, 4, 3, 85, 80, 75, 20, 18);
    shadedEllipse(d, sw, sh, 36, 20, 3, 3, 70, 68, 62, 34, 18);
    // Dust / fine debris
    for (let i = 0; i < 12; i++) {
      const px = 4 + ((i * 17 + 5) % 40);
      const py = 14 + ((i * 13 + 3) % 8);
      setPixel(d, sw, sh, px, py, rgbToABGR(100, 95, 88));
    }
    // Rebar / metal piece sticking out
    drawLine(d, sw, sh, 20, 8, 26, 18, 1.5, rgbToABGR(120, 100, 80));
  }

  // Structural pillar / column (32x80)
  sprites.propColumn = createSprite(32, 80, () => 0);
  {
    const d = sprites.propColumn.data;
    const sw = 32, sh = 80;
    const ccx = 16;

    // Capital (top decorative section)
    shadedRect(d, sw, sh, 6, 0, 20, 6, 130, 130, 135, 0);
    shadedRect(d, sw, sh, 8, 5, 16, 3, 120, 120, 125, 0);
    // Molding
    fillRect(d, sw, sh, 7, 6, 18, 1, rgbToABGR(140, 140, 145));

    // Main shaft with cylindrical shading
    for (let py = 8; py < 70; py++) {
      for (let px = 10; px < 22; px++) {
        const adx = Math.abs(px - ccx);
        const cylShade = 0.55 + 0.65 * (1 - adx / 6);
        setPixel(d, sw, sh, px, py, rgbToABGR(
          clamp(Math.floor(125 * cylShade), 0, 255),
          clamp(Math.floor(125 * cylShade), 0, 255),
          clamp(Math.floor(130 * cylShade), 0, 255)
        ));
      }
    }

    // Fluting detail (vertical grooves)
    for (let py = 8; py < 70; py++) {
      setPixel(d, sw, sh, 12, py, rgbToABGR(95, 95, 100));
      setPixel(d, sw, sh, 19, py, rgbToABGR(95, 95, 100));
    }

    // Base (bottom decorative section)
    shadedRect(d, sw, sh, 8, 70, 16, 3, 120, 120, 125, 2);
    shadedRect(d, sw, sh, 6, 72, 20, 8, 115, 115, 120, 2);
    fillRect(d, sw, sh, 7, 72, 18, 1, rgbToABGR(135, 135, 140));
  }

  // Floor lamp with light glow (24x48)
  sprites.propLamp = createSprite(24, 48, () => 0);
  {
    const d = sprites.propLamp.data;
    const sw = 24, sh = 48;
    const lcx = 12;

    // Light glow (soft yellow halo at top)
    for (let py = 0; py < 16; py++) {
      for (let px = 2; px < 22; px++) {
        const dist = Math.sqrt((px - lcx) * (px - lcx) + (py - 6) * (py - 6));
        if (dist < 10) {
          const glow = 0.3 * (1 - dist / 10);
          if (!d[py * sw + px]) {
            setPixel(d, sw, sh, px, py, rgbToABGR(
              clamp(Math.floor(255 * glow), 0, 255),
              clamp(Math.floor(220 * glow), 0, 255),
              clamp(Math.floor(120 * glow), 0, 255)
            ));
          }
        }
      }
    }

    // Lamp shade (cone shape)
    for (let py = 2; py < 12; py++) {
      const halfW = 3 + (py - 2) * 0.6;
      for (let px = Math.floor(lcx - halfW); px <= Math.ceil(lcx + halfW); px++) {
        if (px >= 0 && px < sw) {
          const shade = 0.7 + 0.4 * (1 - Math.abs(px - lcx) / halfW);
          setPixel(d, sw, sh, px, py, rgbToABGR(
            clamp(Math.floor(200 * shade), 0, 255),
            clamp(Math.floor(180 * shade), 0, 255),
            clamp(Math.floor(100 * shade), 0, 255)
          ));
        }
      }
    }

    // Bulb (bright yellow)
    fillEllipse(d, sw, sh, lcx, 12, 2, 2, rgbToABGR(255, 240, 160));

    // Pole
    shadedRect(d, sw, sh, 11, 14, 2, 28, 90, 90, 100, 1);

    // Base (round)
    shadedEllipse(d, sw, sh, lcx, 44, 6, 3, 80, 80, 90, lcx - 2, 42);
  }

  /* ================================================================ */
  /*  WEAPON VIEW MODELS                                               */
  /* ================================================================ */

  /* ---- PISTOL VM ---- */
  const pistolFrames = generateWeaponVM((data, sw, sh, frame) => {
    const recoil = frame === 1 ? -10 : 0;
    const tiltX = frame === 2 ? 12 : 0;
    const tiltY = frame === 2 ? 6 : 0;
    const bx = 54 + tiltX;
    const by = 30 + recoil + tiltY;

    // Barrel
    shadedRect(data, sw, sh, bx, by, 8, 30, 85, 88, 100, 0);
    // Slide (top of barrel, slightly wider)
    shadedRect(data, sw, sh, bx - 1, by, 10, 26, 95, 98, 110, 0);
    // Slide serrations
    for (let s = 0; s < 4; s++) {
      fillRect(data, sw, sh, bx, by + 2 + s * 5, 8, 1, rgbToABGR(70, 72, 82));
    }
    // Front sight
    fillRect(data, sw, sh, bx + 2, by - 2, 4, 3, rgbToABGR(75, 78, 88));
    setPixel(data, sw, sh, bx + 3, by - 2, rgbToABGR(255, 255, 255)); // sight dot
    // Rear sight
    fillRect(data, sw, sh, bx, by + 24, 3, 3, rgbToABGR(75, 78, 88));
    fillRect(data, sw, sh, bx + 5, by + 24, 3, 3, rgbToABGR(75, 78, 88));

    // Ejection port
    fillRect(data, sw, sh, bx + 7, by + 10, 2, 5, rgbToABGR(50, 52, 60));

    // Lower frame / receiver
    shadedRect(data, sw, sh, bx - 1, by + 26, 10, 12, 75, 78, 88, 0);
    // Trigger guard
    fillRect(data, sw, sh, bx - 4, by + 30, 4, 1, rgbToABGR(70, 72, 82));
    fillRect(data, sw, sh, bx - 4, by + 30, 1, 8, rgbToABGR(70, 72, 82));
    fillRect(data, sw, sh, bx - 4, by + 37, 5, 1, rgbToABGR(70, 72, 82));
    // Trigger
    fillRect(data, sw, sh, bx - 2, by + 32, 2, 4, rgbToABGR(60, 62, 70));

    // Grip (textured)
    shadedRect(data, sw, sh, bx - 1, by + 38, 10, 22, 65, 50, 35, 2);
    // Grip texture (cross-hatch)
    for (let gy = 0; gy < 10; gy++) {
      for (let gx = 0; gx < 4; gx++) {
        if ((gx + gy) % 2 === 0) {
          setPixel(data, sw, sh, bx + 1 + gx * 2, by + 40 + gy * 2, rgbToABGR(55, 42, 28));
        }
      }
    }

    // Magazine base
    fillRect(data, sw, sh, bx, by + 58, 8, 3, rgbToABGR(60, 62, 70));

    // Dominant firing hand
    drawArmoredGlove(data, sw, sh, bx - 4, by + 42, 16, 26, 'right');

    // Slide back on fire frame
    if (frame === 1) {
      // Slide moves back
      fillRect(data, sw, sh, bx - 1, by + 22, 10, 8, rgbToABGR(100, 102, 112));

      // Muzzle flash (bright orange-white gradient)
      fillEllipse(data, sw, sh, bx + 4, by - 10, 14, 12, rgbToABGR(255, 250, 180));
      fillEllipse(data, sw, sh, bx + 4, by - 10, 10, 8, rgbToABGR(255, 220, 100));
      fillEllipse(data, sw, sh, bx + 4, by - 10, 6, 5, rgbToABGR(255, 255, 220));
      // Flash spikes
      fillRect(data, sw, sh, bx + 3, by - 24, 2, 14, rgbToABGR(255, 200, 80));
      fillRect(data, sw, sh, bx - 6, by - 12, 10, 2, rgbToABGR(255, 200, 80));
      fillRect(data, sw, sh, bx + 8, by - 12, 10, 2, rgbToABGR(255, 200, 80));

      // Ejecting casing
      shadedRect(data, sw, sh, bx + 12, by + 8, 4, 8, 220, 180, 70, 3);
    }

    // Reload frame: magazine ejecting
    if (frame === 2) {
      // Mag falling out
      shadedRect(data, sw, sh, bx + 14, by + 50, 7, 16, 70, 72, 82, 0);
      fillRect(data, sw, sh, bx + 15, by + 50, 5, 2, rgbToABGR(80, 82, 92));
      // Visible rounds in mag
      fillRect(data, sw, sh, bx + 16, by + 54, 3, 3, rgbToABGR(200, 170, 60));
    }
  });
  sprites.pistolVM0 = pistolFrames[0];
  sprites.pistolVM1 = pistolFrames[1];
  sprites.pistolVM2 = pistolFrames[2];

  /* ---- SHOTGUN VM ---- */
  const shotgunFrames = generateWeaponVM((data, sw, sh, frame) => {
    const recoil = frame === 1 ? -14 : 0;
    const breakOpen = frame === 2 ? 8 : 0;
    const bx = 48;
    const by = 14 + recoil;

    // Barrel tube (upper)
    shadedRect(data, sw, sh, bx + 4, by, 6, 42, 100, 102, 112, 0);
    // Barrel tube (lower / shell tube)
    shadedRect(data, sw, sh, bx + 12, by + 4, 5, 38, 90, 92, 102, 0);
    // Barrel tip
    fillRect(data, sw, sh, bx + 3, by - 2, 8, 3, rgbToABGR(80, 82, 92));
    // Front bead sight
    setPixel(data, sw, sh, bx + 6, by - 3, rgbToABGR(255, 200, 80));

    // Receiver body
    shadedRect(data, sw, sh, bx, by + 38, 22, 14, 85, 88, 98, 0);
    // Ejection port
    fillRect(data, sw, sh, bx + 16, by + 40, 4, 6, rgbToABGR(55, 58, 65));
    // Loading gate
    fillRect(data, sw, sh, bx + 2, by + 48, 8, 3, rgbToABGR(70, 72, 80));

    // Wooden foregrip (pump)
    const pumpOff = frame === 1 ? 8 : 0;
    shadedRect(data, sw, sh, bx + 2, by + 24 + pumpOff, 14, 12, 140, 95, 50, 0);
    // Wood grain lines
    for (let g = 0; g < 3; g++) {
      fillRect(data, sw, sh, bx + 4, by + 26 + pumpOff + g * 3, 10, 1, rgbToABGR(120, 78, 38));
    }

    // Trigger guard
    fillRect(data, sw, sh, bx - 2, by + 50, 1, 8, rgbToABGR(70, 72, 82));
    fillRect(data, sw, sh, bx - 2, by + 57, 8, 1, rgbToABGR(70, 72, 82));
    // Trigger
    fillRect(data, sw, sh, bx + 2, by + 52, 2, 4, rgbToABGR(65, 67, 75));

    // Wooden stock
    shadedRect(data, sw, sh, bx + 2, by + 52 + breakOpen, 16, 28, 130, 88, 45, 2);
    // Stock butt plate
    fillRect(data, sw, sh, bx + 2, by + 78 + breakOpen, 16, 4, rgbToABGR(80, 55, 30));
    // Stock checkering
    for (let cy2 = 0; cy2 < 6; cy2++) {
      for (let cx2 = 0; cx2 < 4; cx2++) {
        if ((cx2 + cy2) % 2 === 0) {
          setPixel(data, sw, sh, bx + 5 + cx2 * 3, by + 60 + breakOpen + cy2 * 3, rgbToABGR(110, 72, 35));
        }
      }
    }

    // Two-hand hold
    drawArmoredGlove(data, sw, sh, bx + 8, by + 20 + pumpOff, 16, 18, 'left');
    drawArmoredGlove(data, sw, sh, bx - 1, by + 56 + breakOpen, 18, 24, 'right');

    if (frame === 1) {
      // Wide muzzle flash
      fillEllipse(data, sw, sh, bx + 7, by - 14, 20, 14, rgbToABGR(255, 250, 160));
      fillEllipse(data, sw, sh, bx + 7, by - 14, 14, 10, rgbToABGR(255, 200, 80));
      fillEllipse(data, sw, sh, bx + 7, by - 14, 8, 6, rgbToABGR(255, 255, 220));
      // Spread lines
      for (let a = 0; a < 6; a++) {
        const angle = (a / 6) * Math.PI - Math.PI / 2;
        const lx = bx + 7 + Math.cos(angle) * 22;
        const ly = by - 14 + Math.sin(angle) * 16;
        drawLine(data, sw, sh, bx + 7, by - 14, Math.round(lx), Math.round(ly), 1, rgbToABGR(255, 180, 60));
      }
    }

    if (frame === 2) {
      // Shell being inserted (break action open - barrel rotated up)
      // Shell
      shadedRect(data, sw, sh, bx + 20, by + 40, 5, 12, 200, 50, 40, 0);
      fillRect(data, sw, sh, bx + 20, by + 40, 5, 2, rgbToABGR(220, 180, 60)); // brass base
    }
  });
  sprites.shotgunVM0 = shotgunFrames[0];
  sprites.shotgunVM1 = shotgunFrames[1];
  sprites.shotgunVM2 = shotgunFrames[2];

  /* ---- MACHINEGUN VM ---- */
  const mgFrames = generateWeaponVM((data, sw, sh, frame) => {
    const recoil = frame === 1 ? -7 : 0;
    const magOff = frame === 2 ? 16 : 0;
    const bx = 48;
    const by = 10 + recoil;

    // Barrel with shroud
    shadedRect(data, sw, sh, bx + 6, by, 12, 40, 60, 68, 78, 0);
    // Barrel shroud vents
    for (let v = 0; v < 5; v++) {
      fillRect(data, sw, sh, bx + 8, by + 4 + v * 7, 8, 2, rgbToABGR(35, 40, 48));
    }
    // Barrel tip / compensator
    fillRect(data, sw, sh, bx + 5, by - 4, 14, 5, rgbToABGR(55, 60, 70));
    fillRect(data, sw, sh, bx + 7, by - 6, 10, 3, rgbToABGR(50, 55, 65));
    // Front sight post
    fillRect(data, sw, sh, bx + 10, by - 8, 4, 3, rgbToABGR(65, 70, 80));
    setPixel(data, sw, sh, bx + 11, by - 9, rgbToABGR(255, 255, 255));

    // Top rail (picatinny)
    shadedRect(data, sw, sh, bx + 6, by + 2, 12, 2, 55, 60, 70, 0);
    for (let r = 0; r < 6; r++) {
      fillRect(data, sw, sh, bx + 7 + r * 2, by + 2, 1, 2, rgbToABGR(45, 50, 58));
    }

    // Upper receiver
    shadedRect(data, sw, sh, bx + 2, by + 38, 20, 16, 55, 62, 72, 0);
    // Ejection port
    fillRect(data, sw, sh, bx + 18, by + 42, 3, 6, rgbToABGR(40, 44, 52));
    // Charging handle
    fillRect(data, sw, sh, bx + 8, by + 38, 8, 2, rgbToABGR(65, 70, 80));

    // Lower receiver
    shadedRect(data, sw, sh, bx + 2, by + 54, 20, 10, 50, 56, 65, 0);

    // Magazine well
    fillRect(data, sw, sh, bx + 6, by + 60, 10, 4, rgbToABGR(45, 50, 58));
    // Magazine
    shadedRect(data, sw, sh, bx + 6, by + 62 + magOff, 10, 22, 50, 55, 62, 0);
    // Magazine base plate
    fillRect(data, sw, sh, bx + 5, by + 82 + magOff, 12, 2, rgbToABGR(55, 60, 68));

    // Trigger guard
    fillRect(data, sw, sh, bx, by + 60, 1, 8, rgbToABGR(55, 60, 68));
    fillRect(data, sw, sh, bx, by + 67, 7, 1, rgbToABGR(55, 60, 68));
    // Trigger
    fillRect(data, sw, sh, bx + 3, by + 62, 2, 4, rgbToABGR(50, 55, 62));

    // Pistol grip
    shadedRect(data, sw, sh, bx + 2, by + 64, 8, 18, 50, 55, 62, 2);
    // Grip texture
    for (let gy = 0; gy < 4; gy++) {
      for (let gx = 0; gx < 3; gx++) {
        if ((gx + gy) % 2 === 0) {
          setPixel(data, sw, sh, bx + 3 + gx * 2, by + 68 + gy * 3, rgbToABGR(40, 44, 52));
        }
      }
    }

    // Buffer tube / stock
    shadedRect(data, sw, sh, bx + 14, by + 54, 6, 8, 52, 58, 66, 3);
    shadedRect(data, sw, sh, bx + 18, by + 56, 12, 24, 48, 54, 62, 3);
    // Stock butt pad
    fillRect(data, sw, sh, bx + 28, by + 58, 3, 20, rgbToABGR(40, 44, 52));

    // Operator hands
    drawArmoredGlove(data, sw, sh, bx + 10, by + 32, 16, 18, 'left');
    drawArmoredGlove(data, sw, sh, bx - 1, by + 62, 14, 22, 'right');

    if (frame === 1) {
      // Rapid muzzle flash
      fillEllipse(data, sw, sh, bx + 12, by - 16, 16, 12, rgbToABGR(255, 250, 180));
      fillEllipse(data, sw, sh, bx + 12, by - 16, 10, 8, rgbToABGR(255, 200, 80));
      fillEllipse(data, sw, sh, bx + 12, by - 16, 5, 4, rgbToABGR(255, 255, 230));
      // Flash streaks
      fillRect(data, sw, sh, bx + 11, by - 30, 2, 14, rgbToABGR(255, 220, 100));
      fillRect(data, sw, sh, bx - 2, by - 18, 12, 2, rgbToABGR(255, 200, 60));
      fillRect(data, sw, sh, bx + 16, by - 18, 12, 2, rgbToABGR(255, 200, 60));

      // Ejecting casing
      shadedRect(data, sw, sh, bx + 24, by + 38, 4, 8, 220, 180, 70, 3);
    }

    if (frame === 2) {
      // Magazine being removed (magOff already shifts it down)
      // Hand visible removing mag
      fillEllipse(data, sw, sh, bx + 12, by + 76, 8, 5, rgbToABGR(140, 110, 85));
    }
  });
  sprites.machinegunVM0 = mgFrames[0];
  sprites.machinegunVM1 = mgFrames[1];
  sprites.machinegunVM2 = mgFrames[2];

  /* ---- PLASMA CASTER VM ---- */
  const plasmaFrames = generateWeaponVM((data, sw, sh, frame) => {
    const recoil = frame === 1 ? -6 : 0;
    const rechargeOff = frame === 2 ? 4 : 0;
    const bx = 44;
    const by = 14 + recoil;

    // Wide barrel housing
    shadedRect(data, sw, sh, bx + 8, by, 24, 12, 55, 60, 78, 0);
    // Barrel opening
    fillRect(data, sw, sh, bx + 12, by - 2, 16, 4, rgbToABGR(45, 50, 65));
    fillRect(data, sw, sh, bx + 14, by - 1, 12, 2, rgbToABGR(35, 40, 55));
    // Barrel inner glow (frame dependent)
    if (frame !== 2) {
      fillRect(data, sw, sh, bx + 16, by, 8, 2, rgbToABGR(50, 140, 220));
    }

    // Main body
    shadedRect(data, sw, sh, bx + 6, by + 10, 28, 30, 50, 55, 70, 0);

    // Side pylons (left)
    shadedRect(data, sw, sh, bx - 4, by + 12, 12, 22, 48, 52, 68, 1);
    fillRect(data, sw, sh, bx - 2, by + 14, 2, 18, rgbToABGR(50, 160, 240)); // left pylon glow strip
    // Side pylons (right)
    shadedRect(data, sw, sh, bx + 32, by + 12, 12, 22, 48, 52, 68, 3);
    fillRect(data, sw, sh, bx + 40, by + 14, 2, 18, rgbToABGR(50, 160, 240)); // right pylon glow strip

    // Energy core (center glow)
    const coreBright = frame === 2 ? 0.4 : 1.0;
    const coreX = bx + 20, coreY = by + 24;
    if (frame !== 2) {
      // Full glow
      fillEllipse(data, sw, sh, coreX, coreY, 8, 8, rgbToABGR(
        Math.floor(40 * coreBright),
        Math.floor(160 * coreBright),
        Math.floor(255 * coreBright)
      ));
      fillEllipse(data, sw, sh, coreX, coreY, 5, 5, rgbToABGR(
        Math.floor(100 * coreBright),
        Math.floor(220 * coreBright),
        255
      ));
      fillEllipse(data, sw, sh, coreX, coreY, 2, 2, rgbToABGR(200, 245, 255));
    } else {
      // Recharging - dimmer, with energy swirl suggestion
      fillEllipse(data, sw, sh, coreX, coreY, 8, 8, rgbToABGR(25, 60, 100));
      fillEllipse(data, sw, sh, coreX, coreY, 5, 5, rgbToABGR(35, 80, 130));
      // Swirl dots
      setPixel(data, sw, sh, coreX + 3, coreY - 2, rgbToABGR(60, 160, 240));
      setPixel(data, sw, sh, coreX - 2, coreY + 3, rgbToABGR(60, 160, 240));
      setPixel(data, sw, sh, coreX + 1, coreY + 4, rgbToABGR(50, 130, 200));
      setPixel(data, sw, sh, coreX - 3, coreY - 1, rgbToABGR(50, 130, 200));
    }

    // Core housing ring
    for (let a = 0; a < 16; a++) {
      const angle = (a / 16) * Math.PI * 2;
      const rx = coreX + Math.cos(angle) * 10;
      const ry = coreY + Math.sin(angle) * 10;
      setPixel(data, sw, sh, Math.round(rx), Math.round(ry), rgbToABGR(60, 65, 80));
    }

    // Lower grip area
    shadedRect(data, sw, sh, bx + 10, by + 40 + rechargeOff, 20, 24, 45, 48, 62, 2);
    // Grip ridges
    for (let g = 0; g < 5; g++) {
      fillRect(data, sw, sh, bx + 12, by + 44 + rechargeOff + g * 4, 16, 1, rgbToABGR(38, 40, 52));
    }

    // Stock / rear extension
    shadedRect(data, sw, sh, bx + 12, by + 62 + rechargeOff, 16, 16, 42, 45, 58, 2);
    fillRect(data, sw, sh, bx + 14, by + 76 + rechargeOff, 12, 3, rgbToABGR(38, 40, 52));

    // Trigger area
    fillRect(data, sw, sh, bx + 6, by + 42, 1, 8, rgbToABGR(45, 48, 60));
    fillRect(data, sw, sh, bx + 6, by + 49, 6, 1, rgbToABGR(45, 48, 60));
    fillRect(data, sw, sh, bx + 8, by + 44, 2, 4, rgbToABGR(40, 42, 55));

    // Pylon energy conduit lines to core
    drawLine(data, sw, sh, bx, by + 24, bx + 12, coreY, 1, rgbToABGR(40, 130, 200));
    drawLine(data, sw, sh, bx + 40, by + 24, bx + 28, coreY, 1, rgbToABGR(40, 130, 200));

    // Reinforced gauntlets framing the caster
    drawArmoredGlove(data, sw, sh, bx - 6, by + 16, 16, 18, 'left');
    drawArmoredGlove(data, sw, sh, bx + 10, by + 44 + rechargeOff, 16, 24, 'right');

    if (frame === 1) {
      // Large blue-white energy burst
      fillEllipse(data, sw, sh, bx + 20, by - 12, 22, 18, rgbToABGR(80, 180, 255));
      fillEllipse(data, sw, sh, bx + 20, by - 12, 16, 12, rgbToABGR(120, 220, 255));
      fillEllipse(data, sw, sh, bx + 20, by - 12, 8, 6, rgbToABGR(200, 245, 255));
      // Energy tendrils
      drawLine(data, sw, sh, bx + 20, by - 12, bx + 20, by - 34, 2, rgbToABGR(100, 200, 255));
      drawLine(data, sw, sh, bx + 20, by - 12, bx, by - 22, 1.5, rgbToABGR(80, 180, 255));
      drawLine(data, sw, sh, bx + 20, by - 12, bx + 40, by - 22, 1.5, rgbToABGR(80, 180, 255));
      // Core flaring
      fillEllipse(data, sw, sh, coreX, coreY, 10, 10, rgbToABGR(100, 200, 255));
    }
  });
  sprites.plasmaVM0 = plasmaFrames[0];
  sprites.plasmaVM1 = plasmaFrames[1];
  sprites.plasmaVM2 = plasmaFrames[2];

  _spriteCache = sprites;
  return sprites;
}
