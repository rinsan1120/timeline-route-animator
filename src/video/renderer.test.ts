import { afterEach, describe, expect, it, vi } from 'vitest';
import { OSM_ATTRIBUTION, OSM_STYLE } from '../map/osmStyle';

const mocks = vi.hoisted(() => ({
  maps: [] as any[],
  add: vi.fn(async () => {}),
  bitmap: { close: vi.fn() },
}));

vi.mock('maplibre-gl', () => ({
  Map: class {
    options: any;
    fitBounds = vi.fn();
    project = vi.fn(() => ({ x: 100, y: 100 }));
    getCanvas = vi.fn(() => 'map-canvas');
    remove = vi.fn();
    triggerRepaint = vi.fn();
    isStyleLoaded = () => false;
    loaded = () => false;
    areTilesLoaded = () => false;
    once = vi.fn((_event: string, callback: () => void) => queueMicrotask(callback));
    constructor(options: any) { this.options = options; mocks.maps.push(this); }
  },
  LngLatBounds: class { extend() {} },
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

describe('OSM video background', () => {
  it('loads the shared raster style, fits before waiting for tiles and reuses one capture for every frame', async () => {
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
    const blob = await renderRouteVideo({
      points: [0, 1].map((offset) => ({ id: String(offset), latitude: 35 + offset, longitude: 139, source: 'timelinePath' as const, original: true })),
      duration: 5, revealRoute: true, onProgress: vi.fn(),
    });
    const map = mocks.maps[0];
    expect(mocks.maps).toHaveLength(1);
    expect(map.options.style).toBe(OSM_STYLE);
    expect(OSM_STYLE.sources.osm).toMatchObject({ type: 'raster', tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'], tileSize: 256 });
    expect(map.once.mock.calls.map((call: any[]) => call[0])).toEqual(['style.load', 'idle']);
    expect(map.fitBounds.mock.invocationCallOrder[0]).toBeLessThan(map.once.mock.invocationCallOrder[1]);
    expect(map.getCanvas).toHaveBeenCalledTimes(1);
    expect(createImageBitmap).toHaveBeenCalledTimes(1);
    expect(context.drawImage.mock.calls.filter((call) => call[0] === mocks.bitmap)).toHaveLength(150);
    expect(context.fillText).toHaveBeenCalledWith(OSM_ATTRIBUTION, 34, 1055);
    expect(mocks.add).toHaveBeenCalledTimes(150);
    expect(mocks.bitmap.close).toHaveBeenCalledOnce();
    expect(map.remove).toHaveBeenCalledOnce();
    expect(map.remove.mock.invocationCallOrder[0]).toBeLessThan(mocks.add.mock.invocationCallOrder[0]);
    expect(blob.type).toBe('video/mp4');
  });
});
