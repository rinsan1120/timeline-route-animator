import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { VectorTile } from '@mapbox/vector-tile';
import { PbfReader, PbfWriter } from 'pbf';
import type { AddProtocolAction, Map as MapLibreMap } from 'maplibre-gl';
import { GSI_STYLE, GSI_LOW_ZOOM_LAND_SOURCE_ID } from '../src/map/gsiStyle';
import { coastalLandAncestor, supplementCoastalLand, withGsiCoastalLand } from '../src/map/gsiCoastalLand';
import { GSI_VECTOR_CONFIG } from '../src/map/gsiVectorConfig';
import { createVideoMapDataAudit } from '../src/video/videoMapDataAudit';

const mocks = vi.hoisted(() => ({
  protocols: new Map<string, AddProtocolAction>(),
  getHeader: vi.fn(), getZxy: vi.fn(), fetch: vi.fn(),
}));
vi.mock('maplibre-gl', () => ({
  addProtocol: (name: string, protocol: AddProtocolAction) => mocks.protocols.set(name, protocol),
  removeProtocol: (name: string) => mocks.protocols.delete(name),
}));
vi.mock('pmtiles', () => ({
  FetchSource: class { getKey = () => 'archive'; getBytes = vi.fn(); },
  PMTiles: class { getHeader = mocks.getHeader; getZxy = mocks.getZxy; },
}));
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.resetAllMocks(); mocks.protocols.clear(); });

const low = { z: 7, x: 64, y: 64 }, detail = { z: 8, x: 128, y: 128 };
function polygon(layer: string, hole = false): Uint8Array {
  const writer = new PbfWriter();
  writer.writeMessage(3, (_, w) => {
    w.writeStringField(1, layer);
    w.writeMessage(2, (_, f) => {
      f.writeVarintField(3, 3);
      f.writePackedVarint(2, [0, 0]);
      const g = new PbfWriter();
      g.writeVarint(9); g.writeSVarint(0); g.writeSVarint(0);
      g.writeVarint(26);
      for (const [x, y] of [[4096, 0], [0, 4096], [-4096, 0]]) { g.writeSVarint(x); g.writeSVarint(y); }
      g.writeVarint(15);
      if (hole) {
        g.writeVarint(9); g.writeSVarint(1024); g.writeSVarint(-3072);
        g.writeVarint(26);
        for (const [x, y] of [[0, 2048], [2048, 0], [0, -2048]]) { g.writeSVarint(x); g.writeSVarint(y); }
        g.writeVarint(15);
      }
      f.writeBytesField(4, g.finish());
    }, null);
    w.writeStringField(3, layer === 'WA' ? 'vt_code' : 'ftCode');
    w.writeMessage(4, (_, v) => v.writeVarintField(4, layer === 'WA' ? 5101 : 5000), null);
    w.writeVarintField(5, 4096); w.writeVarintField(15, 2);
  }, null);
  return writer.finish();
}
function setup(options: { land?: Uint8Array; detail?: Uint8Array; water?: Uint8Array; sourceWater?: boolean } = {}) {
  mocks.getHeader.mockResolvedValue({ minLon: -180, maxLon: 180, minLat: -85, maxLat: 85, minZoom: 4, maxZoom: 16 });
  mocks.getZxy.mockImplementation(async (z: number) => {
    const data = z === 7 ? options.land : options.detail;
    return data === undefined ? undefined : { data: data.slice().buffer };
  });
  mocks.fetch.mockResolvedValue({ ok: !!options.water, status: options.water ? 200 : 404, arrayBuffer: async () => options.water!.slice().buffer });
  vi.stubGlobal('fetch', mocks.fetch);
  const sourceFeatures = options.water && options.sourceWater !== false
    ? (() => {
      const layer = new VectorTile(new PbfReader(options.water!)).layers.waterarea;
      return Array.from({ length: layer.length }, (_, i) => layer.feature(i).toGeoJSON(detail.x, detail.y, detail.z));
    })() : [];
  const map = {
    getZoom: () => 8.2,
    coveringTiles: vi.fn(({ maxzoom }: { maxzoom: number }) => [{ canonical: maxzoom === 7 ? low : detail }]),
    querySourceFeatures: vi.fn(() => sourceFeatures),
  } as unknown as MapLibreMap;
  const audit = createVideoMapDataAudit();
  return { audit, map };
}

