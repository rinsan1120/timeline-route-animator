import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { classifyRings, VectorTile, type VectorTileLayer } from '@mapbox/vector-tile';
import { PbfReader } from 'pbf';
import earcut from 'earcut';
import polygonClipping, { type MultiPolygon } from 'polygon-clipping';
import { GSI_COASTAL_LAND_SOURCE_LAYER, coastalLandAncestor, createCoastalLandSupplement, supplementCoastalLand, withGsiCoastalLand } from '../src/map/gsiCoastalLand';
import { GSI_VECTOR_CONFIG } from '../src/map/gsiVectorConfig';

// Public GSI PMTiles, fetched 2026-11-03 (no user route/location data):
// https://cyberjapandata.gsi.go.jp/xyz/optimal_bvmap-v1/optimal_bvmap-v1.pmtiles
// Added fixtures: reported offshore tiles and Kunashir/Iturup/Habomai/Tsugaru,
// with their recorded z7 ancestors. 7/116/47 was directory-confirmed absent.

function fixture(name: string) {
  return new Uint8Array(readFileSync(new URL(`./fixtures/gsi-coast/${name}.pbf`, import.meta.url)));
}
function supplementFixture(name: string) {
  const [z, x, y] = name.split('-').map(Number);
  const ancestor = coastalLandAncestor({ z, x, y });
  const parent = `${ancestor.z}-${ancestor.x}-${ancestor.y}`;
  return supplementCoastalLand(fixture(name), { z, x, y }, parent === '7-116-47' ? undefined : fixture(parent));
}
function geometry(layer: VectorTileLayer | undefined): MultiPolygon {
  const polygons: MultiPolygon = [];
  if (layer) for (let i = 0; i < layer.length; i++) {
    const feature = layer.feature(i);
    if (feature.type === 3) for (const polygon of classifyRings(feature.loadGeometry())) polygons.push(polygon.map((ring) => ring.map((p) => [p.x, p.y])));
  }
  return polygons;
}
function area(polygons: MultiPolygon) {
  return polygons.reduce((sum, polygon) => sum + Math.abs(polygon.reduce((total, ring) => total + ring.reduce((a, [x, y], i) => {
    const [nx, ny] = ring[(i + 1) % ring.length];
    return a + x * ny - nx * y;
  }, 0) / 2, 0)), 0);
}
function triangles(layer: VectorTileLayer) {
  const result: number[][] = [];
  for (let i = 0; i < layer.length; i++) {
    for (const polygon of classifyRings(layer.feature(i).loadGeometry())) {
      const vertices: number[] = [], holes: number[] = [];
      for (let j = 0; j < polygon.length; j++) {
        if (j) holes.push(vertices.length / 2);
        for (const p of polygon[j]) vertices.push(p.x, p.y);
      }
      const indices = earcut(vertices, holes, 2);
      for (let j = 0; j < indices.length; j += 3) result.push(indices.slice(j, j + 3).flatMap((index) => vertices.slice(index * 2, index * 2 + 2)));
    }
  }
  return result;
}
function covers(mesh: number[][], x: number, y: number) {
  return mesh.some(([ax, ay, bx, by, cx, cy]) => {
    const a = (bx - ax) * (y - ay) - (by - ay) * (x - ax);
    const b = (cx - bx) * (y - by) - (cy - by) * (x - bx);
    const c = (ax - cx) * (y - cy) - (ay - cy) * (x - cx);
    return (a > 0 && b > 0 && c > 0) || (a < 0 && b < 0 && c < 0);
  });
}
function pixel(longitude: number, latitude: number, z: number, x: number, y: number, extent: number) {
  return [(longitude + 180) / 360 * 2 ** z * extent - x * extent,
    (1 - Math.asinh(Math.tan(latitude * Math.PI / 180)) / Math.PI) / 2 * 2 ** z * extent - y * extent];
}

