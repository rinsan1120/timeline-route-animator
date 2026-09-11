import { describe, expect, it, vi } from 'vitest';
import type { RoutePoint } from '../timeline/types';
import { distanceMeters } from './geometry';
import { deriveDayMarkers, derivePlanDayMarkers, planRouteDistances, routeDistancesByDay } from './tripRoute';
import { buildRouteDistanceModel, routeDistanceProgress } from './routeDistanceProgress';
import { distanceHudLayout, drawDistanceHudPanel } from '../video/distanceHud';
import { dayRouteColor } from './dayRouteColor';

const points: RoutePoint[] = [0, 1, 10, 11].map((longitude, index) => ({
  id: String(index), latitude: 0, longitude, source: 'timelinePath', original: true,
  timestamp: `2026-09-${index < 2 ? '01' : '10'}T12:0${index}:00+09:00`,
}));
const markers = deriveDayMarkers(points, {});
const segment = distanceMeters(points[0], points[1]);

describe('shared route distance HUD', () => {
  it('preserves plan distances and excludes the connection across DAY boundaries', () => {
    const starts = ['2'];
    const totals = planRouteDistances(points, starts);
    expect(totals.days.map(day => day.dayNumber)).toEqual([1, 2]);
    expect(totals.days.map(day => day.distanceMeters)).toEqual([segment, segment]);
    expect(totals.totalMeters).toBeCloseTo(segment * 2);
    expect(buildRouteDistanceModel(points, derivePlanDayMarkers(points, starts, {}), points).totals).toEqual(totals);
  });

  it('uses Timeline markers and retains calendar DAY numbers including gaps', () => {
    const totals = routeDistancesByDay(points, markers);
    expect(totals.days.map(day => day.dayNumber)).toEqual([1, 10]);
    expect(totals.days.map(day => day.pointId)).toEqual(['0', '2']);
    expect(totals.totalMeters).toBeCloseTo(segment * 2);
  });

  it('falls back to DAY 1 without markers and handles empty and single-point routes', () => {
    expect(routeDistancesByDay(points, []).totalMeters).toBeCloseTo(segment * 11);
    expect(routeDistancesByDay([points[0]], []).days).toEqual([{ dayNumber: 1, pointId: '0', distanceMeters: 0 }]);
    expect(routeDistanceProgress(buildRouteDistanceModel([], [], []), null).days).toEqual([]);
    expect(routeDistanceProgress(buildRouteDistanceModel(points, [], points), null).days[0].dayNumber).toBe(1);
  });

  it('shares final totals and progress while respecting DAY transitions and reached points', () => {
    const model = buildRouteDistanceModel(points, markers, points);
    expect(routeDistanceProgress(model, null).currentTotalMeters).toBeCloseTo(segment * 2);
    expect(routeDistanceProgress(model, 0.25).currentTotalMeters).toBeCloseTo(segment / 2);
    const boundary = routeDistanceProgress(model, 0.5);
    expect(boundary.days.map(day => day.currentMeters)).toEqual([segment, 0]);
    expect(routeDistanceProgress(model, 0.5, 1).currentTotalMeters).toBeCloseTo(segment);
    expect(routeDistanceProgress(model, 0.75).currentTotalMeters).toBeCloseTo(segment * 1.5);
    expect(routeDistanceProgress(model, 1).currentTotalMeters).toBeCloseTo(segment * 2);
    const range = buildRouteDistanceModel(points, markers, points.slice(2));
    expect(routeDistanceProgress(range, 0).currentTotalMeters).toBeCloseTo(segment);
    expect(routeDistanceProgress(range, 0.5).currentTotalMeters).toBeCloseTo(segment * 1.5);
    expect(routeDistanceProgress(range, null)).toEqual(routeDistanceProgress(model, null));
  });

  it('sizes actual DAY labels and draws their existing DAY colors', () => {
    const model = buildRouteDistanceModel(points, markers, points);
    const plan = buildRouteDistanceModel(points, derivePlanDayMarkers(points, ['2'], {}), points);
    // Use a long total so the minimum panel width does not hide the label-width difference.
    const wideModel = { ...model, totals: { ...model.totals, totalMeters: 123456789 } };
    const widePlan = { ...plan, totals: { ...plan.totals, totalMeters: 123456789 } };
    expect(distanceHudLayout(wideModel, 1).width).toBe(distanceHudLayout(widePlan, 1).width + 17);
    const fills: string[] = [];
    const context = {
      save: vi.fn(), restore: vi.fn(), beginPath: vi.fn(), roundRect: vi.fn(), stroke: vi.fn(),
      moveTo: vi.fn(), lineTo: vi.fn(), fillText: vi.fn(), fillStyle: '',
      fill() { fills.push(this.fillStyle); },
    };
    drawDistanceHudPanel(context as unknown as CanvasRenderingContext2D, routeDistanceProgress(model, null), distanceHudLayout(model, 1), true);
    expect(fills.slice(1)).toEqual([dayRouteColor(1), dayRouteColor(10)]);
    expect(context.fillText.mock.calls.map(call => call[0])).toContain('DAY 10');
  });
});
