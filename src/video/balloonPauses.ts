import type { RoutePoint } from '../timeline/types';
import type { DayMarker } from '../route/tripRoute';
import type { RouteMarkerMode } from '../route/routeMarker';
import { normalizePauseSeconds } from './playbackTimeline';

export function balloonPauseSeconds(
  points: readonly RoutePoint[], dayMarkers: readonly DayMarker[], mode: RouteMarkerMode, seconds: number,
): number[] {
  const duration = normalizePauseSeconds(seconds);
  const transitions = new Set(mode === 'day'
    ? dayMarkers.filter((marker) => marker.dayNumber > 1).map((marker) => marker.pointId) : []);
  return points.map((point) => point.annotation?.label.trim() || transitions.has(point.id) ? duration : 0);
}
