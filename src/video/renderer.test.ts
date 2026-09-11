import { afterEach, describe, expect, it, vi } from 'vitest';
import { GSI_ATTRIBUTION, GSI_STYLE } from '../map/gsiStyle';
import { GSI_OFFICIAL_SOURCE_ID, GSI_OFFICIAL_STYLE } from '../map/gsiOfficialStyle';
import { GSI_VECTOR_CONFIG } from '../map/gsiVectorConfig';
import { createOverviewCamera } from './overviewCamera';

const mocks = vi.hoisted(() => ({
  maps: [] as any[],
  add: vi.fn(async () => {}),
  bitmap: { close: vi.fn() },
}));

vi.mock('maplibre-gl', () => ({
  Map: class {
    options: any;
    jumpTo = vi.fn();
    getZoom = vi.fn(() => 10);
    project = vi.fn(() => ({ x: 100, y: 100 }));
    getCanvas = vi.fn(() => 'map-canvas');
    remove = vi.fn();
    triggerRepaint = vi.fn();
    isStyleLoaded = () => false;
    loaded = () => false;
    areTilesLoaded = () => false;
    once = vi.fn((_event: string, callback: () => void) => queueMicrotask(callback));
    off = vi.fn();
    constructor(options: any) { this.options = options; mocks.maps.push(this); }
  },
}));

vi.mock('mediabunny', () => ({
  BufferTarget: class { buffer = new ArrayBuffer(8); },
  CanvasSource: class { add = mocks.add; close() {} },
  Mp4OutputFormat: class { getSupportedVideoCodecs() { return ['avc']; } },
  Output: class { addVideoTrack() {} async start() {} async finalize() {} },
  Quality: class {},
  getFirstEncodableVideoCodec: async () => 'avc',
}));

afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); mocks.maps.length = 0; });

describe('GSI Vector video background', () => {
  it('loads the shared vector style, applies the video camera before waiting for tiles and reuses one capture for every frame', async () => {
    const context = Object.fromEntries(['drawImage', 'beginPath', 'moveTo', 'lineTo', 'stroke', 'arc', 'fill', 'fillRect', 'fillText'].map((name) => [name, vi.fn()]));
    const createImageBitmap = vi.fn(async () => mocks.bitmap);
    vi.stubGlobal('window', { VideoEncoder: class {}, setTimeout, clearTimeout });
    vi.stubGlobal('requestAnimationFrame', (callback: () => void) => { queueMicrotask(callback); return 1; });
    vi.stubGlobal('createImageBitmap', createImageBitmap);
    vi.stubGlobal('document', {
      body: { appendChild() {} },
      createElement: () => ({ style: {}, remove() {}, getContext: () => context }),
    });
    const { renderRouteVideo } = await import('./renderer');
    const points = [0, 1].map((offset) => ({ id: String(offset), latitude: 35 + offset, longitude: 139, source: 'timelinePath' as const, original: true }));
    const camera = createOverviewCamera(points)!;
    const blob = await renderRouteVideo({
      points, overviewCamera: camera,
      duration: 5, revealRoute: true, onProgress: vi.fn(),
    });
    const map = mocks.maps[0];
    expect(mocks.maps).toHaveLength(1);
    expect(map.options.style).toBe(GSI_STYLE);
    expect(GSI_STYLE.sources[GSI_OFFICIAL_SOURCE_ID]).toMatchObject({
      type: 'vector',
      tiles: ['https://cyberjapandata.gsi.go.jp/xyz/experimental_bvmap/{z}/{x}/{y}.pbf'],
      minzoom: 4,
      maxzoom: 16,
    });
    expect(GSI_STYLE.glyphs).toBe('https://maps.gsi.go.jp/xyz/noto-jp/{fontstack}/{range}.pbf');
    expect(GSI_STYLE.sprite).toBe('https://gsi-cyberjapan.github.io/gsivectortile-mapbox-gl-js/sprite/std');
    expect(GSI_STYLE.layers).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ 'source-layer': 'contour' }),
      expect.objectContaining({ 'source-layer': 'elevation' }),
      expect.objectContaining({ 'source-layer': 'building' }),
    ]));
    expect(GSI_STYLE.layers).toEqual(expect.arrayContaining([
      expect.objectContaining({ 'source-layer': 'road' }),
      expect.objectContaining({ 'source-layer': 'label' }),
      expect.objectContaining({ 'source-layer': 'symbol' }),
      expect.objectContaining({ 'source-layer': 'transp' }),
    ]));
    const officialNationalRouteNumber = GSI_OFFICIAL_STYLE.layers.find((layer) => layer.id === 'gsibv-vectortile-layer-1349') as any;
    const actualNationalRouteNumber = GSI_STYLE.layers.find((layer) => layer.id === 'gsibv-vectortile-layer-1349');
    expect(actualNationalRouteNumber).toMatchObject({
      filter: officialNationalRouteNumber?.filter,
      minzoom: GSI_VECTOR_CONFIG.labels.nationalRouteNumberMinZoom,
      maxzoom: officialNationalRouteNumber?.maxzoom,
      layout: officialNationalRouteNumber?.layout,
    });
    expect(map.once.mock.calls.map((call: any[]) => call[0])).toEqual(['style.load', 'idle']);
    expect(map.jumpTo).toHaveBeenCalledWith({ center: [camera.longitude, camera.latitude], zoom: camera.zoom, bearing: camera.bearing, pitch: camera.pitch });
    expect(map.jumpTo.mock.invocationCallOrder[0]).toBeLessThan(map.once.mock.invocationCallOrder[1]);
    expect(map.getCanvas).toHaveBeenCalledTimes(1);
    expect(createImageBitmap).toHaveBeenCalledTimes(1);
    expect(context.drawImage.mock.calls.filter((call) => call[0] === mocks.bitmap)).toHaveLength(330);
    expect(context.fillText).toHaveBeenCalledWith(GSI_ATTRIBUTION, 34, 1055);
    expect(mocks.add).toHaveBeenCalledTimes(330);
    expect(mocks.bitmap.close).toHaveBeenCalledOnce();
    expect(map.remove).toHaveBeenCalledOnce();
    expect(map.remove.mock.invocationCallOrder[0]).toBeLessThan(mocks.add.mock.invocationCallOrder[0]);
    expect(blob.type).toBe('video/mp4');
  });
});
