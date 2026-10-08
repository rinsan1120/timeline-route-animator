import { GSI_ZOOM_CONFIG } from '../map/gsiZoomConfig';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GSI_ATTRIBUTION, GSI_STYLE, GSI_DEM_SOURCE_ID, GSI_TERRAIN_TINT_LAYER_ID, GSI_LOW_ZOOM_LAND_SOURCE_ID, GSI_DETAILED_LAND_SOURCE_ID, GSI_REQUIRED_VECTOR_SOURCE_IDS } from '../map/gsiStyle';
import { GSI_COLOR_CONFIG } from '../map/gsiColorConfig';
import { expression } from '@maplibre/maplibre-gl-style-spec';
import { GSI_OFFICIAL_SOURCE_ID, GSI_OFFICIAL_STYLE } from '../map/gsiOfficialStyle';
import { createOverviewCamera } from './overviewCamera';
import { buildFollowCameraPlan, type FollowViewMode } from './followCamera';
import { imageCamera } from '../spot/imageBounds';
import { DEFAULT_ANNOTATION_STYLE } from '../route/annotationStyle';
import type { RoutePoint } from '../timeline/types';

const mocks = vi.hoisted(() => ({
  maps: [] as any[],
  add: vi.fn(async () => {}),
  bitmap: { close: vi.fn() },
  cancel: vi.fn(async () => {}),
  configureMap: null as null | ((map: any, index: number) => void),
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
      mocks.configureMap?.(this, mocks.maps.length - 1);
      queueMicrotask(() => {
        if (this.removed) return;
        this.styleLoaded = true;
        for (const sourceId of Object.keys(this.sources)) this.readySources.add(sourceId);
        this.emit('style.load');
      });
    }
  },
}));

vi.mock('mediabunny', () => ({
  BufferTarget: class { buffer = new ArrayBuffer(8); },
  CanvasSource: class { add = mocks.add; close() {} },
  Mp4OutputFormat: class { getSupportedVideoCodecs() { return ['avc']; } },
  Output: class { addVideoTrack() {} async start() {} async finalize() {} cancel = mocks.cancel; },
  Quality: class {},
  getFirstEncodableVideoCodec: async () => 'avc',
}));

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.clearAllMocks(); mocks.maps.length = 0; mocks.configureMap = null; });

function setupVideoEnvironment() {
  const context = Object.fromEntries(['drawImage', 'beginPath', 'moveTo', 'lineTo', 'stroke', 'arc', 'fill', 'fillRect', 'fillText'].map((name) => [name, vi.fn()]));
  const createImageBitmap = vi.fn(async () => mocks.bitmap);
  vi.stubGlobal('window', { VideoEncoder: class {}, setTimeout, clearTimeout });
  vi.stubGlobal('requestAnimationFrame', (callback: () => void) => { queueMicrotask(callback); return 1; });
  vi.stubGlobal('createImageBitmap', createImageBitmap);
  vi.stubGlobal('document', {
    body: { appendChild() {} },
    createElement: () => ({ style: {}, remove() {}, getContext: () => context }),
  });
  const points = [[0, 0], [0.01, 0], [0.01, 0.01]].map(([longitude, latitude], index) => ({
    id: String(index), longitude, latitude, source: 'manual' as const, original: false,
  }));
  return { context, createImageBitmap, points };
}

function failMapJump(map: any, jumpNumber: number, sourceId: string) {
  const jump = map.jumpTo.getMockImplementation()!;
  map.jumpTo.mockImplementation((camera: any) => {
    jump(camera);
    if (map.jumpTo.mock.calls.length === jumpNumber) {
      queueMicrotask(() => map.emit('error', { sourceId, error: new Error('synthetic tile failure') }));
    }
    return map;
  });
}

