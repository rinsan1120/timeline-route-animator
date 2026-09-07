import type { RoutePoint } from '../timeline/types';

const EARTH_RADIUS_METERS = 6_371_008.8;
const radians = (degrees: number) => degrees * Math.PI / 180;

export function distanceMeters(a: Pick<RoutePoint, 'latitude' | 'longitude'>, b: Pick<RoutePoint, 'latitude' | 'longitude'>): number {
  const latitudeDelta = radians(b.latitude - a.latitude);
  const longitudeDelta = radians(b.longitude - a.longitude);
  const latitudeA = radians(a.latitude);
  const latitudeB = radians(b.latitude);
  const haversine = Math.sin(latitudeDelta / 2) ** 2 + Math.cos(latitudeA) * Math.cos(latitudeB) * Math.sin(longitudeDelta / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.sqrt(haversine));
}

export function routeDistance(points: RoutePoint[]): number {
  let total = 0;
  for (let index = 1; index < points.length; index += 1) total += distanceMeters(points[index - 1], points[index]);
  return total;
}

export interface InterpolatedPosition {
  latitude: number;
  longitude: number;
  segmentIndex: number;
  segmentProgress: number;
}

// Compute once per route, then reuse for all annotated points (including future video rendering).
export function routePointProgresses(points: RoutePoint[]): number[] {
  const cumulative = points.length ? [0] : [];
  for (let index = 1; index < points.length; index += 1) {
    cumulative.push(cumulative[index - 1] + distanceMeters(points[index - 1], points[index]));
  }
  const total = cumulative.at(-1) ?? 0;
  return cumulative.map((distance, index) => {
    if (index === 0) return 0;
    if (index === points.length - 1) return 1;
    return total === 0 ? 0 : distance / total;
  });
}

export function routePointProgress(points: RoutePoint[], pointId: string): number | null {
  const index = points.findIndex((point) => point.id === pointId);
  return index < 0 ? null : routePointProgresses(points)[index];
}

export function interpolateRoute(points: RoutePoint[], progress: number): InterpolatedPosition | null {
  if (!points.length) return null;
  if (points.length === 1) return { ...points[0], segmentIndex: 0, segmentProgress: 0 };
  const distances = points.slice(1).map((point, index) => distanceMeters(points[index], point));
  const total = distances.reduce((sum, distance) => sum + distance, 0);
  if (total === 0) return { ...points[0], segmentIndex: 0, segmentProgress: 0 };
  const target = Math.min(1, Math.max(0, progress)) * total;
  let traversed = 0;
  for (let index = 0; index < distances.length; index += 1) {
    const next = traversed + distances[index];
    if (target <= next || index === distances.length - 1) {
      const segmentProgress = distances[index] === 0 ? 0 : (target - traversed) / distances[index];
      return {
        latitude: points[index].latitude + (points[index + 1].latitude - points[index].latitude) * segmentProgress,
        longitude: points[index].longitude + (points[index + 1].longitude - points[index].longitude) * segmentProgress,
        segmentIndex: index,
        segmentProgress,
      };
    }
    traversed = next;
  }
  return { ...points.at(-1)!, segmentIndex: points.length - 2, segmentProgress: 1 };
}

function squaredSegmentDistance(point: [number, number], start: [number, number], end: [number, number]): number {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  if (dx === 0 && dy === 0) return (point[0] - start[0]) ** 2 + (point[1] - start[1]) ** 2;
  const fraction = Math.max(0, Math.min(1, ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / (dx * dx + dy * dy)));
  return (point[0] - (start[0] + fraction * dx)) ** 2 + (point[1] - (start[1] + fraction * dy)) ** 2;
}

export function nearestSegmentIndex(points: RoutePoint[], longitude: number, latitude: number): number {
  if (points.length < 2) return Math.max(0, points.length - 1);
  let bestIndex = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let index = 0; index < points.length - 1; index += 1) {
    const distance = squaredSegmentDistance([longitude, latitude], [points[index].longitude, points[index].latitude], [points[index + 1].longitude, points[index + 1].latitude]);
    if (distance < bestDistance) { bestDistance = distance; bestIndex = index; }
  }
  return bestIndex;
}

export function formatDistance(meters: number): string {
  return meters >= 1000 ? `${(meters / 1000).toFixed(1)} km` : `${Math.round(meters)} m`;
}
