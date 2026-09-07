import * as maplibregl from 'maplibre-gl';
import { BufferTarget, CanvasSource, Mp4OutputFormat, Output, Quality, getFirstEncodableVideoCodec } from 'mediabunny';
import type { RoutePoint } from '../timeline/types';
import { interpolateRoute, routePointProgresses } from '../route/geometry';
import { DEFAULT_ANNOTATION_STYLE, type AnnotationStyle } from '../route/annotationStyle';
import { OSM_ATTRIBUTION, OSM_STYLE } from '../map/osmStyle';

const WIDTH = 1920;
const HEIGHT = 1080;
const FPS = 30;
const FALLBACK_STYLE = { version: 8 as const, sources: {}, layers: [{ id: 'background', type: 'background' as const, paint: { 'background-color': '#e7edef' } }] };

export interface VideoProgress { current: number; total: number; percent: number }
export interface RenderVideoOptions {
  points: RoutePoint[];
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
  if (!Number.isInteger(options.duration) || options.duration < 5 || options.duration > 60) throw new Error('動画時間は5〜60秒の整数で指定してください。');
  if (options.points.length < 2) throw new Error('動画生成には2点以上のルートが必要です。');
  const supportError = await checkVideoSupport();
  if (supportError) throw new Error(supportError);

  const mapContainer = document.createElement('div');
  Object.assign(mapContainer.style, { position: 'fixed', left: '-20000px', top: '0', width: `${WIDTH}px`, height: `${HEIGHT}px`, pointerEvents: 'none' });
  document.body.appendChild(mapContainer);
  const map = new maplibregl.Map({ container: mapContainer, style: OSM_STYLE, center: [options.points[0].longitude, options.points[0].latitude], zoom: 10, interactive: false, attributionControl: false, pixelRatio: 1, canvasContextAttributes: { preserveDrawingBuffer: true } });
  let mapRemoved = false;
  try {
    await waitForStyle(map, 20_000);
    const bounds = new maplibregl.LngLatBounds();
    options.points.forEach((point) => bounds.extend([point.longitude, point.latitude]));
    map.fitBounds(bounds, { padding: 100, maxZoom: 16, duration: 0 });
    try {
      await waitForIdle(map, 20_000);
    } catch {
      map.setStyle(FALLBACK_STYLE);
      await waitForStyle(map, 5_000);
    }
    map.triggerRepaint();
    await nextPaint();

    const canvas = document.createElement('canvas');
    canvas.width = WIDTH;
    canvas.height = HEIGHT;
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) throw new Error('動画用Canvasを作成できませんでした。');
    context.drawImage(map.getCanvas(), 0, 0, WIDTH, HEIGHT);
    const background = await createImageBitmap(canvas);
    const pixels = options.points.map((point) => map.project([point.longitude, point.latitude]));
    const arrivals = routePointProgresses(options.points);
    const annotations = options.points.flatMap((point, index) => point.annotation?.label
      ? [{ label: point.annotation.label, pixel: pixels[index], arrivalProgress: arrivals[index] }] : []);
    // Encoding uses only the captured bitmap and projected route from this point on.
    map.remove();
    mapRemoved = true;
    const target = new BufferTarget();
    const output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target });
    const source = new CanvasSource(canvas, { codec: 'avc', quality: new Quality({ bitrate: 8_000_000 }), keyFrameInterval: FPS * 2 });
    output.addVideoTrack(source, { frameRate: FPS });
    await output.start();
    const total = options.duration * FPS;
    for (let frame = 0; frame < total; frame += 1) {
      if (options.signal?.aborted) throw new DOMException('動画生成をキャンセルしました。', 'AbortError');
      const progress = total === 1 ? 1 : frame / (total - 1);
      drawFrame(context, background, pixels, options.points, progress, options.revealRoute, annotations, options.annotationStyle ?? DEFAULT_ANNOTATION_STYLE);
      await source.add(frame / FPS, 1 / FPS, { keyFrame: frame % (FPS * 2) === 0 });
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
  points: RoutePoint[],
  progress: number,
  revealRoute: boolean,
  annotations: VideoAnnotation[],
  annotationStyle: AnnotationStyle,
) {
  context.drawImage(background, 0, 0);
  context.lineCap = 'round';
  context.lineJoin = 'round';
  context.lineWidth = 10;
  context.strokeStyle = '#ff5d37';
  context.shadowColor = 'rgba(0,0,0,.22)';
  context.shadowBlur = 8;
  context.beginPath();
  context.moveTo(pixels[0].x, pixels[0].y);
  const position = interpolateRoute(points, progress)!;
  if (revealRoute) {
    for (let index = 1; index <= position.segmentIndex; index += 1) context.lineTo(pixels[index].x, pixels[index].y);
    const start = pixels[position.segmentIndex];
    const end = pixels[position.segmentIndex + 1];
    context.lineTo(start.x + (end.x - start.x) * position.segmentProgress, start.y + (end.y - start.y) * position.segmentProgress);
  } else for (let index = 1; index < pixels.length; index += 1) context.lineTo(pixels[index].x, pixels[index].y);
  context.stroke();
  context.shadowBlur = 0;

  const markerStart = pixels[position.segmentIndex];
  const markerEnd = pixels[position.segmentIndex + 1];
  const x = markerStart.x + (markerEnd.x - markerStart.x) * position.segmentProgress;
  const y = markerStart.y + (markerEnd.y - markerStart.y) * position.segmentProgress;
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

  context.fillStyle = 'rgba(255,255,255,.9)';
  context.fillRect(24, HEIGHT - 50, 520, 34);
  context.fillStyle = '#27364a';
  context.font = '22px system-ui, sans-serif';
  context.fillText(OSM_ATTRIBUTION, 34, HEIGHT - 25);
}

interface VideoAnnotation {
  label: string;
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
  const radius = Math.min(16 * scale, width / 4);
  const pointerSize = Math.min(12 * scale, width / 8);
  const height = fontSize * 1.4 + paddingY * 2;
  const left = Math.max(margin, Math.min(WIDTH - margin - width, annotation.pixel.x - width / 2));
  const below = annotation.pixel.y - height - gap < margin;
  const top = Math.max(margin, Math.min(bottom - height - pointerSize, below ? annotation.pixel.y + gap : annotation.pixel.y - height - gap));
  const pointerX = Math.max(left + radius + pointerSize, Math.min(left + width - radius - pointerSize, annotation.pixel.x));
  context.fillStyle = '#ffffff';
  context.strokeStyle = '#ccd5de';
  context.lineWidth = 2 * scale;
  context.shadowColor = 'rgba(7,17,31,.2)';
  context.shadowBlur = 14 * scale;
  context.shadowOffsetY = 4 * scale;
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
  context.fillStyle = '#10233f';
  context.textBaseline = 'middle';
  context.textAlign = 'left';
  context.fillText(label, left + paddingX, top + height / 2);
  context.restore();
}

function waitForIdle(map: maplibregl.Map, timeout: number): Promise<void> {
  if (map.loaded() && map.areTilesLoaded()) return nextPaint();
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error('動画用地図の読み込みがタイムアウトしました。')), timeout);
    map.once('idle', () => { window.clearTimeout(timer); resolve(); });
  });
}

function waitForStyle(map: maplibregl.Map, timeout: number): Promise<void> {
  if (map.isStyleLoaded()) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error('動画用地図を準備できませんでした。')), timeout);
    map.once('style.load', () => { window.clearTimeout(timer); resolve(); });
  });
}

function nextPaint(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
}
