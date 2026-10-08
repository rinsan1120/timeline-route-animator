import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { classifyRings, VectorTile, type VectorTileLayer } from '@mapbox/vector-tile';
import { PbfReader } from 'pbf';
import earcut from 'earcut';
import { GSI_COASTAL_LAND_SOURCE_LAYER, supplementCoastalLand, withGsiCoastalLand } from '../src/map/gsiCoastalLand';
import { GSI_VECTOR_CONFIG } from '../src/map/gsiVectorConfig';

function fixture(name: string) {
  return new Uint8Array(readFileSync(new URL(`./fixtures/gsi-coast/${name}.pbf`, import.meta.url)));
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
  it('records the data gap independently of map/tile readiness', () => {
    expect(new VectorTile(new PbfReader(fixture('7-114-45'))).layers.AdmArea.length).toBeGreaterThan(0);
    const mid = new VectorTile(new PbfReader(fixture('8-228-91')));
    expect(mid.layers.AdmArea).toBeUndefined();
    expect(mid.layers.WA.length).toBeGreaterThan(0);
    expect(new VectorTile(new PbfReader(fixture('14-14618-5877'))).layers.AdmArea.length).toBeGreaterThan(0);
  });

  it.each(['8-228-91', '8-229-91', '9-456-183', '10-913-367', '13-7309-2938'])('preserves every original byte and reconstructs the exact sea complement within its envelope in %s', (name) => {
    const data = fixture(name), copy = data.slice();
    const result = supplementCoastalLand(data);
    expect(data).toEqual(copy);
    expect(result.slice(0, data.length)).toEqual(data);
    const original = new VectorTile(new PbfReader(data));
    const supplemented = new VectorTile(new PbfReader(result));
    expect(Object.keys(supplemented.layers)).toEqual([...Object.keys(original.layers), GSI_COASTAL_LAND_SOURCE_LAYER]);
    const land = triangles(supplemented.layers[GSI_COASTAL_LAND_SOURCE_LAYER]);
    const water = triangles(original.layers.WA);
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
      expect(covers(land, x, y), `land at ${x},${y}`).toBe(true);
      checkedLand++;
    }
    expect(checkedLand).toBeGreaterThan(0);
    expect(checkedWater).toBeGreaterThan(0);
  });

  it('keeps Rebun, Rishiri and Hokkaido land, sea on all sides, and the unsurveyed sea beyond 46°N', () => {
    const tile = new VectorTile(new PbfReader(supplementCoastalLand(fixture('8-228-91'))));
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
    const detail = new VectorTile(new PbfReader(supplementCoastalLand(fixture('8-228-91'))));
    const coarse = triangles(low.layers.AdmArea);
    const precise = triangles(detail.layers[GSI_COASTAL_LAND_SOURCE_LAYER]);
    const water = triangles(detail.layers.WA);
    let correctedLand = 0;
    for (let x = 17.3; x < 4096; x += 17) for (let y = 319.7; y < 4096; y += 17) {
      // z7 uses extent 16384; this z8 child occupies its south-west quarter.
      if (covers(water, x, y)) continue;
      if (!covers(coarse, x * 2, y * 2 + 8192)) {
        expect(covers(precise, x, y)).toBe(true);
        correctedLand++;
      }
    }
    expect(correctedLand).toBeGreaterThan(0);
    const once = supplementCoastalLand(fixture('8-228-91'));
    expect(supplementCoastalLand(once)).toBe(once);
  });

  it('keeps valid empty ocean tiles empty and leaves low zoom or inland-only data unchanged', () => {
    const empty = new Uint8Array();
    expect(supplementCoastalLand(empty)).toBe(empty);
    const low = fixture('7-114-45');
    expect(supplementCoastalLand(low)).toBe(low);
    const inland = fixture('13-7309-2941');
    expect(supplementCoastalLand(inland)).toBe(inland);
  });

  it.each([7, 8, 13, 14])('supplements only the configured GSI archive and the missing AdmArea zoom band (%s)', async (zoom) => {
    const data = fixture('8-228-91');
    const protocol = vi.fn(async () => ({ data, cacheControl: 'public' }));
    const wrapped = withGsiCoastalLand(protocol);
    const url = `pmtiles://${GSI_VECTOR_CONFIG.lowZoomLand.pmtilesUrl}/${zoom}/228/91`;
    const result = await wrapped({ url, type: 'arrayBuffer' }, new AbortController());
    expect(result.cacheControl).toBe('public');
    expect(result.data === data).toBe(zoom < 8 || zoom >= 14);
    expect((await wrapped({ url: 'pmtiles://other.pmtiles/8/228/91', type: 'arrayBuffer' }, new AbortController())).data).toBe(data);
    expect((await wrapped({ url, type: 'json' }, new AbortController())).data).toBe(data);
  });
});
