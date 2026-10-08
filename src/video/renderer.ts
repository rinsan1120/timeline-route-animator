import { sampleRecordedRouteTime, drawRouteClock, followClockPointIndex } from './routeClock';
import { drawAnnotation } from '../route/annotationCanvas';
import { nearestPointOnRect, placedPopupRect, type PopupPlacement, type EndpointMarkerPlacements } from '../popup/placement';
import * as maplibregl from 'maplibre-gl';
import { BufferTarget, CanvasSource, Mp4OutputFormat, Output, Quality, getFirstEncodableVideoCodec } from 'mediabunny';
import type { RoutePoint } from '../timeline/types';
import { DEFAULT_ANNOTATION_STYLE, type AnnotationStyle } from '../route/annotationStyle';
import type { RouteMarkerMode } from '../route/routeMarker';
import { DAY_MARKER_FONT_FAMILY, dayMarkerColors, dayMarkerConnector, dayMarkerLayout } from '../route/dayMarkerStyle';
import { interpolateTripRoute, revealedTripRouteSegments, splitRouteByDay, tripRoutePointProgresses, type DayMarker } from '../route/tripRoute';
import { GSI_ATTRIBUTION, GSI_STYLE } from '../map/gsiStyle';
import { installTerrainTintFallback, isTerrainTintError } from '../map/gsiTerrainTint';
import { waitForExportViewportReady } from '../map/exportViewportReady';
import { buildFollowCameraPlan, buildFollowPlaybackTimeline, sampleFollowOutputPlayback, sampleFollowPlayback, type FollowCameraPlan, type FollowPlaybackState, type FollowZoomPreset, type FollowViewMode, type VideoCameraMode } from './followCamera';
import { getIntroStartZoom, interpolateIntroZoom } from './introZoom';
import { createOverviewCamera, VIDEO_FPS, VIDEO_MIN_ZOOM, VIDEO_VIEWPORT, type VideoCamera } from './overviewCamera';
import { routeDistanceProgress } from '../route/routeDistanceProgress';
import { drawDistanceHud, type DistanceHudOptions } from './distanceHud';
import { buildOverviewPlaybackTimeline, normalizePauseSeconds, samplePlaybackTimeline } from './playbackTimeline';
import { DEFAULT_PRE_ROLL_SECONDS, DEFAULT_POST_ROLL_SECONDS, introZoomFrameProgress, outputVideoFrameCount } from './outputTiming';
export { outputVideoDuration, outputVideoFrameCount } from './outputTiming';
import { buildRoutePointDayNumbers, colorRouteSegments } from '../route/dayRouteColor';

import { balloonPauseSeconds } from './balloonPauses';

const WIDTH = VIDEO_VIEWPORT.width;
const HEIGHT = VIDEO_VIEWPORT.height;
const styleReadyMaps = new WeakSet<maplibregl.Map>();
export { VIDEO_FPS } from './overviewCamera';
const VIDEO_MAP_TIMEOUT = 20_000;
const VIDEO_MAP_ERROR = '動画用の地図データを完全に読み込めませんでした。通信状況を確認して、もう一度MP4を生成してください。';

