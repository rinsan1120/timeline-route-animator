import { describe, expect, it } from 'vitest';
import type { RoutePoint } from '../timeline/types';
import { buildFollowCameraPlan, buildFollowPlaybackTimeline, FOLLOW_CAMERA_CONFIG, sampleFollowOutputPlayback } from './followCamera';
import { samplePlaybackTimeline } from './playbackTimeline';

const points = (pauseSeconds?: number): RoutePoint[] => [
  { id: 'a', latitude: 35, longitude: 139, source: 'timelinePath', original: true },
  { id: 'b', latitude: 35.01, longitude: 139.01, source: 'timelinePath', original: true, pauseSeconds },
  { id: 'c', latitude: 35.02, longitude: 139.02, source: 'timelinePath', original: true },
];

describe('follow camera pause timeline', () => {
  it('adds pauses without compressing route movement or camera-pan timing', () => {
    const originalPlan = buildFollowCameraPlan(points(), 'close', 30);
    const pausedPlan = buildFollowCameraPlan(points(3), 'close', 30);
    expect(pausedPlan.duration).toBe(originalPlan.duration);
    expect(pausedPlan.routeMovementSeconds).toBe(originalPlan.routeMovementSeconds);
    expect(pausedPlan.totalPanSeconds).toBe(originalPlan.totalPanSeconds);
    expect(pausedPlan.events.map((event) => event.endSeconds - event.startSeconds))
      .toEqual(originalPlan.events.map(() => FOLLOW_CAMERA_CONFIG.panDurationSeconds));

    const timeline = buildFollowPlaybackTimeline(pausedPlan);
    expect(timeline.outputDurationSeconds).toBe(33);
    const pause = timeline.pauses[0];
    expect(samplePlaybackTimeline(timeline, pause.outputStartSeconds + 1)).toMatchObject({
      baseElapsedSeconds: pause.baseElapsedSeconds,
      paused: true,
      pausePointIndex: 1,
    });
    const pauseStart = sampleFollowOutputPlayback(pausedPlan, timeline, pause.outputStartSeconds + 0.1);
    const pauseEnd = sampleFollowOutputPlayback(pausedPlan, timeline, pause.outputEndSeconds - 0.1);
    expect(pauseEnd).toEqual(pauseStart);
    expect(pauseStart).toMatchObject({ markerPosition: { latitude: 35.01, longitude: 139.01 }, reachedPointIndex: 1 });
    const eventsAtOrBeforeArrival = pausedPlan.events.filter((event) => event.routeProgress <= 0.5);
    if (eventsAtOrBeforeArrival.length) {
      expect(pause.baseElapsedSeconds).toBeGreaterThanOrEqual(eventsAtOrBeforeArrival.at(-1)!.endSeconds);
    }
  });

  it('places a day-boundary pause on the correct side of the existing day transition', () => {
    const boundaryPoints: RoutePoint[] = [
      { ...points()[0], timestamp: '2026-01-01T10:00:00+09:00' },
      { ...points()[1], pauseSeconds: 2, timestamp: '2026-01-01T11:00:00+09:00' },
      { ...points()[2], id: 'c', pauseSeconds: 3, timestamp: '2026-01-02T10:00:00+09:00' },
      { id: 'd', latitude: 35.03, longitude: 139.03, source: 'timelinePath', original: true, timestamp: '2026-01-02T11:00:00+09:00' },
    ];
    const plan = buildFollowCameraPlan(boundaryPoints, 'wide', 30);
    const timeline = buildFollowPlaybackTimeline(plan);
    expect(plan.events.some((event) => event.type === 'day-transition')).toBe(true);
    expect(timeline.pauses[1].baseElapsedSeconds - timeline.pauses[0].baseElapsedSeconds)
      .toBeGreaterThanOrEqual(FOLLOW_CAMERA_CONFIG.panDurationSeconds);
  });
});
