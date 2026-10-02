import { describe, expect, it } from 'vitest';
import { buildFollowCameraPlan, buildFollowPlaybackTimeline, sampleFollowOutputPlayback } from './followCamera';
import { buildOverviewPlaybackTimeline, normalizePauseSeconds, samplePlaybackTimeline } from './playbackTimeline';
import { introZoomFrameProgress, outputVideoDuration, outputVideoFrameCount, sampleVideoOutputTime } from './outputTiming';
import type { RoutePoint } from '../timeline/types';

const points: RoutePoint[] = [
  { id: 'start', latitude: 35, longitude: 139, source: 'manual', original: false },
  { id: 'middle', latitude: 35.01, longitude: 139.01, source: 'manual', original: false },
  { id: 'goal', latitude: 35.02, longitude: 139.02, source: 'manual', original: false },
];

describe('video output timing', () => {
  it('keeps the default 3-second holds and includes independent holds and point pauses', () => {
    expect(outputVideoDuration(30)).toBe(36);
    expect(outputVideoFrameCount(30)).toBe(1080);
    expect(outputVideoDuration(30, 6, 2, 5)).toBe(43);
    expect(outputVideoFrameCount(30, 6, 2, 5)).toBe(1290);
    expect(outputVideoDuration(30, 6, 0, 0)).toBe(36);
    expect(outputVideoFrameCount(5, 0, 0.5, 0.5)).toBe(180);
    expect(outputVideoFrameCount(5, 0, 0.5, 0)).toBe(165);
  });

  it('uses the same normalized half-second limits as point pauses', () => {
    expect(normalizePauseSeconds(-1)).toBe(0);
    expect(normalizePauseSeconds(1.2)).toBe(1);
    expect(normalizePauseSeconds(31)).toBe(30);
  });

  it('maps preview progress to the same pre/playback/post intervals as MP4', () => {
    const playback = buildOverviewPlaybackTimeline(points, 30, [0, 6, 0]);
    expect(playback.outputDurationSeconds).toBe(36);
    const total = outputVideoDuration(30, playback.totalPauseSeconds, 2, 5);
    expect(total).toBe(43);
    expect(sampleVideoOutputTime(0, playback.outputDurationSeconds, 2, 5)).toMatchObject({ playbackElapsedSeconds: 0, introZoomProgress: 0 });
    expect(sampleVideoOutputTime(1 / total, playback.outputDurationSeconds, 2, 5).playbackElapsedSeconds).toBe(0);
    expect(sampleVideoOutputTime(2 / total, playback.outputDurationSeconds, 2, 5).introZoomProgress).toBe(1);
    const duringPause = sampleVideoOutputTime((2 + playback.pauses[0].outputStartSeconds + 1) / total, playback.outputDurationSeconds, 2, 5);
    expect(samplePlaybackTimeline(playback, duringPause.playbackElapsedSeconds)).toMatchObject({ paused: true, pausePointIndex: 1 });
    expect(sampleVideoOutputTime(38 / total, playback.outputDurationSeconds, 2, 5).playbackElapsedSeconds).toBe(36);
    expect(sampleVideoOutputTime(1, playback.outputDurationSeconds, 2, 5).playbackElapsedSeconds).toBe(36);
    expect(sampleVideoOutputTime(0, playback.outputDurationSeconds, 0, 0).introZoomProgress).toBeNull();
    expect(sampleVideoOutputTime(1, playback.outputDurationSeconds, 0, 0).playbackElapsedSeconds).toBe(36);
  });

  it('uses the configured pre-roll for intro frames and leaves Follow movement and final camera state intact', () => {
    expect(introZoomFrameProgress(0, 15)).toBe(0);
    expect(introZoomFrameProgress(14, 15)).toBe(1);
    expect(sampleVideoOutputTime(0.25 / 6, 5, 0.5, 0.5).introZoomProgress).toBeCloseTo(introZoomFrameProgress(7.5, 15));
    const plan = buildFollowCameraPlan(points, 'close', 30, 10, 'oblique');
    const playback = buildFollowPlaybackTimeline(plan, [0, 6, 0]);
    expect(plan.duration).toBe(30);
    expect(plan.routeMovementSeconds + plan.totalPanSeconds).toBe(30);
    expect(playback.outputDurationSeconds).toBe(36);
    const last = sampleFollowOutputPlayback(plan, playback, playback.outputDurationSeconds);
    const postStart = sampleVideoOutputTime(38 / 43, playback.outputDurationSeconds, 2, 5);
    const postEnd = sampleVideoOutputTime(1, playback.outputDurationSeconds, 2, 5);
    expect(sampleFollowOutputPlayback(plan, playback, postStart.playbackElapsedSeconds)).toEqual(last);
    expect(sampleFollowOutputPlayback(plan, playback, postEnd.playbackElapsedSeconds)).toEqual(last);
    expect(last).toMatchObject({ routeProgress: 1, reachedPointIndex: 2, pitch: 45 });
  });
});
