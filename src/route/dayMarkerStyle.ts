import { VIDEO_VIEWPORT } from '../video/overviewCamera';
import { nearestPointOnRect, POPUP_PLACEMENT_VIEWPORT, popupDisplayScale } from '../popup/placement';
import { dayRouteColor } from './dayRouteColor';
import type { DayMarker } from './tripRoute';

// Logical pixels in the 1920 x 1080 video. Editing alone may preserve CSS sizes.
const VIDEO_DAY_STYLE = {
  minWidth: 230, noteMaxWidth: 370, paddingX: 24, paddingTop: 17, paddingBottom: 15,
  dayFont: 24, dateFont: 17, noteFont: 19, daySpacing: 1.9, dateSpacing: 0.85,
  border: 3.4, radius: 8.5, rowGap: 3.4, anchorGap: 40, anchorInset: 20,
  connectorWidth: 3.4, connectorLength: 30, anchorOffset: 34, anchorRadius: 5,
  manualConnectorWidth: 6.8, manualAnchorRadius: 8.5, anchorBorder: 3.4,
  shadowBlur: 24, shadowOffsetY: 6.8, margin: 8, bottomMargin: 54,
} as const;

// Editing CSS dimensions are independent of the fixed video design.
const EDITING_DAY_STYLE = {
  minWidth: 138, noteMaxWidth: 220, paddingX: 14, paddingTop: 10, paddingBottom: 9,
  dayFont: 14, dateFont: 10, noteFont: 11, daySpacing: 1.12, dateSpacing: 0.5,
  border: 2, radius: 5, rowGap: 2, anchorGap: 24, anchorInset: 12,
  connectorWidth: 2, connectorLength: 18, anchorOffset: 20, anchorRadius: 3,
  manualConnectorWidth: 4, manualAnchorRadius: 5, anchorBorder: 2,
  shadowBlur: 14, shadowOffsetY: 4, margin: 8, bottomMargin: 54,
} as const;

export const DAY_MARKER_COLORS = {
  background: '#102c4b', outline: '#ff8b68', text: '#ffffff', date: '#cbd7e4',
  anchor: '#ff5d37', shadow: 'rgba(7,17,31,.28)',
};
export const DAY_MARKER_FONT_FAMILY = '"DM Sans", "Noto Sans JP", system-ui, sans-serif';

export function dayMarkerColors(dayNumber: number, dayRouteColorsEnabled: boolean): typeof DAY_MARKER_COLORS {
  if (!dayRouteColorsEnabled) return DAY_MARKER_COLORS;
  const accent = dayRouteColor(dayNumber);
  return { ...DAY_MARKER_COLORS, outline: accent, anchor: accent };
}

export function dayMarkerStyle() {
  return { ...VIDEO_DAY_STYLE };
}

export function dayMarkerEditingStyle(editingScale = 1) {
  const scale = Number.isFinite(editingScale) ? Math.max(0.75, Math.min(1.75, editingScale)) : 1;
  const style = {} as Record<keyof typeof EDITING_DAY_STYLE, number>;
  for (const key of Object.keys(EDITING_DAY_STYLE) as (keyof typeof EDITING_DAY_STYLE)[]) {
    style[key] = EDITING_DAY_STYLE[key] * (key === 'margin' || key === 'bottomMargin' ? 1 : scale);
  }
  return style;
}

// Video and preview always share this device-independent layout.
export function dayMarkerLayout(marker: Pick<DayMarker, 'dayNumber' | 'date' | 'note'>, context: CanvasRenderingContext2D) {
  return layoutDayMarker(marker, context, VIDEO_VIEWPORT, dayMarkerStyle());
}

