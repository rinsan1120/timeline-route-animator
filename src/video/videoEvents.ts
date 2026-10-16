import { LngLat, type Map as MapLibreMap } from 'maplibre-gl';
import { isAnnotationAnchorVisible } from '../route/annotationCanvas';
import { tripRoutePointProgresses } from '../route/tripRoute';
import type { RoutePoint } from '../timeline/types';
import { isInVideoViewport } from './frameDrawing';
import { FOLLOW_CAMERA_CONFIG } from './followCamera';
import type { FrameDrawingOptions } from './frameScene';
import { sampleFrame, type FramePlan, type FrameState } from './frameTimeline';
import type { VideoCamera } from './overviewCamera';

export interface VideoEvent {
  id: string;
  kind: 'start' | 'day' | 'balloon' | 'goal';
  pointId: string;
  name: string;
  frameIndex: number | null;
  unavailableReason?: string;
}

// A detached copy of the actual video transform: jumpTo's center/zoom/bearing/
// pitch order and constraints, without moving a map or requesting any tiles.
export function createVideoEventProjector(map: MapLibreMap) {
  const transform = map._camera.transform.clone();
  let previous: VideoCamera | null = null;
  return (point: RoutePoint, camera: VideoCamera) => {
    if (camera !== previous) {
      transform.setZoom(camera.zoom);
      transform.setCenter(new LngLat(camera.longitude, camera.latitude));
      transform.setBearing(camera.bearing);
      transform.setPitch(camera.pitch);
      previous = camera;
    }
    return transform.locationToScreenPoint(new LngLat(point.longitude, point.latitude));
  };
}

export function buildVideoEvents(plan: FramePlan, options: FrameDrawingOptions,
  project: ReturnType<typeof createVideoEventProjector>): VideoEvent[] {
  const last = plan.totalFrames - 1;
  const states = new Map<number, FrameState>();
  const stateAt = (frame: number) => {
    let state = states.get(frame);
    if (!state) { state = sampleFrame(plan, frame); states.set(frame, state); }
    return state;
  };
  const firstFrame = (matches: (state: FrameState) => boolean) => {
    if (!matches(stateAt(last))) return null;
    let low = 0, high = last;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (matches(stateAt(middle))) high = middle;
      else low = middle + 1;
    }
    return low;
  };
  const candidates = new Set<number>([0, Math.min(last, plan.preFrames), last]);
  const addBoundary = (frame: number | null) => {
    if (frame === null) return;
    for (const value of [frame - 1, frame, frame + 1]) if (value >= 0 && value <= last) candidates.add(value);
  };
  // Stops and the intro/static boundary can change eligibility even when the
  // camera stays fixed (notably coincident points and DAY boundaries).
  const pauseEnds = new Map<number, number>();
  for (const pause of plan.playbackTimeline.pauses) {
    const start = firstFrame((state) => state.playbackElapsedSeconds >= pause.outputStartSeconds);
    const end = firstFrame((state) => state.playbackElapsedSeconds >= pause.outputEndSeconds);
    addBoundary(start); addBoundary(end);
    if (end !== null) pauseEnds.set(pause.pointIndex, end);
  }
  const addCameraInterval = (start: number, end: number) => {
    const from = firstFrame((state) => state.baseElapsedSeconds >= start);
    const to = firstFrame((state) => state.baseElapsedSeconds >= end) ?? last;
    if (from === null) return;
    addBoundary(from); addBoundary(to);
    for (let frame = from; frame <= to; frame += 1) {
      candidates.add(frame);
      const paused = stateAt(frame).pausePointIndex;
      // One projection suffices throughout a stop; no need to visit its frames.
      if (paused !== null) frame = Math.max(frame, (pauseEnds.get(paused) ?? frame + 1) - 1);
    }
  };
  if (plan.introZoomEnabled) for (let frame = 0; frame < plan.preFrames; frame += 1) candidates.add(frame);
  if (plan.cameraMode === 'follow') {
    const follow = plan.followCameraPlan;
    for (const event of follow.events) addCameraInterval(event.startSeconds, event.endSeconds);
    if (follow.viewMode === 'oblique' && follow.firstBearing !== follow.secondBearing) {
      const startProgress = 0.5;
      const endProgress = 0.5 + follow.turnMovementSeconds / follow.routeMovementSeconds;
      const baseAtProgress = (progress: number) => progress * follow.routeMovementSeconds
        + follow.events.filter((event) => event.routeProgress <= progress).length * FOLLOW_CAMERA_CONFIG.panDurationSeconds;
      addCameraInterval(baseAtProgress(startProgress) - follow.events.filter((event) => event.routeProgress === startProgress).length * FOLLOW_CAMERA_CONFIG.panDurationSeconds,
        baseAtProgress(endProgress));
    }
  }
  const cameraFrames = [...candidates].sort((a, b) => a - b);
  const arrivals = tripRoutePointProgresses(options.points);
  const eligible = (state: FrameState, index: number) => state.cameraMode === 'follow' || state.renderPath === 'intro-zoom'
    ? state.playback.reachedPointIndex >= index
    : state.pausePointIndex !== null ? state.pausePointIndex >= index : state.routeProgress >= arrivals[index];
  const firstVisible = (index: number, kind: 'day' | 'balloon') => {
    const arrival = firstFrame((state) => eligible(state, index));
    if (arrival === null) return null;
    const frames = [...new Set([...cameraFrames, arrival])].sort((a, b) => a - b);
    for (const frame of frames) {
      const state = stateAt(frame);
      if (!eligible(state, index)) continue;
      const staticOverview = state.cameraMode === 'overview' && state.renderPath === 'static';
      // Overview DAY is clamped by its painter; Follow/intro first cull anchors.
      if (kind === 'day' && staticOverview) return frame;
      const pixel = project(options.points[index], state.camera);
      if (!staticOverview && !isInVideoViewport(pixel)) continue;
      if (kind === 'balloon' && options.points[index].annotation?.framePosition && !isAnnotationAnchorVisible(pixel)) continue;
      return frame;
    }
    return null;
  };
  const events: VideoEvent[] = [];
  const add = (kind: VideoEvent['kind'], index: number, name: string, frameIndex: number | null) => {
    const pointId = options.points[index].id;
    events.push({ id: `${kind}:${pointId}`, kind, pointId, name, frameIndex,
      unavailableReason: frameIndex === null ? kind === 'balloon' ? 'このバルーンは動画内には表示されません。' : 'このDAYは動画内には表示されません。' : undefined });
  };
  add('start', 0, 'START', Math.min(last, plan.preFrames));
  if ((options.routeMarkerMode ?? 'day') === 'day') {
    const indexes = new Map(options.points.map((point, index) => [point.id, index]));
    for (const marker of options.dayMarkers ?? []) {
      const index = indexes.get(marker.pointId);
      if (index !== undefined) add('day', index, `DAY ${marker.dayNumber}`, firstVisible(index, 'day'));
    }
  }
  options.points.forEach((point, index) => {
    if (point.annotation?.label) add('balloon', index, point.annotation.label, firstVisible(index, 'balloon'));
  });
  add('goal', options.points.length - 1, 'GOAL', firstFrame((state) => state.routeProgress >= 1
    && (state.cameraMode !== 'follow' || state.playback.reachedPointIndex >= options.points.length - 1)));
  return events.sort((a, b) => (a.frameIndex ?? Infinity) - (b.frameIndex ?? Infinity));
}
