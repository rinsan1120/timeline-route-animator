import type * as maplibregl from 'maplibre-gl';
import type { BalloonFramePosition, PopupPlacement, EndpointMarkerPlacements, EndpointMarkerFramePositions } from '../popup/placement';
import { createBalloonReferenceProjector } from '../map/balloonProjection';
import { balloonReferenceCamera, resolveBalloonFramePositions } from '../route/balloonFrame';
import { DEFAULT_ANNOTATION_STYLE, type AnnotationStyle } from '../route/annotationStyle';
import type { RouteMarkerMode } from '../route/routeMarker';
import { interpolateTripRoute, revealedTripRouteSegments, splitRouteByDay, tripRoutePointProgresses, type DayMarker } from '../route/tripRoute';
import { colorRouteSegments } from '../route/dayRouteColor';
import { routeDistanceProgress } from '../route/routeDistanceProgress';
import type { RoutePoint } from '../timeline/types';
import type { FollowCameraPlan, FollowPlaybackState } from './followCamera';
import type { VideoCamera } from './overviewCamera';
import type { DistanceHudOptions } from './distanceHud';
import { sampleFrame, type FramePlan, type FramePlanOptions, type FrameState } from './frameTimeline';
import { isInVideoViewport, type VideoDayMarker } from './frameDrawing';
import type { VideoFrameScene } from './frameRenderer';
import { DEFAULT_TIME_DISPLAY, sampleRecordedRouteTime, sampleRecordedTime, firstRecordedMilliseconds, followClockPointIndex, type FrameClockDisplay, type TimeDisplaySettings } from './routeClock';

export interface FrameDrawingOptions extends FramePlanOptions {
  revealRoute: boolean;
  recordedTimeClockEnabled?: boolean;
  timeDisplaySettings?: TimeDisplaySettings;
  distanceHud?: DistanceHudOptions;
  endpointMarkerPlacements?: EndpointMarkerPlacements;
  endpointMarkerFramePositions?: EndpointMarkerFramePositions;
  annotationStyle?: AnnotationStyle;
  dayNumberByPointId?: ReadonlyMap<string, number>;
  dayRouteColorsEnabled?: boolean;
}

function clockPointIndex(state: FrameState) {
  return state.cameraMode === 'follow'
    ? followClockPointIndex(state.playback, state.pausePointIndex)
    : state.renderPath === 'intro-zoom' ? 0 : state.pausePointIndex;
}

export function frameClockText(options: FrameDrawingOptions, state: FrameState, pointIndex = clockPointIndex(state)): string | null {
  if (!options.recordedTimeClockEnabled && (!options.timeDisplaySettings || options.timeDisplaySettings.labelMode === 'hidden')) return null;
  return sampleRecordedRouteTime(options.points, state.routeProgress, pointIndex);
}

// Sampling a two-second lookback makes interval visibility deterministic on seek
// and independent of dropped preview frames. Time thresholds use recorded time.
export function frameClockDisplay(options: FrameDrawingOptions, state: FrameState, plan: FramePlan, pointIndex = clockPointIndex(state)): FrameClockDisplay | null {
  const text = frameClockText(options, state, pointIndex);
  if (!text) return null;
  const settings = options.timeDisplaySettings ?? DEFAULT_TIME_DISPLAY;
  const pausedLabelVisible = settings.labelMode === 'paused';
  let labelVisible = settings.labelMode === 'always' || (pausedLabelVisible && state.pausePointIndex !== null);
  if (settings.labelMode === 'interval') {
    const current = sampleRecordedTime(options.points, state.routeProgress, pointIndex);
    const before = sampleFrame(plan, Math.max(0, state.frameIndex - Math.round(2 * plan.fps)));
    const previous = sampleRecordedTime(options.points, before.routeProgress, clockPointIndex(before));
    const start = firstRecordedMilliseconds(options.points);
    if (current && previous && start !== null) {
      const interval = settings.intervalMinutes * 60_000;
      const bucket = Math.floor((current.milliseconds - start) / interval);
      labelVisible = bucket > 0 && bucket > Math.floor((previous.milliseconds - start) / interval);
    }
  }
  return { text, hudEnabled: !!options.recordedTimeClockEnabled, settings, labelVisible, pausedLabelVisible };
}

export function prepareVideoDayMarkers(dayMarkers: DayMarker[], pointIndexById: ReadonlyMap<string, number>) {
  return dayMarkers.flatMap((marker) => {
    const pointIndex = pointIndexById.get(marker.pointId);
    return pointIndex === undefined ? [] : [{ ...marker, pointIndex }];
  });
}

