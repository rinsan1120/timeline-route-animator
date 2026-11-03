import { VectorTile } from '@mapbox/vector-tile';
import { PbfReader } from 'pbf';
import { FetchSource, PMTiles, type Header } from 'pmtiles';
import { addProtocol, removeProtocol, type Map as MapLibreMap, type StyleSpecification } from 'maplibre-gl';
import type { Geometry } from 'geojson';
import { GSI_COASTAL_LAND_SOURCE_LAYER, supplementCoastalLand } from '../map/gsiCoastalLand';
import { GSI_DETAILED_LAND_SOURCE_ID, GSI_LOW_ZOOM_LAND_SOURCE_ID, GSI_STYLE } from '../map/gsiStyle';
import { GSI_OFFICIAL_SOURCE_ID } from '../map/gsiOfficialStyle';
import { GSI_VECTOR_CONFIG } from '../map/gsiVectorConfig';
import { GSI_ZOOM_CONFIG } from '../map/gsiZoomConfig';

type Tile = { z: number; x: number; y: number };
type Point = { x: number; y: number };
type Polygon = Point[][];
type TileAudit = {
  state: 'absent' | 'empty' | 'present';
  layers: Record<string, string[]>;
  land: Polygon[];
  fullWater: boolean;
  data?: Uint8Array;
  cacheControl?: string;
  expires?: string;
};
const tileKey = ({ z, x, y }: Tile) => `${z}/${x}/${y}`;
const emptyAudit = (state: TileAudit['state']): TileAudit => ({ state, layers: {}, land: [], fullWater: false });
const auditError = () => new Error('動画用地図の必要な海陸データを確認できませんでした。');
let nextAuditId = 0;

// Two independent 32-bit geometry digests plus length for official fallback
// verification. Do not retain full GeoJSON strings alongside the tile data.
function geometryKey(geometry: Geometry): string {
  const value = JSON.stringify(geometry);
  let a = 2166136261, b = 5381;
  for (let i = 0; i < value.length; i++) {
    a = Math.imul(a ^ value.charCodeAt(i), 16777619);
    b = Math.imul(b, 33) ^ value.charCodeAt(i);
  }
  return `${value.length}:${a >>> 0}:${b >>> 0}`;
}

// Clip a ring to a tile rectangle. Signed areas preserve polygon holes, including
// concave coastlines; no sampling grid can miss a narrow overlap with AdmArea.
function clippedArea(ring: Point[]): number {
  let points = ring;
  for (const axis of ['x', 'y'] as const) for (const edge of [0, 1]) {
    const next: Point[] = [];
    for (let i = 0; i < points.length; i++) {
      const a = points[i], b = points[(i + 1) % points.length];
      const insideA = edge === 0 ? a[axis] >= edge : a[axis] <= edge;
      const insideB = edge === 0 ? b[axis] >= edge : b[axis] <= edge;
      if (insideA) next.push(a);
      if (insideA !== insideB) {
        const t = (edge - a[axis]) / (b[axis] - a[axis]);
        next.push({ x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) });
      }
    }
    points = next;
  }
  return points.reduce((sum, a, i) => {
    const b = points[(i + 1) % points.length];
    return sum + a.x * b.y - b.x * a.y;
  }, 0) / 2;
}
const polygonArea = (rings: Polygon) => Math.abs(rings.reduce((sum, ring) => sum + clippedArea(ring), 0));

function landOverlaps(land: TileAudit, parent: Tile, tile: Tile): boolean {
  const scale = 2 ** (tile.z - parent.z);
  return land.land.some((polygon) => polygonArea(polygon.map((ring) => ring.map((p) => ({
    x: (parent.x + p.x) * scale - tile.x,
    y: (parent.y + p.y) * scale - tile.y,
  })))) > 1e-12);
}

function summarize(data: Uint8Array, coord: Tile, official = false): TileAudit {
  if (!data.length) return emptyAudit('empty');
  const tile = new VectorTile(new PbfReader(data));
  const result = emptyAudit('empty');
  for (const [name, layer] of Object.entries(tile.layers)) {
    if (layer.length) result.state = 'present';
    const required = official ? name === 'waterarea' : ['AdmArea', 'WA', GSI_COASTAL_LAND_SOURCE_LAYER].includes(name);
    if (!required) continue;
    for (let i = 0; i < layer.length; i++) {
      const feature = layer.feature(i);
      // Validate the geometry used by the sea/land layers. Other layers still go
      // through MapLibre's parser and its existing error monitor.
      const rings = feature.loadGeometry();
      if (official) (result.layers[name] ??= []).push(geometryKey(feature.toGeoJSON(coord.x, coord.y, coord.z).geometry));
      if (feature.type !== 3) continue;
      const normalized = rings.map((ring) => ring.map((p) => ({ x: p.x / layer.extent, y: p.y / layer.extent })));
      if (!official && name === 'AdmArea' && coord.z <= GSI_ZOOM_CONFIG.lowZoomLand.sourceMaxZoom) result.land.push(normalized);
      // A single valid water feature must cover the whole tile, including holes.
      // Merely finding a water feature (or adding overlapping areas) proves less.
      if (official && name === 'waterarea' && [5000, 55000].includes(Number(feature.properties.ftCode))
        && polygonArea(normalized) >= 1 - 1e-12) result.fullWater = true;
    }
  }
  return result;
}

