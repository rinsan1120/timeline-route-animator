import type { PopupPlacement } from '../popup/placement';
import type { RoutePoint } from '../timeline/types';
import { distanceMeters, interpolateRoute, nearestSegmentIndex, routeDistance, routePointProgresses, type InterpolatedPosition } from './geometry';

export interface DayMarker {
  placement?: PopupPlacement;
  dayNumber: number;
  date?: string;
  pointId: string;
  note?: string;
}

export interface TripInterpolatedPosition extends InterpolatedPosition {
  fromIndex: number;
  toIndex: number;
}

const DATE_PATTERN = /^(\d{4}-\d{2}-\d{2})T/;

export function routePointDate(point: RoutePoint): string | null {
  return typeof point.timestamp === 'string' ? DATE_PATTERN.exec(point.timestamp)?.[1] ?? null : null;
}

export function splitRouteByDay(points: RoutePoint[]): RoutePoint[][] {
  const segments: RoutePoint[][] = [];
  let current: RoutePoint[] = [];
  let currentDate: string | null = null;
  for (const point of points) {
    const date = routePointDate(point);
    if (date && currentDate && date !== currentDate) {
      segments.push(current);
      current = [];
    }
    current.push(point);
    if (date) currentDate = date;
  }
  if (current.length) segments.push(current);
  return segments;
}

export function deriveDayMarkers(points: RoutePoint[], notes: Record<string, string>, startDate?: string): DayMarker[] {
  const dates = new Set<string>();
  const markers: DayMarker[] = [];
  const firstDate = startDate ?? points.map(routePointDate).find((date): date is string => date !== null);
  for (const point of points) {
    const date = routePointDate(point);
    if (!date || dates.has(date)) continue;
    dates.add(date);
    const note = notes[date]?.trim();
    markers.push({ dayNumber: firstDate ? calendarDayDifference(firstDate, date) + 1 : markers.length + 1, date, pointId: point.id, ...(note ? { note } : {}) });
  }
  return markers;
}

export function derivePlanDayMarkers(points: RoutePoint[], dayStarts: string[], notes: Record<string, string>): DayMarker[] {
  const starts = new Set(dayStarts);
  const markers: DayMarker[] = [];
  // ルート順に走査し、削除中の地点は無視する。IDは保持されるためUndoで境界も復活する。
  for (const [index, point] of points.entries()) {
    if (index !== 0 && !starts.has(point.id)) continue;
    starts.delete(point.id);
    const note = notes[point.id]?.trim();
    markers.push({ dayNumber: markers.length + 1, pointId: point.id, ...(note ? { note } : {}) });
  }
  return markers;
}

export function planRouteDistances(points: RoutePoint[], dayStarts: string[]) {
  return routeDistancesByDay(points, derivePlanDayMarkers(points, dayStarts, {}));
}

export function routeDistancesByDay(points: RoutePoint[], dayMarkers: DayMarker[]) {
  const markers = dayMarkers.length || !points.length
    ? dayMarkers : [{ dayNumber: 1, pointId: points[0].id }];
  const days = markers.map((marker) => ({
    dayNumber: marker.dayNumber,
    pointId: marker.pointId,
    distanceMeters: 0,
  }));
  let dayIndex = -1;
  for (let index = 0; index < points.length; index += 1) {
    if (points[index].id === days[dayIndex + 1]?.pointId) {
      dayIndex += 1;
      // A new DAY starts here; omit the connection from the previous DAY.
    } else if (dayIndex >= 0 && index > 0) {
      days[dayIndex].distanceMeters += distanceMeters(points[index - 1], points[index]);
    }
  }
  return { days, totalMeters: days.reduce((total, day) => total + day.distanceMeters, 0) };
}

function calendarDayDifference(startDate: string, endDate: string): number {
  return Math.round((Date.parse(`${endDate}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`)) / 86_400_000);
}

export function tripRouteDistance(points: RoutePoint[]): number {
  const segments = splitRouteByDay(points);
  return segments.length <= 1 ? routeDistance(points) : segments.reduce((total, segment) => total + routeDistance(segment), 0);
}

export function tripRoutePointProgresses(points: RoutePoint[]): number[] {
  const segments = splitRouteByDay(points);
  if (segments.length <= 1) return routePointProgresses(points);
  const cumulative: number[] = [];
  let total = 0;
  for (const segment of segments) {
    cumulative.push(total);
    for (let index = 1; index < segment.length; index += 1) {
      total += distanceMeters(segment[index - 1], segment[index]);
      cumulative.push(total);
    }
  }
  return cumulative.map((distance, index) => {
    if (index === 0) return 0;
    if (index === points.length - 1) return 1;
    return total === 0 ? 0 : distance / total;
  });
}

