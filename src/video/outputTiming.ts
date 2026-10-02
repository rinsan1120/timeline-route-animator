import { VIDEO_FPS } from './overviewCamera';

export const DEFAULT_PRE_ROLL_SECONDS = 3;
export const DEFAULT_POST_ROLL_SECONDS = 3;

export function outputVideoDuration(movementDuration: number, pointPauseSeconds = 0, preRollSeconds = DEFAULT_PRE_ROLL_SECONDS, postRollSeconds = DEFAULT_POST_ROLL_SECONDS): number {
  return preRollSeconds + movementDuration + pointPauseSeconds + postRollSeconds;
}

export function outputVideoFrameCount(movementDuration: number, pointPauseSeconds = 0, preRollSeconds = DEFAULT_PRE_ROLL_SECONDS, postRollSeconds = DEFAULT_POST_ROLL_SECONDS): number {
  return Math.round(outputVideoDuration(movementDuration, pointPauseSeconds, preRollSeconds, postRollSeconds) * VIDEO_FPS);
}

export function introZoomFrameProgress(frame: number, preRollFrames: number): number {
  return preRollFrames <= 1 ? 1 : Math.min(1, Math.max(0, frame / (preRollFrames - 1)));
}

export function sampleVideoOutputTime(progress: number, playbackDuration: number, preRollSeconds: number, postRollSeconds: number) {
  const elapsed = Math.max(0, Math.min(1, progress)) * outputVideoDuration(playbackDuration, 0, preRollSeconds, postRollSeconds);
  const preRollFrames = Math.round(preRollSeconds * VIDEO_FPS);
  return {
    playbackElapsedSeconds: Math.max(0, Math.min(playbackDuration, elapsed - preRollSeconds)),
    introZoomProgress: preRollFrames > 0 && elapsed <= preRollSeconds
      ? introZoomFrameProgress(elapsed * VIDEO_FPS, preRollFrames) : null,
  };
}
