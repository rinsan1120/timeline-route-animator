import { GSI_ZOOM_CONFIG } from '../map/gsiZoomConfig';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GSI_ATTRIBUTION, GSI_STYLE, GSI_DEM_SOURCE_ID, GSI_TERRAIN_TINT_LAYER_ID } from '../map/gsiStyle';
import { GSI_OFFICIAL_SOURCE_ID, GSI_OFFICIAL_STYLE } from '../map/gsiOfficialStyle';
import { createOverviewCamera } from './overviewCamera';

const mocks = vi.hoisted(() => ({
  maps: [] as any[],
  add: vi.fn(async () => {}),
  bitmap: { close: vi.fn() },
}));

vi.mock('maplibre-gl', () => ({
  Map: class {
    options: any;
    sources: Record<string, any>;
    layers: Record<string, any>;
    listeners = new Map<string, { callback: (event: any) => void; once: boolean }[]>();
    readySources = new Set<string>();
    styleLoaded = false;
    removed = false;
    zoom: number;
    tileTimer: ReturnType<typeof setTimeout> | undefined;
    emit = vi.fn((type: string, data = {}) => {
      for (const listener of [...(this.listeners.get(type) ?? [])]) {
        if (listener.once) this.off(type, listener.callback);
        listener.callback({ type, target: this, ...data });
      }
    });
    on = vi.fn((event: string, callback: (event: any) => void) => {
      this.listeners.set(event, [...(this.listeners.get(event) ?? []), { callback, once: false }]);
      return this;
    });
    once = vi.fn((event: string, callback: (event: any) => void) => {
      this.listeners.set(event, [...(this.listeners.get(event) ?? []), { callback, once: true }]);
      return this;
    });
    off = vi.fn((event: string, callback: (event: any) => void) => {
      this.listeners.set(event, (this.listeners.get(event) ?? []).filter((listener) => listener.callback !== callback));
      return this;
    });
    jumpTo = vi.fn((camera: { zoom?: number }) => {
      this.zoom = camera.zoom ?? this.zoom;
      this.readySources.clear();
      for (const sourceId of Object.keys(this.sources)) this.emit('sourcedataloading', { sourceId });
      // DEM completes first; Vector tiles complete in the next task, exercising both waits.
      queueMicrotask(() => {
        if (this.removed) return;
        for (const [sourceId, source] of Object.entries(this.sources)) {
          if (source.type === 'raster-dem') {
            this.readySources.add(sourceId);
            this.emit('sourcedata', { sourceId });
          }
        }
        this.triggerRepaint();
      });
      clearTimeout(this.tileTimer);
      this.tileTimer = setTimeout(() => {
        if (this.removed) return;
        for (const sourceId of Object.keys(this.sources)) {
          this.readySources.add(sourceId);
          this.emit('sourcedata', { sourceId });
        }
        this.triggerRepaint();
      }, 0);
      return this;
    });
    getZoom = vi.fn(() => this.zoom);
    getSource = vi.fn((id: string) => this.sources[id]);
    getLayer = vi.fn((id: string) => this.layers[id]);
    removeLayer = vi.fn((id: string) => { delete this.layers[id]; return this; });
    removeSource = vi.fn((id: string) => {
      delete this.sources[id];
      this.readySources.delete(id);
      this.triggerRepaint();
      return this;
    });
    isSourceLoaded = vi.fn((id: string) => !!this.sources[id] && this.readySources.has(id));
    project = vi.fn(() => ({ x: 100, y: 100 }));
    getCanvas = vi.fn(() => 'map-canvas');
    remove = vi.fn(() => {
      this.removed = true;
      clearTimeout(this.tileTimer);
      this.emit('remove');
      this.listeners.clear();
    });
    triggerRepaint = vi.fn(() => {
      queueMicrotask(() => {
        if (this.removed) return;
        this.emit('render');
        if (this.loaded()) this.emit('idle');
      });
      return this;
    });
    isStyleLoaded = () => this.styleLoaded;
    loaded = () => this.styleLoaded && this.areTilesLoaded();
    areTilesLoaded = () => Object.keys(this.sources).every((id) => this.readySources.has(id));
    constructor(options: any) {
      this.options = options;
      this.zoom = options.zoom;
      this.sources = { ...options.style.sources };
      this.layers = Object.fromEntries(options.style.layers.map((layer: any) => [layer.id, layer]));
      mocks.maps.push(this);
      queueMicrotask(() => {
        if (this.removed) return;
        this.styleLoaded = true;
        this.emit('style.load');
      });
    }
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
  it('adds pause seconds to output duration and frame count', async () => {
    const { outputVideoDuration, outputVideoFrameCount } = await import('./renderer');
    expect(outputVideoDuration(30)).toBe(36);
    expect(outputVideoDuration(30, 5)).toBe(41);
    expect(outputVideoFrameCount(30, 5)).toBe(41 * 30);
  });

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
    expect(GSI_STYLE.sources[GSI_DEM_SOURCE_ID]).toMatchObject({ type: 'raster-dem', encoding: 'custom' });
    expect(GSI_STYLE.layers).toContainEqual(expect.objectContaining({
      id: GSI_TERRAIN_TINT_LAYER_ID, type: 'color-relief', source: GSI_DEM_SOURCE_ID,
    }));
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
      minzoom: GSI_ZOOM_CONFIG.labels.nationalRouteNumber,
      maxzoom: officialNationalRouteNumber?.maxzoom,
      layout: officialNationalRouteNumber?.layout,
    });
    expect(map.once.mock.calls.map((call: any[]) => call[0])).toEqual(['remove', 'style.load', 'idle']);
    expect(map.jumpTo).toHaveBeenCalledWith({ center: [camera.longitude, camera.latitude], zoom: camera.zoom, bearing: camera.bearing, pitch: camera.pitch });
    const idleWaitIndex = map.once.mock.calls.findIndex(([event]: any[]) => event === 'idle');
    expect(map.jumpTo.mock.invocationCallOrder[0]).toBeLessThan(map.once.mock.invocationCallOrder[idleWaitIndex]);
    const demReadyIndex = map.isSourceLoaded.mock.calls.findIndex(([id]: any[]) => id === GSI_DEM_SOURCE_ID);
    expect(demReadyIndex).toBeGreaterThanOrEqual(0);
    expect(map.jumpTo.mock.invocationCallOrder[0]).toBeLessThan(map.isSourceLoaded.mock.invocationCallOrder[demReadyIndex]);
    const idleEventIndex = map.emit.mock.calls.findIndex(([event]: any[]) => event === 'idle');
    expect(idleEventIndex).toBeGreaterThanOrEqual(0);
    expect(map.emit.mock.invocationCallOrder[idleEventIndex]).toBeLessThan(map.getCanvas.mock.invocationCallOrder[0]);
    expect(map.removeLayer).not.toHaveBeenCalled();
    expect(map.removeSource).not.toHaveBeenCalled();
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
