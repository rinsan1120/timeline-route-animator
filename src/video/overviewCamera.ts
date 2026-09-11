import type { RoutePoint } from '../timeline/types';

export interface ViewportSize {
  width: number;
  height: number;
}

export interface OverviewPadding {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export const VIDEO_VIEWPORT = { width: 1920, height: 1080 } as const;
export const VIDEO_FPS = 30;

export interface VideoCamera {
  longitude: number;
  latitude: number;
  zoom: number;
  bearing: number;
  pitch: number;
}

// MapLibre's Mercator world is 512 pixels at zoom 0.
const WORLD_SIZE_AT_ZOOM_ZERO = 512;
const MAX_MERCATOR_LATITUDE = 85.051129;
export const VIDEO_MIN_ZOOM = -2;

export const OVERVIEW_FIT_PADDING: OverviewPadding = {
  top: 72,
  right: 44,
  bottom: 92,
  left: 44,
};

export function getVideoPreviewViewport(containerWidth: number, containerHeight: number) {
  const valid = isValidViewport({ width: containerWidth, height: containerHeight });
  const scale = valid ? Math.min(containerWidth / VIDEO_VIEWPORT.width, containerHeight / VIDEO_VIEWPORT.height) : 1;
  const width = VIDEO_VIEWPORT.width * scale;
  const height = VIDEO_VIEWPORT.height * scale;
  return { scale, width, height, left: valid ? (containerWidth - width) / 2 : 0, top: valid ? (containerHeight - height) / 2 : 0 };
}

export function videoZoomToPreviewZoom(videoZoom: number, previewScale: number): number {
  return videoZoom + Math.log2(previewScale);
}

// Fit only once in video coordinates, including the asymmetric padding's center
// offset. No live MapLibre instance or browser container size participates.
export function createOverviewCamera(points: readonly RoutePoint[], customZoom?: number): VideoCamera | null {
  if (!points.length) return null;
  let west = Infinity, east = -Infinity, north = Infinity, south = -Infinity;
  for (const point of points) {
    const x = (point.longitude + 180) / 360;
    const y = mercatorY(point.latitude);
    west = Math.min(west, x);
    east = Math.max(east, x);
    north = Math.min(north, y);
    south = Math.max(south, y);
  }
  const padding = OVERVIEW_FIT_PADDING;
  const availableWidth = VIDEO_VIEWPORT.width - padding.left - padding.right;
  const availableHeight = VIDEO_VIEWPORT.height - padding.top - padding.bottom;
  const fitZoom = Math.min(16, Math.log2(Math.min(
    availableWidth / ((east - west) * WORLD_SIZE_AT_ZOOM_ZERO),
    availableHeight / ((south - north) * WORLD_SIZE_AT_ZOOM_ZERO),
  )));
  const zoom = customZoom ?? fitZoom;
  const worldSize = WORLD_SIZE_AT_ZOOM_ZERO * 2 ** zoom;
  const x = (west + east) / 2 - (padding.left - padding.right) / (2 * worldSize);
  const y = (north + south) / 2 - (padding.top - padding.bottom) / (2 * worldSize);
  return constrainVideoCamera({ longitude: x * 360 - 180, latitude: latitudeFromMercatorY(y), zoom, bearing: 0, pitch: 0 });
}

// Match the MP4 map's default Mercator latitude constraints in VIDEO_VIEWPORT,
// not the (possibly taller) browser map outside the 16:9 preview frame.
export function constrainVideoCamera(camera: VideoCamera): VideoCamera {
  const minY = mercatorY(MAX_MERCATOR_LATITUDE);
  const maxY = mercatorY(-MAX_MERCATOR_LATITUDE);
  const zoom = Math.max(VIDEO_MIN_ZOOM, Math.min(22, camera.zoom),
    Math.log2(VIDEO_VIEWPORT.height / ((maxY - minY) * WORLD_SIZE_AT_ZOOM_ZERO)));
  const halfHeight = VIDEO_VIEWPORT.height / (2 * WORLD_SIZE_AT_ZOOM_ZERO * 2 ** zoom);
  const y = Math.max(minY + halfHeight, Math.min(maxY - halfHeight, mercatorY(camera.latitude)));
  return { ...camera, zoom, latitude: latitudeFromMercatorY(y) };
}

function mercatorY(latitude: number): number {
  const clamped = Math.max(-MAX_MERCATOR_LATITUDE, Math.min(MAX_MERCATOR_LATITUDE, latitude));
  const sine = Math.sin(clamped * Math.PI / 180);
  return 0.5 - Math.log((1 + sine) / (1 - sine)) / (4 * Math.PI);
}

function latitudeFromMercatorY(y: number): number {
  return Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) * 180 / Math.PI;
}

function isValidViewport(viewport: ViewportSize): boolean {
  return Number.isFinite(viewport.width) && Number.isFinite(viewport.height) && viewport.width > 0 && viewport.height > 0;
}
