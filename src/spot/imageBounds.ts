import type { RoutePoint } from '../timeline/types';

export interface ImageBounds { west: number; east: number; north: number; south: number }
export interface Pixel { x: number; y: number }
export const SPOT_IMAGE_SIZE = { width: 1920, height: 1080 } as const;

export function moveImageRectangle(rect: ReturnType<typeof imageRectangle>, delta: Pixel, viewport: { width: number; height: number }) {
  // Keep a small part reachable even when the selected region is larger than the viewport.
  const visibleX = Math.min(24, rect.width, viewport.width / 2);
  const visibleY = Math.min(24, rect.height, viewport.height / 2);
  return { ...rect,
    left: Math.max(visibleX - rect.width, Math.min(viewport.width - visibleX, rect.left + delta.x)),
    top: Math.max(visibleY - rect.height, Math.min(viewport.height - visibleY, rect.top + delta.y)),
  };
}

export function imageRectangle(start: Pixel, end: Pixel, viewport: { width: number; height: number }) {
  const ratio = SPOT_IMAGE_SIZE.width / SPOT_IMAGE_SIZE.height;
  const dx = end.x >= start.x ? 1 : -1;
  const dy = end.y >= start.y ? 1 : -1;
  const width = Math.min(Math.max(Math.abs(end.x - start.x), Math.abs(end.y - start.y) * ratio),
    dx > 0 ? viewport.width - start.x : start.x, (dy > 0 ? viewport.height - start.y : start.y) * ratio);
  const height = width / ratio;
  return { left: dx > 0 ? start.x : start.x - width, top: dy > 0 ? start.y : start.y - height, width, height };
}

export function longitudeInBounds(longitude: number, bounds: ImageBounds) {
  const center = (bounds.west + bounds.east) / 2;
  return longitude + 360 * Math.round((center - longitude) / 360);
}

export function spotsInBounds(points: RoutePoint[], bounds: ImageBounds): RoutePoint[] {
  return points.filter((point) => {
    const longitude = longitudeInBounds(point.longitude, bounds);
    return longitude >= bounds.west && longitude <= bounds.east && point.latitude >= bounds.south && point.latitude <= bounds.north;
  });
}

export function imageCamera(bounds: ImageBounds) {
  const mercatorY = (latitude: number) => (1 - Math.asinh(Math.tan(latitude * Math.PI / 180)) / Math.PI) / 2;
  const top = mercatorY(bounds.north);
  const bottom = mercatorY(bounds.south);
  const zoom = Math.log2(Math.min(SPOT_IMAGE_SIZE.width / ((bounds.east - bounds.west) / 360 * 512),
    SPOT_IMAGE_SIZE.height / ((bottom - top) * 512)));
  if (!Number.isFinite(zoom) || bounds.east <= bounds.west || bounds.north <= bounds.south) throw new Error('画像範囲を指定してください。');
  return { center: [(bounds.east + bounds.west) / 2, Math.atan(Math.sinh(Math.PI * (1 - top - bottom))) * 180 / Math.PI] as [number, number], zoom, bearing: 0, pitch: 0 };
}
