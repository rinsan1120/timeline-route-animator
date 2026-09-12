import { describe, expect, it } from 'vitest';
import { GSI_STYLE, GSI_LOW_ZOOM_LAND_SOURCE_ID } from './gsiStyle';
import { GSI_OFFICIAL_SOURCE_ID } from './gsiOfficialStyle';
import { GSI_VECTOR_CONFIG as config } from './gsiVectorConfig';

describe('land fallback underneath the detailed map', () => {
  it.each([3.9, 4, 7.9, 8, 8.1, 10, 15, 16])('keeps the correct background and land at zoom %s', (zoom) => {
    const background = GSI_STYLE.layers[0];
    expect(background.type).toBe('background');
    if (background.type !== 'background') throw new Error('Missing background');
    const expression = background.paint?.['background-color'];
    expect(expression).toEqual(['step', ['zoom'], config.colors.background, 4, config.colors.water]);
    const [, , base, boundary, water] = expression as unknown as [string, unknown, string, number, string];
    expect(zoom < boundary ? base : water).toBe(zoom < 4 ? config.colors.background : config.colors.water);
    const land = GSI_STYLE.layers[1];
    expect(land).toMatchObject({ id: 'gsi-lowzoom-land', type: 'fill', source: GSI_LOW_ZOOM_LAND_SOURCE_ID,
      'source-layer': 'AdmArea', minzoom: 4, paint: { 'fill-color': config.colors.background } });
    expect(land).not.toHaveProperty('maxzoom');
    expect(zoom >= land.minzoom! && zoom < (land.maxzoom ?? Infinity)).toBe(zoom >= 4);
  });

  it('retains source ranges and adds only the land fill below the main layers', () => {
    expect(GSI_STYLE.sources[GSI_OFFICIAL_SOURCE_ID]).toMatchObject({ minzoom: 4, maxzoom: 16,
      tiles: ['https://cyberjapandata.gsi.go.jp/xyz/experimental_bvmap/{z}/{x}/{y}.pbf'] });
    expect(GSI_STYLE.sources[GSI_LOW_ZOOM_LAND_SOURCE_ID]).toMatchObject({ minzoom: 4, maxzoom: 16,
      url: 'pmtiles://https://cyberjapandata.gsi.go.jp/xyz/optimal_bvmap-v1/optimal_bvmap-v1.pmtiles' });
    expect(GSI_STYLE.layers.filter(layer => 'source' in layer && layer.source === GSI_LOW_ZOOM_LAND_SOURCE_ID))
      .toEqual([GSI_STYLE.layers[1]]);
    expect(config.zoomTransition.boundaryZoom).toBe(8);
    expect(config.zoomTransition.fadeEndZoom).toBe(9);
  });
});
