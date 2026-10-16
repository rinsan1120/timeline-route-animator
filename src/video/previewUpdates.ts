import type { RoutePoint } from '../timeline/types';
import type { FramePlan, FramePlanOptions } from './frameTimeline';

export function sameRouteGeometry(a: readonly RoutePoint[], b: readonly RoutePoint[]) {
  return a === b || a.length === b.length && a.every((point, index) => {
    const other = b[index];
    return point.id === other.id && point.longitude === other.longitude && point.latitude === other.latitude && point.timestamp === other.timestamp;
  });
}

// Only inputs consumed by buildFramePlan belong here. Canvas style/HUD/clock
// updates keep the existing plan and its (potentially expensive) Follow camera.
export function sameFramePlanInputs(a: FramePlanOptions, b: FramePlanOptions) {
  const keys = ['duration', 'cameraMode', 'routeMarkerMode', 'commonPauseSeconds', 'preRollSeconds', 'postRollSeconds',
    'introZoomEnabled', 'overviewZoomMode', 'overviewCustomZoom', 'followZoomPreset', 'followCustomZoom', 'followViewMode'] as const;
  if (!keys.every((key) => a[key] === b[key]) || a.followCameraPlan !== b.followCameraPlan || !sameRouteGeometry(a.points, b.points)) return false;
  if (!a.points.every((point, index) => !!point.annotation?.label.trim() === !!b.points[index].annotation?.label.trim()
    && point.pauseSeconds === b.points[index].pauseSeconds)) return false;
  const aDays = a.dayMarkers ?? [], bDays = b.dayMarkers ?? [];
  if (aDays.length !== bDays.length || !aDays.every((day, index) => day.pointId === bDays[index].pointId && day.dayNumber === bDays[index].dayNumber)) return false;
  const first = a.overviewCamera, second = b.overviewCamera;
  return first === second || !!first && !!second && first.longitude === second.longitude && first.latitude === second.latitude
    && first.zoom === second.zoom && first.bearing === second.bearing && first.pitch === second.pitch;
}

// Compare against the last DISPLAYED plan, rather than an intermediate setting
// that may have been superseded before its frame was published.
export function samePlaybackTiming(a: FramePlan, b: FramePlan) {
  if (a === b) return true;
  if (!sameRouteGeometry(a.points, b.points) || a.duration !== b.duration || a.fps !== b.fps
    || a.preFrames !== b.preFrames || a.animationFrames !== b.animationFrames || a.totalFrames !== b.totalFrames) return false;
  const pausesA = a.playbackTimeline.pauses, pausesB = b.playbackTimeline.pauses;
  if (pausesA.length !== pausesB.length || !pausesA.every((pause, index) => {
    const other = pausesB[index];
    return pause.pointIndex === other.pointIndex && pause.baseElapsedSeconds === other.baseElapsedSeconds
      && pause.outputStartSeconds === other.outputStartSeconds && pause.outputEndSeconds === other.outputEndSeconds;
  })) return false;
  const eventsA = a.cameraMode === 'follow' ? a.followCameraPlan.events : [];
  const eventsB = b.cameraMode === 'follow' ? b.followCameraPlan.events : [];
  return eventsA.length === eventsB.length && eventsA.every((event, index) => {
    const other = eventsB[index];
    return event.type === other.type && event.routeProgress === other.routeProgress && event.startSeconds === other.startSeconds
      && event.endSeconds === other.endSeconds && event.reachedPointIndexBefore === other.reachedPointIndexBefore
      && event.reachedPointIndexAfter === other.reachedPointIndexAfter;
  });
}
