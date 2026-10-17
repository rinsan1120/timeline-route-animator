import type { RoutePoint } from '../timeline/types';
import type { RouteMarkerMode } from '../route/routeMarker';
import { interpolateTripRoute, type DayMarker } from '../route/tripRoute';
import { balloonPauseSeconds } from './balloonPauses';
import { buildFollowCameraPlan, buildFollowPlaybackTimeline, sampleFollowOutputPlayback, sampleFollowPlayback, type FollowCameraPlan, type FollowPlaybackState, type FollowViewMode, type FollowZoomPreset, type GeoPosition, type VideoCameraMode } from './followCamera';
import { getIntroStartZoom, interpolateIntroZoom } from './introZoom';
import { createOverviewCamera, VIDEO_FPS, VIDEO_MIN_ZOOM, type VideoCamera } from './overviewCamera';
import { DEFAULT_POST_ROLL_SECONDS, DEFAULT_PRE_ROLL_SECONDS, introZoomFrameProgress, outputVideoFrameCount } from './outputTiming';
import { buildOverviewPlaybackTimeline, normalizePauseSeconds, samplePlaybackTimeline, type PlaybackTimeline } from './playbackTimeline';

// Receives the same validated route/settings as the MP4 renderer (at least two
// points and a 5–120 second movement duration). Plans retain route references.
// Only frame calculation inputs belong here; no Canvas, encoder or React state.
export interface FramePlanOptions {
  points: RoutePoint[];
  duration: number;
  cameraMode?: VideoCameraMode;
  dayMarkers?: DayMarker[];
  routeMarkerMode?: RouteMarkerMode;
  commonPauseSeconds?: number;
  preRollSeconds?: number;
  postRollSeconds?: number;
  introZoomEnabled?: boolean;
  overviewCamera?: VideoCamera;
  overviewZoomMode?: 'auto' | 'custom';
  overviewCustomZoom?: number;
  followCameraPlan?: FollowCameraPlan;
  followZoomPreset?: FollowZoomPreset;
  followCustomZoom?: number;
  followViewMode?: FollowViewMode;
}

interface FramePlanBase {
  points: RoutePoint[];
  duration: number;
  fps: number;
  totalFrames: number;
  preFrames: number;
  animationFrames: number;
  postFrames: number;
  playbackTimeline: PlaybackTimeline;
  introZoomEnabled: boolean;
  introStartZoom: number;
  initialPlayback: FollowPlaybackState;
}

export interface OverviewFramePlan extends FramePlanBase {
  cameraMode: 'overview';
  overviewCamera: VideoCamera;
}

export interface FollowFramePlan extends FramePlanBase {
  cameraMode: 'follow';
  followCameraPlan: FollowCameraPlan;
}

export type FramePlan = OverviewFramePlan | FollowFramePlan;

interface FrameStateBase {
  frameIndex: number;
  section: 'pre-roll' | 'animation' | 'post-roll';
  /** Presentation time on the output video, independent of playback interpolation. */
  outputTimeSeconds: number;
  /** Time within the main playback, including point pauses and camera pans. */
  playbackElapsedSeconds: number;
  baseElapsedSeconds: number;
  routeProgress: number;
  pausePointIndex: number | null;
  markerPosition: GeoPosition;
  camera: VideoCamera;
  introZoomProgress: number | null;
}

export type OverviewFrameState = FrameStateBase & { cameraMode: 'overview' } & (
  | { renderPath: 'intro-zoom'; playback: FollowPlaybackState }
  | { renderPath: 'static' }
);

export interface FollowFrameState extends FrameStateBase {
  cameraMode: 'follow';
  // Retains moving / camera-pan / day-transition and reachedPointIndex verbatim.
  playback: FollowPlaybackState;
}

export type FrameState = OverviewFrameState | FollowFrameState;

