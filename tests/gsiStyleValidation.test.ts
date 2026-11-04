import { describe, expect, it, vi } from 'vitest';
import { validateStyleMin } from '@maplibre/maplibre-gl-style-spec';
import { GSI_DEM_SOURCE_ID, GSI_HILLSHADE_LAYER_ID, GSI_LOW_ZOOM_LAND_SOURCE_ID, GSI_STYLE, GSI_TERRAIN_TINT_LAYER_ID } from '../src/map/gsiStyle';
import { removeTerrainTint } from '../src/map/gsiTerrainTint';
import { GSI_COLOR_CONFIG } from '../src/map/gsiColorConfig';
import { GSI_VECTOR_CONFIG } from '../src/map/gsiVectorConfig';
import { GSI_ZOOM_CONFIG } from '../src/map/gsiZoomConfig';
import type { Map } from 'maplibre-gl';

describe('GSI style', () => {
  it('passes MapLibre style validation without undefined properties', () => {
    expect(validateStyleMin(GSI_STYLE)).toEqual([]);
    const check = (value: unknown): void => {
      expect(value).not.toBeUndefined();
      if (value && typeof value === 'object') Object.values(value).forEach(check);
    };
    GSI_STYLE.layers.forEach(check);
  });

  it('supplements municipality names below zoom 10 behind official labels', () => {
    const index = GSI_STYLE.layers.findIndex((layer) => layer.id === 'gsi-lowzoom-municipality-label');
    expect(GSI_STYLE.layers[index]).toMatchObject({
      type: 'symbol', source: GSI_LOW_ZOOM_LAND_SOURCE_ID, 'source-layer': 'Anno',
      minzoom: GSI_ZOOM_CONFIG.labels.lowZoomMunicipalityName, maxzoom: 10,
      filter: ['in', 'vt_code', 1301, 1302, 1303],
      layout: { 'text-field': '{vt_text}', 'text-font': ['NotoSansCJKjp-Regular'], 'text-size': ['match', ['get', 'vt_code'], 1301, 13, 1302, 11, 10] },
      paint: { 'text-color': GSI_COLOR_CONFIG.placeLabel, 'text-halo-color': GSI_COLOR_CONFIG.labelHalo },
    });
    expect(index).toBeLessThan(GSI_STYLE.layers.findIndex((layer) => layer.id === 'gsibv-vectortile-layer-1515'));
  });

  it('shows only the overview prefectural boundary layers and stops them at zoom 10', () => {
    const boundaries = GSI_STYLE.layers.filter((layer) => 'source-layer' in layer && layer['source-layer'] === 'boundary');
    expect(boundaries.map((layer) => layer.id)).toEqual(['gsibv-vectortile-layer-893', 'gsibv-vectortile-layer-896']);
    expect(boundaries.map((layer) => layer.maxzoom)).toEqual([10, 8]);
    for (const layer of boundaries) expect(layer.paint).toMatchObject({ 'line-color': GSI_COLOR_CONFIG.boundary, 'line-opacity': GSI_VECTOR_CONFIG.lines.overviewBoundaryOpacity });
  });

  it('places hillshade above the color relief and removes both before the DEM fallback', () => {
    const tint = GSI_STYLE.layers.findIndex((layer) => layer.id === GSI_TERRAIN_TINT_LAYER_ID);
    expect(GSI_STYLE.layers[tint + 1]).toMatchObject({ id: GSI_HILLSHADE_LAYER_ID, type: 'hillshade', source: GSI_DEM_SOURCE_ID });
    const removeLayer = vi.fn();
    const removeSource = vi.fn();
    removeTerrainTint({ getLayer: () => true, getSource: () => true, removeLayer, removeSource } as unknown as Map);
    expect(removeLayer.mock.calls).toEqual([[GSI_HILLSHADE_LAYER_ID], [GSI_TERRAIN_TINT_LAYER_ID]]);
    expect(removeLayer.mock.invocationCallOrder[1]).toBeLessThan(removeSource.mock.invocationCallOrder[0]);
  });
});
