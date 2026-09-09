import * as maplibregl from 'maplibre-gl';
import { BufferTarget, CanvasSource, Mp4OutputFormat, Output, Quality, getFirstEncodableVideoCodec } from 'mediabunny';
import type { RoutePoint } from '../timeline/types';
import { DEFAULT_ANNOTATION_STYLE, type AnnotationStyle } from '../route/annotationStyle';
import type { RouteMarkerMode } from '../route/routeMarker';
import { interpolateTripRoute, revealedTripRouteSegments, splitRouteByDay, tripRoutePointProgresses, type DayMarker } from '../route/tripRoute';
import { GSI_ATTRIBUTION, GSI_STYLE, GSI_LOW_ZOOM_LAND_SOURCE_ID } from '../map/gsiStyle';
import { GSI_OFFICIAL_SOURCE_ID } from '../map/gsiOfficialStyle';
import { GSI_VECTOR_CONFIG } from '../map/gsiVectorConfig';
import { buildFollowCameraPlan, sampleFollowPlayback, type FollowCameraPlan, type FollowPlaybackState, type FollowZoomPreset, type VideoCameraMode } from './followCamera';
import { getIntroStartZoom, interpolateIntroZoom, INTRO_ZOOM_DURATION_SECONDS } from './introZoom';

const WIDTH = 1920;
const HEIGHT = 1080;
const styleReadyMaps = new WeakSet<maplibregl.Map>();
export const VIDEO_FPS = 30;
export const PRE_ROLL_SECONDS = INTRO_ZOOM_DURATION_SECONDS;
export const POST_ROLL_SECONDS = 3;
const FALLBACK_STYLE = { version: 8 as const, sources: {}, layers: [{ id: 'background', type: 'background' as const, paint: { 'background-color': '#e7edef' } }] };

export function outputVideoDuration(duration: number): number {
  return PRE_ROLL_SECONDS + duration + POST_ROLL_SECONDS;
}

export function outputVideoFrameCount(duration: number): number {
  return outputVideoDuration(duration) * VIDEO_FPS;
}

export interface VideoProgress { current: number; total: number; percent: number }
export interface RenderVideoOptions {
  points: RoutePoint[];
  dayMarkers?: DayMarker[];
  routeMarkerMode?: RouteMarkerMode;
  cameraMode?: VideoCameraMode;
  followZoomPreset?: FollowZoomPreset;
  followCustomZoom?: number;
  overviewZoomMode?: 'auto' | 'custom';
  overviewCustomZoom?: number;
  followCameraPlan?: FollowCameraPlan;
  introZoomEnabled?: boolean;
  duration: number;
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

