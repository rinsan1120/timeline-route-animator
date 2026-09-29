import { describe, expect, it } from 'vitest';
import type { RoutePoint } from '../timeline/types';
import { hasRecordedRouteTime, sampleRecordedRouteTime, followClockPointIndex, routeClockRect } from './routeClock';
import { buildOverviewPlaybackTimeline, samplePlaybackTimeline } from './playbackTimeline';
import { buildFollowCameraPlan, buildFollowPlaybackTimeline, sampleFollowOutputPlayback } from './followCamera';

const point = (longitude: number, timestamp?: string): RoutePoint => ({
  id: String(longitude), latitude: 0, longitude, timestamp,
  source: timestamp ? 'timelinePath' : 'manual', original: !!timestamp,
});
const route = [point(0, '2026-09-23T14:30:00+09:00'), point(1, '2026-09-23T14:40:00+09:00')];

describe('recorded route clock', () => {
  it('uses recorded endpoint times and clamps start/end holds', () => {
    expect(sampleRecordedRouteTime(route, 0)).toBe('14:30');
    expect(sampleRecordedRouteTime(route, 1)).toBe('14:40');
    expect(sampleRecordedRouteTime(route, -1)).toBe('14:30');
    expect(sampleRecordedRouteTime(route, 2)).toBe('14:40');
  });
  it('interpolates at 50% and 60% by route distance', () => {
    expect(sampleRecordedRouteTime(route, 0.5)).toBe('14:35');
    expect(sampleRecordedRouteTime(route, 0.6)).toBe('14:36');
  });
  it('bridges uneven manual points without writing timestamps', () => {
    const points = [route[0], point(0.1), point(0.6), route[1]];
    const before = JSON.stringify(points);
    expect(sampleRecordedRouteTime(points, 0.5)).toBe('14:35');
    expect(sampleRecordedRouteTime(points, 0.6, 2)).toBe('14:36');
    expect(JSON.stringify(points)).toBe(before);
  });
  it('holds recorded and inferred times at pausePointIndex', () => {
    expect(sampleRecordedRouteTime(route, 0.9, 0)).toBe('14:30');
    expect(sampleRecordedRouteTime(route, 0.1, 1)).toBe('14:40');
    const points = [route[0], point(0.6), route[1]];
    expect(sampleRecordedRouteTime(points, 0.1, 1)).toBe('14:36');
    expect(sampleRecordedRouteTime(points, 0.9, 1)).toBe('14:36');
  });
  it('switches DAYs without interpolating overnight', () => {
    const points = [point(0, '2026-09-23T17:00:00+09:00'), point(1, '2026-09-23T18:00:00+09:00'),
      point(2, '2026-09-24T08:00:00+09:00'), point(3, '2026-09-24T09:00:00+09:00')];
    expect(sampleRecordedRouteTime(points, 0.5, 1)).toBe('18:00');
    expect(sampleRecordedRouteTime(points, 0.5)).toBe('08:00');
    expect(sampleRecordedRouteTime(points, 0.75)).toBe('08:30');
    expect(sampleRecordedRouteTime([points[1], point(1.5), points[2]], 0.5)).toBeNull();
  });
  it('does not extrapolate or use anchors outside animationPoints', () => {
    const points = [point(-1), ...route, point(2)];
    expect(sampleRecordedRouteTime(points, 0.1)).toBeNull();
    expect(sampleRecordedRouteTime(points, 0.9)).toBeNull();
    expect(sampleRecordedRouteTime([point(0.5), route[1]], 0.5)).toBeNull();
    expect(hasRecordedRouteTime([point(0), point(1)])).toBe(false);
    expect(hasRecordedRouteTime([route[0], point(1)])).toBe(false);
    expect(hasRecordedRouteTime(route)).toBe(true);
  });
  it('ignores invalid timestamps and rejects reversed time interpolation', () => {
    expect(sampleRecordedRouteTime([point(0, 'invalid'), route[1]], 0.5)).toBeNull();
    expect(sampleRecordedRouteTime([route[0], point(0.5, 'invalid'), route[1]], 0.5)).toBe('14:35');
    expect(sampleRecordedRouteTime([point(0, route[1].timestamp), point(1, route[0].timestamp)], 0.5)).toBeNull();
    expect(sampleRecordedRouteTime([], 0)).toBeNull();
    expect(sampleRecordedRouteTime(route, NaN)).toBeNull();
  });
  it('respects recorded offsets, including offset changes and missing offsets', () => {
    expect(sampleRecordedRouteTime([point(0, '2026-09-23T14:37:00-04:00')], 0)).toBe('14:37');
    expect(sampleRecordedRouteTime([point(0, '2026-09-23T14:37:00Z')], 0)).toBe('14:37');
    expect(sampleRecordedRouteTime([point(0, '2026-09-23T14:37:00')], 0)).toBe('14:37');
    const changed = [point(0, '2026-09-23T14:30:00+09:00'), point(1, '2026-09-23T13:40:00+08:00')];
    expect(sampleRecordedRouteTime(changed, 0.5)).toBe('14:35');
    expect(sampleRecordedRouteTime(changed, 1)).toBe('13:40');
  });
  it('is independent of video duration and freezes during playback pauses', () => {
    for (const duration of [10, 30, 60]) {
      const points = [route[0], point(0.5, '2026-09-23T14:35:00+09:00'), route[1]];
      const timeline = buildOverviewPlaybackTimeline(points, duration, [0, 2, 0]);
      for (const delta of [0.1, 1.9]) {
        const sample = samplePlaybackTimeline(timeline, duration / 2 + delta);
        expect(sampleRecordedRouteTime(points, sample.baseElapsedSeconds / duration, sample.pausePointIndex)).toBe('14:35');
      }
    }
  });
  it('holds time through Follow pans, DAY transitions and balloon pauses', () => {
    const points = [...route, point(2, '2026-09-24T08:00:00+09:00'), point(3, '2026-09-24T09:00:00+09:00')];
    const plan = buildFollowCameraPlan(points, 'standard', 60);
    const timeline = buildFollowPlaybackTimeline(plan);
    expect(plan.events.some((event) => event.type === 'day-transition')).toBe(true);
    expect(plan.events.some((event) => event.type !== 'day-transition')).toBe(true);
    for (const event of plan.events) {
      const times = [0.1, 0.9].map((fraction) => {
        const elapsed = event.startSeconds + (event.endSeconds - event.startSeconds) * fraction;
        const playback = sampleFollowOutputPlayback(plan, timeline, elapsed);
        return sampleRecordedRouteTime(points, playback.routeProgress,
          followClockPointIndex(playback, samplePlaybackTimeline(timeline, elapsed).pausePointIndex));
      });
      expect(times[0]).not.toBeNull();
      expect(times[0]).toBe(times[1]);
      if (event.type === 'day-transition') expect(times[0]).toBe('14:40');
    }
    const pausedTimeline = buildFollowPlaybackTimeline(plan, [2, 0, 0, 0]);
    const playback = sampleFollowOutputPlayback(plan, pausedTimeline, 1);
    expect(sampleRecordedRouteTime(points, playback.routeProgress,
      followClockPointIndex(playback, samplePlaybackTimeline(pausedTimeline, 1).pausePointIndex))).toBe('14:30');
  });
  it('places the clock above the marker or below it at the top edge', () => {
    expect(routeClockRect(100, 100, 200, 200)).toMatchObject({ x: 72, y: 59, width: 56, height: 24 });
    const top = routeClockRect(10, 10, 200, 200);
    expect(top.x).toBe(0);
    expect(top.y).toBeGreaterThan(21);
  });
});
