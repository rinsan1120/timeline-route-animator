import { sampleRecordedRouteTime, followClockPointIndex } from './routeClock';
import { balloonReferenceCamera, resolveBalloonFramePositions } from '../route/balloonFrame';
import { createBalloonReferenceProjector } from '../map/balloonProjection';
import type { BalloonFramePosition } from '../popup/placement';
import type { PopupPlacement, EndpointMarkerPlacements } from '../popup/placement';
import * as maplibregl from 'maplibre-gl';
import { BufferTarget, CanvasSource, Mp4OutputFormat, Output, Quality, getFirstEncodableVideoCodec } from 'mediabunny';
import type { RoutePoint } from '../timeline/types';
import { DEFAULT_ANNOTATION_STYLE, type AnnotationStyle } from '../route/annotationStyle';
import type { RouteMarkerMode } from '../route/routeMarker';
import { interpolateTripRoute, revealedTripRouteSegments, splitRouteByDay, tripRoutePointProgresses, type DayMarker } from '../route/tripRoute';
import { createVideoMapSession } from './videoMapSession';
import type { FollowCameraPlan, FollowPlaybackState, FollowZoomPreset, FollowViewMode, VideoCameraMode } from './followCamera';
import { createOverviewCamera, VIDEO_FPS, VIDEO_VIEWPORT, type VideoCamera } from './overviewCamera';
import { routeDistanceProgress } from '../route/routeDistanceProgress';
import type { DistanceHudOptions } from './distanceHud';
import { buildFramePlan, sampleFrame } from './frameTimeline';
import { isInVideoViewport, type VideoDayMarker } from './frameDrawing';
import { drawVideoFrame, type VideoFrameScene } from './frameRenderer';
export { outputVideoDuration, outputVideoFrameCount } from './outputTiming';
import { buildRoutePointDayNumbers, colorRouteSegments } from '../route/dayRouteColor';

const WIDTH = VIDEO_VIEWPORT.width;
const HEIGHT = VIDEO_VIEWPORT.height;
export { VIDEO_FPS } from './overviewCamera';

export interface VideoProgress { current: number; total: number; percent: number }
export interface RenderVideoOptions {
  recordedTimeClockEnabled?: boolean;
  distanceHud?: DistanceHudOptions;
  endpointMarkerPlacements?: EndpointMarkerPlacements;
  points: RoutePoint[];
  dayMarkers?: DayMarker[];
  dayNumberByPointId?: ReadonlyMap<string, number>;
  dayRouteColorsEnabled?: boolean;
  routeMarkerMode?: RouteMarkerMode;
  cameraMode?: VideoCameraMode;
  followZoomPreset?: FollowZoomPreset;
  followCustomZoom?: number;
  followViewMode?: FollowViewMode;
  overviewZoomMode?: 'auto' | 'custom';
  overviewCustomZoom?: number;
  overviewCamera?: VideoCamera;
  followCameraPlan?: FollowCameraPlan;
  introZoomEnabled?: boolean;
  duration: number;
  commonPauseSeconds?: number;
  preRollSeconds?: number;
  postRollSeconds?: number;
  revealRoute: boolean;
  annotationStyle?: AnnotationStyle;
  onProgress: (progress: VideoProgress) => void;
  signal?: AbortSignal;
}

export async function checkVideoSupport(): Promise<string | null> {
  if (!('VideoEncoder' in window)) return 'このブラウザはWebCodecs VideoEncoderに対応していません。Android版Chromeの最新版をお試しください。';
  const format = new Mp4OutputFormat();
  const codec = await getFirstEncodableVideoCodec(format.getSupportedVideoCodecs().filter((item) => item === 'avc'), { width: WIDTH, height: HEIGHT });
  return codec === 'avc' ? null : 'この端末では1920×1080のH.264エンコードを利用できません。端末またはChromeを更新してください。';
}

function resolveVideoBalloons(options: RenderVideoOptions, map: maplibregl.Map, context: CanvasRenderingContext2D, overview: VideoCamera, follow: FollowCameraPlan | null): RenderVideoOptions {
  if (!options.points.some((point) => point.annotation?.label && !point.annotation.framePosition)) return options;
  const project = createBalloonReferenceProjector(map);
  const points = resolveBalloonFramePositions(context, options.points, options.annotationStyle ?? DEFAULT_ANNOTATION_STYLE,
    (point) => project(point, balloonReferenceCamera(point.id, overview, follow)));
  return { ...options, points };
}