describe('MP4 map readiness and retry', () => {
  it.each([4, 10])('never captures an incomplete overview at zoom %s, even after 2.5 seconds, and stops after two timeouts', async (zoom) => {
    vi.useFakeTimers();
    const { createImageBitmap, points } = setupVideoEnvironment();
    mocks.configureMap = (map) => {
      map.areTilesLoaded = () => false;
      // An idle notification alone must not bypass readiness checks.
      map.triggerRepaint.mockImplementation(() => {
        queueMicrotask(() => { if (!map.removed) { map.emit('render'); map.emit('idle'); } });
        return map;
      });
    };
    const { renderRouteVideo } = await import('./renderer');
    const rejection = expect(renderRouteVideo({
      points, overviewCamera: { longitude: 0, latitude: 0, zoom, bearing: 0, pitch: 0 },
      duration: 5, revealRoute: true, onProgress: vi.fn(),
    })).rejects.toThrow('動画用の地図データを完全に読み込めませんでした');
    await vi.advanceTimersByTimeAsync(2_500);
    expect(mocks.maps).toHaveLength(1);
    expect(mocks.maps[0].getCanvas).not.toHaveBeenCalled();
    expect(createImageBitmap).not.toHaveBeenCalled();
    expect(mocks.add).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(17_500);
    expect(mocks.maps).toHaveLength(2);
    expect(mocks.maps[0].remove).toHaveBeenCalledOnce();
    expect(mocks.maps[1].options).toEqual(mocks.maps[0].options);
    await vi.advanceTimersByTimeAsync(20_000);
    await rejection;
    expect(mocks.maps.every((map) => map.options.style === GSI_STYLE && map.removed && map.getCanvas.mock.calls.length === 0)).toBe(true);
    expect(mocks.add).not.toHaveBeenCalled();
  });

  it.each(['overview', 'follow'] as const)('recreates the map once after an initial Vector error in %s', async (cameraMode) => {
    const { points } = setupVideoEnvironment();
    mocks.configureMap = (map, index) => { if (index === 0) failMapJump(map, 1, GSI_OFFICIAL_SOURCE_ID); };
    const { renderRouteVideo } = await import('./renderer');
    const blob = await renderRouteVideo({ points, cameraMode, duration: 5, routeMarkerMode: 'none', revealRoute: true, onProgress: vi.fn() });
    expect(blob.type).toBe('video/mp4');
    expect(mocks.maps).toHaveLength(2);
    expect(mocks.maps[0].getCanvas).not.toHaveBeenCalled();
    expect(mocks.maps[0].remove).toHaveBeenCalledOnce();
    expect(mocks.maps[1].options).toEqual(mocks.maps[0].options);
    expect(mocks.maps[0].remove.mock.invocationCallOrder[0]).toBeLessThan(mocks.maps[1].jumpTo.mock.invocationCallOrder[0]);
    expect(mocks.add).toHaveBeenCalledTimes(330);
  });

  it.each(['overview', 'follow'] as const)('rejects two initial Vector failures in %s without encoding any frame', async (cameraMode) => {
    const { points, createImageBitmap } = setupVideoEnvironment();
    mocks.configureMap = (map) => failMapJump(map, 1, GSI_LOW_ZOOM_LAND_SOURCE_ID);
    const { renderRouteVideo } = await import('./renderer');
    await expect(renderRouteVideo({ points, cameraMode, duration: 5, revealRoute: true, onProgress: vi.fn() }))
      .rejects.toThrow('もう一度MP4を生成してください');
    expect(mocks.maps).toHaveLength(2);
    expect(mocks.maps.every((map) => map.removed && map.listeners.size === 0)).toBe(true);
    expect(createImageBitmap).not.toHaveBeenCalled();
    expect(mocks.add).not.toHaveBeenCalled();
  });

  it.each([false, true])('retries a changed oblique follow background once (second failure=%s)', async (failAgain) => {
    const { points } = setupVideoEnvironment();
    mocks.configureMap = (map, index) => {
      if (index === 0) failMapJump(map, 3, GSI_OFFICIAL_SOURCE_ID);
      if (index === 1 && failAgain) failMapJump(map, 1, GSI_OFFICIAL_SOURCE_ID);
    };
    const { renderRouteVideo } = await import('./renderer');
    const result = renderRouteVideo({ points, cameraMode: 'follow', followViewMode: 'oblique', duration: 5, routeMarkerMode: 'none', revealRoute: true, onProgress: vi.fn() });
    if (failAgain) await expect(result).rejects.toThrow('もう一度MP4を生成してください');
    else expect((await result).type).toBe('video/mp4');
    expect(mocks.maps).toHaveLength(2);
    expect(mocks.maps[0].getCanvas).toHaveBeenCalledOnce();
    const failedCamera = mocks.maps[0].jumpTo.mock.calls[2][0];
    expect(mocks.maps[1].jumpTo.mock.calls[0][0]).toEqual(failedCamera);
    expect(failedCamera.pitch).toBe(45);
    expect(mocks.maps.every((map) => map.removed)).toBe(true);
    if (failAgain) {
      expect(mocks.maps[1].getCanvas).not.toHaveBeenCalled();
      expect(mocks.add.mock.calls.length).toBeLessThan(330);
      expect(mocks.cancel).toHaveBeenCalledOnce();
    } else expect(mocks.add).toHaveBeenCalledTimes(330);
  });

  it.each(['overview', 'follow'] as const)('keeps DEM-only failure optional in %s', async (cameraMode) => {
    const { points } = setupVideoEnvironment();
    mocks.configureMap = (map) => failMapJump(map, 1, GSI_DEM_SOURCE_ID);
    const { renderRouteVideo } = await import('./renderer');
    await renderRouteVideo({ points, cameraMode, duration: 5, routeMarkerMode: 'none', revealRoute: true, onProgress: vi.fn() });
    expect(mocks.maps).toHaveLength(1);
    expect(mocks.maps[0].removeSource).toHaveBeenCalledWith(GSI_DEM_SOURCE_ID);
    expect(mocks.maps[0].removeLayer).toHaveBeenCalledWith(GSI_TERRAIN_TINT_LAYER_ID);
    expect(mocks.maps[0].getSource(GSI_OFFICIAL_SOURCE_ID)).toBeDefined();
    expect(mocks.add).toHaveBeenCalledTimes(330);
  });

  it('waits for every overview intro viewport and retries its failed frame without changing frame count', async () => {
    const { points } = setupVideoEnvironment();
    mocks.configureMap = (map, index) => { if (index === 0) failMapJump(map, 3, GSI_OFFICIAL_SOURCE_ID); };
    const { renderRouteVideo } = await import('./renderer');
    await renderRouteVideo({ points, introZoomEnabled: true, duration: 5, routeMarkerMode: 'none', revealRoute: true, onProgress: vi.fn() });
    expect(mocks.maps).toHaveLength(2);
    expect(mocks.maps[1].jumpTo.mock.calls[0][0]).toEqual(mocks.maps[0].jumpTo.mock.calls[2][0]);
    expect(mocks.add).toHaveBeenCalledTimes(330);
    expect(mocks.maps.every((map) => map.removed)).toBe(true);
  });
});