  const mapContainer = document.createElement('div');
  Object.assign(mapContainer.style, { position: 'fixed', left: '-20000px', top: '0', width: `${WIDTH}px`, height: `${HEIGHT}px`, pointerEvents: 'none' });
  document.body.appendChild(mapContainer);
  const map = new maplibregl.Map({ container: mapContainer, style: GSI_STYLE, center: [options.points[0].longitude, options.points[0].latitude], zoom: 10, interactive: false, attributionControl: false, pixelRatio: 1, canvasContextAttributes: { preserveDrawingBuffer: true } });
  let mapRemoved = false;
  try {
    await waitForStyle(map, 20_000);
    const bounds = new maplibregl.LngLatBounds();
    options.points.forEach((point) => bounds.extend([point.longitude, point.latitude]));
    map.fitBounds(bounds, { padding: 100, maxZoom: 16, duration: 0 });
    if (options.overviewZoomMode === 'custom') {
      const zoom = options.overviewCustomZoom ?? 10;
      if (!Number.isFinite(zoom) || zoom < 4 || zoom > 16) throw new Error('Zoomは4.0〜16.0で指定してください。');
      map.jumpTo({ center: map.getCenter(), zoom, bearing: 0, pitch: 0 });
    }
    if (isLowZoomMapView(map.getZoom())) {
      await waitForLowZoomVisualReady(map, 20_000);
    } else {
      try {
        await waitForIdle(map, 20_000);
      } catch {
        map.setStyle(FALLBACK_STYLE);
        await waitForStyle(map, 5_000);
      }
    }
    map.triggerRepaint();
    await nextPaint();

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
    const target = new BufferTarget();
    const output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target });
    const source = new CanvasSource(canvas, { codec: 'avc', quality: new Quality({ bitrate: 8_000_000 }), keyFrameInterval: VIDEO_FPS * 2 });
    output.addVideoTrack(source, { frameRate: VIDEO_FPS });
    await output.start();
    const preFrames = PRE_ROLL_SECONDS * VIDEO_FPS;
    const animationFrames = options.duration * VIDEO_FPS;
    const total = outputVideoFrameCount(options.duration);
    if (options.introZoomEnabled) {
      const targetCenter = map.getCenter();
      const targetZoom = map.getZoom();
      const startZoom = getIntroStartZoom(targetZoom, map.getMinZoom());
      map.jumpTo({ center: targetCenter, zoom: startZoom, bearing: 0, pitch: 0 });
      let previousBandKey: string | null = null;
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
        const introProgress = preFrames <= 1 ? 1 : frame / (preFrames - 1);
        const zoom = interpolateIntroZoom(startZoom, targetZoom, introProgress);
        map.jumpTo({ center: targetCenter, zoom, bearing: 0, pitch: 0 });
        const bandKey = introZoomBandKey(zoom);
        if (bandKey !== previousBandKey) {
          await waitForIntroZoomBandReady(map, zoom, 20_000);
          previousBandKey = bandKey;
        } else {
          await waitForRenderedMapFrame(map, 20_000);
        }
        drawFollowFrame(context, map.getCanvas(), map, options.points, { ...introPlayback, zoom }, dynamicDayMarkers, routeMarkerMode, options.annotationStyle ?? DEFAULT_ANNOTATION_STYLE, options.revealRoute);
        await source.add(frame / VIDEO_FPS, 1 / VIDEO_FPS, { keyFrame: frame % (VIDEO_FPS * 2) === 0 });
        options.onProgress({ current: frame + 1, total, percent: Math.round((frame + 1) / total * 100) });
        if (frame % 5 === 0) await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      }
      map.jumpTo({ center: targetCenter, zoom: targetZoom, bearing: 0, pitch: 0 });
      await waitForIntroZoomBandReady(map, targetZoom, 20_000);
    }
    context.drawImage(map.getCanvas(), 0, 0, WIDTH, HEIGHT);
    const background = await createImageBitmap(canvas);
    const pixels = options.points.map((point) => map.project([point.longitude, point.latitude]));
    const arrivals = tripRoutePointProgresses(options.points);
    const annotations = options.points.flatMap((point, index) => point.annotation?.label
      ? [{ label: point.annotation.label, pixel: pixels[index], arrivalProgress: arrivals[index] }] : []);
    const dayMarkers = (options.dayMarkers ?? []).flatMap((marker) => {
      const pointIndex = pointIndexById.get(marker.pointId);
      return pointIndex === undefined ? [] : [{ ...marker, pixel: pixels[pointIndex], arrivalProgress: arrivals[pointIndex] }];
    });
    let pixelIndex = 0;
    const routeSegments = splitRouteByDay(options.points).map((segment) => segment.map(() => {
      const point = { pixel: pixels[pixelIndex], pointIndex: pixelIndex, arrivalProgress: arrivals[pixelIndex] };
      pixelIndex += 1;
      return point;
    }));
    // Encoding uses only the captured bitmap and projected route from this point on.
    map.remove();
    mapRemoved = true;
    for (let frame = options.introZoomEnabled ? preFrames : 0; frame < total; frame += 1) {
      if (options.signal?.aborted) throw new DOMException('動画生成をキャンセルしました。', 'AbortError');
      const animationFrame = frame - preFrames;
      const progress = frame < preFrames
        ? 0
        : animationFrame >= animationFrames
          ? 1
          : animationFrame / (animationFrames - 1);
      drawFrame(context, background, pixels, routeSegments, options.points, progress, options.revealRoute, annotations, dayMarkers, routeMarkerMode, options.annotationStyle ?? DEFAULT_ANNOTATION_STYLE);
      await source.add(frame / VIDEO_FPS, 1 / VIDEO_FPS, { keyFrame: frame % (VIDEO_FPS * 2) === 0 });
      options.onProgress({ current: frame + 1, total, percent: Math.round((frame + 1) / total * 100) });
      if (frame % 5 === 0) await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    }
    source.close();
    await output.finalize();
    background.close();
    if (!target.buffer) throw new Error('MP4データを作成できませんでした。');
    return new Blob([target.buffer], { type: 'video/mp4' });
  } finally {
    if (!mapRemoved) map.remove();
    mapContainer.remove();
  }
}

