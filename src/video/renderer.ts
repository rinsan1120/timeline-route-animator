import { nearestPointOnRect, placedPopupRect, type PopupPlacement, type EndpointMarkerPlacements } from '../popup/placement';
import * as maplibregl from 'maplibre-gl';
import { BufferTarget, CanvasSource, Mp4OutputFormat, Output, Quality, getFirstEncodableVideoCodec } from 'mediabunny';
import type { RoutePoint } from '../timeline/types';
import { DEFAULT_ANNOTATION_STYLE, type AnnotationStyle } from '../route/annotationStyle';
import type { RouteMarkerMode } from '../route/routeMarker';
import { DAY_MARKER_COLORS, DAY_MARKER_FONT_FAMILY, dayMarkerConnector, dayMarkerLayout } from '../route/dayMarkerStyle';
import { interpolateTripRoute, revealedTripRouteSegments, splitRouteByDay, tripRoutePointProgresses, type DayMarker } from '../route/tripRoute';
import { GSI_ATTRIBUTION, GSI_STYLE, GSI_LOW_ZOOM_LAND_SOURCE_ID } from '../map/gsiStyle';
import { GSI_OFFICIAL_SOURCE_ID } from '../map/gsiOfficialStyle';
import { GSI_VECTOR_CONFIG } from '../map/gsiVectorConfig';
import { buildFollowCameraPlan, sampleFollowPlayback, type FollowCameraPlan, type FollowPlaybackState, type FollowZoomPreset, type VideoCameraMode } from './followCamera';
import { getIntroStartZoom, interpolateIntroZoom, INTRO_ZOOM_DURATION_SECONDS } from './introZoom';
import { createOverviewCamera, VIDEO_FPS, VIDEO_MIN_ZOOM, VIDEO_VIEWPORT, type VideoCamera, type ViewportSize } from './overviewCamera';
import { planRouteDistanceProgress } from '../route/planDistanceProgress';
import { drawDistanceHud, type DistanceHudOptions } from './distanceHud';

