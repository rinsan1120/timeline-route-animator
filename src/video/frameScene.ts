import type * as maplibregl from 'maplibre-gl';
import type { BalloonFramePosition, PopupPlacement, EndpointMarkerPlacements } from '../popup/placement';
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
import type { FramePlanOptions, FrameState } from './frameTimeline';
import { isInVideoViewport, type VideoDayMarker } from './frameDrawing';
import type { VideoFrameScene } from './frameRenderer';
import { sampleRecordedRouteTime, followClockPointIndex } from './routeClock';

export interface FrameDrawingOptions extends FramePlanOptions {
  revealRoute: boolean;
  recordedTimeClockEnabled?: boolean;
  distanceHud?: DistanceHudOptions;
  endpointMarkerPlacements?: EndpointMarkerPlacements;
  annotationStyle?: AnnotationStyle;
  dayNumberByPointId?: ReadonlyMap<string, number>;
  dayRouteColorsEnabled?: boolean;
}

export function frameClockText(options: FrameDrawingOptions, state: FrameState): string | null {
  if (!options.recordedTimeClockEnabled) return null;
  const pointIndex = state.cameraMode === 'follow'
    ? followClockPointIndex(state.playback, state.pausePointIndex)
    : state.renderPath === 'intro-zoom' ? 0 : state.pausePointIndex;
  return sampleRecordedRouteTime(options.points, state.routeProgress, pointIndex);
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

export function prepareOverviewFrameData(options: FrameDrawingOptions, map: maplibregl.Map, pointIndexById: ReadonlyMap<string, number>, dayNumberByPointId: ReadonlyMap<string, number>) {
  const pixels = options.points.map((point) => map.project([point.longitude, point.latitude]));
  const arrivals = tripRoutePointProgresses(options.points);
  const annotations = options.points.flatMap((point, index) => point.annotation?.label
    ? [{ ...point.annotation, pixel: pixels[index], pointIndex: index, arrivalProgress: arrivals[index] }] : []);
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
  clockText: string | null = null,
) {
  const position = interpolateTripRoute(points, progress)!;
  const markerStart = pixels[pausePointIndex ?? position.fromIndex];
  const markerEnd = pixels[pausePointIndex ?? position.toIndex];
  const x = markerStart.x + (markerEnd.x - markerStart.x) * position.segmentProgress;
  const y = markerStart.y + (markerEnd.y - markerStart.y) * position.segmentProgress;
  const scene: VideoFrameScene = {
    background, routeSegments: [], markerPosition: { x, y }, clockText,
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

  if (distanceHud?.settings.enabled) scene.distanceHud = { progress: routeDistanceProgress(distanceHud.model, progress, pausePointIndex ?? undefined), options: distanceHud };
  return scene;
}

interface VideoAnnotation {
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
  map: maplibregl.Map,
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
  clockText: string | null = null,
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
    background, routeSegments: projectedSegments, markerPosition: markerPixel, clockText,
    annotations: [], annotationStyle, dayMarkers: [], dayRouteColorsEnabled, endpointMarkers: [],
  };

  for (let index = 0; index <= playback.reachedPointIndex; index += 1) {
    const point = points[index];
    if (!point.annotation?.label) continue;
    const pixel = map.project([point.longitude, point.latitude]);
    if (!isInVideoViewport(pixel)) continue;
    scene.annotations.push({ ...point.annotation, pixel });
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

  if (distanceHud?.settings.enabled) scene.distanceHud = { progress: routeDistanceProgress(distanceHud.model, playback.routeProgress, playback.reachedPointIndex), options: distanceHud };
  return scene;
}

interface FollowVideoDayMarker extends DayMarker {
  pointIndex: number;
}
