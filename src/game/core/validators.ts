import type { LevelDefinition } from './types';

export function validateLevelDefinition(level: LevelDefinition): string[] {
  const errors: string[] = [];

  if (!level.map.length || !level.map[0].length) {
    errors.push(`${level.id}: map must not be empty`);
  }

  const width = level.map[0]?.length ?? 0;
  for (const row of level.map) {
    if (row.length !== width) {
      errors.push(`${level.id}: map rows must all have the same width`);
      break;
    }
  }

  const checkpointIds = new Set(level.checkpoints.map((checkpoint) => checkpoint.id));
  const objectiveIds = new Set(level.objectives.map((objective) => objective.id));
  const generatorIds = new Set(level.entities.generators.map((generator) => generator.id));

  if (!objectiveIds.has(level.objectiveStart)) {
    errors.push(`${level.id}: objectiveStart "${level.objectiveStart}" is missing`);
  }

  for (const trigger of level.triggers) {
    for (const action of trigger.actions) {
      if (action.type === 'activateCheckpoint' && !checkpointIds.has(action.checkpointId)) {
        errors.push(`${level.id}: trigger "${trigger.id}" references missing checkpoint "${action.checkpointId}"`);
      }
      if (action.type === 'setObjective' && !objectiveIds.has(action.objectiveId)) {
        errors.push(`${level.id}: trigger "${trigger.id}" references missing objective "${action.objectiveId}"`);
      }
      if (action.type === 'activateGenerators') {
        for (const generatorId of action.generatorIds) {
          if (!generatorIds.has(generatorId)) {
            errors.push(`${level.id}: trigger "${trigger.id}" references missing generator "${generatorId}"`);
          }
        }
      }
    }
  }

  return errors;
}
