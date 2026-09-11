import { describe, expect, it } from 'vitest';
import type { RoutePoint } from '../timeline/types';
import { buildRoutePointDayNumbers, colorRouteSegments, DAY_ROUTE_COLORS, dayRouteColor } from './dayRouteColor';

describe('DAY route colors', () => {
  it('cycles the fixed palette after DAY 10', () => {
    expect(dayRouteColor(1)).toBe(DAY_ROUTE_COLORS[0]);
    expect(dayRouteColor(10)).toBe(DAY_ROUTE_COLORS[9]);
    expect(dayRouteColor(11)).toBe(DAY_ROUTE_COLORS[0]);
    expect(dayRouteColor(12)).toBe(DAY_ROUTE_COLORS[1]);
    expect(dayRouteColor(0)).toBe(DAY_ROUTE_COLORS[0]);
  });

  it('retains full-route DAY numbers for an animation range', () => {
    const points: RoutePoint[] = ['a', 'b', 'c', 'd'].map((id) => ({ id, latitude: 35, longitude: 139, source: 'manual', original: false }));
    const dayNumbers = buildRoutePointDayNumbers(points, [
      { dayNumber: 1, pointId: 'a' }, { dayNumber: 2, pointId: 'b' }, { dayNumber: 3, pointId: 'c' },
    ]);
    expect(points.slice(2).map((point) => dayNumbers.get(point.id))).toEqual([3, 3]);
  });

  it('preserves an existing connector while changing the following DAY color', () => {
    const points: RoutePoint[] = ['a', 'b', 'c'].map((id) => ({ id, latitude: 35, longitude: 139, source: 'manual', original: false }));
    const dayNumbers = buildRoutePointDayNumbers(points, [{ dayNumber: 1, pointId: 'a' }, { dayNumber: 2, pointId: 'b' }]);
    const segments = colorRouteSegments([points], dayNumbers, true);
    expect(segments.map((segment) => segment.points.map((point) => point.id))).toEqual([['a', 'b'], ['b', 'c']]);
    expect(segments.map((segment) => segment.color)).toEqual([DAY_ROUTE_COLORS[0], DAY_ROUTE_COLORS[1]]);
  });
});