function drawFrame(
  context: CanvasRenderingContext2D,
  background: ImageBitmap,
  pixels: maplibregl.Point[],
  routeSegments: VideoRoutePoint[][],
  points: RoutePoint[],
  progress: number,
  revealRoute: boolean,
  annotations: VideoAnnotation[],
  dayMarkers: VideoDayMarker[],
  routeMarkerMode: RouteMarkerMode,
  annotationStyle: AnnotationStyle,
) {
  context.drawImage(background, 0, 0);
  context.lineCap = 'round';
  context.lineJoin = 'round';
  context.lineWidth = 10;
  context.strokeStyle = '#ff5d37';
  context.shadowColor = 'rgba(0,0,0,.22)';
  context.shadowBlur = 8;
  const position = interpolateTripRoute(points, progress)!;
  const markerStart = pixels[position.fromIndex];
  const markerEnd = pixels[position.toIndex];
  const x = markerStart.x + (markerEnd.x - markerStart.x) * position.segmentProgress;
  const y = markerStart.y + (markerEnd.y - markerStart.y) * position.segmentProgress;
  context.beginPath();
  for (const segment of routeSegments) {
    let started = false;
    for (const routePoint of segment) {
      if (revealRoute && routePoint.arrivalProgress > progress) break;
      if (started) context.lineTo(routePoint.pixel.x, routePoint.pixel.y);
      else context.moveTo(routePoint.pixel.x, routePoint.pixel.y);
      started = true;
    }
    const segmentStart = segment[0]?.pointIndex ?? -1;
    const segmentEnd = segment.at(-1)?.pointIndex ?? -1;
    if (revealRoute && started && position.fromIndex !== position.toIndex
      && position.fromIndex >= segmentStart && position.toIndex <= segmentEnd
      && segment.some((routePoint) => routePoint.pointIndex === position.toIndex && routePoint.arrivalProgress > progress)) {
      context.lineTo(x, y);
    }
  }
  context.stroke();
  context.shadowBlur = 0;

  context.beginPath();
  context.arc(x, y, 22, 0, Math.PI * 2);
  context.fillStyle = '#ffda57';
  context.fill();
  context.lineWidth = 8;
  context.strokeStyle = '#07111f';
  context.stroke();

  for (const annotation of annotations) {
    if (progress >= annotation.arrivalProgress) drawAnnotation(context, annotation, annotationStyle);
  }

  if (routeMarkerMode === 'day') {
    for (const dayMarker of dayMarkers) {
      if (progress >= dayMarker.arrivalProgress) drawDayMarker(context, dayMarker);
    }
  } else if (routeMarkerMode === 'start-goal') {
    if (isInVideoViewport(pixels[0])) drawEndpointMarker(context, pixels[0], 'START');
    const goalPixel = pixels.at(-1);
    if (progress >= 1 && goalPixel && isInVideoViewport(goalPixel)) drawEndpointMarker(context, goalPixel, 'GOAL');
  }

  context.fillStyle = 'rgba(255,255,255,.9)';
  context.fillRect(24, HEIGHT - 50, 520, 34);
  context.fillStyle = '#27364a';
  context.font = '22px system-ui, sans-serif';
  context.fillText(GSI_ATTRIBUTION, 34, HEIGHT - 25);
}

