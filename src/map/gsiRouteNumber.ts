import { VectorTile } from '@mapbox/vector-tile';
import { PbfReader, PbfWriter } from 'pbf';
import { AJAXError, type AddProtocolAction } from 'maplibre-gl';
import { GSI_VECTOR_CONFIG } from './gsiVectorConfig';

export const GSI_ROUTE_NUMBER_SOURCE_LAYER = 'GsiRouteNumber';
export const GSI_ROUTE_NUMBER_SCHEME = 'gsi-route';
type TileCoordinate = { z: number; x: number; y: number };
type ChildTile = { coordinate: TileCoordinate; data: Uint8Array | undefined };
const supported = (tile: TileCoordinate) => tile.z === 7 || tile.z === 8;

export function routeNumberChildren(tile: TileCoordinate): TileCoordinate[] {
  if (!supported(tile)) return [];
  const scale = 2 ** (9 - tile.z);
  return Array.from({ length: scale * scale }, (_, i) => ({
    z: 9, x: tile.x * scale + i % scale, y: tile.y * scale + Math.floor(i / scale),
  }));
}

/** Append an MVT layer; the original protobuf bytes remain untouched. */
export function supplementRouteNumbers(data: Uint8Array, tile: TileCoordinate, children: ChildTile[]): Uint8Array {
  const expected = routeNumberChildren(tile);
  if (!expected.length || expected.some((coord) => !children.some((child) =>
    child.coordinate.z === coord.z && child.coordinate.x === coord.x && child.coordinate.y === coord.y && child.data?.length))) return data;
  if (new VectorTile(new PbfReader(data)).layers[GSI_ROUTE_NUMBER_SOURCE_LAYER]) return data;
  // Preserve the z9 integer grid when folding up to sixteen children together.
  const extent = 16384;
  const scale = 2 ** (9 - tile.z);
  const points: { x: number; y: number; number: string }[] = [];
  const seen = new Set<string>();
  for (const child of children) {
    const layer = new VectorTile(new PbfReader(child.data!)).layers.transp;
    if (!layer) continue;
    for (let i = 0; i < layer.length; i++) {
      const feature = layer.feature(i);
      if (feature.type !== 1 || feature.properties.ftCode !== 2901 || feature.properties.nRNo === undefined) continue;
      for (const part of feature.loadGeometry()) for (const p of part) {
        const x = Math.round((child.coordinate.x - tile.x * scale + p.x / layer.extent) * extent / scale);
        const y = Math.round((child.coordinate.y - tile.y * scale + p.y / layer.extent) * extent / scale);
        // A half-open parent boundary gives each shield one owning parent tile.
        if (x < 0 || y < 0 || x >= extent || y >= extent) continue;
        const number = String(feature.properties.nRNo);
        const key = `${x}/${y}/${number}`;
        if (!seen.has(key)) { seen.add(key); points.push({ x, y, number }); }
      }
    }
  }
  if (!points.length) return data;
  const writer = new PbfWriter();
  writer.writeMessage(3, (_, layer) => {
    layer.writeStringField(1, GSI_ROUTE_NUMBER_SOURCE_LAYER);
    points.forEach((point, index) => layer.writeMessage(2, (_, feature) => {
      feature.writePackedVarint(2, [0, index]);
      feature.writeVarintField(3, 1);
      const geometry = new PbfWriter();
      geometry.writeVarint(9);
      geometry.writeSVarint(point.x);
      geometry.writeSVarint(point.y);
      feature.writeBytesField(4, geometry.finish());
    }, null));
    layer.writeStringField(3, 'nRNo');
    for (const point of points) layer.writeMessage(4, (_, value) => value.writeStringField(1, point.number), null);
    layer.writeVarintField(5, extent);
    layer.writeVarintField(15, 2);
  }, null);
  const extra = writer.finish();
  const result = new Uint8Array(data.length + extra.length);
  result.set(data);
  result.set(extra, data.length);
  return result;
}

