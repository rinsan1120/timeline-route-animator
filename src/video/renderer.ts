import * as maplibregl from 'maplibre-gl';
import { BufferTarget, CanvasSource, Mp4OutputFormat, Output, Quality, getFirstEncodableVideoCodec } from 'mediabunny';
import type { RoutePoint } from '../timeline/types';
import { interpolateRoute } from '../route/geometry';

const WIDTH = 1920;
const HEIGHT = 1080;
const FPS = 30;
const STYLE_URL = 'https://tiles.openfreemap.org/styles/positron';
const FALLBACK_STYLE = { version: 8 as const, sources: {}, layers: [{ id: 'background', type: 'background' as const, paint: { 'background-color': '#e7edef' } }] };

export interface VideoProgress { current: number; total: number; percent: number }
export interface RenderVideoOptions {
  points: RoutePoint[];
  duration: 5 | 10 | 15;
  revealRoute: boolean;
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
  if (options.points.length < 2) throw new Error('動画生成には2点以上のルートが必要です。');
  const supportError = await checkVideoSupport();
  if (supportError) throw new Error(supportError);

  const mapContainer = document.createElement('div');
  Object.assign(mapContainer.style, { position: 'fixed', left: '-20000px', top: '0', width: `${WIDTH}px`, height: `${HEIGHT}px`, pointerEvents: 'none' });
  document.body.appendChild(mapContainer);
  const map = new maplibregl.Map({ container: mapContainer, style: STYLE_URL, center: [options.points[0].longitude, options.points[0].latitude], zoom: 10, interactive: false, attributionControl: false, pixelRatio: 1, canvasContextAttributes: { preserveDrawingBuffer: true } });
  try {
    await waitForMap(map, 'load', 20_000);
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
    const target = new BufferTarget();
    const output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target });
    const source = new CanvasSource(canvas, { codec: 'avc', quality: new Quality({ bitrate: 8_000_000 }), keyFrameInterval: FPS * 2 });
    output.addVideoTrack(source, { frameRate: FPS });
    await output.start();
    const total = options.duration * FPS;
    for (let frame = 0; frame < total; frame += 1) {
      if (options.signal?.aborted) throw new DOMException('動画生成をキャンセルしました。', 'AbortError');
      const progress = total === 1 ? 1 : frame / (total - 1);
      drawFrame(context, background, pixels, options.points, progress, options.revealRoute);
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
    map.remove();
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

  context.fillStyle = 'rgba(255,255,255,.9)';
  context.fillRect(24, HEIGHT - 50, 520, 34);
  context.fillStyle = '#27364a';
  context.font = '22px system-ui, sans-serif';
  context.fillText('© OpenFreeMap  © OpenStreetMap contributors', 34, HEIGHT - 25);
}

function waitForMap(map: maplibregl.Map, event: 'load', timeout: number): Promise<void> {
  if (map.loaded()) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error('地図の読み込みがタイムアウトしました。')), timeout);
    map.once(event, () => { window.clearTimeout(timer); resolve(); });
  });
}

function waitForIdle(map: maplibregl.Map, timeout: number): Promise<void> {
  if (map.loaded() && map.areTilesLoaded()) return nextPaint();
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error('動画用地図の読み込みがタイムアウトしました。')), timeout);
    map.once('idle', () => { window.clearTimeout(timer); resolve(); });
  });
}

function waitForStyle(map: maplibregl.Map, timeout: number): Promise<void> {
  if (map.isStyleLoaded()) return nextPaint();
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error('動画用地図を準備できませんでした。')), timeout);
    map.once('style.load', () => { window.clearTimeout(timer); void nextPaint().then(resolve); });
  });
}

function nextPaint(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
}