interface VideoAnnotation {
  label: string;
  pixel: { x: number; y: number };
  arrivalProgress: number;
}

interface VideoRoutePoint {
  pixel: { x: number; y: number };
  pointIndex: number;
  arrivalProgress: number;
}

interface VideoDayMarker extends DayMarker {
  pixel: { x: number; y: number };
  arrivalProgress: number;
}

function drawAnnotation(context: CanvasRenderingContext2D, annotation: VideoAnnotation, style: AnnotationStyle) {
  context.save();
  const scale = style.balloonScale;
  const fontSize = 28 * style.fontScale;
  const paddingX = 20 * scale;
  const paddingY = 16 * scale;
  const gap = 40 * scale;
  const margin = 24;
  // Reserve the bottom strip for attribution, which is drawn last.
  const bottom = HEIGHT - 70;
  context.font = `${fontSize}px system-ui, sans-serif`;
  const maxTextWidth = WIDTH - margin * 2 - paddingX * 2;
  let label = annotation.label;
  if (context.measureText(label).width > maxTextWidth) {
    const characters = Array.from(label);
    while (characters.length && context.measureText(`${characters.join('')}…`).width > maxTextWidth) characters.pop();
    label = `${characters.join('')}…`;
  }
  const width = context.measureText(label).width + paddingX * 2;
  const radius = Math.min(10 * scale, width / 4);
  const pointerSize = Math.min(12 * scale, width / 8);
  const height = fontSize * 1.4 + paddingY * 2;
  const left = Math.max(margin, Math.min(WIDTH - margin - width, annotation.pixel.x - width / 2));
  const below = annotation.pixel.y - height - gap < margin;
  const top = Math.max(margin, Math.min(bottom - height - pointerSize, below ? annotation.pixel.y + gap : annotation.pixel.y - height - gap));
  const pointerX = Math.max(left + radius + pointerSize, Math.min(left + width - radius - pointerSize, annotation.pixel.x));
  // Match the browser note balloon: lighter navy than DAY / START / GOAL.
  context.fillStyle = '#2d4f73';
  context.strokeStyle = '#ff8b68';
  context.lineWidth = 2 * scale;
  context.shadowColor = 'rgba(7,17,31,.28)';
  context.shadowBlur = 28 * scale;
  context.shadowOffsetY = 8 * scale;
  context.beginPath();
  context.moveTo(left + radius, top);
  if (below) {
    context.lineTo(pointerX - pointerSize, top);
    context.lineTo(pointerX, top - pointerSize);
    context.lineTo(pointerX + pointerSize, top);
  }
  context.lineTo(left + width - radius, top);
  context.quadraticCurveTo(left + width, top, left + width, top + radius);
  context.lineTo(left + width, top + height - radius);
  context.quadraticCurveTo(left + width, top + height, left + width - radius, top + height);
  if (!below) {
    context.lineTo(pointerX + pointerSize, top + height);
    context.lineTo(pointerX, top + height + pointerSize);
    context.lineTo(pointerX - pointerSize, top + height);
  }
  context.lineTo(left + radius, top + height);
  context.quadraticCurveTo(left, top + height, left, top + height - radius);
  context.lineTo(left, top + radius);
  context.quadraticCurveTo(left, top, left + radius, top);
  context.closePath();
  context.fill();
  context.shadowBlur = 0;
  context.shadowOffsetY = 0;
  context.stroke();
  context.fillStyle = '#ffffff';
  context.textBaseline = 'middle';
  context.textAlign = 'left';
  context.fillText(label, left + paddingX, top + height / 2);
  context.restore();
}

