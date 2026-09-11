import { tripRoutePointProgresses } from '../route/tripRoute';
import type { RoutePoint } from '../timeline/types';

export const MAX_POINT_PAUSE_SECONDS = 30;
export const POINT_PAUSE_STEP_SECONDS = 0.5;

export interface PlaybackPause {
  pointIndex: number;
  baseElapsedSeconds: number;
  outputStartSeconds: number;
  outputEndSeconds: number;
  pauseSeconds: number;
}

export interface PlaybackTimeline {
  baseDurationSeconds: number;
  totalPauseSeconds: number;
  outputDurationSeconds: number;
  pauses: PlaybackPause[];
}

export interface PlaybackTimelineSample {
  baseElapsedSeconds: number;
  paused: boolean;
  pausePointIndex: number | null;
}

export function normalizePauseSeconds(value: number): number {
  if (!Number.isFinite(value)) return 0;
  const clamped = Math.min(MAX_POINT_PAUSE_SECONDS, Math.max(0, value));
  return Math.round(clamped / POINT_PAUSE_STEP_SECONDS) * POINT_PAUSE_STEP_SECONDS;
}

function playablePauseSeconds(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.min(MAX_POINT_PAUSE_SECONDS, Math.max(0, value));
}

export function totalPauseSeconds(points: readonly RoutePoint[]): number {
  return points.slice(1).reduce((total, point) => total + playablePauseSeconds(point.pauseSeconds), 0);
}

export function buildPlaybackTimeline(
  points: readonly RoutePoint[],
  baseDurationSeconds: number,
  pointArrivalSeconds: readonly number[],
): PlaybackTimeline {
  let accumulatedPauseSeconds = 0;
  const pauses: PlaybackPause[] = [];
  for (let pointIndex = 1; pointIndex < points.length; pointIndex += 1) {
    const pauseSeconds = playablePauseSeconds(points[pointIndex].pauseSeconds);
    if (pauseSeconds === 0) continue;
    const baseElapsedSeconds = Math.min(baseDurationSeconds, Math.max(0, pointArrivalSeconds[pointIndex] ?? 0));
    const outputStartSeconds = baseElapsedSeconds + accumulatedPauseSeconds;
    pauses.push({
      pointIndex,
      baseElapsedSeconds,
      outputStartSeconds,
      outputEndSeconds: outputStartSeconds + pauseSeconds,
      pauseSeconds,
    });
    accumulatedPauseSeconds += pauseSeconds;
  }
  return {
    baseDurationSeconds,
    totalPauseSeconds: accumulatedPauseSeconds,
    outputDurationSeconds: baseDurationSeconds + accumulatedPauseSeconds,
    pauses,
  };
}

export function buildOverviewPlaybackTimeline(points: readonly RoutePoint[], duration: number): PlaybackTimeline {
  return buildPlaybackTimeline(points, duration, tripRoutePointProgresses([...points]).map((progress) => progress * duration));
}

export function samplePlaybackTimeline(timeline: PlaybackTimeline, outputElapsedSeconds: number): PlaybackTimelineSample {
  const elapsed = Math.min(timeline.outputDurationSeconds, Math.max(0, outputElapsedSeconds));
  let completedPauseSeconds = 0;
  for (const pause of timeline.pauses) {
    if (elapsed < pause.outputStartSeconds) break;
    if (elapsed < pause.outputEndSeconds) {
      return { baseElapsedSeconds: pause.baseElapsedSeconds, paused: true, pausePointIndex: pause.pointIndex };
    }
    completedPauseSeconds += pause.pauseSeconds;
  }
  return {
    baseElapsedSeconds: Math.min(timeline.baseDurationSeconds, elapsed - completedPauseSeconds),
    paused: false,
    pausePointIndex: null,
  };
}