export function interpolateTripRoute(points: RoutePoint[], progress: number): TripInterpolatedPosition | null {
  if (!points.length) return null;
  const segments = splitRouteByDay(points);
  if (segments.length <= 1) {
    const position = interpolateRoute(points, progress);
    if (!position) return null;
    return { ...position, fromIndex: position.segmentIndex, toIndex: Math.min(points.length - 1, position.segmentIndex + 1) };
  }

  const clamped = Math.min(1, Math.max(0, progress));
  if (clamped === 0) return pointPosition(points, 0);
  if (clamped === 1) return pointPosition(points, points.length - 1);
  const distances = segments.map((segment) => routeDistance(segment));
  const total = distances.reduce((sum, distance) => sum + distance, 0);
  if (total === 0) return pointPosition(points, 0);
  const target = clamped * total;
  let traversed = 0;
  let startIndex = 0;
  for (let segmentIndex = 0; segmentIndex < segments.length; segmentIndex += 1) {
    const segment = segments[segmentIndex];
    const distance = distances[segmentIndex];
    const end = traversed + distance;
    if (distance > 0 && target < end) {
      const position = interpolateRoute(segment, (target - traversed) / distance)!;
      return {
        ...position,
        segmentIndex: startIndex + position.segmentIndex,
        fromIndex: startIndex + position.segmentIndex,
        toIndex: startIndex + Math.min(segment.length - 1, position.segmentIndex + 1),
      };
    }
    traversed = end;
    startIndex += segment.length;
  }
  return pointPosition(points, points.length - 1);
}

export function revealedTripRouteSegments(points: RoutePoint[], progress: number): RoutePoint[][] {
  const segments = splitRouteByDay(points);
  if (!points.length) return segments;
  const arrivals = tripRoutePointProgresses(points);
  const position = interpolateTripRoute(points, progress);
  const clamped = Math.min(1, Math.max(0, progress));
  let startIndex = 0;
  return segments.flatMap((segment) => {
    const visible = segment.filter((_point, index) => arrivals[startIndex + index] <= clamped);
    const endIndex = startIndex + segment.length;
    if (position && position.fromIndex !== position.toIndex
      && position.fromIndex >= startIndex && position.toIndex < endIndex
      && arrivals[position.toIndex] > clamped) {
      visible.push({
        id: 'preview-tail',
        latitude: position.latitude,
        longitude: position.longitude,
        source: 'manual',
        original: false,
      });
    }
    startIndex = endIndex;
    return visible.length ? [visible] : [];
  });
}

export function nearestTripSegmentIndex(points: RoutePoint[], longitude: number, latitude: number): number {
  const segments = splitRouteByDay(points);
  if (segments.length <= 1) return nearestSegmentIndex(points, longitude, latitude);
  let bestIndex = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  let startIndex = 0;
  for (const segment of segments) {
    for (let index = 0; index < segment.length - 1; index += 1) {
      const distance = squaredSegmentDistance(
        [longitude, latitude],
        [segment[index].longitude, segment[index].latitude],
        [segment[index + 1].longitude, segment[index + 1].latitude],
      );
      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = startIndex + index;
      }
    }
    startIndex += segment.length;
  }
  if (Number.isFinite(bestDistance)) return bestIndex;
  return nearestPointIndex(points, longitude, latitude);
}

function pointPosition(points: RoutePoint[], index: number): TripInterpolatedPosition {
  return { ...points[index], segmentIndex: index, segmentProgress: 0, fromIndex: index, toIndex: index };
}

function nearestPointIndex(points: RoutePoint[], longitude: number, latitude: number): number {
  let bestIndex = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  points.forEach((point, index) => {
    const distance = (point.longitude - longitude) ** 2 + (point.latitude - latitude) ** 2;
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
  });
  return bestIndex;
}

function squaredSegmentDistance(point: [number, number], start: [number, number], end: [number, number]): number {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  if (dx === 0 && dy === 0) return (point[0] - start[0]) ** 2 + (point[1] - start[1]) ** 2;
  const fraction = Math.max(0, Math.min(1, ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / (dx * dx + dy * dy)));
  return (point[0] - (start[0] + fraction * dx)) ** 2 + (point[1] - (start[1] + fraction * dy)) ** 2;
}
