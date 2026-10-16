import { DEFAULT_ANNOTATION_STYLE } from '../route/annotationStyle';
import { buildRoutePointDayNumbers } from '../route/dayRouteColor';
import { buildFramePlan, sampleFrame } from './frameTimeline';
import { drawVideoFrame } from './frameRenderer';
import { frameClockText, prepareFollowFrameScene, prepareOverviewFrameData, prepareOverviewFrameScene, prepareVideoDayMarkers, resolveVideoBalloons, type FrameDrawingOptions } from './frameScene';
import { createOverviewCamera, VIDEO_VIEWPORT } from './overviewCamera';
import { createVideoMapSession } from './videoMapSession';

export interface PreviewFrameOptions extends FrameDrawingOptions {
  signal?: AbortSignal;
}

// The caller supplies the output Canvas and awaits each request before the next.
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
  const context = canvas.getContext('2d', { alpha: false });
  if (!context) throw new Error('プレビュー用Canvasを作成できませんでした。');

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
  let overviewBackground: ImageBitmap | null = null;
  let overviewData: ReturnType<typeof prepareOverviewFrameData> | null = null;
  let disposed = false;

  const ensureActive = () => {
    if (disposed || controller.signal.aborted) throw new DOMException('プレビュー描画をキャンセルしました。', 'AbortError');
  };
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    controller.abort();
    options.signal?.removeEventListener('abort', dispose);
    videoMap.dispose();
    overviewBackground?.close();
    overviewBackground = null;
    overviewData = null;
    mapContainer.remove();
  };
  options.signal?.addEventListener('abort', dispose, { once: true });

  const renderFrame = async (requestedFrameIndex: number) => {
    ensureActive();
    const frameIndex = Number.isNaN(requestedFrameIndex) ? 0
      : Math.max(0, Math.min(framePlan.totalFrames - 1, Math.floor(requestedFrameIndex)));
    const state = sampleFrame(framePlan, frameIndex);
    if (!balloonsResolved) {
      // Match MP4's migration camera even when the first request is mid-video.
      const initialCamera = framePlan.cameraMode === 'overview' ? framePlan.overviewCamera : {
        ...framePlan.initialPlayback.cameraCenter, zoom: framePlan.initialPlayback.zoom,
        bearing: framePlan.initialPlayback.bearing, pitch: framePlan.initialPlayback.pitch,
      };
      const map = await videoMap.prepare(initialCamera);
      ensureActive();
      drawingOptions = resolveVideoBalloons(options, map, context,
        framePlan.cameraMode === 'overview' ? framePlan.overviewCamera : createOverviewCamera(options.points)!,
        framePlan.cameraMode === 'follow' ? framePlan.followCameraPlan : null);
      balloonsResolved = true;
    }

    if (state.cameraMode === 'overview' && state.renderPath === 'static') {
      if (!overviewBackground || !overviewData) {
        // Fixed projection and background are retained when seeking back to intro.
        const map = await videoMap.prepare(state.camera);
        ensureActive();
        context.drawImage(map.getCanvas(), 0, 0, VIDEO_VIEWPORT.width, VIDEO_VIEWPORT.height);
        const bitmap = await createImageBitmap(canvas);
        if (disposed || controller.signal.aborted) {
          bitmap.close();
          ensureActive();
        }
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
      const map = await videoMap.prepare(state.camera);
      ensureActive();
      // Overview intro uses Follow composition with its original reveal setting;
      // actual Follow output always reveals the travelled route, as in MP4.
      drawVideoFrame(context, prepareFollowFrameScene(map.getCanvas(), map, drawingOptions.points, state.playback,
        dayMarkers, options.routeMarkerMode ?? 'day', options.annotationStyle ?? DEFAULT_ANNOTATION_STYLE,
        options.endpointMarkerPlacements ?? {}, state.cameraMode === 'follow' ? true : options.revealRoute,
        options.distanceHud, dayNumberByPointId, options.dayRouteColorsEnabled ?? false, frameClockText(drawingOptions, state)));
    }
    return { canvas, state };
  };

  return { framePlan, renderFrame, dispose };
}
