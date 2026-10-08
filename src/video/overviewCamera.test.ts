import { describe, expect, it, vi } from 'vitest';
import { getVideoPreviewViewport, videoZoomToPreviewZoom, videoPreviewFieldOfView, VIDEO_CAMERA_FOV } from './overviewCamera';
import { createBalloonReferenceProjector } from '../map/balloonProjection';
import type { Map as MapLibreMap } from 'maplibre-gl';

vi.mock('maplibre-gl', () => ({ LngLat: class { constructor(public lng: number, public lat: number) {} } }));

describe('overview camera viewport conversion', () => {
  it('projects migrations from an isolated 1920×1080 transform, independent of the live map camera', () => {
    const transform = Object.fromEntries(['setConstrainOverride', 'setFov', 'setPadding', 'resize', 'setZoom', 'setCenter', 'setBearing', 'setPitch'].map((key) => [key, vi.fn()]));
    transform.locationToScreenPoint = vi.fn(() => ({ x: 800, y: 300 }));
    const live = { _camera: { transform: { clone: vi.fn(() => transform) } }, jumpTo: vi.fn() };
    const project = createBalloonReferenceProjector(live as unknown as MapLibreMap);
    const camera = { longitude: 139, latitude: 35, zoom: 10, bearing: 90, pitch: 45 };
    const point = { id: 'a', longitude: 140, latitude: 36, source: 'manual' as const, original: false };
    expect(project(point, camera)).toEqual({ x: 800, y: 300 });
    expect(transform.resize).toHaveBeenCalledWith(1920, 1080, false);
    expect(transform.setFov).toHaveBeenCalledWith(VIDEO_CAMERA_FOV);
    expect(transform.setPadding).toHaveBeenCalledWith({ top: 0, right: 0, bottom: 0, left: 0 });
    expect(transform.setZoom).toHaveBeenCalledWith(10);
    expect(transform.setCenter.mock.calls[0][0]).toMatchObject({ lng: 139, lat: 35 });
    expect(transform.setBearing).toHaveBeenCalledWith(90);
    expect(transform.setPitch).toHaveBeenCalledWith(45);
    expect(live.jumpTo).not.toHaveBeenCalled();
  });
  it.each([[960, 720], [360, 640], [1200, 400], [1920, 1080]])('preserves perspective camera distance inside the video frame at %s×%s', (width, height) => {
    const frame = getVideoPreviewViewport(width, height);
    const videoDistance = 1080 / (2 * Math.tan(VIDEO_CAMERA_FOV * Math.PI / 360));
    const previewDistance = height / (2 * Math.tan(videoPreviewFieldOfView(width, height) * Math.PI / 360));
    expect(previewDistance / frame.scale).toBeCloseTo(videoDistance);
  });
  it('scales the video camera into a centered 16:9 frame, not the entire map', () => {
    const previewViewport = getVideoPreviewViewport(960, 720);
    expect(previewViewport).toEqual({ width: 960, height: 540, left: 0, top: 90, scale: 0.5 });
    expect(videoZoomToPreviewZoom(10, previewViewport.scale)).toBe(9);
  });
});
