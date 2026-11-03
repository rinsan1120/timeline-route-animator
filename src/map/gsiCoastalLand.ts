import { classifyRings, VectorTile } from '@mapbox/vector-tile';
import { PbfReader, PbfWriter } from 'pbf';
import polygonClipping, { type MultiPolygon, type Ring } from 'polygon-clipping';
import type { AddProtocolAction } from 'maplibre-gl';
import { GSI_VECTOR_CONFIG } from './gsiVectorConfig';
import { GSI_ZOOM_CONFIG } from './gsiZoomConfig';

export const GSI_COASTAL_LAND_SOURCE_LAYER = 'GsiCoastalLand';
type Point = { x: number; y: number };
export type GsiTileCoordinate = { z: number; x: number; y: number };

export function coastalLandAncestor(tile: GsiTileCoordinate): GsiTileCoordinate {
  const z = GSI_ZOOM_CONFIG.lowZoomLand.sourceMaxZoom;
  const scale = 2 ** (tile.z - z);
  return { z, x: Math.floor(tile.x / scale), y: Math.floor(tile.y / scale) };
}

const signedArea = (ring: Point[]) => ring.reduce((area, a, i) => {
  const b = ring[(i + 1) % ring.length];
  return area + a.x * b.y - b.x * a.y;
}, 0);

function integerPolygon(polygon: Ring[]): Point[][] {
  const result: Point[][] = [];
  for (let i = 0; i < polygon.length; i++) {
    const ring: Point[] = [];
    for (const [x, y] of polygon[i]) {
      const point = { x: Math.round(x), y: Math.round(y) };
      if (!ring.length || point.x !== ring[ring.length - 1].x || point.y !== ring[ring.length - 1].y) ring.push(point);
    }
    if (ring.length && (ring[0].x !== ring[ring.length - 1].x || ring[0].y !== ring[ring.length - 1].y)) ring.push(ring[0]);
    const area = signedArea(ring);
    if (ring.length < 4 || area === 0) { if (i === 0) return []; else continue; }
    // MVT uses positive outer winding in tile coordinates and negative holes.
    if ((area > 0) !== (i === 0)) ring.reverse();
    result.push(ring);
  }
  return result;
}

function ancestorLand(data: Uint8Array | undefined, tile: GsiTileCoordinate, extent: number): MultiPolygon {
  if (!data?.length) return [];
  const source = new VectorTile(new PbfReader(data)).layers[GSI_VECTOR_CONFIG.lowZoomLand.sourceLayer];
  if (!source) return [];
  const ancestor = coastalLandAncestor(tile);
  const scale = 2 ** (tile.z - ancestor.z);
  const land: MultiPolygon = [];
  for (let i = 0; i < source.length; i++) {
    const feature = source.feature(i);
    if (feature.type !== 3) continue;
    for (const polygon of classifyRings(feature.loadGeometry())) {
      const converted: Ring[] = polygon.map((ring) => ring.map((p) => [
        ((ancestor.x + p.x / source.extent) * scale - tile.x) * extent,
        ((ancestor.y + p.y / source.extent) * scale - tile.y) * extent,
      ]));
      // Most ancestor features are in other children. Avoid boolean operations
      // on those features (and very large coordinates at detailed zoom levels).
      if (converted[0].some(([x]) => x >= -extent) && converted[0].some(([x]) => x <= 2 * extent)
        && converted[0].some(([, y]) => y >= -extent) && converted[0].some(([, y]) => y <= 2 * extent)) land.push(converted);
    }
  }
  return land.length ? polygonClipping.union(land) : [];
}

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
export function supplementCoastalLand(data: Uint8Array, coordinate: GsiTileCoordinate, ancestorData?: Uint8Array): Uint8Array {
  if (!data.length) return data; // Unaddressed ocean tiles are valid empty tiles.
  const tile = new VectorTile(new PbfReader(data));
  const water = tile.layers.WA;
  if (!water || tile.layers[GSI_COASTAL_LAND_SOURCE_LAYER]) return data;
  const land: Point[][][] = [];
  const supportedLand = ancestorLand(ancestorData, coordinate, water.extent);
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
      // A sea envelope is a data boundary, not evidence of land. Clip only its
      // ancestor-backed portion, then cut the detailed sea coastline out of it.
      // A partially supported component must never admit its unsupported rest.
      if (supportedLand.length && east > west && south > north) {
        const envelope: Ring[] = [[[west, north], [east, north], [east, south], [west, south], [west, north]]];
        const supported = polygonClipping.intersection(supportedLand, envelope);
        if (supported.length) {
          const seaRing: Ring = ocean.map((p) => [p.x, p.y]);
          const precise = polygonClipping.difference(supported, [seaRing]);
          for (const polygon of precise) {
            const rounded = integerPolygon(polygon);
            if (rounded.length) land.push(rounded);
          }
        }
      }
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
  const prefix = `pmtiles://${GSI_VECTOR_CONFIG.lowZoomLand.pmtilesUrl}/`;
  const supplement = createCoastalLandSupplement(async (tile, controller) => {
    const result = await protocol({ url: `${prefix}${tile.z}/${tile.x}/${tile.y}`, type: 'arrayBuffer' }, controller);
    if (!(result.data instanceof Uint8Array)) throw new Error('海陸補完用の地図データを読み込めませんでした。');
    return result.data;
  });
  return async (params, abortController) => {
    const result = await protocol(params, abortController);
    if (params.type !== 'json' && params.url.startsWith(prefix) && result.data instanceof Uint8Array) {
      const [zoom, x, y] = params.url.slice(prefix.length).split('/').map(Number);
      if (zoom >= GSI_ZOOM_CONFIG.lowZoomLand.maxZoom && zoom < GSI_ZOOM_CONFIG.lowZoomLand.detailedLandMinZoom) {
        return { ...result, data: await supplement(result.data, { z: zoom, x, y }, abortController.signal) };
      }
    }
    return result;
  };
}

