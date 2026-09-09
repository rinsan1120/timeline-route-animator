export interface PopupPlacement { offsetX: number; offsetY: number }
export type EndpointMarkerLabel = 'START' | 'GOAL';
export type EndpointMarkerPlacements = Partial<Record<EndpointMarkerLabel, PopupPlacement>>;
export const POPUP_PLACEMENT_VIEWPORT = { width: 1920, height: 1080 };
export function popupDisplayScale(width: number, height: number): number {
  const scale = Math.min(width / POPUP_PLACEMENT_VIEWPORT.width, height / POPUP_PLACEMENT_VIEWPORT.height);
  return Number.isFinite(scale) && scale > 0 ? scale : 1;
}
export function nearestPointOnRect(rect: { left: number; top: number; width: number; height: number }, anchor: { x: number; y: number }) {
  const x = Math.max(rect.left, Math.min(rect.left + rect.width, anchor.x));
  const y = Math.max(rect.top, Math.min(rect.top + rect.height, anchor.y));
  if (x !== anchor.x || y !== anchor.y) return { x, y };
  const edges = [{ x: rect.left, y }, { x: rect.left + rect.width, y }, { x, y: rect.top }, { x, y: rect.top + rect.height }];
  return edges.reduce((a, b) => Math.hypot(a.x - x, a.y - y) <= Math.hypot(b.x - x, b.y - y) ? a : b);
}
export function placedPopupRect(anchor: { x: number; y: number }, placement: PopupPlacement, width: number, height: number, viewportWidth: number, bottom: number, margin: number, scale = 1) {
  return {
    left: Math.max(margin, Math.min(viewportWidth - width - margin, anchor.x + placement.offsetX * scale - width / 2)),
    top: Math.max(margin, Math.min(bottom - height, anchor.y + placement.offsetY * scale - height / 2)),
    width, height,
  };
}