/** Share pending/resolved z9 reads across Maps, with independent cancellation. */
export function createRouteNumberSupplement(read: (tile: TileCoordinate, controller: AbortController) => Promise<Uint8Array | undefined>) {
  type Entry = { controller: AbortController; promise: Promise<Uint8Array | undefined>; users: number; settled: boolean };
  const cache = new Map<string, Entry>();
  function acquire(tile: TileCoordinate, signal: AbortSignal) {
    signal.throwIfAborted();
    const key = `${tile.z}/${tile.x}/${tile.y}`;
    let entry = cache.get(key);
    if (!entry) {
      const controller = new AbortController();
      entry = { controller, users: 0, settled: false, promise: Promise.resolve(undefined) };
      const pending = entry;
      pending.promise = read(tile, controller).then((value) => {
        pending.settled = true;
        if (cache.size > 128) for (const [oldKey, old] of cache) {
          if (old.settled && oldKey !== key) { cache.delete(oldKey); break; }
        }
        return value;
      }).catch((error) => { if (cache.get(key) === pending) cache.delete(key); throw error; });
      cache.set(key, pending);
    }
    const current = entry;
    current.users++;
    return new Promise<Uint8Array | undefined>((resolve, reject) => {
      let finished = false;
      const finish = (callback: () => void) => {
        if (finished) return;
        finished = true;
        signal.removeEventListener('abort', onAbort);
        current.users--;
        if (!current.users && !current.settled) {
          if (cache.get(key) === current) cache.delete(key);
          current.controller.abort();
        }
        callback();
      };
      const onAbort = () => finish(() => reject(signal.reason));
      signal.addEventListener('abort', onAbort, { once: true });
      current.promise.then((value) => finish(() => resolve(value)), (error) => finish(() => reject(error)));
      if (signal.aborted) onAbort();
    });
  }
  return async (data: Uint8Array, tile: TileCoordinate, signal: AbortSignal): Promise<Uint8Array> => {
    signal.throwIfAborted();
    if (!supported(tile)) return data;
    try {
      const children = await Promise.all(routeNumberChildren(tile).map(async (coordinate) => ({
        coordinate, data: await acquire(coordinate, signal),
      })));
      signal.throwIfAborted();
      return supplementRouteNumbers(data, tile, children);
    } catch {
      signal.throwIfAborted();
      return data;
    }
  };
}

function tileUrl(tile: TileCoordinate) {
  return GSI_VECTOR_CONFIG.source.vectorTileUrl.replace('{z}', String(tile.z)).replace('{x}', String(tile.x)).replace('{y}', String(tile.y));
}

export function createGsiRouteNumberProtocol(): AddProtocolAction {
  const supplement = createRouteNumberSupplement(async (tile, controller) => {
    const response = await fetch(tileUrl(tile), { signal: controller.signal });
    if (response.status === 404) return undefined;
    if (!response.ok) throw new Error('国道番号の補完データを読み込めませんでした。');
    return new Uint8Array(await response.arrayBuffer());
  });
  return async (params, controller) => {
    const match = params.url.match(/^gsi-route:\/\/(\d+)\/(\d+)\/(\d+)$/);
    if (!match) throw new Error('地図タイルのURLが正しくありません。');
    const coordinate = { z: Number(match[1]), x: Number(match[2]), y: Number(match[3]) };
    const response = await fetch(tileUrl(coordinate), { signal: controller.signal });
    // Preserve MapLibre's native HTTP status handling (including absent tiles).
    if (!response.ok) throw new AJAXError(response.status, response.statusText, tileUrl(coordinate), await response.blob());
    const data = new Uint8Array(await response.arrayBuffer());
    const enabled = GSI_VECTOR_CONFIG.labels.showLowZoomNationalRouteNumbers
      && GSI_VECTOR_CONFIG.labels.showNationalRouteNumbers && GSI_VECTOR_CONFIG.visibility.nationalRouteNumbers;
    return {
      data: enabled ? await supplement(data, coordinate, controller.signal) : data,
      cacheControl: response.headers.get('Cache-Control') ?? undefined,
      expires: response.headers.get('Expires') ?? undefined,
    };
  };
}