export function buildFramePlan(options: FramePlanOptions & { cameraMode: 'follow' }): FollowFramePlan;
export function buildFramePlan(options: FramePlanOptions & { cameraMode: 'overview' }): OverviewFramePlan;
export function buildFramePlan(options: FramePlanOptions): FramePlan;
export function buildFramePlan(options: FramePlanOptions): FramePlan {
  const pointPauses = balloonPauseSeconds(options.points, options.dayMarkers ?? [], options.routeMarkerMode ?? 'day', options.commonPauseSeconds ?? 0);
  const follow = options.cameraMode === 'follow'
    ? options.followCameraPlan ?? buildFollowCameraPlan(options.points, options.followZoomPreset ?? 'standard', options.duration, options.followCustomZoom, options.followViewMode)
    : null;
  const playbackTimeline = follow
    ? buildFollowPlaybackTimeline(follow, pointPauses)
    : buildOverviewPlaybackTimeline(options.points, options.duration, pointPauses);
  const preRollSeconds = normalizePauseSeconds(options.preRollSeconds ?? DEFAULT_PRE_ROLL_SECONDS);
  const postRollSeconds = normalizePauseSeconds(options.postRollSeconds ?? DEFAULT_POST_ROLL_SECONDS);
  const preFrames = Math.round(preRollSeconds * VIDEO_FPS);
  const animationFrames = Math.round(playbackTimeline.outputDurationSeconds * VIDEO_FPS);
  const totalFrames = outputVideoFrameCount(options.duration, playbackTimeline.totalPauseSeconds, preRollSeconds, postRollSeconds);
  const timing = {
    points: options.points, duration: options.duration, fps: VIDEO_FPS,
    totalFrames, preFrames, animationFrames, postFrames: totalFrames - preFrames - animationFrames,
    playbackTimeline, introZoomEnabled: !!options.introZoomEnabled,
  };
  if (follow) {
    const initialPlayback = sampleFollowPlayback(follow, 0);
    return {
      ...timing, cameraMode: 'follow', followCameraPlan: follow, initialPlayback,
      introStartZoom: getIntroStartZoom(initialPlayback.zoom, VIDEO_MIN_ZOOM),
    };
  }
  const customZoom = options.overviewZoomMode === 'custom' ? options.overviewCustomZoom ?? 10 : undefined;
  const camera = options.overviewCamera ?? createOverviewCamera(options.points, customZoom)!;
  const introStartZoom = getIntroStartZoom(camera.zoom, VIDEO_MIN_ZOOM);
  return {
    ...timing, cameraMode: 'overview', overviewCamera: camera, introStartZoom,
    initialPlayback: {
      phase: 'moving', routeProgress: 0,
      markerPosition: { longitude: options.points[0].longitude, latitude: options.points[0].latitude },
      reachedPointIndex: 0,
      cameraCenter: { longitude: camera.longitude, latitude: camera.latitude },
      zoom: introStartZoom, bearing: 0, pitch: 0,
    },
  };
}

export function sampleFrame(plan: OverviewFramePlan, frameIndex: number): OverviewFrameState;
export function sampleFrame(plan: FollowFramePlan, frameIndex: number): FollowFrameState;
export function sampleFrame(plan: FramePlan, frameIndex: number): FrameState;
export function sampleFrame(plan: FramePlan, frameIndex: number): FrameState {
  if (!Number.isInteger(frameIndex) || frameIndex < 0 || frameIndex >= plan.totalFrames) {
    throw new RangeError('フレーム番号が動画の範囲外です。');
  }
  const animationFrame = frameIndex - plan.preFrames;
  // Preserve the MP4 endpoint-inclusive interpolation, NOT frameIndex / fps.
  const playbackElapsedSeconds = frameIndex < plan.preFrames
    ? 0
    : animationFrame >= plan.animationFrames
      ? plan.playbackTimeline.outputDurationSeconds
      : animationFrame / (plan.animationFrames - 1) * plan.playbackTimeline.outputDurationSeconds;
  const sample = samplePlaybackTimeline(plan.playbackTimeline, playbackElapsedSeconds);
  const introZoomProgress = plan.introZoomEnabled && frameIndex < plan.preFrames
    ? introZoomFrameProgress(frameIndex, plan.preFrames) : null;
  const timing = {
    frameIndex,
    section: frameIndex < plan.preFrames ? 'pre-roll' as const
      : animationFrame >= plan.animationFrames ? 'post-roll' as const : 'animation' as const,
    outputTimeSeconds: frameIndex / plan.fps,
    playbackElapsedSeconds, baseElapsedSeconds: sample.baseElapsedSeconds,
    pausePointIndex: sample.pausePointIndex, introZoomProgress,
  };
  if (plan.cameraMode === 'follow') {
    const playback = introZoomProgress !== null
      ? { ...plan.initialPlayback, zoom: interpolateIntroZoom(plan.introStartZoom, plan.initialPlayback.zoom, introZoomProgress) }
      : sampleFollowOutputPlayback(plan.followCameraPlan, plan.playbackTimeline, playbackElapsedSeconds);
    return {
      ...timing, cameraMode: 'follow', playback,
      routeProgress: playback.routeProgress, markerPosition: playback.markerPosition,
      camera: { ...playback.cameraCenter, zoom: playback.zoom, bearing: playback.bearing, pitch: playback.pitch },
    };
  }
  if (introZoomProgress !== null) {
    const playback = { ...plan.initialPlayback, zoom: interpolateIntroZoom(plan.introStartZoom, plan.overviewCamera.zoom, introZoomProgress) };
    return {
      ...timing, cameraMode: 'overview', renderPath: 'intro-zoom', playback,
      routeProgress: 0, markerPosition: playback.markerPosition,
      camera: { ...playback.cameraCenter, zoom: playback.zoom, bearing: playback.bearing, pitch: playback.pitch },
    };
  }
  const routeProgress = sample.baseElapsedSeconds / plan.duration;
  const position = sample.pausePointIndex === null
    ? interpolateTripRoute(plan.points, routeProgress)! : plan.points[sample.pausePointIndex];
  return {
    ...timing, cameraMode: 'overview', renderPath: 'static', routeProgress,
    markerPosition: { longitude: position.longitude, latitude: position.latitude }, camera: plan.overviewCamera,
  };
}

/** Select the frame whose presentation interval contains the requested seconds. */
export function getFrameIndexAtTime(plan: Pick<FramePlan, 'fps' | 'totalFrames'>, seconds: number): number {
  if (Number.isNaN(seconds)) return 0;
  return Math.max(0, Math.min(plan.totalFrames - 1, Math.floor(seconds * plan.fps)));
}
