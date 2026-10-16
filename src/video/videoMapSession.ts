import * as maplibregl from 'maplibre-gl';
import { GSI_STYLE } from '../map/gsiStyle';
import { installTerrainTintFallback, isTerrainTintError } from '../map/gsiTerrainTint';
import { waitForExportViewportReady } from '../map/exportViewportReady';
import type { VideoCamera } from './overviewCamera';

// The caller owns the container and calls prepare sequentially.
const styleReadyMaps = new WeakSet<maplibregl.Map>();
const VIDEO_MAP_TIMEOUT = 20_000;
const VIDEO_MAP_ERROR = '動画用の地図データを完全に読み込めませんでした。通信状況を確認して、もう一度MP4を生成してください。';

// Only map preparation is retried; successful maps and captured backgrounds are reused.
export function createVideoMapSession(container: HTMLElement, signal?: AbortSignal) {
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
