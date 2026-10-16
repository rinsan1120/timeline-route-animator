import type { Map as MapLibreMap } from 'maplibre-gl';
import { DEFAULT_ANNOTATION_STYLE } from '../route/annotationStyle';
import { buildRoutePointDayNumbers } from '../route/dayRouteColor';
import { buildFramePlan, sampleFrame, type FrameState } from './frameTimeline';
import { drawVideoFrame } from './frameRenderer';
import { frameClockText, prepareFollowFrameScene, prepareOverviewFrameData, prepareOverviewFrameScene, prepareVideoDayMarkers, resolveVideoBalloons, type FrameDrawingOptions } from './frameScene';
import { createOverviewCamera, VIDEO_VIEWPORT, type VideoCamera } from './overviewCamera';
import { createVideoMapSession } from './videoMapSession';
import { buildVideoEvents, createVideoEventProjector, type VideoEvent } from './videoEvents';

export interface PreviewFrameOptions extends FrameDrawingOptions {
  signal?: AbortSignal;
}

export type PreviewFrameResult =
  | { status: 'rendered'; requestId: number; canvas: HTMLCanvasElement; state: FrameState }
  | { status: 'discarded'; requestId: number; frameIndex: number; reason: 'superseded' | 'disposed'; error?: unknown };

interface FrameRequest {
  id: number;
  frameIndex: number;
  resolve: (result: PreviewFrameResult) => void;
  reject: (error: unknown) => void;
}

// Cache scope fixes GSI_STYLE and pixelRatio=1; settings changes need a new session.
function cameraKey(camera: VideoCamera): string {
  return `GSI_STYLE:${VIDEO_VIEWPORT.width}x${VIDEO_VIEWPORT.height}:1:${camera.longitude}:${camera.latitude}:${camera.zoom}:${camera.bearing}:${camera.pitch}`;
}

