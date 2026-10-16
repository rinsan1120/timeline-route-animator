import { LngLat, type Map as MapLibreMap, type Point } from 'maplibre-gl';
import { DEFAULT_ANNOTATION_STYLE } from '../route/annotationStyle';
import { loadDayMarkerFonts } from '../route/dayMarkerStyle';
import { annotationLayout, isAnnotationAnchorVisible, type CanvasAnnotation } from '../route/annotationCanvas';
import type { BalloonFramePosition } from '../popup/placement';
import { buildRoutePointDayNumbers } from '../route/dayRouteColor';
import { buildFramePlan, getFrameIndexAtTime, sampleFrame, type FramePlan, type FrameState } from './frameTimeline';
import { drawVideoFrame, type VideoFrameScene } from './frameRenderer';
import { frameClockText, prepareFollowFrameScene, prepareOverviewFrameData, prepareOverviewFrameScene, prepareVideoDayMarkers, resolveVideoBalloons, type FrameDrawingOptions } from './frameScene';
import { createOverviewCamera, VIDEO_VIEWPORT, type VideoCamera } from './overviewCamera';
import { createVideoMapSession } from './videoMapSession';
import { buildVideoEvents, createVideoEventProjector, type VideoEvent } from './videoEvents';
import { sameFramePlanInputs, samePlaybackTiming, sameRouteGeometry } from './previewUpdates';

export interface PreviewFrameOptions extends FrameDrawingOptions {
  signal?: AbortSignal;
}

export interface PreviewBalloon {
  pointId: string;
  annotation: CanvasAnnotation;
  rect: { left: number; top: number; width: number; height: number };
}

export type PreviewFrameResult =
  | { status: 'rendered'; requestId: number; canvas: HTMLCanvasElement; state: FrameState; framePlan: FramePlan; events?: VideoEvent[]; eventAnchorId?: string | null }
  | { status: 'discarded'; requestId: number; frameIndex: number; reason: 'superseded' | 'disposed'; error?: unknown };

interface FrameRequest {
  id: number;
  frameIndex: number;
  options: PreviewFrameOptions;
  position?: PreviewPosition;
  eventAnchorId?: string | null;
  resolve: (result: PreviewFrameResult) => void;
  reject: (error: unknown) => void;
}

export interface PreviewPosition {
  timeSeconds: number;
  frameIndex: number;
  eventAnchorId: string | null;
  framePlan: FramePlan | null;
  forceEvent?: boolean;
}

// Cache scope fixes GSI_STYLE and pixelRatio=1 for the lifetime of the session.
function cameraKey(camera: VideoCamera): string {
  return `GSI_STYLE:${VIDEO_VIEWPORT.width}x${VIDEO_VIEWPORT.height}:1:${camera.longitude}:${camera.latitude}:${camera.zoom}:${camera.bearing}:${camera.pitch}`;
}

// The caller supplies the output Canvas; concurrent requests keep only the latest.
// Setting updates share this same serial queue with frame requests.
function validateOptions(options: PreviewFrameOptions) {
  if (!Number.isInteger(options.duration) || options.duration < 5 || options.duration > 120) throw new Error('移動時間は5〜120秒の整数で指定してください。');
  if (options.points.length < 2) throw new Error('動画生成には2点以上のルートが必要です。');
  const customZoom = options.overviewZoomMode === 'custom' ? options.overviewCustomZoom ?? 10 : undefined;
  if (options.cameraMode !== 'follow' && customZoom !== undefined && (!Number.isFinite(customZoom) || customZoom < 4 || customZoom > 16)) throw new Error('Zoomは4.0〜16.0で指定してください。');
  if (options.signal?.aborted) throw new DOMException('プレビュー描画をキャンセルしました。', 'AbortError');
}

