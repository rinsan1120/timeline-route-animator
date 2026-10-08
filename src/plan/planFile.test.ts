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
  it('keeps framePosition and legacy placement without changing the file version', () => {
    const points = [{ id: 'a', latitude: 35, longitude: 139, source: 'manual' as const, original: false,
      annotation: { label: '地点', placement: { offsetX: 100, offsetY: -80 }, framePosition: { x: 0.8, y: 0.2 } } }];
    const parsed = parsePlanFile(JSON.stringify({ ...base, points, unknown: true }));
    expect(parsed.points).toEqual(points);
    expect(parsePlanFile(serializePlanFile(parsed)).points).toEqual(points);
    expect(JSON.parse(serializePlanFile(parsed)).version).toBe(1);
  });
  it.each([{ x: 0, y: -1 }, { x: 0, y: 1.1 }, { x: 2, y: 0 }, { x: '0', y: 0 }, { x: 0, y: null }])('rejects invalid fixed coordinates %j', (framePosition) => {
    const points = [{ id: 'a', latitude: 35, longitude: 139, source: 'manual', original: false, annotation: { label: '地点', framePosition } }];
    expect(() => parsePlanFile(JSON.stringify({ ...base, points }))).toThrow();
  });
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
