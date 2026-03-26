import { describe, expect, it } from 'vitest';
import { validateLevelDefinition } from '../src/game/core/validators';
import { LEVELS } from '../src/game/data/levels';

describe('content validation', () => {
  it('validates every level definition', () => {
    const errors = LEVELS.flatMap((level) => validateLevelDefinition(level));
    expect(errors).toEqual([]);
  });

  it('ships a four-act campaign', () => {
    expect(LEVELS).toHaveLength(4);
    expect(LEVELS.map((level) => level.actTitle)).toEqual([
      'Act I // Breach Protocol',
      'Act II // Industrial Escalation',
      'Act III // Security Lockdown',
      'Act IV // Reactor Core',
    ]);
  });
});