/** Share pending/resolved ancestor data without one Map cancelling another. */
export function createCoastalLandSupplement(read: (tile: GsiTileCoordinate, controller: AbortController) => Promise<Uint8Array | undefined>) {
  type Entry = { controller: AbortController; promise: Promise<Uint8Array | undefined>; users: number; settled: boolean };
  const ancestors = new Map<string, Entry>();
  return async (data: Uint8Array, tile: GsiTileCoordinate, signal: AbortSignal): Promise<Uint8Array> => {
    signal.throwIfAborted();
    if (!data.length) return data;
    const parsed = new VectorTile(new PbfReader(data));
    if (!parsed.layers.WA || parsed.layers[GSI_COASTAL_LAND_SOURCE_LAYER]) return data;
    const ancestor = coastalLandAncestor(tile);
    const key = `${ancestor.z}/${ancestor.x}/${ancestor.y}`;
    let entry = ancestors.get(key);
    if (!entry) {
      const controller = new AbortController();
      entry = { controller, users: 0, settled: false, promise: Promise.resolve(undefined) };
      const pending = entry;
      pending.promise = read(ancestor, controller).then((value) => {
        pending.settled = true;
        // Keep a bounded set of small z7 reference tiles, including valid absence.
        if (ancestors.size > 64) for (const [oldKey, old] of ancestors) {
          if (old.settled && oldKey !== key) { ancestors.delete(oldKey); break; }
        }
        return value;
      }).catch((error) => { if (ancestors.get(key) === pending) ancestors.delete(key); throw error; });
      ancestors.set(key, pending);
    }
    const current = entry;
    current.users++;
    const reference = await new Promise<Uint8Array | undefined>((resolve, reject) => {
      const release = () => {
        signal.removeEventListener('abort', onAbort);
        current.users--;
        if (!current.users && !current.settled) {
          if (ancestors.get(key) === current) ancestors.delete(key);
          current.controller.abort();
        }
      };
      let finished = false;
      const finish = (callback: () => void) => { if (!finished) { finished = true; release(); callback(); } };
      const onAbort = () => finish(() => reject(signal.reason));
      signal.addEventListener('abort', onAbort, { once: true });
      current.promise.then((value) => finish(() => resolve(value)), (error) => finish(() => reject(error)));
      if (signal.aborted) onAbort();
    });
    signal.throwIfAborted();
    return supplementCoastalLand(data, tile, reference);
  };
}
