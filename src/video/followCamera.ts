import type { RoutePoint } from '../timeline/types';
import { interpolateTripRoute, splitRouteByDay, tripRoutePointProgresses } from '../route/tripRoute';

export type VideoCameraMode = 'overview' | 'follow';
export type FollowZoomPreset = 'wide' | 'standard' | 'close' | 'custom';
export type FollowPlaybackPhase = 'moving' | 'camera-pan' | 'day-transition';

export interface GeoPosition {
  longitude: number;
  latitude: number;
}

export interface FollowPlaybackState {
  phase: FollowPlaybackPhase;
  cameraCenter: GeoPosition;
  zoom: number;
  bearing: 0;
  pitch: 0;
  routeProgress: number;
  markerPosition: GeoPosition;
  reachedPointIndex: number;
}

interface FollowCameraEvent {
  type: Exclude<FollowPlaybackPhase, 'moving'>;
  routeProgress: number;
  fromCenter: GeoPosition;
  toCenter: GeoPosition;
  markerBefore: GeoPosition;
  markerAfter: GeoPosition;
  reachedPointIndexBefore: number;
  reachedPointIndexAfter: number;
  startSeconds: number;
  endSeconds: number;
}

export interface FollowCameraPlan {
  points: RoutePoint[];
  duration: number;
  zoom: number;
  initialCenter: GeoPosition;
  totalPanSeconds: number;
  routeMovementSeconds: number;
  events: FollowCameraEvent[];
}

export const FOLLOW_VIEWPORT = { width: 1920, height: 1080 } as const;

export const FOLLOW_ZOOM_BY_PRESET: Record<Exclude<FollowZoomPreset, 'custom'>, number> = {
  wide: 8,
  standard: 10,
  close: 12,
};

export const FOLLOW_CAMERA_CONFIG = {
  panTriggerBoundary: { left: 0.10, right: 0.90, top: 0.10, bottom: 0.90 },
  diagonalProximityBoundary: { left: 0.30, right: 0.70, top: 0.30, bottom: 0.70 },
  panDurationSeconds: 0.5,
  bearing: 0 as const,
  pitch: 0 as const,
  sampleStepPixels: 4,
} as const;

export const FOLLOW_DURATION_ERROR = 'この表示範囲では移動時間が短すぎます。移動時間を長くするか、表示範囲を広くしてください。';

interface WorldPoint { x: number; y: number }
interface UntimedCameraEvent extends Omit<FollowCameraEvent, 'startSeconds' | 'endSeconds'> {}

const PAN_LEFT = 1;
const PAN_RIGHT = 2;
const PAN_TOP = 4;
const PAN_BOTTOM = 8;

export function buildFollowCameraPlan(points: RoutePoint[], preset: FollowZoomPreset, duration: number, customZoom = 10): FollowCameraPlan {
  if (!points.length) throw new Error('ルート追従にはルートが必要です。');
  const zoom = preset === 'custom' ? customZoom : FOLLOW_ZOOM_BY_PRESET[preset];
  if (!Number.isFinite(zoom) || zoom < 4 || zoom > 16) throw new Error('Zoomは4.0〜16.0で指定してください。');
  const worldSize = 512 * 2 ** zoom;
  const arrivals = tripRoutePointProgresses(points);
  const segments = splitRouteByDay(points);
  const initialCenter = toGeoPosition(points[0]);
  const events = buildUntimedCameraEvents(points, segments, arrivals, initialCenter, worldSize);
  const totalPanSeconds = events.length * FOLLOW_CAMERA_CONFIG.panDurationSeconds;
  const routeMovementSeconds = duration - totalPanSeconds;
  if (totalPanSeconds >= duration || routeMovementSeconds <= 0) throw new Error(FOLLOW_DURATION_ERROR);
  const timedEvents: FollowCameraEvent[] = events.map((event, index) => {
    const startSeconds = event.routeProgress * routeMovementSeconds + index * FOLLOW_CAMERA_CONFIG.panDurationSeconds;
    return { ...event, startSeconds, endSeconds: startSeconds + FOLLOW_CAMERA_CONFIG.panDurationSeconds };
  });
  return { points, duration, zoom, initialCenter, totalPanSeconds, routeMovementSeconds, events: timedEvents };
}

