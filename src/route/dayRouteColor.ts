import type { RoutePoint } from '../timeline/types';
import type { DayMarker } from './tripRoute';

export const DAY_ROUTE_COLORS = [
  '#FF5D37',
  '#2563EB',
  '#8B5CF6',
  '#008C7A',
  '#C026D3',
  '#DC2626',
  '#4F46E5',
  '#A65324',
  '#087EA4',
  '#DB2777',
] as const;

export const DEFAULT_ROUTE_COLOR = DAY_ROUTE_COLORS[0];

export function dayRouteColor(dayNumber: number): string {
  if (!Number.isInteger(dayNumber) || dayNumber < 1) return DEFAULT_ROUTE_COLOR;
  return DAY_ROUTE_COLORS[(dayNumber - 1) % DAY_ROUTE_COLORS.length];
}

export function buildRoutePointDayNumbers(points: readonly RoutePoint[], dayMarkers: readonly DayMarker[]): ReadonlyMap<string, number> {
  const dayStartByPointId = new Map(dayMarkers.map((marker) => [marker.pointId, marker.dayNumber]));
  const dayNumberByPointId = new Map<string, number>();
  let dayNumber = 1;
  for (const point of points) {
    dayNumber = dayStartByPointId.get(point.id) ?? dayNumber;
    dayNumberByPointId.set(point.id, dayNumber);
  }
  return dayNumberByPointId;
}

export interface DayRouteSegment {
  points: RoutePoint[];
  dayNumber: number;
  color: string;
}

// Split only for coloring. Existing base segment boundaries and connector geometry stay intact.
export function colorRouteSegments(
  segments: readonly RoutePoint[][],
  dayNumberByPointId: ReadonlyMap<string, number>,
  enabled: boolean,
): DayRouteSegment[] {
  if (!enabled) return segments.map((points) => ({ points, dayNumber: 1, color: DEFAULT_ROUTE_COLOR }));
  return segments.flatMap((points) => {
    if (!points.length) return [];
    const colored: DayRouteSegment[] = [];
    let dayNumber = dayNumberByPointId.get(points[0].id) ?? 1;
    let current = [points[0]];
    for (let index = 1; index < points.length; index += 1) {
      const point = points[index];
      const nextDayNumber = dayNumberByPointId.get(point.id) ?? dayNumber;
      if (nextDayNumber !== dayNumber) {
        current.push(point);
        colored.push({ points: current, dayNumber, color: dayRouteColor(dayNumber) });
        current = [point];
        dayNumber = nextDayNumber;
      } else {
        current.push(point);
      }
    }
    colored.push({ points: current, dayNumber, color: dayRouteColor(dayNumber) });
    return colored;
  });
}