export function createPreviewFrameRenderer(canvas: HTMLCanvasElement, options: PreviewFrameOptions) {
  validateOptions(options);
  let framePlan = buildFramePlan(options);
  let desiredOptions = options;
  const externalSignal = options.signal;
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
  let pointIndexById = new Map(options.points.map((point, index) => [point.id, index]));
  let dayMarkers = prepareVideoDayMarkers(options.dayMarkers ?? [], pointIndexById);
  let dayNumberByPointId = options.dayNumberByPointId ?? buildRoutePointDayNumbers(options.points, options.dayMarkers ?? []);
  let drawingOptions: FrameDrawingOptions = options;
  let dayFontsReady: Promise<void> | null = null;
  let balloonsResolved = false;
  let eventProjector: ReturnType<typeof createVideoEventProjector> | null = null;
  let events: VideoEvent[] | null = null;
  let displayedState: FrameState | null = null;
  let displayedPlan: FramePlan | null = null;
  let displayedScene: VideoFrameScene | null = null;
  let draftScene: VideoFrameScene | null = null;
  const retiredBackgrounds = new Set<ImageBitmap>();
  let overviewBackground: ImageBitmap | null = null;
  let overviewBackgroundKey = '';
  let overviewPixels: Point[] | null = null;
  let overviewData: ReturnType<typeof prepareOverviewFrameData> | null = null;
  let dynamicBackground: { bitmap: ImageBitmap; key: string; map: MapLibreMap; introEndReady: boolean } | null = null;
  let preparedMap: MapLibreMap | null = null;
  let preparedCameraKey = '';
  let projectionKey = '';
  let projectionMap: MapLibreMap | null = null;
  const projections = new Map<string, Point>();
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
  const retireBackground = (bitmap?: ImageBitmap | null) => {
    if (!bitmap) return;
    if (bitmap === displayedScene?.background) retiredBackgrounds.add(bitmap);
    else bitmap.close();
  };
  const invalidateBackgrounds = () => {
    retireBackground(overviewBackground);
    overviewBackground = null;
    overviewBackgroundKey = '';
    overviewData = null;
    overviewPixels = null;
    retireBackground(dynamicBackground?.bitmap);
    dynamicBackground = null;
    preparedMap = null;
    preparedCameraKey = '';
    projectionMap = null;
    projections.clear();
  };
  const releaseResources = () => {
    videoMap.dispose();
    displayedScene = null;
    draftScene = null;
    invalidateBackgrounds();
    retiredBackgrounds.forEach((bitmap) => bitmap.close());
    retiredBackgrounds.clear();
    workCanvas.width = 0;
    workCanvas.height = 0;
    mapContainer.remove();
    finishDisposal();
  };
  const dispose = () => {
    if (disposed) return disposalDone;
    disposed = true;
    controller.abort();
    externalSignal?.removeEventListener('abort', dispose);
    if (pending) {
      pending.resolve(discarded(pending));
      pending = null;
    }
    // Do not remove the map or staging Canvas under an in-flight prepare/bitmap.
    if (!running) releaseResources();
    return disposalDone;
  };
  externalSignal?.addEventListener('abort', dispose, { once: true });

  const applyOptions = (next: PreviewFrameOptions) => {
    if (next === options) return;
    validateOptions(next);
    if (options.dayMarkers !== next.dayMarkers || options.routeMarkerMode !== next.routeMarkerMode
      || options.annotationStyle?.fontScale !== next.annotationStyle?.fontScale) dayFontsReady = null;
    const geometryChanged = !sameRouteGeometry(options.points, next.points);
    const reuseFollow = !geometryChanged && framePlan.cameraMode === 'follow' && next.cameraMode === 'follow'
      && options.duration === next.duration && options.followZoomPreset === next.followZoomPreset
      && options.followCustomZoom === next.followCustomZoom && options.followViewMode === next.followViewMode;
    const nextPlan = sameFramePlanInputs(options, next) ? framePlan : buildFramePlan({ ...next,
      followCameraPlan: next.followCameraPlan ?? (reuseFollow && framePlan.cameraMode === 'follow' ? framePlan.followCameraPlan : undefined) });
    const eventsChanged = nextPlan !== framePlan || options.points !== next.points || options.dayMarkers !== next.dayMarkers
      || options.routeMarkerMode !== next.routeMarkerMode;
    const sceneChanged = options.points !== next.points || options.dayMarkers !== next.dayMarkers
      || options.dayRouteColorsEnabled !== next.dayRouteColorsEnabled || options.dayNumberByPointId !== next.dayNumberByPointId;
    const resolvedPoints = drawingOptions.points;
    const samePoints = options.points === next.points;
    options = next;
    framePlan = nextPlan;
    drawingOptions = { ...options, points: samePoints ? resolvedPoints : options.points };
    if (!samePoints) balloonsResolved = false;
    if (sceneChanged) overviewData = null;
    if (geometryChanged) { projections.clear(); overviewPixels = null; }
    pointIndexById = new Map(options.points.map((point, index) => [point.id, index]));
    dayMarkers = prepareVideoDayMarkers(options.dayMarkers ?? [], pointIndexById);
    dayNumberByPointId = options.dayNumberByPointId ?? buildRoutePointDayNumbers(options.points, options.dayMarkers ?? []);
    if (eventsChanged) events = null;
  };

  const cachedProjection = (map: MapLibreMap, camera: VideoCamera): Pick<MapLibreMap, 'project'> => {
    const key = cameraKey(camera);
    if (projectionMap !== map || projectionKey !== key) {
      projections.clear(); projectionMap = map; projectionKey = key;
    }
    return { project: (location) => {
      const point = LngLat.convert(location);
      const pointKey = `${point.lng}:${point.lat}`;
      let pixel = projections.get(pointKey);
      if (!pixel) { pixel = map.project(location); projections.set(pointKey, pixel); }
      return pixel;
    } };
  };

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
    applyOptions(request.options);
    dayFontsReady ??= (options.routeMarkerMode ?? 'day') === 'day'
      ? loadDayMarkerFonts(options.dayMarkers ?? [], options.annotationStyle) : Promise.resolve();
    await dayFontsReady;
    if (!isCurrent(request)) return;
    if (videoMap.hasError()) invalidateBackgrounds();
    if (!balloonsResolved) {
      // Match MP4's migration camera even when the first request is mid-video.
      const initialCamera = framePlan.cameraMode === 'overview' ? framePlan.overviewCamera : {
        ...framePlan.initialPlayback.cameraCenter, zoom: framePlan.initialPlayback.zoom,
        bearing: framePlan.initialPlayback.bearing, pitch: framePlan.initialPlayback.pitch,
      };
      // A live update can resolve new labels with a detached reference projector;
      // keep the currently prepared map/background when it is already available.
      const map = preparedMap ?? await prepareCamera(initialCamera);
      if (!isCurrent(request)) return;
      assertMapHealthy();
      drawingOptions = resolveVideoBalloons(options, map, context,
        framePlan.cameraMode === 'overview' ? framePlan.overviewCamera : createOverviewCamera(options.points)!,
        framePlan.cameraMode === 'follow' ? framePlan.followCameraPlan : null);
      balloonsResolved = true;
      eventProjector = createVideoEventProjector(map);
    }

    if (request.position) {
      const { timeSeconds, frameIndex, eventAnchorId, framePlan: previousPlan } = request.position;
      const event = getEvents().find((candidate) => candidate.id === eventAnchorId && candidate.frameIndex !== null);
      request.eventAnchorId = event?.id ?? null;
      request.frameIndex = event && (request.position.forceEvent || previousPlan && !samePlaybackTiming(previousPlan, framePlan))
        ? event.frameIndex! : previousPlan?.fps === framePlan.fps ? frameIndex : getFrameIndexAtTime(framePlan, timeSeconds);
    }
    request.frameIndex = Math.max(0, Math.min(framePlan.totalFrames - 1, request.frameIndex));
    const state = sampleFrame(framePlan, request.frameIndex);
    let scene: VideoFrameScene;

    if (state.cameraMode === 'overview' && state.renderPath === 'static') {
      const key = cameraKey(state.camera);
      if (overviewBackgroundKey !== key) {
        retireBackground(overviewBackground); overviewBackground = null; overviewData = null; overviewPixels = null;
      }
      if (!overviewBackground || !overviewPixels) {
        // Fixed projection and background are retained when seeking back to intro.
        const map = await prepareCamera(state.camera);
        if (!isCurrent(request)) return;
        if (!overviewBackground) {
          const bitmap = await captureBackground(map, request);
          if (!bitmap) return;
          overviewBackground = bitmap;
          overviewBackgroundKey = key;
        }
        if (!overviewPixels) {
          const projection = cachedProjection(map, state.camera);
          overviewPixels = options.points.map((point) => projection.project([point.longitude, point.latitude]));
        }
      }
      // Metadata/color edits use the fixed pixels even if the hidden map was
      // last used for intro: no map move or tile fetch is needed for composition.
      if (!overviewData) overviewData = prepareOverviewFrameData(drawingOptions, preparedMap!, pointIndexById, dayNumberByPointId, overviewPixels);
      const { pixels, routeSegments, annotations, dayMarkers: overviewDayMarkers } = overviewData;
      scene = prepareOverviewFrameScene(overviewBackground, pixels, routeSegments, drawingOptions.points,
        state.routeProgress, options.revealRoute, annotations, overviewDayMarkers, options.routeMarkerMode ?? 'day',
        options.annotationStyle ?? DEFAULT_ANNOTATION_STYLE, options.endpointMarkerPlacements ?? {}, options.distanceHud,
        options.dayRouteColorsEnabled ?? false, state.pausePointIndex, frameClockText(drawingOptions, state));
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
        retireBackground(dynamicBackground?.bitmap);
        dynamicBackground = { bitmap, key, map, introEndReady: lastIntroFrame };
      }
      // Overview intro uses Follow composition with its original reveal setting;
      // actual Follow output always reveals the travelled route, as in MP4.
      scene = prepareFollowFrameScene(dynamicBackground.bitmap, cachedProjection(map, state.camera), drawingOptions.points, state.playback,
        dayMarkers, options.routeMarkerMode ?? 'day', options.annotationStyle ?? DEFAULT_ANNOTATION_STYLE,
        options.endpointMarkerPlacements ?? {}, state.cameraMode === 'follow' ? true : options.revealRoute,
        options.distanceHud, dayNumberByPointId, options.dayRouteColorsEnabled ?? false, frameClockText(drawingOptions, state));
    }
    drawVideoFrame(context, scene);
    return { state, scene };
  };

  const processRequests = async () => {
    if (running) return;
    running = true;
    try {
      while (pending && !disposed) {
        const request = pending;
        pending = null;
        try {
          const rendered = await drawRequestedFrame(request);
          if (!rendered || !isCurrent(request)) {
            request.resolve(discarded(request));
          } else {
            assertMapHealthy();
            // Publish only a complete, current frame; failures leave output intact.
            outputContext.drawImage(workCanvas, 0, 0);
            const { state, scene } = rendered;
            displayedState = state;
            displayedPlan = framePlan;
            displayedScene = scene;
            draftScene = null;
            retiredBackgrounds.forEach((bitmap) => { if (bitmap !== scene.background) bitmap.close(); });
            retiredBackgrounds.clear();
            request.resolve({ status: 'rendered', requestId: request.id, canvas, state, framePlan,
              events: request.position ? getEvents() : undefined, eventAnchorId: request.eventAnchorId });
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

  const enqueue = async (requestedFrameIndex: number, position?: PreviewPosition): Promise<PreviewFrameResult> => {
    ensureActive();
    const frameIndex = Number.isNaN(requestedFrameIndex) ? 0
      : Math.max(0, Math.min(framePlan.totalFrames - 1, Math.floor(requestedFrameIndex)));
    const id = ++latestRequestId;
    return new Promise<PreviewFrameResult>((resolve, reject) => {
      if (pending) pending.resolve(discarded(pending));
      pending = { id, frameIndex, options: desiredOptions, position, resolve, reject };
      void processRequests();
    });
  };

  const renderFrame = (frameIndex: number) => enqueue(frameIndex);
  const updateOptions = (next: PreviewFrameOptions, position: PreviewPosition) => {
    desiredOptions = next;
    return enqueue(0, position);
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
  const getDisplayedBalloons = (): PreviewBalloon[] => {
    const scene = draftScene ?? displayedScene;
    if (!scene || disposed) return [];
    context.save();
    try {
      return scene.annotations.flatMap((annotation) => {
        if (!annotation.pointId || annotation.framePosition && !isAnnotationAnchorVisible(annotation.pixel)) return [];
        const { left, top, width, height } = annotationLayout(context, annotation, scene.annotationStyle);
        return [{ pointId: annotation.pointId, annotation, rect: { left, top, width, height } }];
      });
    } finally { context.restore(); }
  };
  const previewBalloonPosition = (pointId: string, position: BalloonFramePosition | null) => {
    ensureActive();
    if (!displayedScene) return [];
    const scene = position ? { ...displayedScene, annotations: displayedScene.annotations.map((annotation) =>
      annotation.pointId === pointId ? { ...annotation, framePosition: position } : annotation) } : displayedScene;
    // A draft only recomposes the published scene: no sampling, map operations,
    // projection, tile requests or mutation of route/history/settings.
    drawVideoFrame(context, scene);
    outputContext.drawImage(workCanvas, 0, 0);
    draftScene = position ? scene : null;
    return getDisplayedBalloons();
  };
  return { get framePlan() { return framePlan; }, renderFrame, updateOptions, cancelPendingFrames,
    getDisplayedState: () => displayedState, getDisplayedPlan: () => displayedPlan, getDisplayedBalloons, previewBalloonPosition, getEvents, dispose };
}
