import type { StyleSpecification } from 'maplibre-gl';

export const GSI_ATTRIBUTION = '国土地理院';

export const GSI_STYLE: StyleSpecification = {
  version: 8,
  sources: {
    gsi: {
      type: 'raster',
      tiles: ['https://cyberjapandata.gsi.go.jp/xyz/std/{z}/{x}/{y}.png'],
      tileSize: 256,
      maxzoom: 18,
      attribution: '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank" rel="noopener">国土地理院</a>',
    },
  },
  layers: [{ id: 'gsi-background', type: 'raster', source: 'gsi' }],
};