function withinArchive(tile: Tile, header: Header): boolean {
  const size = 2 ** tile.z;
  const y = (latitude: number) => (1 - Math.asinh(Math.tan(latitude * Math.PI / 180)) / Math.PI) / 2 * size;
  return tile.x >= Math.floor((header.minLon + 180) / 360 * size)
    && tile.x < Math.ceil((header.maxLon + 180) / 360 * size)
    && tile.y >= Math.floor(y(header.maxLat)) && tile.y < Math.ceil(y(header.minLat));
}

/** Independent, in-memory evidence belonging to exactly one video Map instance. */
export function createVideoMapDataAudit(signal?: AbortSignal) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();
  const source = new FetchSource(GSI_VECTOR_CONFIG.lowZoomLand.pmtilesUrl);
  // PMTiles header fetches have no per-call signal. Bind even those requests to
  // this audit's lifecycle, so timeout, retry and cancellation release all I/O.
  const archive = new PMTiles({
    getKey: () => source.getKey(),
    getBytes: async (offset, length, _signal, etag) => {
      const response = await source.getBytes(offset, length, controller.signal, etag);
      // The initial header range may legitimately contain an entire small file.
      // All directory/tile ranges must contain exactly the indexed byte count.
      if (!(offset === 0 && length === 16384) && response.data.byteLength !== length) throw auditError();
      return response;
    },
  });
  const tiles = new Map<string, Promise<TileAudit>>();
  const byteSizes = new Map<string, number>();
  let retainedBytes = 0;
  let inspectedMap: MapLibreMap | null = null;
  const scheme = `jms-video-${++nextAuditId}`;
  const url = `${scheme}://archive`;
  const style: StyleSpecification = { ...GSI_STYLE, sources: { ...GSI_STYLE.sources } };
  for (const id of [GSI_LOW_ZOOM_LAND_SOURCE_ID, GSI_DETAILED_LAND_SOURCE_ID]) {
    const original = style.sources[id];
    if (original?.type === 'vector') style.sources[id] = { ...original, url };
  }

  const evict = (key: string) => {
    tiles.delete(key);
    retainedBytes -= byteSizes.get(key) ?? 0;
    byteSizes.delete(key);
  };

  function cached(key: string, read: () => Promise<TileAudit>): Promise<TileAudit> {
    const found = tiles.get(key);
    if (found) { tiles.delete(key); tiles.set(key, found); return found; }
    const pending = read().then((result) => {
      if (tiles.get(key) === pending) {
        const size = result.data?.byteLength ?? 0;
        byteSizes.set(key, size);
        retainedBytes += size;
        while (retainedBytes > 16 * 1024 * 1024 || tiles.size > 256) evict(tiles.keys().next().value!);
      }
      return result;
    }).catch((error) => { if (tiles.get(key) === pending) evict(key); throw error; });
    tiles.set(key, pending);
    // Bounded session data; eviction may cause a later re-audit, never success
    // based on another Map's cache or a remembered protocol passage.
    if (tiles.size > 256) evict(tiles.keys().next().value!);
    return pending;
  }

  async function readArchive(tile: Tile): Promise<TileAudit> {
    return cached(`archive:${tileKey(tile)}`, async () => {
      // getZxy consults the archive directories. undefined means unrecorded;
      // HTTP 404/range/decompression failures throw and are never cached as empty.
      const response = await archive.getZxy(tile.z, tile.x, tile.y, controller.signal);
      if (!response) return { ...emptyAudit('absent'), data: new Uint8Array() };
      let data: Uint8Array = new Uint8Array(response.data);
      if (tile.z >= GSI_ZOOM_CONFIG.lowZoomLand.maxZoom && tile.z < GSI_ZOOM_CONFIG.lowZoomLand.detailedLandMinZoom) {
        data = supplementCoastalLand(data);
      }
      return { ...summarize(data, tile), data, cacheControl: response.cacheControl, expires: response.expires };
    });
  }

  // The Map receives the very data independently inspected below. This is not a
  // passage log: inspect enumerates required coordinates even on Map cache hits.
  // A per-session protocol also turns HTTP/range failures into ordinary errors,
  // so MapLibre cannot silently accept an AJAX 404 as a completed empty tile.
  addProtocol(scheme, async (params, requestController) => {
    try {
      if (params.type === 'json') {
        const h = await archive.getHeader();
        requestController.signal.throwIfAborted();
        return { data: { tiles: [`${url}/{z}/{x}/{y}`], minzoom: h.minZoom, maxzoom: h.maxZoom,
          bounds: [h.minLon, h.minLat, h.maxLon, h.maxLat] } };
      }
      const match = params.url.slice(url.length).match(/^\/(\d+)\/(\d+)\/(\d+)$/);
      if (!match) throw auditError();
      const tile = { z: Number(match[1]), x: Number(match[2]), y: Number(match[3]) };
      const result = await readArchive(tile);
      requestController.signal.throwIfAborted();
      // MapLibre can transfer this buffer to a worker; keep the session copy intact.
      return { data: result.data!.slice(), cacheControl: result.cacheControl, expires: result.expires };
    } catch (error) {
      if (requestController.signal.aborted || controller.signal.aborted) throw error;
      throw new Error(auditError().message, { cause: error });
    }
  });

  async function readOfficial(tile: Tile): Promise<TileAudit> {
    return cached(`official:${tileKey(tile)}`, async () => {
      const url = GSI_VECTOR_CONFIG.source.vectorTileUrl.replace('{z}', String(tile.z)).replace('{x}', String(tile.x)).replace('{y}', String(tile.y));
      const response = await fetch(url, { signal: controller.signal });
      // A normal 404 is not automatically a failure; the caller still has to
      // prove that no broad AdmArea can hide the sea in this tile.
      if (response.status === 404) return emptyAudit('absent');
      if (!response.ok) throw auditError();
      return summarize(new Uint8Array(await response.arrayBuffer()), tile, true);
    });
  }

  function covering(map: MapLibreMap, maxzoom: number): Tile[] {
    const unique = new Map<string, Tile>();
    for (const { canonical } of map.coveringTiles({ tileSize: 512, minzoom: GSI_ZOOM_CONFIG.source.minZoom, maxzoom })) {
      unique.set(tileKey(canonical), canonical);
    }
    return [...unique.values()];
  }

  function assertLayers(map: MapLibreMap, sourceId: string, required: { tile: Tile; audit: TileAudit }[], names: string[]) {
    for (const name of names) {
      const expected = required.flatMap(({ audit }) => audit.layers[name] ?? []);
      if (!expected.length) continue; // True empty/absent tiles need no phantom feature.
      const loaded = new Set(map.querySourceFeatures(sourceId, { sourceLayer: name }).map((f) => geometryKey(f.geometry)));
      if (!expected.every((feature) => loaded.has(feature))) throw auditError();
    }
  }

  async function inspect(map: MapLibreMap) {
    if (inspectedMap && inspectedMap !== map) throw auditError();
    inspectedMap = map;
    if (!GSI_VECTOR_CONFIG.lowZoomLand.enabled || map.getZoom() < GSI_ZOOM_CONFIG.lowZoomLand.minZoom) return () => {};
    const header = await archive.getHeader();
    if (![header.minLon, header.maxLon, header.minLat, header.maxLat].every(Number.isFinite)
      || header.minLon >= header.maxLon || header.minLat >= header.maxLat) throw auditError();
    const low = covering(map, GSI_ZOOM_CONFIG.lowZoomLand.sourceMaxZoom);
    const detailed = covering(map, GSI_ZOOM_CONFIG.source.maxZoom);
    const read = async (tile: Tile) => ({ tile, audit: await readArchive(tile) });
    const [land, detail] = await Promise.all([Promise.all(low.map(read)), Promise.all(detailed.map(read))]);
    const fallback: { tile: Tile; audit: TileAudit }[] = [];
    for (const entry of detail) {
      // A tile outside TileJSON bounds is intentionally not loaded by MapLibre.
      // Treat it like an unrecorded tile, not like missing rendered geometry.
      const unavailable = !withinArchive(entry.tile, header) || entry.audit.state !== 'present';
      if (!unavailable || !land.some((parent) => withinArchive(parent.tile, header) && landOverlaps(parent.audit, parent.tile, entry.tile))) continue;
      const water = await readOfficial(entry.tile);
      const zoom = map.getZoom();
      const visibleWater = GSI_STYLE.layers.some((layer) => layer.type === 'fill' && layer.source === GSI_OFFICIAL_SOURCE_ID
        && layer['source-layer'] === 'waterarea' && layer.layout?.visibility !== 'none'
        && zoom >= (layer.minzoom ?? 0) && zoom < (layer.maxzoom ?? Infinity));
      if (!water.fullWater || !visibleWater) throw auditError();
      fallback.push({ tile: entry.tile, audit: water });
    }
    return () => {
      controller.signal.throwIfAborted();
      // Only fallback data came through the ordinary HTTP source. Check that
      // this Map actually has those water polygons, even if its 404 was silent.
      assertLayers(map, GSI_OFFICIAL_SOURCE_ID, fallback, ['waterarea']);
    };
  }

  return {
    style,
    inspect: async (map: MapLibreMap, timeout: number) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        return await Promise.race([inspect(map), new Promise<never>((_, reject) => {
          timer = setTimeout(() => { abort(); reject(auditError()); }, timeout);
        })]);
      } finally { clearTimeout(timer); }
    },
    dispose: () => {
      abort();
      signal?.removeEventListener('abort', abort);
      removeProtocol(scheme);
      tiles.clear();
      byteSizes.clear();
    },
  };
}
