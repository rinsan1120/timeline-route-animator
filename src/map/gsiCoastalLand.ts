import { classifyRings, VectorTile } from '@mapbox/vector-tile';
import { PbfReader, PbfWriter } from 'pbf';
import type { AddProtocolAction } from 'maplibre-gl';
import { GSI_VECTOR_CONFIG } from './gsiVectorConfig';
import { GSI_ZOOM_CONFIG } from './gsiZoomConfig';

export const GSI_COASTAL_LAND_SOURCE_LAYER = 'GsiCoastalLand';
type Point = { x: number; y: number };

function writePolygon(rings: Point[][], writer: PbfWriter) {
  writer.writeVarintField(3, 3); // MVT Polygon
  const geometry = new PbfWriter();
  let x = 0;
  let y = 0;
  for (const ring of rings) {
    const points = ring.slice(0, -1); // ClosePath supplies the repeated endpoint.
    geometry.writeVarint(9); // MoveTo, count 1
    geometry.writeSVarint(points[0].x - x);
    geometry.writeSVarint(points[0].y - y);
    x = points[0].x;
    y = points[0].y;
    geometry.writeVarint(((points.length - 1) << 3) | 2); // LineTo
    for (const point of points.slice(1)) {
      geometry.writeSVarint(point.x - x);
      geometry.writeSVarint(point.y - y);
      x = point.x;
      y = point.y;
    }
    geometry.writeVarint(15); // ClosePath
  }
  writer.writeBytesField(4, geometry.finish());
}

/** Supplement missing mid-zoom AdmArea without changing any original tile layers. */
export function supplementCoastalLand(data: Uint8Array): Uint8Array {
  if (!data.length) return data; // Unaddressed ocean tiles are valid empty tiles.
  const tile = new VectorTile(new PbfReader(data));
  const water = tile.layers.WA;
  if (!water || tile.layers[GSI_COASTAL_LAND_SOURCE_LAYER]) return data;
  const land: Point[][][] = [];
  for (let i = 0; i < water.length; i++) {
    const feature = water.feature(i);
    // Only sea polygons; inland lakes/rivers must never create rectangular land.
    if (feature.type !== 3 || feature.properties.vt_code !== 5101) continue;
    for (const [ocean, ...islands] of classifyRings(feature.loadGeometry())) {
      let west = Infinity, east = -Infinity, north = Infinity, south = -Infinity;
      for (const point of ocean) {
        west = Math.min(west, point.x); east = Math.max(east, point.x);
        north = Math.min(north, point.y); south = Math.max(south, point.y);
      }
      // Complement only inside the sea's own envelope, never the entire tile:
      // the sea data ends at e.g. 46°N, while everything beyond it is still ocean.
      land.push([
        [{ x: west, y: north }, { x: east, y: north }, { x: east, y: south }, { x: west, y: south }, { x: west, y: north }],
        [...ocean].reverse(),
      ]);
      // Sea holes are islands. Reverse their winding into independent land faces.
      for (const island of islands) land.push([[...island].reverse()]);
    }
  }
  if (!land.length) return data;
  const supplement = new PbfWriter();
  supplement.writeMessage(3, (_, layer) => {
    layer.writeStringField(1, GSI_COASTAL_LAND_SOURCE_LAYER);
    for (const polygon of land) layer.writeMessage(2, writePolygon, polygon);
    layer.writeVarintField(5, water.extent);
    layer.writeVarintField(15, 2);
  }, null);
  const extra = supplement.finish();
  const result = new Uint8Array(data.length + extra.length);
  result.set(data);
  result.set(extra, data.length);
  return result;
}

export function withGsiCoastalLand(protocol: AddProtocolAction): AddProtocolAction {
  return async (params, abortController) => {
    const result = await protocol(params, abortController);
    const prefix = `pmtiles://${GSI_VECTOR_CONFIG.lowZoomLand.pmtilesUrl}/`;
    if (params.type !== 'json' && params.url.startsWith(prefix) && result.data instanceof Uint8Array) {
      const zoom = Number(params.url.slice(prefix.length).split('/')[0]);
      if (zoom >= GSI_ZOOM_CONFIG.lowZoomLand.maxZoom && zoom < GSI_ZOOM_CONFIG.lowZoomLand.detailedLandMinZoom) {
        return { ...result, data: supplementCoastalLand(result.data) };
      }
    }
    return result;
  };
}
