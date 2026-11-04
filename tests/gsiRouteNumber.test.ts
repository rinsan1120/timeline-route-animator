import { afterEach, describe, expect, it, vi } from 'vitest';
import { VectorTile } from '@mapbox/vector-tile';
import { PbfReader, PbfWriter } from 'pbf';
import fixture from './fixtures/gsi-route-number.json';
import { createGsiRouteNumberProtocol, createRouteNumberSupplement, GSI_ROUTE_NUMBER_SOURCE_LAYER, routeNumberChildren, supplementRouteNumbers } from '../src/map/gsiRouteNumber';
import { GSI_STYLE } from '../src/map/gsiStyle';
import { GSI_OFFICIAL_SOURCE_ID, GSI_OFFICIAL_STYLE } from '../src/map/gsiOfficialStyle';
import { GSI_VECTOR_CONFIG } from '../src/map/gsiVectorConfig';

function encode(points: (string | number)[][] = [], extent = 4096, name = 'transp') {
  const writer = new PbfWriter();
  writer.writeMessage(3, (_, layer) => {
    layer.writeStringField(1, name);
    points.forEach(([x, y, code, number, type], i) => layer.writeMessage(2, (_, feature) => {
      feature.writePackedVarint(2, [0, i * 2, 1, i * 2 + 1]);
      feature.writeVarintField(3, Number(type));
      const geometry = new PbfWriter();
      geometry.writeVarint(9);
      geometry.writeSVarint(Number(x)); geometry.writeSVarint(Number(y));
      if (type === 2) { geometry.writeVarint(10); geometry.writeSVarint(10); geometry.writeSVarint(10); }
      feature.writeBytesField(4, geometry.finish());
    }, null));
    layer.writeStringField(3, 'ftCode'); layer.writeStringField(3, 'nRNo');
    for (const [, , code, number] of points) {
      layer.writeMessage(4, (_, value) => value.writeVarintField(5, Number(code)), null);
      layer.writeMessage(4, (_, value) => value.writeStringField(1, String(number)), null);
    }
    layer.writeVarintField(5, extent); layer.writeVarintField(15, 2);
  }, null);
  return writer.finish();
}
const original = encode([[100, 200, 2904, 'E2', 1]]);
const children = fixture.children.map((child) => ({ coordinate: child, data: encode(child.points, child.extent) }));
const dataByTile = new Map(children.map((child) => [`${child.coordinate.x}/${child.coordinate.y}`, child.data]));
function shields(data: Uint8Array) {
  const layer = new VectorTile(new PbfReader(data)).layers[GSI_ROUTE_NUMBER_SOURCE_LAYER];
  return Array.from({ length: layer.length }, (_, i) => {
    const feature = layer.feature(i), point = feature.loadGeometry()[0][0];
    return [point.x, point.y, feature.properties.nRNo];
  });
}
afterEach(() => vi.unstubAllGlobals());