// Only map preparation is retried; successful maps and captured backgrounds are reused.
function createVideoMapSession(container: HTMLElement, signal?: AbortSignal) {
  let map: maplibregl.Map | null = null;
  let loadError: Error | null = null;
  const onError = (event: maplibregl.ErrorEvent) => {
    if (!isTerrainTintError(event)) loadError = new Error(VIDEO_MAP_ERROR);
  };
  const dispose = () => {
    if (map) {
      map.off('error', onError);
      map.remove();
      map = null;
    }
    loadError = null;
  };
  const prepare = async (camera: VideoCamera, move = true): Promise<maplibregl.Map> => {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      if (signal?.aborted) throw new DOMException('動画生成をキャンセルしました。', 'AbortError');
      try {
        const created = !map;
        if (!map) {
          map = new maplibregl.Map({
            container, style: GSI_STYLE, center: [camera.longitude, camera.latitude],
            zoom: camera.zoom, bearing: camera.bearing, pitch: camera.pitch,
            interactive: false, attributionControl: false, pixelRatio: 1,
            canvasContextAttributes: { preserveDrawingBuffer: true },
          });
          installTerrainTintFallback(map);
          map.on('error', onError);
        }
        await waitForStyle(map, VIDEO_MAP_TIMEOUT, () => loadError, signal);
        if (created || move) map.jumpTo({ center: [camera.longitude, camera.latitude], zoom: camera.zoom, bearing: camera.bearing, pitch: camera.pitch });
        await waitForExportViewportReady(map, VIDEO_MAP_TIMEOUT, () => loadError, VIDEO_MAP_ERROR, signal);
        return map;
      } catch (error) {
        dispose();
        if (signal?.aborted || (error instanceof DOMException && error.name === 'AbortError')) throw error;
        if (attempt === 1) throw new Error(VIDEO_MAP_ERROR, { cause: error });
      }
    }
    throw new Error(VIDEO_MAP_ERROR);
  };
  return { prepare, dispose, hasError: () => loadError !== null };
}

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
    const preRollSeconds = normalizePauseSeconds(options.preRollSeconds ?? DEFAULT_PRE_ROLL_SECONDS);
    const postRollSeconds = normalizePauseSeconds(options.postRollSeconds ?? DEFAULT_POST_ROLL_SECONDS);
    const preFrames = Math.round(preRollSeconds * VIDEO_FPS);
    const playbackTimeline = buildOverviewPlaybackTimeline(options.points, options.duration, balloonPauseSeconds(options.points, options.dayMarkers ?? [], routeMarkerMode, options.commonPauseSeconds ?? 0));
    const animationFrames = Math.round(playbackTimeline.outputDurationSeconds * VIDEO_FPS);
    const total = outputVideoFrameCount(options.duration, playbackTimeline.totalPauseSeconds, preRollSeconds, postRollSeconds);
    if (options.introZoomEnabled && preFrames > 0) {
      const targetCenter = { lng: camera.longitude, lat: camera.latitude };
      const targetZoom = camera.zoom;
      const startZoom = getIntroStartZoom(targetZoom, VIDEO_MIN_ZOOM);
      const introPlayback: FollowPlaybackState = {
        phase: 'moving',
        routeProgress: 0,
        markerPosition: { longitude: options.points[0].longitude, latitude: options.points[0].latitude },
        reachedPointIndex: 0,
        cameraCenter: { longitude: targetCenter.lng, latitude: targetCenter.lat },
        zoom: startZoom,
        bearing: 0,
        pitch: 0,
      };
      for (let frame = 0; frame < preFrames; frame += 1) {
        if (options.signal?.aborted) throw new DOMException('動画生成をキャンセルしました。', 'AbortError');
        const introProgress = introZoomFrameProgress(frame, preFrames);
        const zoom = interpolateIntroZoom(startZoom, targetZoom, introProgress);
        map = await videoMap.prepare({ longitude: targetCenter.lng, latitude: targetCenter.lat, zoom, bearing: 0, pitch: 0 });
        drawFollowFrame(context, map.getCanvas(), map, options.points, { ...introPlayback, zoom }, dynamicDayMarkers, routeMarkerMode, options.annotationStyle ?? DEFAULT_ANNOTATION_STYLE, options.endpointMarkerPlacements ?? {}, options.revealRoute, options.distanceHud, dayNumberByPointId, options.dayRouteColorsEnabled ?? false, options.recordedTimeClockEnabled ? sampleRecordedRouteTime(options.points, 0, 0) : null);
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
      ? [{ label: point.annotation.label, placement: point.annotation.placement, pixel: pixels[index], pointIndex: index, arrivalProgress: arrivals[index] }] : []);
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
      const animationFrame = frame - preFrames;
      const outputElapsedSeconds = frame < preFrames
        ? 0
        : animationFrame >= animationFrames
          ? playbackTimeline.outputDurationSeconds
          : animationFrame / (animationFrames - 1) * playbackTimeline.outputDurationSeconds;
      const sample = samplePlaybackTimeline(playbackTimeline, outputElapsedSeconds);
      const progress = sample.baseElapsedSeconds / options.duration;
      drawFrame(context, background, pixels, routeSegments, options.points, progress, options.revealRoute, annotations, dayMarkers, routeMarkerMode, options.annotationStyle ?? DEFAULT_ANNOTATION_STYLE, options.endpointMarkerPlacements ?? {}, options.distanceHud, options.dayRouteColorsEnabled ?? false, sample.pausePointIndex, options.recordedTimeClockEnabled ? sampleRecordedRouteTime(options.points, progress, sample.pausePointIndex) : null);
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
  context.drawImage(background, 0, 0);
  context.lineCap = 'round';
  context.lineJoin = 'round';
  context.lineWidth = 10;
  context.shadowColor = 'rgba(0,0,0,.22)';
  context.shadowBlur = 8;
  const position = interpolateTripRoute(points, progress)!;
  const markerStart = pixels[pausePointIndex ?? position.fromIndex];
  const markerEnd = pixels[pausePointIndex ?? position.toIndex];
  const x = markerStart.x + (markerEnd.x - markerStart.x) * position.segmentProgress;
  const y = markerStart.y + (markerEnd.y - markerStart.y) * position.segmentProgress;
  for (const segment of routeSegments) {
    context.beginPath();
    let started = false;
    for (const routePoint of segment.points) {
      if (revealRoute && (pausePointIndex !== null ? routePoint.pointIndex > pausePointIndex : routePoint.arrivalProgress > progress)) break;
      if (started) context.lineTo(routePoint.pixel.x, routePoint.pixel.y);
      else context.moveTo(routePoint.pixel.x, routePoint.pixel.y);
      started = true;
    }
    const segmentStart = segment.points[0]?.pointIndex ?? -1;
    const segmentEnd = segment.points.at(-1)?.pointIndex ?? -1;
    if (revealRoute && pausePointIndex === null && started && position.fromIndex !== position.toIndex
      && position.fromIndex >= segmentStart && position.toIndex <= segmentEnd
      && segment.points.some((routePoint) => routePoint.pointIndex === position.toIndex && routePoint.arrivalProgress > progress)) {
      context.lineTo(x, y);
    }
    context.strokeStyle = segment.color;
    context.stroke();
  }
  context.shadowBlur = 0;

  context.beginPath();
  context.arc(x, y, 22, 0, Math.PI * 2);
  context.fillStyle = '#ffda57';
  context.fill();
  context.lineWidth = 8;
  context.strokeStyle = '#07111f';
  context.stroke();

  drawRouteClock(context, clockText, x, y);

  for (const annotation of annotations) {
    if (pausePointIndex !== null ? annotation.pointIndex <= pausePointIndex : progress >= annotation.arrivalProgress) drawAnnotation(context, annotation, annotationStyle);
  }

  if (routeMarkerMode === 'day') {
    for (const dayMarker of dayMarkers) {
      if (pausePointIndex !== null ? dayMarker.pointIndex <= pausePointIndex : progress >= dayMarker.arrivalProgress) drawDayMarker(context, dayMarker, dayRouteColorsEnabled);
    }
  } else if (routeMarkerMode === 'start-goal') {
    if (isInVideoViewport(pixels[0])) drawEndpointMarker(context, pixels[0], 'START', endpointMarkerPlacements.START);
    const goalPixel = pixels.at(-1);
    if (progress >= 1 && goalPixel && isInVideoViewport(goalPixel)) drawEndpointMarker(context, goalPixel, 'GOAL', endpointMarkerPlacements.GOAL);
  }

  if (distanceHud?.settings.enabled) drawDistanceHud(context, routeDistanceProgress(distanceHud.model, progress, pausePointIndex ?? undefined), distanceHud);
  context.fillStyle = 'rgba(255,255,255,.9)';
  context.fillRect(24, HEIGHT - 50, 520, 34);
  context.fillStyle = '#27364a';
  context.font = '22px system-ui, sans-serif';
  context.fillText(GSI_ATTRIBUTION, 34, HEIGHT - 25);
}

