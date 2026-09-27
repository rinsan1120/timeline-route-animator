import { describe, expect, it } from 'vitest';
import type { RoutePoint } from '../timeline/types';
import { deriveDayMarkers, derivePlanDayMarkers } from '../route/tripRoute';
import { balloonPauseSeconds } from './balloonPauses';
import { buildOverviewPlaybackTimeline } from './playbackTimeline';
import { buildFollowCameraPlan, buildFollowPlaybackTimeline, sampleFollowOutputPlayback } from './followCamera';

const points: RoutePoint[] = [0, 1, 2, 3].map((index) => ({
  id: String(index), latitude: 35, longitude: 139 + index * 0.001,
  timestamp: `2026-09-0${index < 2 ? 1 : 2}T10:00:00+09:00`,
  source: 'timelinePath', original: true, pauseSeconds: 5,
}));

describe('common balloon pauses', () => {
  it('pauses at DAY transitions only in DAY mode, never for DAY 1 alone', () => {
    const days = deriveDayMarkers(points, {});
    expect(balloonPauseSeconds(points, days, 'day', 3)).toEqual([0, 0, 3, 0]);
    expect(balloonPauseSeconds(points, days, 'none', 3)).toEqual([0, 0, 0, 0]);
    expect(balloonPauseSeconds(points, days, 'start-goal', 3)).toEqual([0, 0, 0, 0]);
    expect(balloonPauseSeconds(points, days, 'day', 0)).toEqual([0, 0, 0, 0]);
  });

  it('includes first-point labels, ignores whitespace and deduplicates DAY plus label', () => {
    const labeled = points.map((point, index) => ({ ...point, annotation: { label: index % 2 === 0 ? '地点' : '  ' } }));
    const days = derivePlanDayMarkers(labeled, ['2'], {});
    for (const mode of ['day', 'none', 'start-goal'] as const) {
      expect(balloonPauseSeconds(labeled, days, mode, 3)).toEqual([3, 0, 3, 0]);
    }
    expect(balloonPauseSeconds(labeled.slice(1, 3), days, 'day', 3)).toEqual([0, 3]);
    expect(balloonPauseSeconds(points, derivePlanDayMarkers(points, [], {}), 'day', 3)).toEqual([0, 0, 0, 0]);
  });

  it('uses the same total and reached point in overview and follow, ignoring legacy pauses', () => {
    const days = deriveDayMarkers(points, {});
    const pauses = balloonPauseSeconds(points, days, 'day', 3);
    const overview = buildOverviewPlaybackTimeline(points, 30, pauses);
    const plan = buildFollowCameraPlan(points, 'wide', 30);
    const follow = buildFollowPlaybackTimeline(plan, pauses);
    expect(overview.outputDurationSeconds).toBe(33);
    expect(follow.outputDurationSeconds).toBe(33);
    expect(sampleFollowOutputPlayback(plan, follow, follow.pauses[0].outputStartSeconds + 1))
      .toMatchObject({ reachedPointIndex: 2, markerPosition: { latitude: points[2].latitude, longitude: points[2].longitude } });
    expect(buildOverviewPlaybackTimeline(points, 30).totalPauseSeconds).toBe(0);
    expect(buildFollowPlaybackTimeline(plan).totalPauseSeconds).toBe(0);
  });
});