describe('video session map data audit', () => {
  it('audits required coordinates without any protocol passage and reuses the results on Map cache hits', async () => {
    const { audit, map } = setup({ land: polygon('AdmArea'), detail: polygon('WA') });
    (await audit.inspect(map, 1000))();
    (await audit.inspect(map, 1000))();
    expect(mocks.getZxy).toHaveBeenCalledTimes(2);
    expect(map.coveringTiles).toHaveBeenCalledWith({ tileSize: 512, minzoom: 4, maxzoom: 7 });
    expect(map.coveringTiles).toHaveBeenCalledWith({ tileSize: 512, minzoom: 4, maxzoom: 16 });
    audit.dispose();
  });

  it('serves the audited, supplemented bytes to this Map alone and protects its cached buffer', async () => {
    const data = new Uint8Array(readFileSync(new URL('./fixtures/gsi-coast/8-228-91.pbf', import.meta.url)));
    const land = new Uint8Array(readFileSync(new URL('./fixtures/gsi-coast/7-114-45.pbf', import.meta.url)));
    const { audit } = setup({ detail: data, land });
    const other = createVideoMapDataAudit();
    const source = audit.style.sources[GSI_LOW_ZOOM_LAND_SOURCE_ID];
    const original = GSI_STYLE.sources[GSI_LOW_ZOOM_LAND_SOURCE_ID];
    expect(source).toEqual({ ...original, url: expect.stringMatching(/^jms-video-/) });
    expect(source).not.toEqual(other.style.sources[GSI_LOW_ZOOM_LAND_SOURCE_ID]);
    if (source.type !== 'vector') throw new Error('vector expected');
    const protocol = mocks.protocols.get(source.url!.split(':')[0])!;
    const first = await protocol({ url: `${source.url}/8/228/91` }, new AbortController());
    expect(first.data).toEqual(supplementCoastalLand(data, { z: 8, x: 228, y: 91 }, land));
    structuredClone(first.data, { transfer: [(first.data as Uint8Array).buffer] });
    const second = await protocol({ url: `${source.url}/8/228/91` }, new AbortController());
    expect(second.data).toEqual(supplementCoastalLand(data, { z: 8, x: 228, y: 91 }, land));
    expect(mocks.getZxy).toHaveBeenCalledTimes(2);
    audit.dispose(); other.dispose();
    expect(mocks.protocols.size).toBe(0);
  });

  it.each(['10-928-376', '9-464-188', '8-232-94', '9-463-185', '9-466-183', '9-463-187', '9-455-191', '8-228-91'])
    ('uses identical editor and video supplement rules for real tile %s', async (name) => {
      const [z, x, y] = name.split('-').map(Number), tile = { z, x, y };
      const ancestor = coastalLandAncestor(tile);
      const data = new Uint8Array(readFileSync(new URL(`./fixtures/gsi-coast/${name}.pbf`, import.meta.url)));
      const parentName = `${ancestor.z}-${ancestor.x}-${ancestor.y}`;
      const land = parentName === '7-116-47' ? undefined
        : new Uint8Array(readFileSync(new URL(`./fixtures/gsi-coast/${parentName}.pbf`, import.meta.url)));
      const { audit } = setup({ detail: data, land });
      const source = audit.style.sources[GSI_LOW_ZOOM_LAND_SOURCE_ID];
      if (source.type !== 'vector') throw new Error('vector expected');
      const protocol = mocks.protocols.get(source.url!.split(':')[0])!;
      const video = await protocol({ url: `${source.url}/${z}/${x}/${y}` }, new AbortController());
      const editor = withGsiCoastalLand(async (params) => ({
        data: params.url.endsWith(`/7/${ancestor.x}/${ancestor.y}`) ? land ?? new Uint8Array() : data,
      }));
      const preview = await editor({ url: `pmtiles://${GSI_VECTOR_CONFIG.lowZoomLand.pmtilesUrl}/${z}/${x}/${y}` }, new AbortController());
      expect(video.data).toEqual(preview.data);
      audit.dispose();
    });

  it.each([undefined, new Uint8Array()])('accepts directory-confirmed unrecorded or empty ocean with no land over it', async (data) => {
    const { audit, map } = setup({ detail: data });
    (await audit.inspect(map, 1000))();
    expect(mocks.fetch).not.toHaveBeenCalled();
    audit.dispose();
  });

  it('accepts unrecorded open ocean beside the real northern Hokkaido coastal fixture', async () => {
    const data = new Uint8Array(readFileSync(new URL('./fixtures/gsi-coast/7-114-45.pbf', import.meta.url)));
    const { audit, map } = setup({ land: data });
    vi.mocked(map.coveringTiles).mockImplementation(({ maxzoom }) => [{ canonical: maxzoom === 7
      ? { z: 7, x: 114, y: 45 } : { z: 8, x: 228, y: 90 } }] as any);
    (await audit.inspect(map, 1000))();
    expect(mocks.fetch).not.toHaveBeenCalled();
    audit.dispose();
  });

  it('does not reuse another session or another Map as audit evidence', async () => {
    const first = setup({ detail: polygon('WA') });
    (await first.audit.inspect(first.map, 1000))();
    await expect(first.audit.inspect({ ...first.map } as MapLibreMap, 1000)).rejects.toThrow('海陸データ');
    const second = setup();
    (await second.audit.inspect(second.map, 1000))();
    expect(mocks.getZxy).toHaveBeenCalledTimes(4);
    first.audit.dispose(); second.audit.dispose();
  });

  it('does not classify an archive HTTP 404 or malformed recorded data as an unrecorded tile', async () => {
    const { audit, map } = setup();
    mocks.getZxy.mockRejectedValueOnce(Object.assign(new Error('HTTP 404'), { status: 404 }));
    await expect(audit.inspect(map, 1000)).rejects.toThrow('HTTP 404');
    mocks.getZxy.mockResolvedValue({ data: new Uint8Array([255]).buffer });
    await expect(audit.inspect(map, 1000)).rejects.toThrow();
    audit.dispose();
  });

  it('exposes archive transport failures as ordinary errors rather than MapLibre-suppressed 404s', async () => {
    const { audit } = setup();
    mocks.getZxy.mockRejectedValue(Object.assign(new Error('HTTP 404'), { status: 404 }));
    const [scheme, protocol] = [...mocks.protocols][0];
    const error = await protocol({ url: `${scheme}://archive/8/128/128` }, new AbortController()).catch((error) => error);
    expect(error).toBeInstanceOf(Error);
    expect(error.status).toBeUndefined();
    audit.dispose();
  });

  it.each([undefined, new Uint8Array()])('rejects unrecorded/empty detail if broad land could hide the sea', async (data) => {
    const { audit, map } = setup({ land: polygon('AdmArea'), detail: data });
    await expect(audit.inspect(map, 1000)).rejects.toThrow('海陸データ');
    audit.dispose();
  });

  it('accepts confirmed official ocean coverage, but requires it in this Map after rendering', async () => {
    const { audit, map } = setup({ land: polygon('AdmArea'), water: polygon('waterarea') });
    const assertLoaded = await audit.inspect(map, 1000);
    assertLoaded();
    vi.mocked(map.querySourceFeatures).mockReturnValue([]);
    expect(assertLoaded).toThrow('海陸データ');
    audit.dispose();
  });

  it('does not treat an ocean feature with an uncovered hole as complete coverage', async () => {
    const { audit, map } = setup({ land: polygon('AdmArea'), water: polygon('waterarea', true) });
    await expect(audit.inspect(map, 1000)).rejects.toThrow('海陸データ');
    audit.dispose();
  });

  it('times out and releases its protocol, and never succeeds after cancellation', async () => {
    vi.useFakeTimers();
    const { audit, map } = setup();
    mocks.getHeader.mockReturnValue(new Promise(() => {}));
    const result = expect(audit.inspect(map, 1000)).rejects.toThrow('海陸データ');
    await vi.advanceTimersByTimeAsync(1000);
    await result;
    audit.dispose();
    expect(mocks.protocols.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });
});
