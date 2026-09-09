import type { RoutePoint } from '../timeline/types';
import { nearestTripSegmentIndex } from './tripRoute';

export function addPoint(points: RoutePoint[], latitude: number, longitude: number, id = `manual-${crypto.randomUUID()}`): RoutePoint[] {
  const point: RoutePoint = { id, latitude, longitude, source: 'manual', original: false };
  if (points.length < 2) return [...points, point];
  const segmentIndex = nearestTripSegmentIndex(points, longitude, latitude);
  return [...points.slice(0, segmentIndex + 1), point, ...points.slice(segmentIndex + 1)];
}

export function appendPlanPoint(points: RoutePoint[], latitude: number, longitude: number, id = `manual-${crypto.randomUUID()}`): RoutePoint[] {
  return [...points, { id, latitude, longitude, source: 'manual', original: false }];
}

export function deletePoint(points: RoutePoint[], id: string): RoutePoint[] {
  return points.filter((point) => point.id !== id);
}

export function movePoint(points: RoutePoint[], id: string, latitude: number, longitude: number): RoutePoint[] {
  return points.map((point) => point.id === id ? { ...point, latitude, longitude, original: false } : point);
}