function setupImageEnvironment() {
  const { context, points } = setupVideoEnvironment();
  Object.assign(context, { measureText: vi.fn(() => ({ width: 80 })) });
  for (const name of ['save', 'restore', 'closePath', 'quadraticCurveTo']) context[name] = vi.fn();
  const canvas = { width: 0, height: 0, getContext: vi.fn(() => context),
    toBlob: vi.fn((callback: (blob: Blob) => void) => callback(new Blob(['synthetic png'], { type: 'image/png' }))) };
  const container = { style: {}, remove: vi.fn() };
  vi.stubGlobal('document', { fonts: { ready: Promise.resolve() }, body: { appendChild: vi.fn() },
    createElement: vi.fn((name) => name === 'canvas' ? canvas : container) });
  const bounds = { west: -0.02, east: 0.02, north: 0.02, south: -0.02 };
  return { context, canvas, container, points: points.slice(0, 1) as RoutePoint[], bounds };
}

describe('Spot PNG map readiness and retry', () => {
  it('keeps the image camera, spot size, attribution and PNG dimensions after every required source is ready', async () => {
    const { context, canvas, container, points, bounds } = setupImageEnvironment();
    const { renderSpotImage } = await import('../spot/renderSpotImage');
    expect((await renderSpotImage(points, bounds, DEFAULT_ANNOTATION_STYLE)).type).toBe('image/png');
    expect(mocks.maps).toHaveLength(1);
    const map = mocks.maps[0];
    expect(map.options).toMatchObject({ style: GSI_STYLE, ...imageCamera(bounds), pixelRatio: 1 });
    expect(map.jumpTo).not.toHaveBeenCalled();
    for (const id of GSI_REQUIRED_VECTOR_SOURCE_IDS) {
      const index = map.isSourceLoaded.mock.calls.findIndex(([sourceId]: string[]) => sourceId === id);
      expect(index).toBeGreaterThanOrEqual(0);
      expect(map.isSourceLoaded.mock.invocationCallOrder[index]).toBeLessThan(map.getCanvas.mock.invocationCallOrder[0]);
    }
    expect(canvas).toMatchObject({ width: 1920, height: 1080 });
    expect(context.drawImage).toHaveBeenCalledWith('map-canvas', 0, 0, 1920, 1080);
    expect(context.arc).toHaveBeenCalledWith(100, 100, 23, 0, Math.PI * 2);
    expect(context.fillText).toHaveBeenCalledWith(GSI_ATTRIBUTION, 34, 1055);
    expect(canvas.toBlob).toHaveBeenCalledOnce();
    expect(map.removed).toBe(true);
    expect(map.listeners.size).toBe(0);
    expect(container.remove).toHaveBeenCalledOnce();
  });

  it.each(['style', 'loaded', 'tiles', ...GSI_REQUIRED_VECTOR_SOURCE_IDS])('rejects premature idle with incomplete %s, retries once, and never creates a PNG', async (incomplete) => {
    vi.useFakeTimers();
    const { context, canvas, container, points, bounds } = setupImageEnvironment();
    mocks.configureMap = (map) => {
      if (incomplete === 'style') map.isStyleLoaded = () => false;
      else if (incomplete === 'loaded') map.loaded = () => false;
      else if (incomplete === 'tiles') map.areTilesLoaded = () => false;
      else {
        const original = map.isSourceLoaded.getMockImplementation();
        map.isSourceLoaded.mockImplementation((id: string) => id !== incomplete && original(id));
      }
      map.triggerRepaint.mockImplementation(() => {
        queueMicrotask(() => { if (!map.removed) map.emit('idle'); });
        return map;
      });
    };
    const { renderSpotImage } = await import('../spot/renderSpotImage');
    const rejection = expect(renderSpotImage(points, bounds, DEFAULT_ANNOTATION_STYLE)).rejects.toThrow('もう一度PNG');
    await vi.advanceTimersByTimeAsync(29_999);
    expect(mocks.maps).toHaveLength(1);
    expect(canvas.toBlob).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(mocks.maps).toHaveLength(2);
    expect(mocks.maps[0].removed).toBe(true);
    expect(mocks.maps[1].options).toEqual(mocks.maps[0].options);
    await vi.advanceTimersByTimeAsync(30_000);
    await rejection;
    expect(context.drawImage).not.toHaveBeenCalled();
    expect(canvas.toBlob).not.toHaveBeenCalled();
    expect(mocks.maps.every((map) => map.removed && map.listeners.size === 0)).toBe(true);
    expect(container.remove).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(GSI_REQUIRED_VECTOR_SOURCE_IDS)('recreates once after a %s error, without changing the camera or source style', async (sourceId) => {
    const { canvas, points, bounds } = setupImageEnvironment();
    mocks.configureMap = (map, index) => {
      if (!index) queueMicrotask(() => map.emit('error', { sourceId }));
    };
    const { renderSpotImage } = await import('../spot/renderSpotImage');
    await renderSpotImage(points, bounds, DEFAULT_ANNOTATION_STYLE);
    expect(mocks.maps).toHaveLength(2);
    expect(mocks.maps[0].getCanvas).not.toHaveBeenCalled();
    expect(mocks.maps[1].options).toEqual(mocks.maps[0].options);
    expect(mocks.maps.every((map) => map.removed)).toBe(true);
    expect(canvas.toBlob).toHaveBeenCalledOnce();
  });

  it.each(GSI_REQUIRED_VECTOR_SOURCE_IDS)('aborts PNG creation after two missing-source failures (%s)', async (sourceId) => {
    const { context, canvas, points, bounds } = setupImageEnvironment();
    mocks.configureMap = (map) => { delete map.sources[sourceId]; };
    const { renderSpotImage } = await import('../spot/renderSpotImage');
    await expect(renderSpotImage(points, bounds, DEFAULT_ANNOTATION_STYLE)).rejects.toThrow('画像用の地図データ');
    expect(mocks.maps).toHaveLength(2);
    expect(mocks.maps.every((map) => map.removed)).toBe(true);
    expect(context.drawImage).not.toHaveBeenCalled();
    expect(canvas.toBlob).not.toHaveBeenCalled();
  });

  it('stops after two tile errors without returning a Blob for the save operation', async () => {
    const { canvas, points, bounds } = setupImageEnvironment();
    mocks.configureMap = (map) => queueMicrotask(() => map.emit('error', { sourceId: GSI_OFFICIAL_SOURCE_ID }));
    const { renderSpotImage } = await import('../spot/renderSpotImage');
    await expect(renderSpotImage(points, bounds, DEFAULT_ANNOTATION_STYLE)).rejects.toThrow('もう一度PNG');
    expect(mocks.maps).toHaveLength(2);
    expect(mocks.maps.every((map) => map.removed && map.getCanvas.mock.calls.length === 0)).toBe(true);
    expect(canvas.toBlob).not.toHaveBeenCalled();
  });

  it('recovers from one timeout at the same image camera', async () => {
    vi.useFakeTimers();
    const { canvas, points, bounds } = setupImageEnvironment();
    mocks.configureMap = (map, index) => { if (!index) map.areTilesLoaded = () => false; };
    const { renderSpotImage } = await import('../spot/renderSpotImage');
    const result = renderSpotImage(points, bounds, DEFAULT_ANNOTATION_STYLE);
    await vi.advanceTimersByTimeAsync(30_000);
    expect((await result).type).toBe('image/png');
    expect(mocks.maps).toHaveLength(2);
    expect(mocks.maps[1].options).toEqual(mocks.maps[0].options);
    expect(canvas.toBlob).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('allows only two instances across initial loading and final camera adjustment combined', async () => {
    const { canvas, points, bounds } = setupImageEnvironment();
    const initial = imageCamera(bounds);
    mocks.configureMap = (map, index) => {
      map.project.mockImplementation(() => ({ x: map.zoom > initial.zoom - 0.4 ? 5 : 400, y: 300 }));
      if (!index) queueMicrotask(() => map.emit('error', { sourceId: GSI_OFFICIAL_SOURCE_ID }));
      else failMapJump(map, 1, GSI_DETAILED_LAND_SOURCE_ID);
    };
    const { renderSpotImage } = await import('../spot/renderSpotImage');
    await expect(renderSpotImage(points, bounds, DEFAULT_ANNOTATION_STYLE)).rejects.toThrow('もう一度PNG');
    expect(mocks.maps).toHaveLength(2);
    expect(mocks.maps.every((map) => map.removed)).toBe(true);
    expect(canvas.toBlob).not.toHaveBeenCalled();
  });

  it.each([false, true])('retries the final fitted camera with identical balloons (second failure=%s)', async (failAgain) => {
    const { context, canvas, points, bounds } = setupImageEnvironment();
    points[0] = { ...points[0], annotation: { label: 'スポット', placement: { offsetX: 10, offsetY: -80 } } };
    const initial = imageCamera(bounds);
    mocks.configureMap = (map, index) => {
      map.project.mockImplementation(() => ({ x: map.zoom > initial.zoom - 0.4 ? 5 : 400, y: 300 }));
      if (!index) failMapJump(map, 1, GSI_DETAILED_LAND_SOURCE_ID);
      if (index && failAgain) queueMicrotask(() => map.emit('error', { sourceId: GSI_OFFICIAL_SOURCE_ID }));
    };
    const { renderSpotImage } = await import('../spot/renderSpotImage');
    const result = renderSpotImage(points, bounds, DEFAULT_ANNOTATION_STYLE);
    if (failAgain) await expect(result).rejects.toThrow('もう一度PNG');
    else await result;
    expect(mocks.maps).toHaveLength(2);
    const first = mocks.maps[0], second = mocks.maps[1];
    const finalCamera = first.jumpTo.mock.calls.at(-1)[0];
    expect(finalCamera.zoom).toBeCloseTo(initial.zoom - 0.4, 3);
    expect(second.options).toMatchObject({ ...finalCamera, style: GSI_STYLE });
    expect(second.jumpTo).not.toHaveBeenCalled();
    expect(first.getCanvas).not.toHaveBeenCalled();
    expect(mocks.maps.every((map) => map.removed)).toBe(true);
    if (failAgain) expect(canvas.toBlob).not.toHaveBeenCalled();
    else {
      expect(context.arc).toHaveBeenCalledWith(400, 300, 23, 0, Math.PI * 2);
      expect(context.fillText).toHaveBeenCalledWith('スポット', expect.any(Number), expect.any(Number));
      expect(canvas.toBlob).toHaveBeenCalledOnce();
    }
  });

  it('accepts DEM failure through the existing fallback without recreating a map', async () => {
    const { canvas, points, bounds } = setupImageEnvironment();
    mocks.configureMap = (map) => queueMicrotask(() => map.emit('error', { sourceId: GSI_DEM_SOURCE_ID }));
    const { renderSpotImage } = await import('../spot/renderSpotImage');
    await renderSpotImage(points, bounds, DEFAULT_ANNOTATION_STYLE);
    expect(mocks.maps).toHaveLength(1);
    expect(mocks.maps[0].removeSource).toHaveBeenCalledWith(GSI_DEM_SOURCE_ID);
    expect(canvas.toBlob).toHaveBeenCalledOnce();
  });

  it('keeps a DEM-only timeout optional and waits for its fallback before capturing', async () => {
    vi.useFakeTimers();
    const { canvas, points, bounds } = setupImageEnvironment();
    mocks.configureMap = (map) => {
      const loaded = map.isSourceLoaded.getMockImplementation();
      map.isSourceLoaded.mockImplementation((id: string) => id !== GSI_DEM_SOURCE_ID && loaded(id));
      map.areTilesLoaded = () => Object.keys(map.sources).every((id) => map.isSourceLoaded(id));
      queueMicrotask(() => map.emit('sourcedataloading', { sourceId: GSI_DEM_SOURCE_ID }));
    };
    const { renderSpotImage } = await import('../spot/renderSpotImage');
    const result = renderSpotImage(points, bounds, DEFAULT_ANNOTATION_STYLE);
    await vi.advanceTimersByTimeAsync(9_999);
    expect(canvas.toBlob).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect((await result).type).toBe('image/png');
    expect(mocks.maps).toHaveLength(1);
    expect(mocks.maps[0].removeSource).toHaveBeenCalledWith(GSI_DEM_SOURCE_ID);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('GSI Vector video background', () => {
  it('keeps ocean and overzoomed land across zoom 8, with precise coastal/land/water faces below terrain and detailed vectors', () => {
    expect(GSI_STYLE.layers[0]).toMatchObject({
      id: 'gsi-background', type: 'background', paint: {
        'background-color': ['step', ['zoom'], GSI_COLOR_CONFIG.background, 4, GSI_COLOR_CONFIG.water],
      },
    });
    const background = GSI_STYLE.layers[0];
    if (background.type !== 'background') throw new Error('Expected background layer');
    const parsed = expression.createExpression(background.paint?.['background-color'], 'layers[0].paint.background-color');
    if (parsed.result !== 'success') throw new Error('Invalid background expression');
    for (const [zoom, color] of [[0, GSI_COLOR_CONFIG.background], [3.99, GSI_COLOR_CONFIG.background], ...[4, 7.5, 7.99, 8, 8.01, 8.2, 9, 10, 11, 13.99, 14, 16].map((zoom) => [zoom, GSI_COLOR_CONFIG.water] as const)] as const) {
      expect(parsed.value.evaluate({ zoom })).toBe(color);
    }
    const land = GSI_STYLE.layers[1];
    const coastal = GSI_STYLE.layers[2];
    const detailedLand = GSI_STYLE.layers[3];
    const water = GSI_STYLE.layers[4];
    expect(land).toMatchObject({
      id: 'gsi-lowzoom-land', type: 'fill', source: GSI_LOW_ZOOM_LAND_SOURCE_ID,
      'source-layer': 'AdmArea', minzoom: 4, paint: { 'fill-color': GSI_COLOR_CONFIG.background },
    });
    expect(water).toMatchObject({
      id: 'gsi-fallback-water', type: 'fill', source: GSI_DETAILED_LAND_SOURCE_ID,
      'source-layer': 'WA', minzoom: 4, paint: { 'fill-color': GSI_COLOR_CONFIG.water },
    });
    expect(land.maxzoom).toBeUndefined();
    expect(water.maxzoom).toBeUndefined();
    expect(GSI_STYLE.sources[GSI_LOW_ZOOM_LAND_SOURCE_ID]).toMatchObject({
      type: 'vector', minzoom: 4, maxzoom: 7,
      url: 'pmtiles://https://cyberjapandata.gsi.go.jp/xyz/optimal_bvmap-v1/optimal_bvmap-v1.pmtiles',
    });
    expect(coastal).toMatchObject({ id: 'gsi-coastal-land', source: GSI_DETAILED_LAND_SOURCE_ID,
      'source-layer': 'GsiCoastalLand', minzoom: 8, maxzoom: 14, paint: { 'fill-color': GSI_COLOR_CONFIG.background } });
    expect(detailedLand).toMatchObject({ id: 'gsi-detailed-land', source: GSI_DETAILED_LAND_SOURCE_ID,
      'source-layer': 'AdmArea', minzoom: 14, paint: { 'fill-color': GSI_COLOR_CONFIG.background } });
    expect(detailedLand.maxzoom).toBeUndefined();
    expect(GSI_STYLE.sources[GSI_DETAILED_LAND_SOURCE_ID]).toMatchObject({ type: 'vector', minzoom: 4, maxzoom: 16 });
    expect(GSI_STYLE.layers[5].id).toBe(GSI_TERRAIN_TINT_LAYER_ID);
    expect(GSI_STYLE.layers.slice(6).every((layer) => 'source' in layer && layer.source === GSI_OFFICIAL_SOURCE_ID)).toBe(true);
  });

  it.each([
    { viewMode: 'top', introZoomEnabled: false, zoom: 8 },
    { viewMode: 'top', introZoomEnabled: true, zoom: 8 },
    { viewMode: 'oblique', introZoomEnabled: false, zoom: 8 },
    { viewMode: 'oblique', introZoomEnabled: true, zoom: 8 },
    { viewMode: 'top', introZoomEnabled: false, zoom: 4 },
    { viewMode: 'oblique', introZoomEnabled: false, zoom: 12 },
  ] as { viewMode: FollowViewMode; introZoomEnabled: boolean; zoom: number }[])('uses shared follow orientation and caches fixed backgrounds ($viewMode, intro=$introZoomEnabled, zoom=$zoom)', async ({ viewMode, introZoomEnabled, zoom }) => {
    const context = Object.fromEntries(['drawImage', 'beginPath', 'moveTo', 'lineTo', 'stroke', 'arc', 'fill', 'fillRect', 'fillText'].map((name) => [name, vi.fn()]));
    const createImageBitmap = vi.fn(async () => mocks.bitmap);
    vi.stubGlobal('window', { VideoEncoder: class {}, setTimeout, clearTimeout });
    vi.stubGlobal('requestAnimationFrame', (callback: () => void) => { queueMicrotask(callback); return 1; });
    vi.stubGlobal('createImageBitmap', createImageBitmap);
    vi.stubGlobal('document', {
      body: { appendChild() {} },
      createElement: () => ({ style: {}, remove() {}, getContext: () => context }),
    });
    const points = [[0, 0], [0.01, 0], [0.01, 0.01]].map(([longitude, latitude], index) => ({
      id: String(index), longitude, latitude, source: 'manual' as const, original: false,
    }));
    const plan = buildFollowCameraPlan(points, 'custom', 5, zoom, viewMode);
    expect(plan.events).toHaveLength(0);
    const { renderRouteVideo } = await import('./renderer');
    await renderRouteVideo({
      points, cameraMode: 'follow', followZoomPreset: 'custom', followCustomZoom: zoom, followViewMode: viewMode,
      duration: 5, introZoomEnabled, routeMarkerMode: 'none', revealRoute: true, onProgress: vi.fn(),
    });
    const map = mocks.maps[0];
    expect(map.isSourceLoaded).toHaveBeenCalledWith(GSI_LOW_ZOOM_LAND_SOURCE_ID);
    const fallbackReadyIndex = map.isSourceLoaded.mock.calls.findIndex(([id]: any[]) => id === GSI_LOW_ZOOM_LAND_SOURCE_ID);
    expect(map.isSourceLoaded.mock.invocationCallOrder[fallbackReadyIndex]).toBeLessThan(map.getCanvas.mock.invocationCallOrder[0]);
    expect(map.options).toMatchObject({ bearing: plan.firstBearing, pitch: plan.pitch });
    const cameras = map.jumpTo.mock.calls.slice(1).map(([camera]: any[]) => camera);
    expect(cameras.every((camera: any) => camera.pitch === plan.pitch)).toBe(true);
    expect(cameras.every((camera: any) => camera.center[0] === 0 && camera.center[1] === 0)).toBe(true);
    if (introZoomEnabled) {
      expect(cameras.slice(0, 90).every((camera: any) => camera.bearing === plan.firstBearing)).toBe(true);
      expect(cameras[0].zoom).toBeLessThan(plan.zoom);
      expect(cameras[89].zoom).toBe(plan.zoom);
    }
    if (viewMode === 'oblique') {
      expect(cameras.some((camera: any) => camera.bearing > plan.secondBearing && camera.bearing < plan.firstBearing)).toBe(true);
      expect(cameras.at(-1).bearing).toBeCloseTo(plan.secondBearing, 8);
      expect(createImageBitmap.mock.calls.length).toBeGreaterThan(introZoomEnabled ? 90 : 2);
      expect(createImageBitmap.mock.calls.length).toBeLessThan(introZoomEnabled ? 200 : 100);
    } else {
      expect(cameras.every((camera: any) => camera.bearing === 0)).toBe(true);
      expect(createImageBitmap).toHaveBeenCalledTimes(introZoomEnabled ? 90 : 1);
    }
    expect(createImageBitmap.mock.calls.length).toBe(cameras.length);
    expect(mocks.bitmap.close.mock.calls.length).toBe(cameras.length);
    expect(mocks.add).toHaveBeenCalledTimes(330);
    expect(map.remove).toHaveBeenCalledOnce();
    expect(mocks.maps).toHaveLength(1);
  });

  it('adds pause seconds to output duration and frame count', async () => {
    const { outputVideoDuration, outputVideoFrameCount } = await import('./renderer');
    expect(outputVideoDuration(30)).toBe(36);
    expect(outputVideoDuration(30, 5)).toBe(41);
    expect(outputVideoFrameCount(30, 5)).toBe(41 * 30);
  });

  it.each(['overview', 'follow'] as const)('holds the first and final states for configured durations in %s', async (cameraMode) => {
    const { context, points } = setupVideoEnvironment();
    mocks.configureMap = (map) => {
      map.project = vi.fn(([longitude, latitude]: number[]) => ({ x: 100 + longitude * 10_000, y: 100 + latitude * 10_000 }));
    };
    const { renderRouteVideo } = await import('./renderer');
    await renderRouteVideo({ points, cameraMode, duration: 5, preRollSeconds: 2, postRollSeconds: 5,
      introZoomEnabled: false, routeMarkerMode: 'none', revealRoute: true, onProgress: vi.fn() });
    const markerPositions = context.arc.mock.calls.map(([x, y]: number[]) => [x, y]);
    expect(markerPositions).toHaveLength(360);
    expect(markerPositions.slice(0, 61).every(([x, y]: number[]) => x === markerPositions[0][0] && y === markerPositions[0][1])).toBe(true);
    expect(markerPositions[61]).not.toEqual(markerPositions[0]);
    expect(markerPositions.slice(210).every(([x, y]: number[]) => x === markerPositions[209][0] && y === markerPositions[209][1])).toBe(true);
    expect(mocks.add).toHaveBeenCalledTimes(360);
    expect(mocks.maps[0].jumpTo.mock.calls.some(([camera]: any[]) => camera.zoom < mocks.maps[0].options.zoom)).toBe(false);
  });

  it.each(['overview', 'follow'] as const)('skips pre/post holds and intro zoom at zero seconds in %s', async (cameraMode) => {
    const { points } = setupVideoEnvironment();
    const { renderRouteVideo } = await import('./renderer');
    await renderRouteVideo({ points, cameraMode, duration: 5, preRollSeconds: 0, postRollSeconds: 0,
      introZoomEnabled: true, routeMarkerMode: 'none', revealRoute: true, onProgress: vi.fn() });
    expect(mocks.add).toHaveBeenCalledTimes(150);
    expect(mocks.maps[0].jumpTo.mock.calls.some(([camera]: any[]) => camera.zoom < mocks.maps[0].options.zoom)).toBe(false);
  });

  it.each(['overview', 'follow'] as const)('encodes 15 intro and 15 final frames for half-second holds in %s', async (cameraMode) => {
    const { points } = setupVideoEnvironment();
    const { renderRouteVideo } = await import('./renderer');
    await renderRouteVideo({ points, cameraMode, duration: 5, preRollSeconds: 0.5, postRollSeconds: 0.5,
      introZoomEnabled: true, routeMarkerMode: 'none', revealRoute: true, onProgress: vi.fn() });
    expect(mocks.add).toHaveBeenCalledTimes(180);
    expect(mocks.maps[0].jumpTo.mock.calls.some(([camera]: any[]) => camera.zoom < mocks.maps[0].options.zoom)).toBe(true);
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
    expect(map.once.mock.calls.map((call: any[]) => call[0])).toEqual(['remove', 'style.load']);
    expect(map.jumpTo).toHaveBeenCalledWith({ center: [camera.longitude, camera.latitude], zoom: camera.zoom, bearing: camera.bearing, pitch: camera.pitch });
    const idleWaitIndex = map.on.mock.calls.findIndex(([event]: any[]) => event === 'idle');
    expect(map.jumpTo.mock.invocationCallOrder[0]).toBeLessThan(map.on.mock.invocationCallOrder[idleWaitIndex]);
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