function buildUntimedCameraEvents(
  points: RoutePoint[],
  segments: RoutePoint[][],
  arrivals: number[],
  initialCenter: GeoPosition,
  worldSize: number,
): UntimedCameraEvent[] {
  let cameraWorld = projectWorld(initialCenter, worldSize);
  const events: UntimedCameraEvent[] = [];
  let segmentStartIndex = 0;

  segments.forEach((segment, dayIndex) => {
    if (dayIndex > 0) {
      const previousPointIndex = segmentStartIndex - 1;
      const nextPointIndex = segmentStartIndex;
      const nextPosition = toGeoPosition(points[nextPointIndex]);
      const targetWorld = projectWorldNear(nextPosition, worldSize, cameraWorld.x);
      events.push({
        type: 'day-transition',
        routeProgress: arrivals[nextPointIndex],
        fromCenter: unprojectWorld(cameraWorld, worldSize),
        toCenter: unprojectWorld(targetWorld, worldSize),
        markerBefore: toGeoPosition(points[previousPointIndex]),
        markerAfter: nextPosition,
        reachedPointIndexBefore: previousPointIndex,
        reachedPointIndexAfter: nextPointIndex,
      });
      cameraWorld = targetWorld;
    }

    for (let index = 0; index < segment.length - 1; index += 1) {
      const fromIndex = segmentStartIndex + index;
      const toIndex = fromIndex + 1;
      const from = segment[index];
      const to = segment[index + 1];
      const fromWorld = projectWorldNear(toGeoPosition(from), worldSize, cameraWorld.x);
      const toWorld = projectWorldNear(toGeoPosition(to), worldSize, fromWorld.x);
      const steps = Math.max(1, Math.ceil(Math.max(Math.abs(toWorld.x - fromWorld.x), Math.abs(toWorld.y - fromWorld.y)) / FOLLOW_CAMERA_CONFIG.sampleStepPixels));
      for (let sample = 1; sample <= steps; sample += 1) {
        const fraction = sample / steps;
        const markerPosition = {
          longitude: from.longitude + (to.longitude - from.longitude) * fraction,
          latitude: from.latitude + (to.latitude - from.latitude) * fraction,
        };
        const markerWorld = projectWorldNear(markerPosition, worldSize, cameraWorld.x);
        const screen = {
          x: markerWorld.x - cameraWorld.x + FOLLOW_VIEWPORT.width / 2,
          y: markerWorld.y - cameraWorld.y + FOLLOW_VIEWPORT.height / 2,
        };
        const routeProgress = arrivals[fromIndex] + (arrivals[toIndex] - arrivals[fromIndex]) * fraction;
        const panDirections = getPanDirections(screen);
        if (panDirections === 0) continue;

        const targetCenter = markerWorld;
        const reachedPointIndex = sample === steps ? toIndex : fromIndex;
        events.push({
          type: 'camera-pan',
          routeProgress,
          fromCenter: unprojectWorld(cameraWorld, worldSize),
          toCenter: unprojectWorld(targetCenter, worldSize),
          markerBefore: markerPosition,
          markerAfter: markerPosition,
          reachedPointIndexBefore: reachedPointIndex,
          reachedPointIndexAfter: reachedPointIndex,
        });
        cameraWorld = targetCenter;
      }
    }
    segmentStartIndex += segment.length;
  });
  return events;
}

function getPanDirections(screen: WorldPoint): number {
  const trigger = FOLLOW_CAMERA_CONFIG.panTriggerBoundary;
  let directions = 0;
  if (screen.x <= FOLLOW_VIEWPORT.width * trigger.left) directions |= PAN_LEFT;
  else if (screen.x >= FOLLOW_VIEWPORT.width * trigger.right) directions |= PAN_RIGHT;
  if (screen.y <= FOLLOW_VIEWPORT.height * trigger.top) directions |= PAN_TOP;
  else if (screen.y >= FOLLOW_VIEWPORT.height * trigger.bottom) directions |= PAN_BOTTOM;
  if (directions === 0) return 0;

  const proximity = FOLLOW_CAMERA_CONFIG.diagonalProximityBoundary;
  if (directions & (PAN_LEFT | PAN_RIGHT)) {
    if (screen.y <= FOLLOW_VIEWPORT.height * proximity.top) directions |= PAN_TOP;
    else if (screen.y >= FOLLOW_VIEWPORT.height * proximity.bottom) directions |= PAN_BOTTOM;
  }
  if (directions & (PAN_TOP | PAN_BOTTOM)) {
    if (screen.x <= FOLLOW_VIEWPORT.width * proximity.left) directions |= PAN_LEFT;
    else if (screen.x >= FOLLOW_VIEWPORT.width * proximity.right) directions |= PAN_RIGHT;
  }
  return directions;
}

