import { describe, expect, it } from 'vitest';
import { addPoint, deletePoint, movePoint } from './editor';
import { distanceMeters, interpolateRoute, routeDistance } from './geometry';
import { emptyHistory, historyReducer } from './history';
import type { RoutePoint } from '../timeline/types';

const point = (id: string, latitude: number, longitude: number): RoutePoint => ({ id, latitude, longitude, source: 'timelinePath', original: true });
const route = [point('a', 35, 139), point('b', 35, 140), point('c', 35, 142)];

describe('route geometry', () => {
  it('calculates route distance', () => expect(routeDistance(route)).toBeCloseTo(distanceMeters(route[0], route[1]) + distanceMeters(route[1], route[2]), 5));
  it('interpolates by cumulative distance, not point index', () => {
    const middle = interpolateRoute(route, 0.5)!;
    expect(middle.segmentIndex).toBe(1);
    expect(middle.longitude).toBeCloseTo(140.5, 1);
  });
});

describe('route editing', () => {
  it('adds into the nearest segment', () => expect(addPoint(route, 35, 140.5, 'new').map((item) => item.id)).toEqual(['a', 'b', 'new', 'c']));
  it('deletes a point', () => expect(deletePoint(route, 'b').map((item) => item.id)).toEqual(['a', 'c']));
  it('moves a point', () => expect(movePoint(route, 'b', 36, 141).find((item) => item.id === 'b')).toMatchObject({ latitude: 36, longitude: 141, original: false }));
  it('supports undo and redo', () => {
    let state = historyReducer(emptyHistory, { type: 'load', points: route });
    const edited = deletePoint(route, 'b');
    state = historyReducer(state, { type: 'commit', points: edited });
    state = historyReducer(state, { type: 'undo' });
    expect(state.present).toEqual(route);
    state = historyReducer(state, { type: 'redo' });
    expect(state.present).toEqual(edited);
  });
});