// Preserve readable, draggable CSS dimensions only outside video preview.
export function dayMarkerEditingLayout(marker: Pick<DayMarker, 'dayNumber' | 'date' | 'note'>, context: CanvasRenderingContext2D, reference: { width: number; height: number }, editingScale = 1) {
  if (!Number.isFinite(reference.width) || !Number.isFinite(reference.height) || reference.width <= 0 || reference.height <= 0) reference = POPUP_PLACEMENT_VIEWPORT;
  const style = dayMarkerEditingStyle(editingScale);
  const displayScale = popupDisplayScale(reference.width, reference.height);
  for (const key of Object.keys(style) as (keyof typeof style)[]) style[key] /= displayScale;
  return layoutDayMarker(marker, context, reference, style);
}

function layoutDayMarker(marker: Pick<DayMarker, 'dayNumber' | 'date' | 'note'>, context: CanvasRenderingContext2D, reference: { width: number; height: number }, style: Record<keyof typeof VIDEO_DAY_STYLE, number>) {
  const rows = [{ kind: 'day', text: `DAY ${marker.dayNumber}`, fontSize: style.dayFont, weight: 700, spacing: style.daySpacing, color: DAY_MARKER_COLORS.text },
    ...(marker.date ? [{ kind: 'date', text: marker.date.replaceAll('-', '.'), fontSize: style.dateFont, weight: 600, spacing: style.dateSpacing, color: DAY_MARKER_COLORS.date }] : []),
    ...(marker.note ? [{ kind: 'note', text: marker.note, fontSize: style.noteFont, weight: 400, spacing: 0, color: DAY_MARKER_COLORS.text }] : [])];
  const measure = (text: string, spacing: number) => context.measureText(text).width + Array.from(text).length * spacing;
  const viewportWidth = reference.width / popupDisplayScale(reference.width, reference.height);
  const maxWidth = Math.min(POPUP_PLACEMENT_VIEWPORT.width, viewportWidth) - style.margin * 2;
  let contentWidth = 0;
  let y = style.border + style.paddingTop;
  const laidOutRows = rows.map((row) => {
    context.font = `${row.weight} ${row.fontSize}px ${DAY_MARKER_FONT_FAMILY}`;
    const available = Math.min(maxWidth - 2 * (style.border + style.paddingX), row.kind === 'note' ? style.noteMaxWidth : Infinity);
    let text = row.text;
    if (measure(text, row.spacing) > available) {
      const characters = Array.from(text);
      while (characters.length && measure(`${characters.join('')}…`, row.spacing) > available) characters.pop();
      text = `${characters.join('')}…`;
    }
    const textWidth = measure(text, row.spacing);
    contentWidth = Math.max(contentWidth, textWidth);
    const height = row.fontSize * 1.25;
    const result = { ...row, text, textWidth, height, y: y + height / 2 };
    y += height + style.rowGap;
    return result;
  });
  // Round in reference CSS pixels, so offsetWidth/offsetHeight match the model.
  const displayScale = popupDisplayScale(reference.width, reference.height);
  const round = (value: number) => Math.ceil(value * displayScale) / displayScale;
  return {
    style, rows: laidOutRows,
    width: round(Math.min(maxWidth, Math.max(style.minWidth, contentWidth + 2 * (style.border + style.paddingX)))),
    height: round(y - style.rowGap + style.paddingBottom + style.border),
  };
}

export function dayMarkerConnector(rect: { left: number; top: number; width: number; height: number }, anchor: { x: number; y: number }, manual: boolean, below: boolean, style: Record<keyof typeof VIDEO_DAY_STYLE, number>) {
  if (manual) return { start: nearestPointOnRect(rect, anchor), end: anchor, dot: anchor, width: style.manualConnectorWidth, radius: style.manualAnchorRadius };
  const x = Math.max(rect.left + style.anchorInset, Math.min(rect.left + rect.width - style.anchorInset, anchor.x));
  const y = below ? rect.top : rect.top + rect.height;
  const direction = below ? -1 : 1;
  return { start: { x, y }, end: { x, y: y + direction * style.connectorLength }, dot: { x, y: y + direction * style.anchorOffset }, width: style.connectorWidth, radius: style.anchorRadius };
}