describe('GSI national route number supplement', () => {
  it('appends only national shields at parent coordinates, deduplicating buffered children', () => {
    const result = supplementRouteNumbers(original, fixture.parent, children);
    expect(result.slice(0, original.length)).toEqual(original);
    expect(Object.keys(new VectorTile(new PbfReader(result)).layers)).toEqual(['transp', GSI_ROUTE_NUMBER_SOURCE_LAYER]);
    expect(shields(result)).toEqual([[8192, 4096, '12'], [2048, 2048, '34'], [2048, 2048, '78'], [4096, 10240, '90']]);
    expect(supplementRouteNumbers(result, fixture.parent, children)).toBe(result);
  });

  it('returns original bytes for missing or empty child tiles, but accepts a valid tile without transp', () => {
    expect(supplementRouteNumbers(original, fixture.parent, children.slice(1))).toBe(original);
    expect(supplementRouteNumbers(original, fixture.parent, children.map((child, i) => i ? child : { ...child, data: undefined }))).toBe(original);
    expect(supplementRouteNumbers(original, fixture.parent, children.map((child, i) => i ? child : { ...child, data: new Uint8Array() }))).toBe(original);
    const valid = children.map((child, i) => i === 3 ? { ...child, data: encode([], 4096, 'road') } : child);
    expect(shields(supplementRouteNumbers(original, fixture.parent, valid))).toHaveLength(4);
  });

  it.each([4, 6, 7, 9, 10, 16])('never reads children or modifies z%s', async (z) => {
    const read = vi.fn();
    expect(await createRouteNumberSupplement(read)(original, { ...fixture.parent, z }, new AbortController().signal)).toBe(original);
    expect(supplementRouteNumbers(original, { ...fixture.parent, z }, children)).toBe(original);
    expect(read).not.toHaveBeenCalled();
  });

  it.each(['missing', 'failure', 'malformed'])('falls back without stopping the map on child %s', async (failure) => {
    const read = vi.fn(async (tile) => {
      if (tile.x === 201 && tile.y === 161) {
        if (failure === 'failure') throw new Error('network');
        return failure === 'missing' ? undefined : new Uint8Array([255]);
      }
      return dataByTile.get(`${tile.x}/${tile.y}`);
    });
    expect(await createRouteNumberSupplement(read)(original, fixture.parent, new AbortController().signal)).toBe(original);
  });

  it('shares pending children and caches them while keeping Map cancellation independent', async () => {
    const resolvers: (() => void)[] = [];
    const read = vi.fn((tile, _controller: AbortController) => new Promise<Uint8Array | undefined>((resolve) => {
      resolvers.push(() => resolve(dataByTile.get(`${tile.x}/${tile.y}`)));
    }));
    const supplement = createRouteNumberSupplement(read);
    const first = new AbortController(), second = new AbortController();
    const one = supplement(original, fixture.parent, first.signal);
    const rejection = expect(one).rejects.toMatchObject({ name: 'AbortError' });
    const two = supplement(original, fixture.parent, second.signal);
    expect(read).toHaveBeenCalledTimes(4);
    first.abort();
    await rejection;
    expect(read.mock.calls.every(([, controller]) => !controller.signal.aborted)).toBe(true);
    resolvers.forEach((resolve) => resolve());
    expect(shields(await two)).toHaveLength(4);
    await supplement(original, fixture.parent, second.signal);
    expect(read).toHaveBeenCalledTimes(4);
  });

  it('aborts child requests when their final consumer cancels, allowing retry', async () => {
    const read = vi.fn((_tile, controller: AbortController) => new Promise<Uint8Array>((_resolve, reject) => {
      controller.signal.addEventListener('abort', () => reject(controller.signal.reason));
    }));
    const supplement = createRouteNumberSupplement(read);
    const controller = new AbortController();
    const pending = supplement(original, fixture.parent, controller.signal);
    const rejection = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    controller.abort(); await rejection;
    expect(read.mock.calls.every(([, child]) => child.signal.aborted)).toBe(true);
    const retry = new AbortController();
    const again = supplement(original, fixture.parent, retry.signal);
    const rejectedAgain = expect(again).rejects.toMatchObject({ name: 'AbortError' });
    expect(read).toHaveBeenCalledTimes(8);
    retry.abort(); await rejectedAgain;
  });

  it('uses official HTTP URLs/default browser caching and preserves cache metadata, passing z9 through', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      const match = url.match(/\/(\d+)\/(\d+)\/(\d+)\.pbf$/)!;
      const data = Number(match[1]) === 8 ? original : dataByTile.get(`${match[2]}/${match[3]}`) ?? original;
      return new Response(data, { headers: { 'Cache-Control': 'public, max-age=3600', Expires: 'Wed, 04 Nov 2026 00:00:00 GMT' } });
    });
    vi.stubGlobal('fetch', fetchMock);
    const protocol = createGsiRouteNumberProtocol();
    const controller = new AbortController();
    const result = await protocol({ url: 'gsi-route://8/100/80', type: 'arrayBuffer' }, controller);
    expect(shields(result.data as Uint8Array)).toHaveLength(4);
    expect(result.cacheControl).toBe('public, max-age=3600');
    expect(result.expires).toBe('Wed, 04 Nov 2026 00:00:00 GMT');
    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect(fetchMock.mock.calls.every(([url]) => url.startsWith('https://cyberjapandata.gsi.go.jp/xyz/experimental_bvmap/'))).toBe(true);
    fetchMock.mockClear();
    const native = await protocol({ url: 'gsi-route://9/200/160', type: 'arrayBuffer' }, controller);
    expect(native.data).toEqual(children[0].data);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('preserves the native HTTP status for base tiles without requesting children', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 404, statusText: 'Not Found' }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(createGsiRouteNumberProtocol()({ url: 'gsi-route://9/200/160', type: 'arrayBuffer' }, new AbortController()))
      .rejects.toMatchObject({ status: 404 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('uses the configured start zoom, official appearance and exclusive z9 boundary in the shared style', () => {
    const injected = GSI_STYLE.layers.find((layer) => layer.id === 'gsi-lowzoom-national-route-number')!;
    const native = GSI_STYLE.layers.find((layer) => layer.id === 'gsibv-vectortile-layer-1349')!;
    expect(injected).toMatchObject({ type: 'symbol', source: GSI_OFFICIAL_SOURCE_ID, 'source-layer': GSI_ROUTE_NUMBER_SOURCE_LAYER, minzoom: 8.5, maxzoom: 9 });
    expect(injected.layout).toEqual(native.layout);
    expect(injected.paint).toEqual(native.paint);
    expect(injected.layout).toMatchObject({ 'icon-image': '国道番号-20', 'text-field': '{nRNo}', 'icon-size': { stops: [[9, 0.5], [14, 0.5], [17, 1], [18, 1]] }, 'text-size': { stops: [[9, 10], [14, 10], [17, 24], [18, 24]] } });
    expect(GSI_STYLE.layers.at(-1)?.id).toBe(injected.id);
    for (const official of GSI_OFFICIAL_STYLE.layers.filter((layer) => layer.id === native.id)) {
      expect(native).toEqual({ ...official, minzoom: 4, paint: { ...official.paint, 'text-color': '#ffffff' } });
    }
    expect(GSI_VECTOR_CONFIG.labels.showLowZoomNationalRouteNumbers).toBe(true);
    expect(GSI_STYLE.sources[GSI_OFFICIAL_SOURCE_ID]).toMatchObject({ tiles: ['gsi-route://{z}/{x}/{y}'] });
  });
});