export function resolveVideoBalloons<T extends FrameDrawingOptions>(options: T, map: maplibregl.Map, context: CanvasRenderingContext2D, overview: VideoCamera, follow: FollowCameraPlan | null): T {
  if (!options.points.some((point) => point.annotation?.label && !point.annotation.framePosition)) return options;
  const project = createBalloonReferenceProjector(map);
  const points = resolveBalloonFramePositions(context, options.points, options.annotationStyle ?? DEFAULT_ANNOTATION_STYLE,
    (point) => project(point, balloonReferenceCamera(point.id, overview, follow)));
  return { ...options, points };
}

export function prepareOverviewFrameData(options: FrameDrawingOptions, map: Pick<maplibregl.Map, 'project'>, pointIndexById: ReadonlyMap<string, number>, dayNumberByPointId: ReadonlyMap<string, number>, projectedPixels?: maplibregl.Point[]) {
  const pixels = projectedPixels ?? options.points.map((point) => map.project([point.longitude, point.latitude]));
  const arrivals = tripRoutePointProgresses(options.points);
  const annotations = options.points.flatMap((point, index) => point.annotation?.label
    ? [{ ...point.annotation, pointId: point.id, pixel: pixels[index], pointIndex: index, arrivalProgress: arrivals[index] }] : []);
  const dayMarkers = (options.dayMarkers ?? []).flatMap((marker) => {
    const pointIndex = pointIndexById.get(marker.pointId);
    return pointIndex === undefined ? [] : [{ ...marker, pixel: pixels[pointIndex], pointIndex, arrivalProgress: arrivals[pointIndex] }];
  });
  const routeSegments = colorRouteSegments(splitRouteByDay(options.points), dayNumberByPointId, options.dayRouteColorsEnabled ?? false).map((segment) => ({
    color: segment.color,
    points: segment.points.map((point) => {
      const pointIndex = pointIndexById.get(point.id)!;
      return { pixel: pixels[pointIndex], pointIndex, arrivalProgress: arrivals[pointIndex] };
    }),
  }));
  return { pixels, annotations, dayMarkers, routeSegments };
}

export function prepareOverviewFrameScene(
  background: ImageBitmap,
  pixels: maplibregl.Point[],
  routeSegments: VideoRouteSegment[],
  points: RoutePoint[],
  progress: number,
  revealRoute: boolean,
  annotations: (VideoAnnotation & { pointIndex: number })[],
  dayMarkers: (VideoDayMarker & { pointIndex: number })[],
  routeMarkerMode: RouteMarkerMode,
  annotationStyle: AnnotationStyle,
  endpointMarkerPlacements: EndpointMarkerPlacements,
  distanceHud?: DistanceHudOptions,
  dayRouteColorsEnabled = false,
  pausePointIndex: number | null = null,
  clockDisplay: FrameClockDisplay | null = null,
  endpointMarkerFramePositions: EndpointMarkerFramePositions = {},
) {
  const position = interpolateTripRoute(points, progress)!;
  const markerStart = pixels[pausePointIndex ?? position.fromIndex];
  const markerEnd = pixels[pausePointIndex ?? position.toIndex];
  const x = markerStart.x + (markerEnd.x - markerStart.x) * position.segmentProgress;
  const y = markerStart.y + (markerEnd.y - markerStart.y) * position.segmentProgress;
  const scene: VideoFrameScene = {
    background, routeSegments: [], markerPosition: { x, y }, clockDisplay,
    annotations: [], annotationStyle, dayMarkers: [], dayRouteColorsEnabled, endpointMarkers: [],
  };
  for (const segment of routeSegments) {
    const routePixels = [];
    for (const routePoint of segment.points) {
      if (revealRoute && (pausePointIndex !== null ? routePoint.pointIndex > pausePointIndex : routePoint.arrivalProgress > progress)) break;
      routePixels.push(routePoint.pixel);
    }
    const segmentStart = segment.points[0]?.pointIndex ?? -1;
    const segmentEnd = segment.points.at(-1)?.pointIndex ?? -1;
    if (revealRoute && pausePointIndex === null && routePixels.length > 0 && position.fromIndex !== position.toIndex
      && position.fromIndex >= segmentStart && position.toIndex <= segmentEnd
      && segment.points.some((routePoint) => routePoint.pointIndex === position.toIndex && routePoint.arrivalProgress > progress)) {
      routePixels.push({ x, y });
    }
    scene.routeSegments.push({ color: segment.color, pixels: routePixels });
  }

  for (const annotation of annotations) {
    if (pausePointIndex !== null ? annotation.pointIndex <= pausePointIndex : progress >= annotation.arrivalProgress) scene.annotations.push(annotation);
  }

  if (routeMarkerMode === 'day') {
    for (const dayMarker of dayMarkers) {
      if (pausePointIndex !== null ? dayMarker.pointIndex <= pausePointIndex : progress >= dayMarker.arrivalProgress) scene.dayMarkers.push(dayMarker);
    }
  } else if (routeMarkerMode === 'start-goal') {
    if (isInVideoViewport(pixels[0])) scene.endpointMarkers.push({ pixel: pixels[0], label: 'START', placement: endpointMarkerPlacements.START });
    const goalPixel = pixels.at(-1);
    if (progress >= 1 && goalPixel && isInVideoViewport(goalPixel)) scene.endpointMarkers.push({ pixel: goalPixel, label: 'GOAL', placement: endpointMarkerPlacements.GOAL });
  }

  for (const endpoint of scene.endpointMarkers) {
    const position = endpointMarkerFramePositions[endpoint.label];
    if (position) endpoint.framePosition = position;
  }
  if (distanceHud?.settings.enabled) scene.distanceHud = { progress: routeDistanceProgress(distanceHud.model, progress, pausePointIndex ?? undefined), options: distanceHud };
  return scene;
}