export function sampleFollowPlayback(plan: FollowCameraPlan, elapsedSeconds: number): FollowPlaybackState {
  const elapsed = Math.min(plan.duration, Math.max(0, elapsedSeconds));
  const eventIndex = lastEventStartingAtOrBefore(plan.events, elapsed);
  const activeEvent = eventIndex >= 0 && elapsed < plan.events[eventIndex].endSeconds ? plan.events[eventIndex] : null;
  if (activeEvent) {
    const eventProgress = (elapsed - activeEvent.startSeconds) / FOLLOW_CAMERA_CONFIG.panDurationSeconds;
    return {
      phase: activeEvent.type,
      cameraCenter: interpolateGeoPosition(activeEvent.fromCenter, activeEvent.toCenter, easeInOutCubic(eventProgress)),
      zoom: plan.zoom,
      bearing: FOLLOW_CAMERA_CONFIG.bearing,
      pitch: FOLLOW_CAMERA_CONFIG.pitch,
      routeProgress: activeEvent.routeProgress,
      markerPosition: activeEvent.markerBefore,
      reachedPointIndex: activeEvent.reachedPointIndexBefore,
    };
  }

  const completedEvents = countCompletedEvents(plan.events, elapsed);
  const routeProgress = Math.min(1, Math.max(0, (elapsed - completedEvents * FOLLOW_CAMERA_CONFIG.panDurationSeconds) / plan.routeMovementSeconds));
  const position = interpolateTripRoute(plan.points, routeProgress)!;
  const reachedPointIndex = position.fromIndex === position.toIndex || position.segmentProgress < 1
    ? position.fromIndex
    : position.toIndex;
  return {
    phase: 'moving',
    cameraCenter: completedEvents ? plan.events[completedEvents - 1].toCenter : plan.initialCenter,
    zoom: plan.zoom,
    bearing: FOLLOW_CAMERA_CONFIG.bearing,
    pitch: FOLLOW_CAMERA_CONFIG.pitch,
    routeProgress,
    markerPosition: { longitude: position.longitude, latitude: position.latitude },
    reachedPointIndex,
  };
}

function lastEventStartingAtOrBefore(events: FollowCameraEvent[], elapsed: number): number {
  let low = 0;
  let high = events.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (events[middle].startSeconds <= elapsed) low = middle + 1;
    else high = middle;
  }
  return low - 1;
}

function countCompletedEvents(events: FollowCameraEvent[], elapsed: number): number {
  let low = 0;
  let high = events.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (events[middle].endSeconds <= elapsed) low = middle + 1;
    else high = middle;
  }
  return low;
}

function easeInOutCubic(value: number): number {
  const clamped = Math.min(1, Math.max(0, value));
  return clamped < 0.5 ? 4 * clamped ** 3 : 1 - (-2 * clamped + 2) ** 3 / 2;
}

function toGeoPosition(point: Pick<RoutePoint, 'longitude' | 'latitude'>): GeoPosition {
  return { longitude: point.longitude, latitude: point.latitude };
}

function projectWorld(position: GeoPosition, worldSize: number): WorldPoint {
  const latitude = Math.max(-85.051129, Math.min(85.051129, position.latitude));
  const sine = Math.sin(latitude * Math.PI / 180);
  return {
    x: (position.longitude + 180) / 360 * worldSize,
    y: (0.5 - Math.log((1 + sine) / (1 - sine)) / (4 * Math.PI)) * worldSize,
  };
}

function projectWorldNear(position: GeoPosition, worldSize: number, referenceX: number): WorldPoint {
  const point = projectWorld(position, worldSize);
  point.x += Math.round((referenceX - point.x) / worldSize) * worldSize;
  return point;
}

function unprojectWorld(point: WorldPoint, worldSize: number): GeoPosition {
  const longitude = normalizeLongitude(point.x / worldSize * 360 - 180);
  const y = 0.5 - point.y / worldSize;
  const latitude = 90 - 360 * Math.atan(Math.exp(-y * 2 * Math.PI)) / Math.PI;
  return { longitude, latitude };
}

function interpolateGeoPosition(from: GeoPosition, to: GeoPosition, progress: number): GeoPosition {
  let longitudeDelta = to.longitude - from.longitude;
  if (longitudeDelta > 180) longitudeDelta -= 360;
  if (longitudeDelta < -180) longitudeDelta += 360;
  return {
    longitude: normalizeLongitude(from.longitude + longitudeDelta * progress),
    latitude: from.latitude + (to.latitude - from.latitude) * progress,
  };
}

function normalizeLongitude(longitude: number): number {
  return ((longitude + 180) % 360 + 360) % 360 - 180;
}
