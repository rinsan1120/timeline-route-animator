import type { BalloonFramePosition } from '../popup/placement';
import type { RoutePoint } from '../timeline/types';
import type { AnnotationStyle } from './annotationStyle';
import { annotationFramePosition, annotationLayout } from './annotationCanvas';
import { buildFollowPlaybackTimeline, sampleFollowPlayback, type FollowCameraPlan } from '../video/followCamera';
import { constrainVideoCamera, type VideoCamera } from '../video/overviewCamera';

// Use the existing arrival calculation (including pans and DAY transitions),
// independent of playback pauses and the current editor camera.
export function balloonReferenceCamera(pointId: string, overview: VideoCamera, follow: FollowCameraPlan | null): VideoCamera {
  const index = follow?.points.findIndex((point) => point.id === pointId) ?? -1;
  if (!follow || index < 0) return overview;
  const pauses = follow.points.map((_, pointIndex) => pointIndex === index ? 1 : 0);
  const arrival = buildFollowPlaybackTimeline(follow, pauses).pauses[0].baseElapsedSeconds;
  const playback = sampleFollowPlayback(follow, arrival);
  return constrainVideoCamera({ ...playback.cameraCenter, zoom: playback.zoom, bearing: playback.bearing, pitch: playback.pitch });
}

export function resolveBalloonFramePositions(
  context: CanvasRenderingContext2D, points: RoutePoint[], style: AnnotationStyle,
  projectReference: (point: RoutePoint) => { x: number; y: number },
): RoutePoint[] {
  let changed = false;
  const resolved = points.map((point) => {
    if (!point.annotation?.label || point.annotation.framePosition) return point;
    const projected = projectReference(point);
    const pixel = Number.isFinite(projected.x) && Number.isFinite(projected.y) ? projected : { x: 960, y: 540 };
    const layout = annotationLayout(context, { ...point.annotation, pixel }, style);
    changed = true;
    return { ...point, annotation: { ...point.annotation, framePosition: annotationFramePosition(layout) } };
  });
  return changed ? resolved : points;
}

export function applyBalloonFramePositions(points: RoutePoint[], positions: ReadonlyMap<string, BalloonFramePosition>): RoutePoint[] {
  let changed = false;
  const resolved = points.map((point) => {
    const framePosition = positions.get(point.id);
    if (!point.annotation || point.annotation.framePosition || !framePosition) return point;
    changed = true;
    return { ...point, annotation: { ...point.annotation, framePosition } };
  });
  return changed ? resolved : points;
}