interface VideoAnnotation {
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

interface VideoDayMarker extends DayMarker {
  pixel: { x: number; y: number };
  arrivalProgress: number;
}


function drawDayMarker(context: CanvasRenderingContext2D, marker: VideoDayMarker, dayRouteColorsEnabled: boolean) {
  context.save();
  const { width, height, style, rows } = dayMarkerLayout(marker, context);
  const colors = dayMarkerColors(marker.dayNumber, dayRouteColorsEnabled);
  const margin = style.margin;
  const bottom = HEIGHT - style.bottomMargin;
  const gap = style.anchorGap;
  let left = Math.max(margin, Math.min(WIDTH - margin - width, marker.pixel.x - width / 2));
  const below = marker.pixel.y - height - gap < margin;
  let top = Math.max(margin, Math.min(bottom - height, below ? marker.pixel.y + gap : marker.pixel.y - height - gap));
  if (marker.placement) {
    ({ left, top } = placedPopupRect(marker.pixel, marker.placement, width, height, WIDTH, bottom, margin));
  }
  const connector = dayMarkerConnector({ left, top, width, height }, marker.pixel, Boolean(marker.placement), below, style);
  context.strokeStyle = colors.outline;
  context.lineWidth = connector.width;
  context.lineCap = 'butt';
  context.beginPath();
  context.moveTo(connector.start.x, connector.start.y);
  context.lineTo(connector.end.x, connector.end.y);
  context.stroke();
  context.beginPath();
  context.arc(connector.dot.x, connector.dot.y, connector.radius, 0, Math.PI * 2);
  context.fillStyle = colors.anchor;
  context.fill();
  context.lineWidth = style.anchorBorder;
  context.strokeStyle = colors.text;
  context.stroke();

  context.shadowColor = colors.shadow;
  context.shadowBlur = style.shadowBlur;
  context.shadowOffsetY = style.shadowOffsetY;
  context.fillStyle = colors.background;
  context.beginPath();
  context.roundRect(left, top, width, height, style.radius);
  context.fill();
  context.shadowBlur = 0;
  context.shadowOffsetY = 0;
  context.lineWidth = style.border;
  context.strokeStyle = colors.outline;
  // The browser has a uniform rounded border, not a separate thick top accent.
  context.beginPath();
  context.roundRect(left + style.border / 2, top + style.border / 2,
    width - style.border, height - style.border, Math.max(0, style.radius - style.border / 2));
  context.stroke();

  context.textAlign = 'left';
  context.textBaseline = 'middle';
  for (const row of rows) {
    context.fillStyle = row.color;
    context.font = `${row.weight} ${row.fontSize}px ${DAY_MARKER_FONT_FAMILY}`;
    const x = left + (width - row.textWidth) / 2;
    if (!row.spacing) {
      context.fillText(row.text, x, top + row.y);
    } else {
      let prefix = '';
      Array.from(row.text).forEach((character, index) => {
        context.fillText(character, x + context.measureText(prefix).width + index * row.spacing, top + row.y);
        prefix += character;
      });
    }
  }
  context.restore();
}

function drawEndpointMarker(context: CanvasRenderingContext2D, pixel: { x: number; y: number }, label: 'START' | 'GOAL', placement?: PopupPlacement) {
  context.save();
  const margin = 24;
  const bottom = HEIGHT - 70;
  const width = 230;
  const height = 78;
  const gap = 42;
  let left = Math.max(margin, Math.min(WIDTH - margin - width, pixel.x - width / 2));
  const below = pixel.y - height - gap < margin;
  let top = Math.max(margin, Math.min(bottom - height, below ? pixel.y + gap : pixel.y - height - gap));
  if (placement) {
    ({ left, top } = placedPopupRect(pixel, placement, width, height, WIDTH, bottom, margin));
  }
  const anchorX = Math.max(left + 18, Math.min(left + width - 18, pixel.x));

  context.strokeStyle = '#ff8b68';
  context.lineWidth = 5;
  context.beginPath();
  const connectorStart = placement
    ? nearestPointOnRect({ left, top, width, height }, pixel)
    : { x: anchorX, y: below ? top : top + height };
  context.moveTo(connectorStart.x, connectorStart.y);
  context.lineTo(pixel.x, pixel.y);
  context.stroke();
  context.beginPath();
  context.arc(pixel.x, pixel.y, 10, 0, Math.PI * 2);
  context.fillStyle = '#ff5d37';
  context.fill();
  context.lineWidth = 4;
  context.strokeStyle = '#ffffff';
  context.stroke();

  context.shadowColor = 'rgba(7,17,31,.28)';
  context.shadowBlur = 18;
  context.shadowOffsetY = 5;
  context.fillStyle = '#102c4b';
  context.fillRect(left, top, width, height);
  context.shadowBlur = 0;
  context.shadowOffsetY = 0;
  context.lineWidth = 4;
  context.strokeStyle = '#ff8b68';
  context.strokeRect(left, top, width, height);
  context.fillStyle = '#ff8b68';
  context.fillRect(left, top, width, 7);

  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillStyle = '#ffffff';
  context.font = '700 36px system-ui, sans-serif';
  context.fillText(label, left + width / 2, top + height / 2 + 3);
  context.restore();
}

async function renderFollowRouteVideo(options: RenderVideoOptions): Promise<Blob> {
  if (!Number.isInteger(options.duration) || options.duration < 5 || options.duration > 120) throw new Error('移動時間は5〜120秒の整数で指定してください。');
  if (options.points.length < 2) throw new Error('動画生成には2点以上のルートが必要です。');
  const supportError = await checkVideoSupport();
  if (supportError) throw new Error(supportError);
  const routeMarkerMode = options.routeMarkerMode ?? 'day';
  const plan = options.followCameraPlan ?? buildFollowCameraPlan(options.points, options.followZoomPreset ?? 'standard', options.duration, options.followCustomZoom, options.followViewMode);
  const playbackTimeline = buildFollowPlaybackTimeline(plan, balloonPauseSeconds(options.points, options.dayMarkers ?? [], routeMarkerMode, options.commonPauseSeconds ?? 0));
  const initialPlayback = sampleFollowPlayback(plan, 0);
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
    const preRollSeconds = normalizePauseSeconds(options.preRollSeconds ?? DEFAULT_PRE_ROLL_SECONDS);
    const postRollSeconds = normalizePauseSeconds(options.postRollSeconds ?? DEFAULT_POST_ROLL_SECONDS);
    const preFrames = Math.round(preRollSeconds * VIDEO_FPS);
    const animationFrames = Math.round(playbackTimeline.outputDurationSeconds * VIDEO_FPS);
    const total = outputVideoFrameCount(options.duration, playbackTimeline.totalPauseSeconds, preRollSeconds, postRollSeconds);
    let backgroundKey = '';
    for (let frame = 0; frame < total; frame += 1) {
      if (options.signal?.aborted) throw new DOMException('動画生成をキャンセルしました。', 'AbortError');
      const animationFrame = frame - preFrames;
      const outputElapsedSeconds = frame < preFrames
        ? 0
        : animationFrame >= animationFrames
          ? playbackTimeline.outputDurationSeconds
          : animationFrame / (animationFrames - 1) * playbackTimeline.outputDurationSeconds;
      const playback = options.introZoomEnabled && frame < preFrames
        ? {
          ...initialPlayback,
          zoom: interpolateIntroZoom(
            getIntroStartZoom(initialPlayback.zoom, VIDEO_MIN_ZOOM),
            initialPlayback.zoom,
            introZoomFrameProgress(frame, preFrames),
          ),
        }
        : sampleFollowOutputPlayback(plan, playbackTimeline, outputElapsedSeconds);
      const nextBackgroundKey = `${playback.cameraCenter.longitude.toFixed(9)}:${playback.cameraCenter.latitude.toFixed(9)}:${playback.zoom}:${playback.bearing}:${playback.pitch}`;
      const introFrame = options.introZoomEnabled && frame < preFrames;
      const lastIntroFrame = introFrame && frame === preFrames - 1;
      if (!background || nextBackgroundKey !== backgroundKey || lastIntroFrame || videoMap.hasError()) {
        map = await videoMap.prepare({ ...playback.cameraCenter, zoom: playback.zoom, bearing: playback.bearing, pitch: playback.pitch });
        context.drawImage(map.getCanvas(), 0, 0, WIDTH, HEIGHT);
        const nextBackground = await createImageBitmap(canvas);
        background?.close();
        background = nextBackground;
        backgroundKey = nextBackgroundKey;
      }
      drawFollowFrame(context, background, map, options.points, playback, dayMarkers, routeMarkerMode, options.annotationStyle ?? DEFAULT_ANNOTATION_STYLE, options.endpointMarkerPlacements ?? {}, true, options.distanceHud, dayNumberByPointId, options.dayRouteColorsEnabled ?? false, options.recordedTimeClockEnabled ? sampleRecordedRouteTime(options.points, playback.routeProgress, followClockPointIndex(playback, samplePlaybackTimeline(playbackTimeline, outputElapsedSeconds).pausePointIndex)) : null);
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
  context.drawImage(background, 0, 0);
  context.lineCap = 'round';
  context.lineJoin = 'round';
  context.lineWidth = 10;
  context.shadowColor = 'rgba(0,0,0,.22)';
  context.shadowBlur = 8;
  const routeSegments = colorRouteSegments(
    revealRoute ? revealedTripRouteSegments(points, playback.routeProgress) : splitRouteByDay(points),
    dayNumberByPointId,
    dayRouteColorsEnabled,
  );
  for (const segment of routeSegments) {
    context.beginPath();
    segment.points.forEach((point, index) => {
      const pixel = map.project([point.longitude, point.latitude]);
      if (index === 0) context.moveTo(pixel.x, pixel.y);
      else context.lineTo(pixel.x, pixel.y);
    });
    context.strokeStyle = segment.color;
    context.stroke();
  }
  context.shadowBlur = 0;

  const markerPixel = map.project([playback.markerPosition.longitude, playback.markerPosition.latitude]);
  context.beginPath();
  context.arc(markerPixel.x, markerPixel.y, 22, 0, Math.PI * 2);
  context.fillStyle = '#ffda57';
  context.fill();
  context.lineWidth = 8;
  context.strokeStyle = '#07111f';
  context.stroke();

  drawRouteClock(context, clockText, markerPixel.x, markerPixel.y);

  for (let index = 0; index <= playback.reachedPointIndex; index += 1) {
    const point = points[index];
    if (!point.annotation?.label) continue;
    const pixel = map.project([point.longitude, point.latitude]);
    if (!isInVideoViewport(pixel)) continue;
    drawAnnotation(context, { label: point.annotation.label, placement: point.annotation.placement, pixel }, annotationStyle);
  }

  if (routeMarkerMode === 'day') {
    for (const dayMarker of dayMarkers) {
      if (dayMarker.pointIndex > playback.reachedPointIndex) continue;
      const point = points[dayMarker.pointIndex];
      const pixel = map.project([point.longitude, point.latitude]);
      if (!isInVideoViewport(pixel)) continue;
      drawDayMarker(context, { ...dayMarker, pixel, arrivalProgress: 0 }, dayRouteColorsEnabled);
    }
  } else if (routeMarkerMode === 'start-goal') {
    const startPixel = map.project([points[0].longitude, points[0].latitude]);
    if (isInVideoViewport(startPixel)) drawEndpointMarker(context, startPixel, 'START', endpointMarkerPlacements.START);
    if (playback.reachedPointIndex >= points.length - 1) {
      const goal = points.at(-1)!;
      const goalPixel = map.project([goal.longitude, goal.latitude]);
      if (isInVideoViewport(goalPixel)) drawEndpointMarker(context, goalPixel, 'GOAL', endpointMarkerPlacements.GOAL);
    }
  }

  if (distanceHud?.settings.enabled) drawDistanceHud(context, routeDistanceProgress(distanceHud.model, playback.routeProgress, playback.reachedPointIndex), distanceHud);
  context.fillStyle = 'rgba(255,255,255,.9)';
  context.fillRect(24, HEIGHT - 50, 520, 34);
  context.fillStyle = '#27364a';
  context.font = '22px system-ui, sans-serif';
  context.fillText(GSI_ATTRIBUTION, 34, HEIGHT - 25);
}

interface FollowVideoDayMarker extends DayMarker {
  pointIndex: number;
}

function isInVideoViewport(point: { x: number; y: number }): boolean {
  return point.x >= 0 && point.x <= WIDTH && point.y >= 0 && point.y <= HEIGHT;
}

function waitForStyle(map: maplibregl.Map, timeout: number, getLoadError: () => Error | null, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(new DOMException('動画生成をキャンセルしました。', 'AbortError'));
  const error = getLoadError();
  if (error) return Promise.reject(error);
  // isStyleLoaded also reflects tile readiness; style.load itself fires only once.
  if (styleReadyMaps.has(map) || map.isStyleLoaded()) {
    styleReadyMaps.add(map);
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      window.clearTimeout(timer);
      map.off('style.load', onLoad);
      map.off('error', onError);
      signal?.removeEventListener('abort', onAbort);
    };
    const onLoad = () => {
      cleanup();
      styleReadyMaps.add(map);
      resolve();
    };
    const fail = (error: unknown) => { cleanup(); reject(error); };
    const onError = (event: maplibregl.ErrorEvent) => {
      if (!isTerrainTintError(event)) fail(getLoadError() ?? new Error(VIDEO_MAP_ERROR));
    };
    const onAbort = () => fail(new DOMException('動画生成をキャンセルしました。', 'AbortError'));
    const timer = window.setTimeout(() => {
      cleanup();
      reject(new Error('動画用地図を準備できませんでした。'));
    }, timeout);
    map.once('style.load', onLoad);
    map.on('error', onError);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
