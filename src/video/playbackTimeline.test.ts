import { describe, expect, it } from 'vitest';
import type { RoutePoint } from '../timeline/types';
import { buildOverviewPlaybackTimeline, normalizePauseSeconds, samplePlaybackTimeline, totalPauseSeconds } from './playbackTimeline';

const point = (id: string, longitude: number, pauseSeconds?: number): RoutePoint => ({
  id, latitude: 35, longitude, source: 'timelinePath', original: true, pauseSeconds,
});

describe('playback pause timeline', () => {
  it('normalizes UI values to half-second steps within 0 to 30 seconds', () => {
    expect(normalizePauseSeconds(-2)).toBe(0);
    expect(normalizePauseSeconds(2.74)).toBe(2.5);
    expect(normalizePauseSeconds(2.75)).toBe(3);
    expect(normalizePauseSeconds(40)).toBe(30);
  });

  it('matches the original timeline when no pauses are configured', () => {
    const timeline = buildOverviewPlaybackTimeline([point('a', 139), point('b', 140)], 30);
    expect(timeline.totalPauseSeconds).toBe(0);
    expect(samplePlaybackTimeline(timeline, 12)).toEqual({ baseElapsedSeconds: 12, paused: false, pausePointIndex: null });
  });

  it('holds route progress for three seconds and resumes at the original speed', () => {
    const timeline = buildOverviewPlaybackTimeline([point('a', 139), point('b', 140, 3), point('c', 141)], 30);
    expect(samplePlaybackTimeline(timeline, 16)).toMatchObject({ baseElapsedSeconds: 15, paused: true, pausePointIndex: 1 });
    expect(samplePlaybackTimeline(timeline, 17.9).baseElapsedSeconds / 30).toBeCloseTo(0.5);
    expect(samplePlaybackTimeline(timeline, 19).baseElapsedSeconds / 30).toBeCloseTo(16 / 30);
  });

  it('accumulates multiple pauses', () => {
    const timeline = buildOverviewPlaybackTimeline([
      point('a', 139), point('b', 140, 2), point('c', 141, 3), point('d', 142),
    ], 30);
    expect(timeline.totalPauseSeconds).toBe(5);
    expect(timeline.outputDurationSeconds).toBe(35);
    expect(samplePlaybackTimeline(timeline, 23)).toMatchObject({ baseElapsedSeconds: 20, paused: true, pausePointIndex: 2 });
    expect(samplePlaybackTimeline(timeline, 26).baseElapsedSeconds).toBeCloseTo(21);
  });

  it('ignores the animation-range start and points outside the supplied range, but includes the final point', () => {
    const all = [point('outside-before', 138, 8), point('start', 139, 2), point('final', 140, 3), point('outside-after', 141, 4)];
    const animationPoints = all.slice(1, 3);
    expect(totalPauseSeconds(animationPoints)).toBe(3);
    const timeline = buildOverviewPlaybackTimeline(animationPoints, 30);
    expect(timeline.pauses).toHaveLength(1);
    expect(timeline.pauses[0]).toMatchObject({ pointIndex: 1, baseElapsedSeconds: 30, pauseSeconds: 3 });
    expect(samplePlaybackTimeline(timeline, 31)).toMatchObject({ baseElapsedSeconds: 30, paused: true, pausePointIndex: 1 });
  });
});