interface VideoAnnotation {
  pointId?: string;
  framePosition?: BalloonFramePosition;
  placement?: PopupPlacement;
  label: string;
  pixel: { x: number; y: number };
  arrivalProgress: number;
}

interface VideoRoutePoint {
  pixel: { x: number; y: number };
  pointIndex: number;
  arrivalProgress: number;
}

interface VideoRouteSegment {
  color: string;
  points: VideoRoutePoint[];
}

export function prepareFollowFrameScene(
  background: CanvasImageSource,
  map: Pick<maplibregl.Map, 'project'>,
  points: RoutePoint[],
  playback: FollowPlaybackState,
  dayMarkers: FollowVideoDayMarker[],
  routeMarkerMode: RouteMarkerMode,
  annotationStyle: AnnotationStyle,
  endpointMarkerPlacements: EndpointMarkerPlacements,
  revealRoute = true,
  distanceHud?: DistanceHudOptions,
  dayNumberByPointId: ReadonlyMap<string, number> = new Map(),
  dayRouteColorsEnabled = false,
  clockDisplay: FrameClockDisplay | null = null,
  endpointMarkerFramePositions: EndpointMarkerFramePositions = {},
) {
  const routeSegments = colorRouteSegments(
    revealRoute ? revealedTripRouteSegments(points, playback.routeProgress) : splitRouteByDay(points),
    dayNumberByPointId,
    dayRouteColorsEnabled,
  );
  const projectedSegments = routeSegments.map((segment) => ({
    color: segment.color,
    pixels: segment.points.map((point) => map.project([point.longitude, point.latitude])),
  }));
  const markerPixel = map.project([playback.markerPosition.longitude, playback.markerPosition.latitude]);
  const scene: VideoFrameScene = {
    background, routeSegments: projectedSegments, markerPosition: markerPixel, clockDisplay,
    annotations: [], annotationStyle, dayMarkers: [], dayRouteColorsEnabled, endpointMarkers: [],
  };

  for (let index = 0; index <= playback.reachedPointIndex; index += 1) {
    const point = points[index];
    if (!point.annotation?.label) continue;
    const pixel = map.project([point.longitude, point.latitude]);
    if (!isInVideoViewport(pixel)) continue;
    scene.annotations.push({ ...point.annotation, pointId: point.id, pixel });
  }

  if (routeMarkerMode === 'day') {
    for (const dayMarker of dayMarkers) {
      if (dayMarker.pointIndex > playback.reachedPointIndex) continue;
      const point = points[dayMarker.pointIndex];
      const pixel = map.project([point.longitude, point.latitude]);
      if (!isInVideoViewport(pixel)) continue;
      scene.dayMarkers.push({ ...dayMarker, pixel, arrivalProgress: 0 });
    }
  } else if (routeMarkerMode === 'start-goal') {
    const startPixel = map.project([points[0].longitude, points[0].latitude]);
    if (isInVideoViewport(startPixel)) scene.endpointMarkers.push({ pixel: startPixel, label: 'START', placement: endpointMarkerPlacements.START });
    if (playback.reachedPointIndex >= points.length - 1) {
      const goal = points.at(-1)!;
      const goalPixel = map.project([goal.longitude, goal.latitude]);
      if (isInVideoViewport(goalPixel)) scene.endpointMarkers.push({ pixel: goalPixel, label: 'GOAL', placement: endpointMarkerPlacements.GOAL });
    }
  }

  for (const endpoint of scene.endpointMarkers) {
    const position = endpointMarkerFramePositions[endpoint.label];
    if (position) endpoint.framePosition = position;
  }
  if (distanceHud?.settings.enabled) scene.distanceHud = { progress: routeDistanceProgress(distanceHud.model, playback.routeProgress, playback.reachedPointIndex), options: distanceHud };
  return scene;
}

interface FollowVideoDayMarker extends DayMarker {
  pointIndex: number;
}