describe('GSI coastal land supplement', () => {
  it.each([
    ['10-928-376', 0.9], ['9-464-188', 0.5], ['8-232-94', 0.1],
  ] as const)('does not turn the open-ocean data boundary into land in %s', (name, minimumOldRatio) => {
    const original = fixture(name);
    const water = new VectorTile(new PbfReader(original)).layers.WA;
    const [ocean] = classifyRings(water.feature(0).loadGeometry())[0];
    const west = Math.min(...ocean.map((p) => p.x)), east = Math.max(...ocean.map((p) => p.x));
    const north = Math.min(...ocean.map((p) => p.y)), south = Math.max(...ocean.map((p) => p.y));
    const former = polygonClipping.difference([[[west, north], [east, north], [east, south], [west, south], [west, north]]],
      [ocean.map((p): [number, number] => [p.x, p.y])]);
    const bounds: MultiPolygon = [[[[0, 0], [water.extent, 0], [water.extent, water.extent], [0, water.extent], [0, 0]]]];
    const previousRatio = area(polygonClipping.intersection(former, bounds)) / water.extent ** 2;
    expect(previousRatio).toBeGreaterThan(minimumOldRatio);
    const corrected = supplementFixture(name);
    expect(corrected).toEqual(original); // No supported mainland or explicit island.
    expect(new VectorTile(new PbfReader(corrected)).layers[GSI_COASTAL_LAND_SOURCE_LAYER]).toBeUndefined();
  });

  it.each(['9-463-185', '9-466-183', '9-463-187', '9-455-191', '8-228-91'])
    ('preserves every explicitly bounded island and adds no envelope land outside ancestor support in %s', (name) => {
      const [z, x, y] = name.split('-').map(Number);
      const coord = { z, x, y }, parent = coastalLandAncestor(coord);
      const original = new VectorTile(new PbfReader(fixture(name)));
      const result = supplementFixture(name);
      const native = fixture(name);
      expect(result.slice(0, native.length)).toEqual(native);
      const land = geometry(new VectorTile(new PbfReader(result)).layers[GSI_COASTAL_LAND_SOURCE_LAYER]);
      const islands: MultiPolygon = [];
      for (let i = 0; i < original.layers.WA.length; i++) {
        const feature = original.layers.WA.feature(i);
        if (feature.properties.vt_code !== 5101) continue;
        for (const [, ...holes] of classifyRings(feature.loadGeometry())) for (const hole of holes) {
          islands.push([hole.map((p) => [p.x, p.y])]);
        }
      }
      expect(islands.length).toBeGreaterThan(0);
      expect(area(polygonClipping.difference(islands, land))).toBeLessThan(1e-6);
      const reference = new VectorTile(new PbfReader(fixture(`${parent.z}-${parent.x}-${parent.y}`))).layers.AdmArea;
      const scale = 2 ** (z - parent.z), extent = original.layers.WA.extent;
      const supported: MultiPolygon = geometry(reference).map((polygon) => polygon.map((ring) => ring.map(([px, py]) => [
        ((parent.x + px / reference.extent) * scale - x) * extent,
        ((parent.y + py / reference.extent) * scale - y) * extent,
      ])));
      // Quantization at the MVT integer grid can contribute less than one unit
      // along a clipped boundary; it cannot admit an unsupported component.
      const unsupported = area(polygonClipping.difference(land, supported, islands));
      expect(unsupported / extent ** 2).toBeLessThan(0.0001);
      expect(area(polygonClipping.intersection(land, supported))).toBeGreaterThan(1000);
    });

  it('keeps explicit tiny islands even with a normally unrecorded ancestor', () => {
    const coord = { z: 9, x: 463, y: 187 };
    const result = supplementCoastalLand(fixture('9-463-187'), coord);
    const land = geometry(new VectorTile(new PbfReader(result)).layers[GSI_COASTAL_LAND_SOURCE_LAYER]);
    expect(land.length).toBeGreaterThan(100);
    expect(area(land)).toBeGreaterThan(0);
  });

  it('shares an ancestor read and does not cancel a second Map when the first cancels', async () => {
    let resolve!: (data: Uint8Array) => void;
    const read = vi.fn((_tile, controller: AbortController) => new Promise<Uint8Array>((done) => {
      resolve = done;
    }));
    const supplement = createCoastalLandSupplement(read);
    const first = new AbortController(), second = new AbortController();
    const one = supplement(fixture('8-228-91'), { z: 8, x: 228, y: 91 }, first.signal);
    const rejected = expect(one).rejects.toMatchObject({ name: 'AbortError' });
    const two = supplement(fixture('8-229-91'), { z: 8, x: 229, y: 91 }, second.signal);
    first.abort();
    await rejected;
    expect(read).toHaveBeenCalledOnce();
    expect(read.mock.calls[0][1].signal.aborted).toBe(false);
    resolve(fixture('7-114-45'));
    expect(await two).toEqual(supplementFixture('8-229-91'));
    await supplement(fixture('8-228-91'), { z: 8, x: 228, y: 91 }, second.signal);
    expect(read).toHaveBeenCalledOnce();
  });

  it('records the data gap independently of map/tile readiness', () => {
    expect(new VectorTile(new PbfReader(fixture('7-114-45'))).layers.AdmArea.length).toBeGreaterThan(0);
    const mid = new VectorTile(new PbfReader(fixture('8-228-91')));
    expect(mid.layers.AdmArea).toBeUndefined();
    expect(mid.layers.WA.length).toBeGreaterThan(0);
    expect(new VectorTile(new PbfReader(fixture('14-14618-5877'))).layers.AdmArea.length).toBeGreaterThan(0);
  });

  it.each(['8-228-91', '8-229-91', '9-456-183', '10-913-367', '13-7309-2938'])('preserves original bytes and bounded coastal land in %s', (name) => {
    const data = fixture(name), copy = data.slice();
    const result = supplementFixture(name);
    expect(data).toEqual(copy);
    expect(result.slice(0, data.length)).toEqual(data);
    const original = new VectorTile(new PbfReader(data));
    const supplemented = new VectorTile(new PbfReader(result));
    expect(Object.keys(supplemented.layers)).toEqual([...Object.keys(original.layers), GSI_COASTAL_LAND_SOURCE_LAYER]);
    const land = triangles(supplemented.layers[GSI_COASTAL_LAND_SOURCE_LAYER]);
    const water = triangles(original.layers.WA);
    const [zoom, tileX, tileY] = name.split('-').map(Number);
    const parent = coastalLandAncestor({ z: zoom, x: tileX, y: tileY });
    const reference = new VectorTile(new PbfReader(fixture(`${parent.z}-${parent.x}-${parent.y}`))).layers.AdmArea;
    const coarse = triangles(reference), scale = 2 ** (zoom - parent.z);
    // Exercise the same triangulation as MapLibre, including holes touching the
    // envelope and clipped mainland coastlines, rather than just counting rings.
    const envelopes: number[][] = [];
    for (let i = 0; i < original.layers.WA.length; i++) {
      const f = original.layers.WA.feature(i);
      if (f.properties.vt_code !== 5101) continue;
      for (const [ocean] of classifyRings(f.loadGeometry())) {
        envelopes.push([Math.min(...ocean.map((p) => p.x)), Math.min(...ocean.map((p) => p.y)), Math.max(...ocean.map((p) => p.x)), Math.max(...ocean.map((p) => p.y))]);
      }
    }
    let checkedLand = 0, checkedWater = 0;
    const extent = original.layers.WA.extent;
    for (let x = 17.3; x < extent; x += 61) for (let y = 19.7; y < extent; y += 61) {
      const inEnvelope = envelopes.some(([w, n, e, s]) => x > w && x < e && y > n && y < s);
      if (!inEnvelope) { expect(covers(land, x, y)).toBe(false); continue; }
      if (covers(water, x, y)) { checkedWater++; continue; } // Native WA is above all land.
      const coarseX = ((tileX + x / extent) / scale - parent.x) * reference.extent;
      const coarseY = ((tileY + y / extent) / scale - parent.y) * reference.extent;
      if (covers(coarse, coarseX, coarseY)) expect(covers(land, x, y), `backed coast at ${x},${y}`).toBe(true);
      if (covers(land, x, y)) checkedLand++;
    }
    expect(checkedLand).toBeGreaterThan(0);
    expect(checkedWater).toBeGreaterThan(0);
  });

  it('keeps Rebun, Rishiri and Hokkaido land, sea on all sides, and the unsurveyed sea beyond 46°N', () => {
    const tile = new VectorTile(new PbfReader(supplementFixture('8-228-91')));
    const land = triangles(tile.layers[GSI_COASTAL_LAND_SOURCE_LAYER]);
    const water = triangles(tile.layers.WA);
    for (const [lon, lat] of [[141.03, 45.4], [141.22, 45.18], [141.8, 45.25]]) {
      const [x, y] = pixel(lon, lat, 8, 228, 91, 4096);
      expect(covers(water, x, y)).toBe(false);
      expect(covers(land, x, y)).toBe(true);
    }
    for (const [lon, lat] of [[140.9, 45.3], [141.4, 45.65], [142, 45.5]]) {
      const [x, y] = pixel(lon, lat, 8, 228, 91, 4096);
      expect(covers(water, x, y)).toBe(true);
    }
    const [x, y] = pixel(141.4, 46.05, 8, 228, 91, 4096);
    expect(covers(land, x, y)).toBe(false);
  });

  it('restores coastal land missed by the coarse z7 shoreline instead of merely enlarging it', () => {
    const low = new VectorTile(new PbfReader(fixture('7-114-45')));
    const detail = new VectorTile(new PbfReader(supplementFixture('8-228-91')));
    const coarse = triangles(low.layers.AdmArea);
    const precise = triangles(detail.layers[GSI_COASTAL_LAND_SOURCE_LAYER]);
    const water = triangles(detail.layers.WA);
    let correctedLand = 0;
    for (let x = 17.3; x < 4096; x += 17) for (let y = 319.7; y < 4096; y += 17) {
      // z7 uses extent 16384; this z8 child occupies its south-west quarter.
      if (covers(water, x, y)) continue;
      if (!covers(coarse, x * 2, y * 2 + 8192)) {
        if (covers(precise, x, y)) correctedLand++;
      }
    }
    expect(correctedLand).toBeGreaterThan(0);
    const once = supplementFixture('8-228-91');
    expect(supplementCoastalLand(once, { z: 8, x: 228, y: 91 }, fixture('7-114-45'))).toBe(once);
  });

  it('keeps valid empty ocean tiles empty and leaves low zoom or inland-only data unchanged', () => {
    const empty = new Uint8Array();
    expect(supplementCoastalLand(empty, { z: 8, x: 228, y: 90 })).toBe(empty);
    const low = fixture('7-114-45');
    expect(supplementCoastalLand(low, { z: 7, x: 114, y: 45 })).toBe(low);
    const inland = fixture('13-7309-2941');
    expect(supplementCoastalLand(inland, { z: 13, x: 7309, y: 2941 })).toBe(inland);
  });

  it.each([7, 8, 13, 14])('supplements only the configured GSI archive and the missing AdmArea zoom band (%s)', async (zoom) => {
    const data = fixture('8-228-91');
    const protocol = vi.fn(async (params: { url: string }) => ({ data: params.url.endsWith('/7/114/45') ? fixture('7-114-45') : data, cacheControl: 'public' }));
    const wrapped = withGsiCoastalLand(protocol);
    const url = `pmtiles://${GSI_VECTOR_CONFIG.lowZoomLand.pmtilesUrl}/${zoom}/228/91`;
    const result = await wrapped({ url, type: 'arrayBuffer' }, new AbortController());
    expect(result.cacheControl).toBe('public');
    expect(result.data === data).toBe(zoom < 8 || zoom >= 14);
    expect((await wrapped({ url: 'pmtiles://other.pmtiles/8/228/91', type: 'arrayBuffer' }, new AbortController())).data).toBe(data);
    expect((await wrapped({ url, type: 'json' }, new AbortController())).data).toBe(data);
  });
});
