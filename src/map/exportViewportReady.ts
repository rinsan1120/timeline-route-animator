import type { ErrorEvent, Map as MapLibreMap } from 'maplibre-gl';
import { GSI_REQUIRED_VECTOR_SOURCE_IDS } from './gsiStyle';
import { isTerrainTintError } from './gsiTerrainTint';

/** Accept only a rendered idle frame after the caller's last camera change. */
export function waitForExportViewportReady(
  map: MapLibreMap,
  timeout: number,
  getLoadError: () => Error | null,
  errorMessage: string,
  signal?: AbortSignal,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      window.clearTimeout(timer);
      map.off('idle', onIdle);
      map.off('error', onError);
      signal?.removeEventListener('abort', onAbort);
    };
    const fail = (error: unknown) => { cleanup(); reject(error); };
    const onError = (event: ErrorEvent) => {
      if (!isTerrainTintError(event)) fail(getLoadError() ?? new Error(errorMessage));
    };
    const onAbort = () => fail(new DOMException('動画生成をキャンセルしました。', 'AbortError'));
    const onIdle = () => {
      try {
        const error = getLoadError();
        if (error) return fail(error);
        // An idle event before the style is ready cannot prove a source is missing.
        if (!map.isStyleLoaded()) return;
        for (const sourceId of GSI_REQUIRED_VECTOR_SOURCE_IDS) {
          if (!map.getSource(sourceId)) return fail(new Error(errorMessage));
        }
        // Optional DEM errors/timeouts remove only DEM through the existing fallback.
        if (!map.loaded() || !map.areTilesLoaded()
          || !GSI_REQUIRED_VECTOR_SOURCE_IDS.every((sourceId) => map.isSourceLoaded(sourceId))) return;
        cleanup();
        resolve();
      } catch (error) { fail(error); }
    };
    const timer = window.setTimeout(() => fail(new Error(errorMessage)), timeout);
    map.on('idle', onIdle);
    map.on('error', onError);
    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) return onAbort();
    const error = getLoadError();
    if (error) return fail(error);
    try { map.triggerRepaint(); } catch (error) { fail(error); }
  });
}
