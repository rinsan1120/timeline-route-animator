import { describe, expect, it } from 'vitest';
import type { RoutePoint } from '../timeline/types';
import { buildFollowCameraPlan, buildFollowPlaybackTimeline, FOLLOW_CAMERA_CONFIG, sampleFollowOutputPlayback, sampleFollowPlayback } from './followCamera';
import { interpolateTripRoute } from '../route/tripRoute';
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

    const timeline = buildFollowPlaybackTimeline(pausedPlan, [0, 3, 0]);
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
    const timeline = buildFollowPlaybackTimeline(plan, [0, 2, 3, 0]);
    expect(plan.events.some((event) => event.type === 'day-transition')).toBe(true);
    expect(timeline.pauses[1].baseElapsedSeconds - timeline.pauses[0].baseElapsedSeconds)
      .toBeGreaterThanOrEqual(FOLLOW_CAMERA_CONFIG.panDurationSeconds);
  });
});

const route = (coordinates: [number, number][]): RoutePoint[] => coordinates.map(([longitude, latitude], index) => ({
  id: String(index), longitude, latitude, source: 'manual', original: false,
}));

describe('follow view orientation', () => {
  const corner = route([[0, 0], [0.01, 0], [0.01, 0.01]]);

  it('keeps the default top view and the existing center, zoom and pan timeline unchanged', () => {
    const top = buildFollowCameraPlan(points(), 'close', 30);
    const oblique = buildFollowCameraPlan(points(), 'close', 30, 10, 'oblique');
    expect(oblique.events).toEqual(top.events);
    expect(oblique.routeMovementSeconds).toBe(top.routeMovementSeconds);
    expect(oblique.duration).toBe(top.duration);
    for (let elapsed = 0; elapsed <= top.duration; elapsed += 0.1) {
      const { bearing, pitch, ...topState } = sampleFollowPlayback(top, elapsed);
      const { bearing: _bearing, pitch: obliquePitch, ...obliqueState } = sampleFollowPlayback(oblique, elapsed);
      expect({ bearing, pitch }).toEqual({ bearing: 0, pitch: 0 });
      expect(obliquePitch).toBe(45);
      expect(obliqueState).toEqual(topState);
    }
  });

  it('uses the distance midpoint even with dense nearby points, and the supplied animation range', () => {
    const sparse = route([[0, 0], [0.02, 0], [0.02, 0.06]]);
    const dense = route([[0, 0], [0.0001, 0], [0.0002, 0], [0.0003, 0], [0.02, 0], [0.02, 0.06]]);
    const middle = interpolateTripRoute(dense, 0.5)!;
    expect(middle.longitude).toBeCloseTo(0.02, 8);
    expect(middle.latitude).toBeCloseTo(0.02, 8);
    const plan = buildFollowCameraPlan(dense, 'wide', 10, 10, 'oblique');
    const sparsePlan = buildFollowCameraPlan(sparse, 'wide', 10, 10, 'oblique');
    expect(plan.firstBearing).toBeCloseTo(45, 4);
    expect(plan.firstBearing).toBeCloseTo(sparsePlan.firstBearing, 8);
    expect(plan.secondBearing).toBeCloseTo(0, 8);
    const rangePlan = buildFollowCameraPlan(dense.slice(-2), 'wide', 10, 10, 'oblique');
    expect(rangePlan.firstBearing).toBeCloseTo(0, 8);
    expect(rangePlan.secondBearing).toBeCloseTo(0, 8);
  });

  it('holds the first direction through 50%, then eases to the second in two movement seconds', () => {
    const plan = buildFollowCameraPlan(corner, 'wide', 10, 10, 'oblique');
    expect(plan.events).toHaveLength(0);
    for (const elapsed of [0, 2, 4.99, 5]) {
      expect(sampleFollowPlayback(plan, elapsed)).toMatchObject({ bearing: plan.firstBearing, pitch: 45 });
    }
    expect(sampleFollowPlayback(plan, 5.5).bearing).toBeCloseTo(84.375, 6);
    expect(sampleFollowPlayback(plan, 6).bearing).toBeCloseTo(45, 6);
    expect(sampleFollowPlayback(plan, 6.5).bearing).toBeCloseTo(5.625, 6);
    expect(sampleFollowPlayback(plan, 7).bearing).toBeCloseTo(plan.secondBearing, 6);
    expect(sampleFollowPlayback(plan, 10).bearing).toBeCloseTo(plan.secondBearing, 6);
  });

  it('finishes the turn within the remaining movement time without extending the video', () => {
    const plan = buildFollowCameraPlan(corner, 'wide', 3, 10, 'oblique');
    expect(plan.duration).toBe(3);
    expect(plan.turnMovementSeconds).toBe(1.5);
    expect(sampleFollowPlayback(plan, 2.25).bearing).toBeCloseTo(45, 6);
    expect(sampleFollowPlayback(plan, 3).bearing).toBeCloseTo(plan.secondBearing, 6);
  });

  it.each([[350, 10, 351.25, 8.75], [10, 350, 8.75, 351.25]])('turns by the shortest arc from %s to %s', (firstBearing, secondBearing, early, late) => {
    const plan = { ...buildFollowCameraPlan(corner, 'wide', 10, 10, 'oblique'), firstBearing, secondBearing };
    expect(sampleFollowPlayback(plan, 5.5).bearing).toBeCloseTo(early, 8);
    expect(sampleFollowPlayback(plan, 6).bearing).toBeCloseTo(0, 8);
    expect(sampleFollowPlayback(plan, 6.5).bearing).toBeCloseTo(late, 8);
    expect(sampleFollowPlayback(plan, 7).bearing).toBeCloseTo(secondBearing, 8);
  });

  it('freezes rotation for a balloon pause during the turn', () => {
    const points = route([[0, 0], [0.01, 0], [0.01, 0.002], [0.01, 0.01]]);
    const plan = buildFollowCameraPlan(points, 'wide', 10, 10, 'oblique');
    const timeline = buildFollowPlaybackTimeline(plan, [0, 0, 3, 0]);
    const pause = timeline.pauses[0];
    const start = sampleFollowOutputPlayback(plan, timeline, pause.outputStartSeconds + 0.1);
    const end = sampleFollowOutputPlayback(plan, timeline, pause.outputEndSeconds - 0.1);
    expect(start.bearing).toBeGreaterThan(plan.secondBearing);
    expect(start.bearing).toBeLessThan(plan.firstBearing);
    expect(end).toEqual(start);
    expect(sampleFollowOutputPlayback(plan, timeline, timeline.outputDurationSeconds).bearing).toBe(plan.secondBearing);
  });

  it.each(['camera-pan', 'day-transition'] as const)('freezes rotation during %s', (type) => {
    const points = type === 'camera-pan'
      ? route([[0, 0], [0.4, 0], [0.4, 0.4]])
      : route([[0, 0], [0.006, 0], [0.006, 0.001], [0.01, 0.001]]).map((point, index) => ({
        ...point, timestamp: `2026-01-0${index < 2 ? 1 : 2}T10:00:00+09:00`,
      }));
    const plan = buildFollowCameraPlan(points, type === 'camera-pan' ? 'close' : 'wide', 10, 10, 'oblique');
    const event = plan.events.find((event) => event.type === type && event.routeProgress > 0.5
      && event.routeProgress < 0.5 + plan.turnMovementSeconds / plan.routeMovementSeconds)!;
    expect(event).toBeDefined();
    const start = sampleFollowPlayback(plan, event.startSeconds + 0.1);
    const end = sampleFollowPlayback(plan, event.endSeconds - 0.1);
    expect(start.phase).toBe(type);
    expect(end.routeProgress).toBe(start.routeProgress);
    expect(end.bearing).toBe(start.bearing);
  });

  it.each(([
    [[0, 0], [0, 0]],
    [[0, 0], [0.000001, 0], [0.000001, 0.000001]],
    [[0, 0], [0.01, 0], [0, 0], [0, 0.02]],
    [[0, 0.02], [0, 0], [0.01, 0], [0, 0]],
  ] as [number, number][][]).map((coordinates) => ({ coordinates })))('uses safe fallback directions for coincident or near-coincident anchors: $coordinates', ({ coordinates }) => {
    const plan = buildFollowCameraPlan(route(coordinates), 'wide', 10, 10, 'oblique');
    expect(plan.firstBearing).toBe(plan.secondBearing);
    for (const elapsed of [0, 5, 6, 10]) {
      expect(Number.isFinite(sampleFollowPlayback(plan, elapsed).bearing)).toBe(true);
    }
    expect(plan.firstBearing).toBeCloseTo(coordinates[0][1] === 0.02 ? 180 : 0, 6);
  });
});