function drawDayMarker(context: CanvasRenderingContext2D, marker: VideoDayMarker) {
  context.save();
  const margin = 24;
  const bottom = HEIGHT - 70;
  const width = 300;
  const dateHeight = marker.date ? 36 : 0;
  const height = (marker.note ? 98 : 66) + dateHeight;
  const gap = 42;
  const left = Math.max(margin, Math.min(WIDTH - margin - width, marker.pixel.x - width / 2));
  const below = marker.pixel.y - height - gap < margin;
  const top = Math.max(margin, Math.min(bottom - height, below ? marker.pixel.y + gap : marker.pixel.y - height - gap));
  const anchorX = Math.max(left + 18, Math.min(left + width - 18, marker.pixel.x));

  context.strokeStyle = '#ff8b68';
  context.lineWidth = 5;
  context.beginPath();
  context.moveTo(anchorX, below ? top : top + height);
  context.lineTo(marker.pixel.x, marker.pixel.y);
  context.stroke();
  context.beginPath();
  context.arc(marker.pixel.x, marker.pixel.y, 10, 0, Math.PI * 2);
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
  context.fillText(`DAY ${marker.dayNumber}`, left + width / 2, top + 34);
  if (marker.date) {
    context.fillStyle = '#cbd7e4';
    context.font = '24px system-ui, sans-serif';
    context.fillText(marker.date.replaceAll('-', '.'), left + width / 2, top + 70);
  }
  if (marker.note) {
    context.fillStyle = '#ffffff';
    context.font = '26px system-ui, sans-serif';
    context.fillText(truncateCanvasText(context, marker.note, width - 28), left + width / 2, top + 72 + dateHeight);
  }
  context.restore();
}