// The caller supplies the output Canvas; concurrent requests keep only the latest.
// Route/settings and Canvas size/state must remain unchanged for this session.
export function createPreviewFrameRenderer(canvas: HTMLCanvasElement, options: PreviewFrameOptions) {
  if (!Number.isInteger(options.duration) || options.duration < 5 || options.duration > 120) throw new Error('移動時間は5〜120秒の整数で指定してください。');
  if (options.points.length < 2) throw new Error('動画生成には2点以上のルートが必要です。');
  const customZoom = options.overviewZoomMode === 'custom' ? options.overviewCustomZoom ?? 10 : undefined;
  if (options.cameraMode !== 'follow' && customZoom !== undefined && (!Number.isFinite(customZoom) || customZoom < 4 || customZoom > 16)) throw new Error('Zoomは4.0〜16.0で指定してください。');
  if (options.signal?.aborted) throw new DOMException('プレビュー描画をキャンセルしました。', 'AbortError');
  const framePlan = buildFramePlan(options);
  canvas.width = VIDEO_VIEWPORT.width;
  canvas.height = VIDEO_VIEWPORT.height;
  const outputContext = canvas.getContext('2d', { alpha: false });
  const workCanvas = document.createElement('canvas');
  workCanvas.width = VIDEO_VIEWPORT.width;
  workCanvas.height = VIDEO_VIEWPORT.height;
  const context = workCanvas.getContext('2d', { alpha: false });
  if (!outputContext || !context) throw new Error('プレビュー用Canvasを作成できませんでした。');

  const mapContainer = document.createElement('div');
  Object.assign(mapContainer.style, { position: 'fixed', left: '-20000px', top: '0', width: `${VIDEO_VIEWPORT.width}px`, height: `${VIDEO_VIEWPORT.height}px`, pointerEvents: 'none' });
  document.body.appendChild(mapContainer);
  const controller = new AbortController();
  const videoMap = createVideoMapSession(mapContainer, controller.signal);
  const pointIndexById = new Map(options.points.map((point, index) => [point.id, index]));
  const dayMarkers = prepareVideoDayMarkers(options.dayMarkers ?? [], pointIndexById);
  const dayNumberByPointId = options.dayNumberByPointId ?? buildRoutePointDayNumbers(options.points, options.dayMarkers ?? []);
  let drawingOptions: FrameDrawingOptions = options;
  let balloonsResolved = false;
  let eventProjector: ReturnType<typeof createVideoEventProjector> | null = null;
  let events: VideoEvent[] | null = null;
  let displayedState: FrameState | null = null;
  let overviewBackground: ImageBitmap | null = null;
  let overviewData: ReturnType<typeof prepareOverviewFrameData> | null = null;
  let dynamicBackground: { bitmap: ImageBitmap; key: string; map: MapLibreMap; introEndReady: boolean } | null = null;
  let preparedMap: MapLibreMap | null = null;
  let preparedCameraKey = '';
  let latestRequestId = 0;
  let pending: FrameRequest | null = null;
  let running = false;
  let disposed = false;
  let finishDisposal!: () => void;
  const disposalDone = new Promise<void>((resolve) => { finishDisposal = resolve; });

  const ensureActive = () => {
    if (disposed || controller.signal.aborted) throw new DOMException('プレビュー描画をキャンセルしました。', 'AbortError');
  };
  const isCurrent = (request: FrameRequest) => !disposed && request.id === latestRequestId;
  const discarded = (request: FrameRequest, error?: unknown): PreviewFrameResult => ({
    status: 'discarded', requestId: request.id, frameIndex: request.frameIndex,
    reason: disposed ? 'disposed' : 'superseded', error,
  });
  const invalidateBackgrounds = () => {
    overviewBackground?.close();
    overviewBackground = null;
    overviewData = null;
    dynamicBackground?.bitmap.close();
    dynamicBackground = null;
    preparedMap = null;
    preparedCameraKey = '';
  };
  const releaseResources = () => {
    videoMap.dispose();
    invalidateBackgrounds();
    workCanvas.width = 0;
    workCanvas.height = 0;
    mapContainer.remove();
    finishDisposal();
  };
  const dispose = () => {
    if (disposed) return disposalDone;
    disposed = true;
    controller.abort();
    options.signal?.removeEventListener('abort', dispose);
    if (pending) {
      pending.resolve(discarded(pending));
      pending = null;
    }
    // Do not remove the map or staging Canvas under an in-flight prepare/bitmap.
    if (!running) releaseResources();
    return disposalDone;
  };
  options.signal?.addEventListener('abort', dispose, { once: true });

  const assertMapHealthy = () => {
    if (videoMap.hasError()) throw new Error('プレビュー用の地図背景を取得できませんでした。');
  };
  const prepareCamera = async (camera: VideoCamera, force = false) => {
    ensureActive();
    if (videoMap.hasError()) invalidateBackgrounds();
    const key = cameraKey(camera);
    if (!force && preparedMap && preparedCameraKey === key) return preparedMap;
    const map = await videoMap.prepare(camera);
    ensureActive();
    // A retry may replace the map, so prior backgrounds must be revalidated.
    if (preparedMap && preparedMap !== map) invalidateBackgrounds();
    preparedMap = map;
    preparedCameraKey = key;
    return map;
  };
  const captureBackground = async (map: MapLibreMap, request: FrameRequest) => {
    assertMapHealthy();
    context.drawImage(map.getCanvas(), 0, 0, VIDEO_VIEWPORT.width, VIDEO_VIEWPORT.height);
    const bitmap = await createImageBitmap(workCanvas);
    if (!isCurrent(request)) {
      bitmap.close();
      return null;
    }
    try { assertMapHealthy(); } catch (error) { bitmap.close(); throw error; }
    return bitmap;
  };

  const drawRequestedFrame = async (request: FrameRequest) => {
    const state = sampleFrame(framePlan, request.frameIndex);
    if (videoMap.hasError()) invalidateBackgrounds();
    if (!balloonsResolved) {
      // Match MP4's migration camera even when the first request is mid-video.
      const initialCamera = framePlan.cameraMode === 'overview' ? framePlan.overviewCamera : {
        ...framePlan.initialPlayback.cameraCenter, zoom: framePlan.initialPlayback.zoom,
        bearing: framePlan.initialPlayback.bearing, pitch: framePlan.initialPlayback.pitch,
      };
      const map = await prepareCamera(initialCamera);
      if (!isCurrent(request)) return;
      assertMapHealthy();
      drawingOptions = resolveVideoBalloons(options, map, context,
        framePlan.cameraMode === 'overview' ? framePlan.overviewCamera : createOverviewCamera(options.points)!,
        framePlan.cameraMode === 'follow' ? framePlan.followCameraPlan : null);
      balloonsResolved = true;
      eventProjector = createVideoEventProjector(map);
    }

    if (state.cameraMode === 'overview' && state.renderPath === 'static') {
      if (!overviewBackground || !overviewData) {
        // Fixed projection and background are retained when seeking back to intro.
        const map = await prepareCamera(state.camera);
        if (!isCurrent(request)) return;
        const bitmap = await captureBackground(map, request);
        if (!bitmap) return;
        if (!isCurrent(request)) { bitmap.close(); return; }
        try {
          overviewData = prepareOverviewFrameData(drawingOptions, map, pointIndexById, dayNumberByPointId);
        } catch (error) {
          bitmap.close();
          throw error;
        }
        overviewBackground?.close();
        overviewBackground = bitmap;
      }
      const { pixels, routeSegments, annotations, dayMarkers: overviewDayMarkers } = overviewData;
      drawVideoFrame(context, prepareOverviewFrameScene(overviewBackground, pixels, routeSegments, drawingOptions.points,
        state.routeProgress, options.revealRoute, annotations, overviewDayMarkers, options.routeMarkerMode ?? 'day',
        options.annotationStyle ?? DEFAULT_ANNOTATION_STYLE, options.endpointMarkerPlacements ?? {}, options.distanceHud,
        options.dayRouteColorsEnabled ?? false, state.pausePointIndex, frameClockText(drawingOptions, state)));
    } else {
      // Preserve MP4's final intro readiness check once, then reuse that capture.
      const lastIntroFrame = state.introZoomProgress !== null && state.frameIndex === framePlan.preFrames - 1;
      const map = await prepareCamera(state.camera, lastIntroFrame && !dynamicBackground?.introEndReady);
      if (!isCurrent(request)) return;
      assertMapHealthy();
      const key = cameraKey(state.camera);
      if (!dynamicBackground || dynamicBackground.key !== key || dynamicBackground.map !== map
        || (lastIntroFrame && !dynamicBackground.introEndReady)) {
        const bitmap = await captureBackground(map, request);
        if (!bitmap) return;
        if (!isCurrent(request)) { bitmap.close(); return; }
        dynamicBackground?.bitmap.close();
        dynamicBackground = { bitmap, key, map, introEndReady: lastIntroFrame };
      }
      // Overview intro uses Follow composition with its original reveal setting;
      // actual Follow output always reveals the travelled route, as in MP4.
      drawVideoFrame(context, prepareFollowFrameScene(dynamicBackground.bitmap, map, drawingOptions.points, state.playback,
        dayMarkers, options.routeMarkerMode ?? 'day', options.annotationStyle ?? DEFAULT_ANNOTATION_STYLE,
        options.endpointMarkerPlacements ?? {}, state.cameraMode === 'follow' ? true : options.revealRoute,
        options.distanceHud, dayNumberByPointId, options.dayRouteColorsEnabled ?? false, frameClockText(drawingOptions, state)));
    }
    return state;
  };

  const processRequests = async () => {
    if (running) return;
    running = true;
    try {
      while (pending && !disposed) {
        const request = pending;
        pending = null;
        try {
          const state = await drawRequestedFrame(request);
          if (!state || !isCurrent(request)) {
            request.resolve(discarded(request));
          } else {
            assertMapHealthy();
            // Publish only a complete, current frame; failures leave output intact.
            outputContext.drawImage(workCanvas, 0, 0);
            displayedState = state;
            request.resolve({ status: 'rendered', requestId: request.id, canvas, state });
          }
        } catch (error) {
          invalidateBackgrounds();
          // Restore staging state after a possibly interrupted Canvas operation.
          if (!disposed) {
            workCanvas.width = VIDEO_VIEWPORT.width;
            workCanvas.height = VIDEO_VIEWPORT.height;
          }
          if (!isCurrent(request)) request.resolve(discarded(request, error));
          else request.reject(error);
        }
      }
    } finally {
      running = false;
      if (disposed) releaseResources();
    }
  };

  const renderFrame = async (requestedFrameIndex: number): Promise<PreviewFrameResult> => {
    ensureActive();
    const frameIndex = Number.isNaN(requestedFrameIndex) ? 0
      : Math.max(0, Math.min(framePlan.totalFrames - 1, Math.floor(requestedFrameIndex)));
    const id = ++latestRequestId;
    return new Promise<PreviewFrameResult>((resolve, reject) => {
      if (pending) pending.resolve(discarded(pending));
      pending = { id, frameIndex, resolve, reject };
      void processRequests();
    });
  };

  const cancelPendingFrames = () => {
    latestRequestId += 1;
    if (pending) { pending.resolve(discarded(pending)); pending = null; }
    return displayedState;
  };
  const getEvents = () => {
    ensureActive();
    if (!eventProjector) throw new Error('映像の準備が完了していません。');
    return events ??= buildVideoEvents(framePlan, drawingOptions, eventProjector);
  };
  return { framePlan, renderFrame, cancelPendingFrames, getDisplayedState: () => displayedState, getEvents, dispose };
}
