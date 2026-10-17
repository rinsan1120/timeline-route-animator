export interface PopupPlacement { offsetX: number; offsetY: number }
export interface BalloonFramePosition { x: number; y: number }
export function isBalloonFramePosition(value: unknown): value is BalloonFramePosition {
  if (!value || typeof value !== 'object') return false;
  const { x, y } = value as BalloonFramePosition;
  return Number.isFinite(x) && Number.isFinite(y) && x >= 0 && x <= 1 && y >= 0 && y <= 1;
}
export type EndpointMarkerLabel = 'START' | 'GOAL';
export type EndpointMarkerPlacements = Partial<Record<EndpointMarkerLabel, PopupPlacement>>;
export type EndpointMarkerFramePositions = Partial<Record<EndpointMarkerLabel, BalloonFramePosition>>;

export function parseMarkerFramePositions(value: unknown, validKey: (key: string) => boolean): Record<string, BalloonFramePosition> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('マーカーの固定位置が不正です。');
  return Object.fromEntries(Object.entries(value).map(([key, position]) => {
    if (!validKey(key) || !isBalloonFramePosition(position)) throw new Error('マーカーの固定位置が不正です。');
    return [key, { x: position.x, y: position.y }];
  }));
}
export const POPUP_PLACEMENT_VIEWPORT = { width: 1920, height: 1080 };

export function videoMarkerRect(anchor: { x: number; y: number }, width: number, height: number,
  margin: number, bottomMargin: number, gap: number, placement?: PopupPlacement, framePosition?: BalloonFramePosition) {
  const { width: viewportWidth, height: viewportHeight } = POPUP_PLACEMENT_VIEWPORT;
  const bottom = viewportHeight - bottomMargin;
  const below = anchor.y - height - gap < margin;
  if (framePosition) return { ...placedPopupRect({ x: framePosition.x * viewportWidth, y: framePosition.y * viewportHeight },
    { offsetX: 0, offsetY: 0 }, width, height, viewportWidth, bottom, margin), below: false };
  if (placement) return { ...placedPopupRect(anchor, placement, width, height, viewportWidth, bottom, margin), below };
  return {
    left: Math.max(margin, Math.min(viewportWidth - margin - width, anchor.x - width / 2)),
    top: Math.max(margin, Math.min(bottom - height, below ? anchor.y + gap : anchor.y - height - gap)),
    width, height, below,
  };
}
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