function drawEndpointMarker(context: CanvasRenderingContext2D, pixel: { x: number; y: number }, label: 'START' | 'GOAL') {
  context.save();
  const margin = 24;
  const bottom = HEIGHT - 70;
  const width = 230;
  const height = 78;
  const gap = 42;
  const left = Math.max(margin, Math.min(WIDTH - margin - width, pixel.x - width / 2));
  const below = pixel.y - height - gap < margin;
  const top = Math.max(margin, Math.min(bottom - height, below ? pixel.y + gap : pixel.y - height - gap));
  const anchorX = Math.max(left + 18, Math.min(left + width - 18, pixel.x));

  context.strokeStyle = '#ff8b68';
  context.lineWidth = 5;
  context.beginPath();
  context.moveTo(anchorX, below ? top : top + height);
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

function truncateCanvasText(context: CanvasRenderingContext2D, value: string, maxWidth: number): string {
  if (context.measureText(value).width <= maxWidth) return value;
  const characters = Array.from(value);
  while (characters.length && context.measureText(`${characters.join('')}…`).width > maxWidth) characters.pop();
  return `${characters.join('')}…`;
}

async function renderFollowRouteVideo(options: RenderVideoOptions): Promise<Blob> {
  if (!Number.isInteger(options.duration) || options.duration < 5 || options.duration > 120) throw new Error('移動時間は5〜120秒の整数で指定してください。');
  if (options.points.length < 2) throw new Error('動画生成には2点以上のルートが必要です。');
  const supportError = await checkVideoSupport();
  if (supportError) throw new Error(supportError);
  const routeMarkerMode = options.routeMarkerMode ?? 'day';
  const plan = options.followCameraPlan ?? buildFollowCameraPlan(options.points, options.followZoomPreset ?? 'standard', options.duration, options.followCustomZoom);
  const initialPlayback = sampleFollowPlayback(plan, 0);
  const mapContainer = document.createElement('div');
  Object.assign(mapContainer.style, { position: 'fixed', left: '-20000px', top: '0', width: `${WIDTH}px`, height: `${HEIGHT}px`, pointerEvents: 'none' });
  document.body.appendChild(mapContainer);
  const map = new maplibregl.Map({
    container: mapContainer,
    style: GSI_STYLE,
    center: [initialPlayback.cameraCenter.longitude, initialPlayback.cameraCenter.latitude],
    zoom: initialPlayback.zoom,
    bearing: 0,
    pitch: 0,
    interactive: false,
    attributionControl: false,
    pixelRatio: 1,
    canvasContextAttributes: { preserveDrawingBuffer: true },
  });
  let background: ImageBitmap | null = null;
  try {
    await waitForStyle(map, 20_000);
    let lowZoomPrewarmed = false;
    if (isLowZoomMapView(map.getZoom())) {
      await waitForLowZoomVisualReady(map, 20_000);
      lowZoomPrewarmed = true;
    } else {
      await waitForPrimaryVectorReady(map, 20_000);
    }
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
    const target = new BufferTarget();
    const output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target });
    const source = new CanvasSource(canvas, { codec: 'avc', quality: new Quality({ bitrate: 8_000_000 }), keyFrameInterval: VIDEO_FPS * 2 });
    output.addVideoTrack(source, { frameRate: VIDEO_FPS });
    await output.start();
    const preFrames = PRE_ROLL_SECONDS * VIDEO_FPS;
    const animationFrames = options.duration * VIDEO_FPS;
    const total = outputVideoFrameCount(options.duration);
    let backgroundKey = '';
    let previousIntroBandKey: string | null = null;
    for (let frame = 0; frame < total; frame += 1) {
      if (options.signal?.aborted) throw new DOMException('動画生成をキャンセルしました。', 'AbortError');
      const animationFrame = frame - preFrames;
      const elapsedSeconds = frame < preFrames
        ? 0
        : animationFrame >= animationFrames
          ? options.duration
          : animationFrame / (animationFrames - 1) * options.duration;
      const playback = options.introZoomEnabled && frame < preFrames
        ? {
          ...initialPlayback,
          zoom: interpolateIntroZoom(
            getIntroStartZoom(initialPlayback.zoom, map.getMinZoom()),
            initialPlayback.zoom,
            preFrames <= 1 ? 1 : frame / (preFrames - 1),
          ),
        }
        : sampleFollowPlayback(plan, elapsedSeconds);
      const nextBackgroundKey = `${playback.cameraCenter.longitude.toFixed(9)}:${playback.cameraCenter.latitude.toFixed(9)}:${playback.zoom}`;
      const introFrame = options.introZoomEnabled && frame < preFrames;
      const lastIntroFrame = introFrame && frame === preFrames - 1;
      if (!background || nextBackgroundKey !== backgroundKey || lastIntroFrame) {
        map.jumpTo({ center: [playback.cameraCenter.longitude, playback.cameraCenter.latitude], zoom: playback.zoom, bearing: 0, pitch: 0 });
        if (introFrame) {
          const bandKey = introZoomBandKey(playback.zoom);
          if (bandKey !== previousIntroBandKey || lastIntroFrame) {
            await waitForIntroZoomBandReady(map, playback.zoom, 20_000);
            previousIntroBandKey = bandKey;
            if (isLowZoomMapView(playback.zoom)) lowZoomPrewarmed = true;
          } else {
            await waitForRenderedMapFrame(map, 20_000);
          }
        } else if (isLowZoomMapView(playback.zoom)) {
          if (!lowZoomPrewarmed) {
            await waitForLowZoomVisualReady(map, 20_000);
            lowZoomPrewarmed = true;
          } else {
            await waitForRenderedMapFrame(map, 20_000);
          }
        } else {
          await waitForPrimaryVectorReady(map, 20_000);
        }
        context.drawImage(map.getCanvas(), 0, 0, WIDTH, HEIGHT);
        const nextBackground = await createImageBitmap(canvas);
        background?.close();
        background = nextBackground;
        backgroundKey = nextBackgroundKey;
      }
      drawFollowFrame(context, background, map, options.points, playback, dayMarkers, routeMarkerMode, options.annotationStyle ?? DEFAULT_ANNOTATION_STYLE);
      await source.add(frame / VIDEO_FPS, 1 / VIDEO_FPS, { keyFrame: frame % (VIDEO_FPS * 2) === 0 });
      options.onProgress({ current: frame + 1, total, percent: Math.round((frame + 1) / total * 100) });
      if (frame % 5 === 0) await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    }
    source.close();
    await output.finalize();
    if (!target.buffer) throw new Error('MP4データを作成できませんでした。');
    return new Blob([target.buffer], { type: 'video/mp4' });
  } finally {
    background?.close();
    map.remove();
    mapContainer.remove();
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
  revealRoute = true,
) {
  context.drawImage(background, 0, 0);
  context.lineCap = 'round';
  context.lineJoin = 'round';
  context.lineWidth = 10;
  context.strokeStyle = '#ff5d37';
  context.shadowColor = 'rgba(0,0,0,.22)';
  context.shadowBlur = 8;
  context.beginPath();
  for (const segment of revealRoute ? revealedTripRouteSegments(points, playback.routeProgress) : splitRouteByDay(points)) {
    segment.forEach((point, index) => {
      const pixel = map.project([point.longitude, point.latitude]);
      if (index === 0) context.moveTo(pixel.x, pixel.y);
      else context.lineTo(pixel.x, pixel.y);
    });
  }
  context.stroke();
  context.shadowBlur = 0;

  const markerPixel = map.project([playback.markerPosition.longitude, playback.markerPosition.latitude]);
  context.beginPath();
  context.arc(markerPixel.x, markerPixel.y, 22, 0, Math.PI * 2);
  context.fillStyle = '#ffda57';
  context.fill();
  context.lineWidth = 8;
  context.strokeStyle = '#07111f';
  context.stroke();

  for (let index = 0; index <= playback.reachedPointIndex; index += 1) {
    const point = points[index];
    if (!point.annotation?.label) continue;
    const pixel = map.project([point.longitude, point.latitude]);
    if (!isInVideoViewport(pixel)) continue;
    drawAnnotation(context, { label: point.annotation.label, pixel, arrivalProgress: 0 }, annotationStyle);
  }

  if (routeMarkerMode === 'day') {
    for (const dayMarker of dayMarkers) {
      if (dayMarker.pointIndex > playback.reachedPointIndex) continue;
      const point = points[dayMarker.pointIndex];
      const pixel = map.project([point.longitude, point.latitude]);
      if (!isInVideoViewport(pixel)) continue;
      drawDayMarker(context, { ...dayMarker, pixel, arrivalProgress: 0 });
    }
  } else if (routeMarkerMode === 'start-goal') {
    const startPixel = map.project([points[0].longitude, points[0].latitude]);
    if (isInVideoViewport(startPixel)) drawEndpointMarker(context, startPixel, 'START');
    if (playback.reachedPointIndex >= points.length - 1) {
      const goal = points.at(-1)!;
      const goalPixel = map.project([goal.longitude, goal.latitude]);
      if (isInVideoViewport(goalPixel)) drawEndpointMarker(context, goalPixel, 'GOAL');
    }
  }

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

function isLowZoomMapView(zoom: number): boolean {
  return GSI_VECTOR_CONFIG.lowZoomLand.enabled && zoom < GSI_VECTOR_CONFIG.lowZoomLand.maxZoom;
}

async function waitForRenderedMapFrame(map: maplibregl.Map, timeout: number): Promise<void> {
  // style.load完了後のタイル取得を、スタイル自体の未ロードと混同しない。
  if (!styleReadyMaps.has(map)) await waitForStyle(map, timeout);
  await new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      window.clearTimeout(timer);
      map.off('render', onRender);
    };
    const onRender = () => {
      cleanup();
      resolve();
    };
    const timer = window.setTimeout(() => {
      cleanup();
      reject(new Error('動画用地図を描画できませんでした。'));
    }, timeout);
    map.on('render', onRender);
    try {
      map.triggerRepaint();
    } catch (error) {
      cleanup();
      reject(error);
    }
  });
  await nextPaint();
}

