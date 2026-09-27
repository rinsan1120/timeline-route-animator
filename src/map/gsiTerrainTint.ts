import type { ErrorEvent, Map as MapLibreMap, MapSourceDataEvent } from 'maplibre-gl';
import { GSI_DEM_SOURCE_ID, GSI_TERRAIN_TINT_LAYER_ID } from './gsiStyle';

export function isTerrainTintError(event: ErrorEvent): boolean {
  // MapLibre 6.7 Style.addSourceのevented parentがsourceIdを付加する。
  // ErrorEventの宣言にはないため、実際に付加された値だけを判定する。
  return 'sourceId' in event && event.sourceId === GSI_DEM_SOURCE_ID;
}

export function removeTerrainTint(map: MapLibreMap): void {
  if (map.getLayer(GSI_TERRAIN_TINT_LAYER_ID)) map.removeLayer(GSI_TERRAIN_TINT_LAYER_ID);
  if (map.getSource(GSI_DEM_SOURCE_ID)) map.removeSource(GSI_DEM_SOURCE_ID);
}

/** DEMだけの失敗・長時間待機は、この地図の標高色を外してVector表示を継続する。 */
export function installTerrainTintFallback(map: MapLibreMap): void {
  let timer: number | undefined;
  let removed = false;
  const clearTimer = () => {
    window.clearTimeout(timer);
    timer = undefined;
  };
  const fallback = () => {
    clearTimer();
    // MapLibreのタイルイベント伝播中にsourceを破棄しない。
    queueMicrotask(() => {
      if (!removed) removeTerrainTint(map);
    });
  };
  const onError = (event: ErrorEvent) => {
    if (isTerrainTintError(event)) fallback();
  };
  const onLoading = (event: MapSourceDataEvent) => {
    if (event.sourceId === GSI_DEM_SOURCE_ID && timer === undefined) {
      timer = window.setTimeout(fallback, 10_000);
    }
  };
  const onRender = () => {
    if (timer !== undefined && (!map.getSource(GSI_DEM_SOURCE_ID) || map.isSourceLoaded(GSI_DEM_SOURCE_ID))) clearTimer();
  };
  map.on('error', onError);
  map.on('sourcedataloading', onLoading);
  map.on('render', onRender);
  map.once('remove', () => {
    removed = true;
    clearTimer();
    map.off('error', onError);
    map.off('sourcedataloading', onLoading);
    map.off('render', onRender);
  });
}
