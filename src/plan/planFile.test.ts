import { describe, expect, it } from 'vitest';
import { parsePlanFile, PLAN_FILE_FORMAT, PLAN_FILE_VERSION, serializePlanFile } from './planFile';

const base = {
  format: PLAN_FILE_FORMAT,
  version: PLAN_FILE_VERSION,
  savedAt: '2026-01-01T00:00:00.000Z',
  planDayStarts: [],
  planDayNotes: {},
  dayMarkerPlacements: {},
};

describe('plan file point pauses', () => {
  it('loads old plan JSON without pauseSeconds', () => {
    const points = [{ id: 'a', latitude: 35, longitude: 139, source: 'manual', original: false }];
    expect(parsePlanFile(JSON.stringify({ ...base, points })).points[0].pauseSeconds).toBeUndefined();
  });

  it('saves and restores pauseSeconds', () => {
    const state = {
      points: [{ id: 'a', latitude: 35, longitude: 139, source: 'manual' as const, original: false, pauseSeconds: 3 }],
      planDayStarts: [], planDayNotes: {}, dayMarkerPlacements: {},
    };
    expect(parsePlanFile(serializePlanFile(state)).points[0].pauseSeconds).toBe(3);
  });

  it('rejects an out-of-range pauseSeconds', () => {
    const points = [{ id: 'a', latitude: 35, longitude: 139, source: 'manual', original: false, pauseSeconds: 31 }];
    expect(() => parsePlanFile(JSON.stringify({ ...base, points }))).toThrow();
  });
});
