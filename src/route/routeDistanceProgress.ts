import type { RoutePoint } from '../timeline/types';
import { distanceMeters } from './geometry';
import { interpolateTripRoute, routeDistancesByDay, type DayMarker } from './tripRoute';

export function buildRouteDistanceModel(points: RoutePoint[], dayMarkers: DayMarker[], animationPoints: RoutePoint[]) {
  const totals = routeDistancesByDay(points, dayMarkers);
  const starts = new Set(totals.days.map((day) => day.pointId));
  let dayIndex = -1;
  let meters = 0;
  const atPoint = new Map<string, { dayIndex: number; meters: number }>();
  points.forEach((point, index) => {
    if (starts.has(point.id)) {
      dayIndex += 1;
      meters = 0;
    } else if (index > 0) {
      meters += distanceMeters(points[index - 1], point);
    }
    atPoint.set(point.id, { dayIndex, meters });
  });
  return { totals, atPoint, animationPoints };
}

export type RouteDistanceModel = ReturnType<typeof buildRouteDistanceModel>;

// null means editing: show the entire route, not just the selected animation range.
export function routeDistanceProgress(model: RouteDistanceModel, routeProgress: number | null, reachedPointIndex?: number | null) {
  const position = routeProgress === null ? null : interpolateTripRoute(model.animationPoints, routeProgress);
  let current = position ? model.atPoint.get(model.animationPoints[position.fromIndex].id) : undefined;
  if (position && current) {
    if (reachedPointIndex != null && position.fromIndex > reachedPointIndex) {
      // During a camera/day transition the marker can still be at the preceding point.
      const reachedPoint = model.animationPoints[reachedPointIndex];
      current = reachedPoint ? model.atPoint.get(reachedPoint.id) : undefined;
    } else {
      const end = model.atPoint.get(model.animationPoints[position.toIndex].id);
      if (end && end.dayIndex === current.dayIndex) {
        current = { dayIndex: current.dayIndex, meters: current.meters + (end.meters - current.meters) * position.segmentProgress };
      } else if (end && position.segmentProgress >= 1) {
        current = end;
      }
      // While crossing a DAY boundary, retain the previous DAY's final distance.
    }
  }
  const days = model.totals.days.map((day, index) => ({
    dayNumber: day.dayNumber,
    totalMeters: day.distanceMeters,
    currentMeters: routeProgress === null || (current && index < current.dayIndex)
      ? day.distanceMeters
      : current && index === current.dayIndex ? Math.min(day.distanceMeters, Math.max(0, current.meters)) : 0,
  }));
  return {
    days,
    currentTotalMeters: days.reduce((total, day) => total + day.currentMeters, 0),
    totalMeters: model.totals.totalMeters,
  };
}

export type RouteDistanceProgress = ReturnType<typeof routeDistanceProgress>;