export async function renderRouteVideo(options: RenderVideoOptions): Promise<Blob> {
  if (options.cameraMode === 'follow') return renderFollowRouteVideo(options);
  if (!Number.isInteger(options.duration) || options.duration < 5 || options.duration > 120) throw new Error('移動時間は5〜120秒の整数で指定してください。');
  if (options.points.length < 2) throw new Error('動画生成には2点以上のルートが必要です。');
  const supportError = await checkVideoSupport();
  if (supportError) throw new Error(supportError);
  const routeMarkerMode = options.routeMarkerMode ?? 'day';
  const customZoom = options.overviewZoomMode === 'custom' ? options.overviewCustomZoom ?? 10 : undefined;
  if (customZoom !== undefined && (!Number.isFinite(customZoom) || customZoom < 4 || customZoom > 16)) throw new Error('Zoomは4.0〜16.0で指定してください。');
  const camera = options.overviewCamera ?? createOverviewCamera(options.points, customZoom)!;

  const mapContainer = document.createElement('div');
  Object.assign(mapContainer.style, { position: 'fixed', left: '-20000px', top: '0', width: `${WIDTH}px`, height: `${HEIGHT}px`, pointerEvents: 'none' });
  document.body.appendChild(mapContainer);
  const videoMap = createVideoMapSession(mapContainer, options.signal);
  let background: ImageBitmap | null = null;
  let unfinishedOutput: Output | null = null;
  try {
    let map = await videoMap.prepare(camera);

    const canvas = document.createElement('canvas');
    canvas.width = WIDTH;
    canvas.height = HEIGHT;
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) throw new Error('動画用Canvasを作成できませんでした。');
    options = resolveVideoBalloons(options, map, context, camera, null);
    const pointIndexById = new Map(options.points.map((point, index) => [point.id, index]));
    const dynamicDayMarkers = (options.dayMarkers ?? []).flatMap((marker) => {
      const pointIndex = pointIndexById.get(marker.pointId);
      return pointIndex === undefined ? [] : [{ ...marker, pointIndex }];
    });
    const dayNumberByPointId = options.dayNumberByPointId ?? buildRoutePointDayNumbers(options.points, options.dayMarkers ?? []);
    const target = new BufferTarget();
    const output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target });
    unfinishedOutput = output;
    const source = new CanvasSource(canvas, { codec: 'avc', quality: new Quality({ bitrate: 8_000_000 }), keyFrameInterval: VIDEO_FPS * 2 });
    output.addVideoTrack(source, { frameRate: VIDEO_FPS });
    await output.start();
    const framePlan = buildFramePlan({ ...options, cameraMode: 'overview', overviewCamera: camera });
    const { preFrames, totalFrames: total } = framePlan;
    if (options.introZoomEnabled && preFrames > 0) {
      for (let frame = 0; frame < preFrames; frame += 1) {
        if (options.signal?.aborted) throw new DOMException('動画生成をキャンセルしました。', 'AbortError');
        const state = sampleFrame(framePlan, frame);
        if (state.renderPath !== 'intro-zoom') throw new RangeError('開始時ズームのフレームではありません。');
        map = await videoMap.prepare(state.camera);
        drawFollowFrame(context, map.getCanvas(), map, options.points, state.playback, dynamicDayMarkers, routeMarkerMode, options.annotationStyle ?? DEFAULT_ANNOTATION_STYLE, options.endpointMarkerPlacements ?? {}, options.revealRoute, options.distanceHud, dayNumberByPointId, options.dayRouteColorsEnabled ?? false, options.recordedTimeClockEnabled ? sampleRecordedRouteTime(options.points, 0, 0) : null);
        await source.add(frame / VIDEO_FPS, 1 / VIDEO_FPS, { keyFrame: frame % (VIDEO_FPS * 2) === 0 });
        options.onProgress({ current: frame + 1, total, percent: Math.round((frame + 1) / total * 100) });
        if (frame % 5 === 0) await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      }
    }
    map = await videoMap.prepare(camera, !!options.introZoomEnabled && preFrames > 0);
    context.drawImage(map.getCanvas(), 0, 0, WIDTH, HEIGHT);
    background = await createImageBitmap(canvas);
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
    // Encoding uses only the captured bitmap and projected route from this point on.
    videoMap.dispose();
    for (let frame = options.introZoomEnabled ? preFrames : 0; frame < total; frame += 1) {
      if (options.signal?.aborted) throw new DOMException('動画生成をキャンセルしました。', 'AbortError');
      const state = sampleFrame(framePlan, frame);
      drawFrame(context, background, pixels, routeSegments, options.points, state.routeProgress, options.revealRoute, annotations, dayMarkers, routeMarkerMode, options.annotationStyle ?? DEFAULT_ANNOTATION_STYLE, options.endpointMarkerPlacements ?? {}, options.distanceHud, options.dayRouteColorsEnabled ?? false, state.pausePointIndex, options.recordedTimeClockEnabled ? sampleRecordedRouteTime(options.points, state.routeProgress, state.pausePointIndex) : null);
      await source.add(frame / VIDEO_FPS, 1 / VIDEO_FPS, { keyFrame: frame % (VIDEO_FPS * 2) === 0 });
      options.onProgress({ current: frame + 1, total, percent: Math.round((frame + 1) / total * 100) });
      if (frame % 5 === 0) await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    }
    source.close();
    await output.finalize();
    unfinishedOutput = null;
    if (!target.buffer) throw new Error('MP4データを作成できませんでした。');
    return new Blob([target.buffer], { type: 'video/mp4' });
  } finally {
    background?.close();
    videoMap.dispose();
    mapContainer.remove();
    // Keep the original failure if encoder cancellation also fails.
    await unfinishedOutput?.cancel().catch(() => {});
  }
}