async function waitForLowZoomVisualReady(map: maplibregl.Map, timeout: number): Promise<void> {
  if (!styleReadyMaps.has(map)) await waitForStyle(map, timeout);
  if (!(map.loaded() && map.areTilesLoaded())) {
    // 初回Range Requestに猶予を与えるが、全タイルの完了は必須にしない。
    await new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        window.clearTimeout(timer);
        map.off('idle', onReady);
        map.off('render', onRender);
      };
      const onReady = () => { cleanup(); resolve(); };
      const onRender = () => {
        if (map.loaded() && map.areTilesLoaded()) onReady();
      };
      const timer = window.setTimeout(onReady, Math.min(timeout, 2_500));
      map.on('idle', onReady);
      map.on('render', onRender);
      try {
        map.triggerRepaint();
      } catch (error) {
        cleanup();
        reject(error);
      }
    });
  }
  await waitForRenderedMapFrame(map, timeout);
}

async function waitForPrimaryVectorReady(map: maplibregl.Map, timeout: number): Promise<void> {
  await waitForMapSourceReady(map, GSI_OFFICIAL_SOURCE_ID, timeout);
}

function introZoomBandKey(zoom: number): string {
  return `${isLowZoomMapView(zoom) ? 'low' : 'main'}:${Math.floor(zoom)}`;
}

