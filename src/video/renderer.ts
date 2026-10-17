import { BufferTarget, CanvasSource, Mp4OutputFormat, Output, Quality, getFirstEncodableVideoCodec } from 'mediabunny';
import type { RoutePoint } from '../timeline/types';
import { DEFAULT_ANNOTATION_STYLE, type AnnotationStyle } from '../route/annotationStyle';
import { loadDayMarkerFonts } from '../route/dayMarkerStyle';
import type { RouteMarkerMode } from '../route/routeMarker';
import { createVideoMapSession } from './videoMapSession';
import type { FollowCameraPlan, FollowZoomPreset, FollowViewMode, VideoCameraMode } from './followCamera';
import { createOverviewCamera, VIDEO_FPS, VIDEO_VIEWPORT, type VideoCamera } from './overviewCamera';
import type { DistanceHudOptions } from './distanceHud';
import { buildFramePlan, sampleFrame } from './frameTimeline';
import { drawVideoFrame } from './frameRenderer';
import { frameClockText, prepareOverviewFrameScene, prepareFollowFrameScene, prepareOverviewFrameData, prepareVideoDayMarkers, resolveVideoBalloons } from './frameScene';
import type { EndpointMarkerPlacements, EndpointMarkerFramePositions } from '../popup/placement';
import type { DayMarker } from '../route/tripRoute';
export { outputVideoDuration, outputVideoFrameCount } from './outputTiming';
import { buildRoutePointDayNumbers } from '../route/dayRouteColor';

const WIDTH = VIDEO_VIEWPORT.width;
const HEIGHT = VIDEO_VIEWPORT.height;
export { VIDEO_FPS } from './overviewCamera';

export interface VideoProgress { current: number; total: number; percent: number }
export interface RenderVideoOptions {
  recordedTimeClockEnabled?: boolean;
  distanceHud?: DistanceHudOptions;
  endpointMarkerPlacements?: EndpointMarkerPlacements;
  endpointMarkerFramePositions?: EndpointMarkerFramePositions;
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
  if (routeMarkerMode === 'day') await loadDayMarkerFonts(options.dayMarkers ?? [], options.annotationStyle);
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
    const dynamicDayMarkers = prepareVideoDayMarkers(options.dayMarkers ?? [], pointIndexById);
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
        drawVideoFrame(context, prepareFollowFrameScene(map.getCanvas(), map, options.points, state.playback, dynamicDayMarkers, routeMarkerMode, options.annotationStyle ?? DEFAULT_ANNOTATION_STYLE, options.endpointMarkerPlacements ?? {}, options.revealRoute, options.distanceHud, dayNumberByPointId, options.dayRouteColorsEnabled ?? false, frameClockText(options, state), options.endpointMarkerFramePositions));
        await source.add(frame / VIDEO_FPS, 1 / VIDEO_FPS, { keyFrame: frame % (VIDEO_FPS * 2) === 0 });
        options.onProgress({ current: frame + 1, total, percent: Math.round((frame + 1) / total * 100) });
        if (frame % 5 === 0) await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      }
    }
    map = await videoMap.prepare(camera, !!options.introZoomEnabled && preFrames > 0);
    context.drawImage(map.getCanvas(), 0, 0, WIDTH, HEIGHT);
    background = await createImageBitmap(canvas);
    const { pixels, annotations, dayMarkers, routeSegments } = prepareOverviewFrameData(options, map, pointIndexById, dayNumberByPointId);
    // Encoding uses only the captured bitmap and projected route from this point on.
    videoMap.dispose();
    for (let frame = options.introZoomEnabled ? preFrames : 0; frame < total; frame += 1) {
      if (options.signal?.aborted) throw new DOMException('動画生成をキャンセルしました。', 'AbortError');
      const state = sampleFrame(framePlan, frame);
      drawVideoFrame(context, prepareOverviewFrameScene(background, pixels, routeSegments, options.points, state.routeProgress, options.revealRoute, annotations, dayMarkers, routeMarkerMode, options.annotationStyle ?? DEFAULT_ANNOTATION_STYLE, options.endpointMarkerPlacements ?? {}, options.distanceHud, options.dayRouteColorsEnabled ?? false, state.pausePointIndex, frameClockText(options, state), options.endpointMarkerFramePositions));
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

async function renderFollowRouteVideo(options: RenderVideoOptions): Promise<Blob> {
  if (!Number.isInteger(options.duration) || options.duration < 5 || options.duration > 120) throw new Error('移動時間は5〜120秒の整数で指定してください。');
  if (options.points.length < 2) throw new Error('動画生成には2点以上のルートが必要です。');
  const supportError = await checkVideoSupport();
  if (supportError) throw new Error(supportError);
  const routeMarkerMode = options.routeMarkerMode ?? 'day';
  if (routeMarkerMode === 'day') await loadDayMarkerFonts(options.dayMarkers ?? [], options.annotationStyle);
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
    const dayMarkers = prepareVideoDayMarkers(options.dayMarkers ?? [], pointIndexById);
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
      drawVideoFrame(context, prepareFollowFrameScene(background, map, options.points, playback, dayMarkers, routeMarkerMode, options.annotationStyle ?? DEFAULT_ANNOTATION_STYLE, options.endpointMarkerPlacements ?? {}, true, options.distanceHud, dayNumberByPointId, options.dayRouteColorsEnabled ?? false, frameClockText(options, state), options.endpointMarkerFramePositions));
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