const WIDTH = VIDEO_VIEWPORT.width;
const HEIGHT = VIDEO_VIEWPORT.height;
const styleReadyMaps = new WeakSet<maplibregl.Map>();
export { VIDEO_FPS } from './overviewCamera';
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
  distanceHud?: DistanceHudOptions;
  endpointMarkerPlacements?: EndpointMarkerPlacements;
  points: RoutePoint[];
  dayMarkers?: DayMarker[];
  routeMarkerMode?: RouteMarkerMode;
  cameraMode?: VideoCameraMode;
  followZoomPreset?: FollowZoomPreset;
  followCustomZoom?: number;
  overviewZoomMode?: 'auto' | 'custom';
  overviewCustomZoom?: number;
  overviewCamera?: VideoCamera;
  // Browser viewport is retained only for the existing DAY marker size model.
  dayMarkerReferenceViewport?: ViewportSize;
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
  const customZoom = options.overviewZoomMode === 'custom' ? options.overviewCustomZoom ?? 10 : undefined;
  if (customZoom !== undefined && (!Number.isFinite(customZoom) || customZoom < 4 || customZoom > 16)) throw new Error('Zoomは4.0〜16.0で指定してください。');
  const camera = options.overviewCamera ?? createOverviewCamera(options.points, customZoom)!;

  const mapContainer = document.createElement('div');
  Object.assign(mapContainer.style, { position: 'fixed', left: '-20000px', top: '0', width: `${WIDTH}px`, height: `${HEIGHT}px`, pointerEvents: 'none' });
  document.body.appendChild(mapContainer);
  const map = new maplibregl.Map({ container: mapContainer, style: GSI_STYLE, center: [options.points[0].longitude, options.points[0].latitude], zoom: 10, interactive: false, attributionControl: false, pixelRatio: 1, canvasContextAttributes: { preserveDrawingBuffer: true } });
  let mapRemoved = false;
  try {
    await waitForStyle(map, 20_000);
    map.jumpTo({ center: [camera.longitude, camera.latitude], zoom: camera.zoom, bearing: camera.bearing, pitch: camera.pitch });
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
      const targetCenter = { lng: camera.longitude, lat: camera.latitude };
      const targetZoom = camera.zoom;
      const startZoom = getIntroStartZoom(targetZoom, VIDEO_MIN_ZOOM);
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
        drawFollowFrame(context, map.getCanvas(), map, options.points, { ...introPlayback, zoom }, dynamicDayMarkers, routeMarkerMode, options.annotationStyle ?? DEFAULT_ANNOTATION_STYLE, options.endpointMarkerPlacements ?? {}, options.revealRoute, options.distanceHud, options.dayMarkerReferenceViewport);
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
      ? [{ label: point.annotation.label, placement: point.annotation.placement, pixel: pixels[index], arrivalProgress: arrivals[index] }] : []);
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
      drawFrame(context, background, pixels, routeSegments, options.points, progress, options.revealRoute, annotations, dayMarkers, routeMarkerMode, options.annotationStyle ?? DEFAULT_ANNOTATION_STYLE, options.endpointMarkerPlacements ?? {}, options.distanceHud, options.dayMarkerReferenceViewport);
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
  endpointMarkerPlacements: EndpointMarkerPlacements,
  distanceHud?: DistanceHudOptions,
  dayMarkerReferenceViewport: ViewportSize = VIDEO_VIEWPORT,
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
      if (progress >= dayMarker.arrivalProgress) drawDayMarker(context, dayMarker, dayMarkerReferenceViewport);
    }
  } else if (routeMarkerMode === 'start-goal') {
    if (isInVideoViewport(pixels[0])) drawEndpointMarker(context, pixels[0], 'START', endpointMarkerPlacements.START);
    const goalPixel = pixels.at(-1);
    if (progress >= 1 && goalPixel && isInVideoViewport(goalPixel)) drawEndpointMarker(context, goalPixel, 'GOAL', endpointMarkerPlacements.GOAL);
  }

  if (distanceHud?.settings.enabled) drawDistanceHud(context, planRouteDistanceProgress(distanceHud.model, progress), distanceHud);
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
  let left = Math.max(margin, Math.min(WIDTH - margin - width, annotation.pixel.x - width / 2));
  const below = annotation.pixel.y - height - gap < margin;
  let top = Math.max(margin, Math.min(bottom - height - pointerSize, below ? annotation.pixel.y + gap : annotation.pixel.y - height - gap));
  if (annotation.placement) {
    ({ left, top } = placedPopupRect(annotation.pixel, annotation.placement, width, height, WIDTH, bottom, margin));
  }
  const pointerX = Math.max(left + radius + pointerSize, Math.min(left + width - radius - pointerSize, annotation.pixel.x));
  if (annotation.placement) {
    const edge = nearestPointOnRect({ left, top, width, height }, annotation.pixel);
    context.strokeStyle = '#ff8b68';
    context.lineWidth = 2 * scale;
    context.beginPath();
    context.moveTo(edge.x, edge.y);
    context.lineTo(annotation.pixel.x, annotation.pixel.y);
    context.stroke();
  }
  // Match the browser note balloon: lighter navy than DAY / START / GOAL.
  context.fillStyle = '#2d4f73';
  context.strokeStyle = '#ff8b68';
  context.lineWidth = 2 * scale;
  context.shadowColor = 'rgba(7,17,31,.28)';
  context.shadowBlur = 28 * scale;
  context.shadowOffsetY = 8 * scale;
  context.beginPath();
  context.moveTo(left + radius, top);
  if (!annotation.placement && below) {
    context.lineTo(pointerX - pointerSize, top);
    context.lineTo(pointerX, top - pointerSize);
    context.lineTo(pointerX + pointerSize, top);
  }
  context.lineTo(left + width - radius, top);
  context.quadraticCurveTo(left + width, top, left + width, top + radius);
  context.lineTo(left + width, top + height - radius);
  context.quadraticCurveTo(left + width, top + height, left + width - radius, top + height);
  if (!annotation.placement && !below) {
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

function drawDayMarker(context: CanvasRenderingContext2D, marker: VideoDayMarker, referenceViewport: ViewportSize) {
  context.save();
  const { width, height, style, rows } = dayMarkerLayout(marker, context, referenceViewport);
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
  context.strokeStyle = DAY_MARKER_COLORS.outline;
  context.lineWidth = connector.width;
  context.lineCap = 'butt';
  context.beginPath();
  context.moveTo(connector.start.x, connector.start.y);
  context.lineTo(connector.end.x, connector.end.y);
  context.stroke();
  context.beginPath();
  context.arc(connector.dot.x, connector.dot.y, connector.radius, 0, Math.PI * 2);
  context.fillStyle = DAY_MARKER_COLORS.anchor;
  context.fill();
  context.lineWidth = style.anchorBorder;
  context.strokeStyle = DAY_MARKER_COLORS.text;
  context.stroke();

  context.shadowColor = DAY_MARKER_COLORS.shadow;
  context.shadowBlur = style.shadowBlur;
  context.shadowOffsetY = style.shadowOffsetY;
  context.fillStyle = DAY_MARKER_COLORS.background;
  context.beginPath();
  context.roundRect(left, top, width, height, style.radius);
  context.fill();
  context.shadowBlur = 0;
  context.shadowOffsetY = 0;
  context.lineWidth = style.border;
  context.strokeStyle = DAY_MARKER_COLORS.outline;
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
  // Failed tiles may count as loaded in MapLibre. Keep errors across camera changes.
  let mapLoadError: Error | null = null;
  const onMapError = () => {
    mapLoadError = new Error('追従動画用の地図データを読み込めませんでした。ネットワーク接続を確認してください。');
  };
  map.on('error', onMapError);
  try {
    await waitForStyle(map, 20_000);
    await waitForFollowViewportReady(map, 20_000, () => mapLoadError, options.signal);
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
            getIntroStartZoom(initialPlayback.zoom, VIDEO_MIN_ZOOM),
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
        await waitForFollowViewportReady(map, 20_000, () => mapLoadError, options.signal);
        context.drawImage(map.getCanvas(), 0, 0, WIDTH, HEIGHT);
        const nextBackground = await createImageBitmap(canvas);
        background?.close();
        background = nextBackground;
        backgroundKey = nextBackgroundKey;
      }
      if (mapLoadError) throw mapLoadError;
      drawFollowFrame(context, background, map, options.points, playback, dayMarkers, routeMarkerMode, options.annotationStyle ?? DEFAULT_ANNOTATION_STYLE, options.endpointMarkerPlacements ?? {}, true, options.distanceHud, options.dayMarkerReferenceViewport);
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
    map.off('error', onMapError);
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
  endpointMarkerPlacements: EndpointMarkerPlacements,
  revealRoute = true,
  distanceHud?: DistanceHudOptions,
  dayMarkerReferenceViewport: ViewportSize = VIDEO_VIEWPORT,
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
    drawAnnotation(context, { label: point.annotation.label, placement: point.annotation.placement, pixel, arrivalProgress: 0 }, annotationStyle);
  }

  if (routeMarkerMode === 'day') {
    for (const dayMarker of dayMarkers) {
      if (dayMarker.pointIndex > playback.reachedPointIndex) continue;
      const point = points[dayMarker.pointIndex];
      const pixel = map.project([point.longitude, point.latitude]);
      if (!isInVideoViewport(pixel)) continue;
      drawDayMarker(context, { ...dayMarker, pixel, arrivalProgress: 0 }, dayMarkerReferenceViewport);
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

  if (distanceHud?.settings.enabled) drawDistanceHud(context, planRouteDistanceProgress(distanceHud.model, playback.routeProgress, playback.reachedPointIndex), distanceHud);
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

function waitForFollowViewportReady(
  map: maplibregl.Map,
  timeout: number,
  getLoadError: () => Error | null,
  signal?: AbortSignal,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const requiredSources: string[] = [GSI_OFFICIAL_SOURCE_ID];
    if (isLowZoomMapView(map.getZoom())) requiredSources.push(GSI_LOW_ZOOM_LAND_SOURCE_ID);
    const cleanup = () => {
      window.clearTimeout(timer);
      map.off('idle', onIdle);
      map.off('error', onError);
      signal?.removeEventListener('abort', onAbort);
    };
    const fail = (error: unknown) => {
      cleanup();
      reject(error);
    };
    const onError = () => fail(getLoadError() ?? new Error('追従動画用の地図データを読み込めませんでした。'));
    const onAbort = () => fail(new DOMException('動画生成をキャンセルしました。', 'AbortError'));
    const onIdle = () => {
      try {
        const error = getLoadError();
        if (error) return fail(error);
        for (const sourceId of requiredSources) {
          if (!map.getSource(sourceId)) return fail(new Error(`動画用の地図データが見つかりません（${sourceId}）。`));
        }
        if (!map.loaded() || !map.areTilesLoaded() || !requiredSources.every((sourceId) => map.isSourceLoaded(sourceId))) return;
        cleanup();
        resolve();
      } catch (error) {
        fail(error);
      }
    };
    const timer = window.setTimeout(() => {
      fail(new Error('追従動画用の地図データの読み込みがタイムアウトしました。動画生成を中止しました。'));
    }, timeout);
    map.on('idle', onIdle);
    map.on('error', onError);
    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) return onAbort();
    const error = getLoadError();
    if (error) return fail(error);
    try {
      // jumpTo's tile selection is applied during render. Only accept a subsequent
      // idle frame: current-viewport tiles and final symbol placement have rendered.
      // Cached viewports proceed on that frame, without a fixed delay.
      map.triggerRepaint();
    } catch (error) {
      fail(error);
    }
  });
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