async function waitForIntroZoomBandReady(map: maplibregl.Map, zoom: number, timeout: number): Promise<void> {
  await waitForPrimaryVectorReady(map, timeout);
  if (isLowZoomMapView(zoom)) await waitForMapSourceReady(map, GSI_LOW_ZOOM_LAND_SOURCE_ID, timeout);
}

async function waitForMapSourceReady(map: maplibregl.Map, sourceId: string, timeout: number): Promise<void> {
  // view変更を反映してから、指定sourceだけの準備完了を確認する。
  await waitForRenderedMapFrame(map, timeout);
  if (!map.getSource(sourceId)) {
    throw new Error(`動画用の地図データが見つかりません（${sourceId}）。`);
  }
  await new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      window.clearTimeout(timer);
      map.off('sourcedata', checkReady);
      map.off('render', checkReady);
    };
    const checkReady = () => {
      try {
        if (map.getSource(sourceId) && map.isSourceLoaded(sourceId)) {
          cleanup();
          resolve();
        }
      } catch (error) {
        cleanup();
        reject(error);
      }
    };
    const timer = window.setTimeout(() => {
      cleanup();
      reject(new Error(`動画用の地図データの読み込みがタイムアウトしました（${sourceId}）。`));
    }, timeout);
    map.on('sourcedata', checkReady);
    map.on('render', checkReady);
    checkReady();
  });
  await waitForRenderedMapFrame(map, timeout);
}

function waitForIdle(map: maplibregl.Map, timeout: number): Promise<void> {
  if (map.loaded() && map.areTilesLoaded()) return nextPaint();
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error('動画用地図の読み込みがタイムアウトしました。')), timeout);
    map.once('idle', () => { window.clearTimeout(timer); resolve(); });
  });
}

function waitForStyle(map: maplibregl.Map, timeout: number): Promise<void> {
  styleReadyMaps.delete(map);
  if (map.isStyleLoaded()) {
    styleReadyMaps.add(map);
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      window.clearTimeout(timer);
      map.off('style.load', onLoad);
    };
    const onLoad = () => {
      cleanup();
      styleReadyMaps.add(map);
      resolve();
    };
    const timer = window.setTimeout(() => {
      cleanup();
      reject(new Error('動画用地図を準備できませんでした。'));
    }, timeout);
    map.once('style.load', onLoad);
  });
}

function nextPaint(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
}