function drawFrame(
  context: CanvasRenderingContext2D,
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
  drawVideoFrame(context, scene);
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

async function renderFollowRouteVideo(options: RenderVideoOptions): Promise<Blob> {
  if (!Number.isInteger(options.duration) || options.duration < 5 || options.duration > 120) throw new Error('移動時間は5〜120秒の整数で指定してください。');
  if (options.points.length < 2) throw new Error('動画生成には2点以上のルートが必要です。');
  const supportError = await checkVideoSupport();
  if (supportError) throw new Error(supportError);
  const routeMarkerMode = options.routeMarkerMode ?? 'day';
  const framePlan = buildFramePlan({ ...options, cameraMode: 'follow' });
  const plan = framePlan.followCameraPlan;
  const initialPlayback = framePlan.initialPlayback;
  const mapContainer = document.createElement('div');
  Object.assign(mapContainer.style, { position: 'fixed', left: '-20000px', top: '0', width: `${WIDTH}px`, height: `${HEIGHT}px`, pointerEvents: 'none' });
  document.body.appendChild(mapContainer);
  const videoMap = createVideoMapSession(mapContainer, options.signal);
  let background: ImageBitmap | null = null;
  let unfinishedOutput: Output | null = null;
  try {
    let map = await videoMap.prepare({ ...initialPlayback.cameraCenter, zoom: initialPlayback.zoom, bearing: initialPlayback.bearing, pitch: initialPlayback.pitch });
    const canvas = document.createElement('canvas');
    canvas.width = WIDTH;
    canvas.height = HEIGHT;
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) throw new Error('動画用Canvasを作成できませんでした。');
    options = resolveVideoBalloons(options, map, context, createOverviewCamera(options.points)!, plan);
    const pointIndexById = new Map(options.points.map((point, index) => [point.id, index]));
    const dayMarkers = (options.dayMarkers ?? []).flatMap((marker) => {
      const pointIndex = pointIndexById.get(marker.pointId);
      return pointIndex === undefined ? [] : [{ ...marker, pointIndex }];
    });
    const dayNumberByPointId = options.dayNumberByPointId ?? buildRoutePointDayNumbers(options.points, options.dayMarkers ?? []);
    const target = new BufferTarget();
    const output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target });
    unfinishedOutput = output;
    const source = new CanvasSource(canvas, { codec: 'avc', quality: new Quality({ bitrate: 8_000_000 }), keyFrameInterval: VIDEO_FPS * 2 });
    output.addVideoTrack(source, { frameRate: VIDEO_FPS });
    await output.start();
    const { preFrames, totalFrames: total } = framePlan;
    let backgroundKey = '';
    for (let frame = 0; frame < total; frame += 1) {
      if (options.signal?.aborted) throw new DOMException('動画生成をキャンセルしました。', 'AbortError');
      const state = sampleFrame(framePlan, frame);
      const playback = state.playback;
      const nextBackgroundKey = `${playback.cameraCenter.longitude.toFixed(9)}:${playback.cameraCenter.latitude.toFixed(9)}:${playback.zoom}:${playback.bearing}:${playback.pitch}`;
      const introFrame = state.introZoomProgress !== null;
      const lastIntroFrame = introFrame && frame === preFrames - 1;
      if (!background || nextBackgroundKey !== backgroundKey || lastIntroFrame || videoMap.hasError()) {
        map = await videoMap.prepare({ ...playback.cameraCenter, zoom: playback.zoom, bearing: playback.bearing, pitch: playback.pitch });
        context.drawImage(map.getCanvas(), 0, 0, WIDTH, HEIGHT);
        const nextBackground = await createImageBitmap(canvas);
        background?.close();
        background = nextBackground;
        backgroundKey = nextBackgroundKey;
      }
      drawFollowFrame(context, background, map, options.points, playback, dayMarkers, routeMarkerMode, options.annotationStyle ?? DEFAULT_ANNOTATION_STYLE, options.endpointMarkerPlacements ?? {}, true, options.distanceHud, dayNumberByPointId, options.dayRouteColorsEnabled ?? false, options.recordedTimeClockEnabled ? sampleRecordedRouteTime(options.points, playback.routeProgress, followClockPointIndex(playback, state.pausePointIndex)) : null);
      await source.add(frame / VIDEO_FPS, 1 / VIDEO_FPS, { keyFrame: frame % (VIDEO_FPS * 2) === 0 });
      options.onProgress({ current: frame + 1, total, percent: Math.round((frame + 1) / total * 100) });
      if (frame % 5 === 0) await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    }
    source.close();
    await output.finalize();
    unfinishedOutput = null;
    if (!target.buffer) throw new Error('MP4データを作成できませんでした。');
    return new Blob([target.buffer], { type: 'video/mp4' });
  } finally {
    background?.close();
    videoMap.dispose();
    mapContainer.remove();
    await unfinishedOutput?.cancel().catch(() => {});
  }
}

function drawFollowFrame(
  context: CanvasRenderingContext2D,
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
  drawVideoFrame(context, scene);
}

interface FollowVideoDayMarker extends DayMarker {
  pointIndex: number;
}
