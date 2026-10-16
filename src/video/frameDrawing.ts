import { GSI_ATTRIBUTION } from '../map/gsiStyle';
import { nearestPointOnRect, placedPopupRect, type PopupPlacement } from '../popup/placement';
import { DAY_MARKER_FONT_FAMILY, dayMarkerColors, dayMarkerConnector, dayMarkerLayout } from '../route/dayMarkerStyle';
import type { DayMarker } from '../route/tripRoute';
import { VIDEO_VIEWPORT } from './overviewCamera';

const WIDTH = VIDEO_VIEWPORT.width;
const HEIGHT = VIDEO_VIEWPORT.height;

// Callers own projection, visibility, drawing order and surrounding Canvas state.
// Keep existing save/restore boundaries; marker and attribution do not restore state.
export interface VideoDayMarker extends DayMarker {
  pixel: { x: number; y: number };
  arrivalProgress: number;
}


export function drawDayMarker(context: CanvasRenderingContext2D, marker: VideoDayMarker, dayRouteColorsEnabled: boolean) {
  context.save();
  const { width, height, style, rows } = dayMarkerLayout(marker, context);
  const colors = dayMarkerColors(marker.dayNumber, dayRouteColorsEnabled);
  const margin = style.margin;
  const bottom = HEIGHT - style.bottomMargin;
  const gap = style.anchorGap;
  let left = Math.max(margin, Math.min(WIDTH - margin - width, marker.pixel.x - width / 2));
  const below = marker.pixel.y - height - gap < margin;
  let top = Math.max(margin, Math.min(bottom - height, below ? marker.pixel.y + gap : marker.pixel.y - height - gap));
  if (marker.placement) {
    ({ left, top } = placedPopupRect(marker.pixel, marker.placement, width, height, WIDTH, bottom, margin));
  }
  const connector = dayMarkerConnector({ left, top, width, height }, marker.pixel, Boolean(marker.placement), below, style);
  context.strokeStyle = colors.outline;
  context.lineWidth = connector.width;
  context.lineCap = 'butt';
  context.beginPath();
  context.moveTo(connector.start.x, connector.start.y);
  context.lineTo(connector.end.x, connector.end.y);
  context.stroke();
  context.beginPath();
  context.arc(connector.dot.x, connector.dot.y, connector.radius, 0, Math.PI * 2);
  context.fillStyle = colors.anchor;
  context.fill();
  context.lineWidth = style.anchorBorder;
  context.strokeStyle = colors.text;
  context.stroke();

  context.shadowColor = colors.shadow;
  context.shadowBlur = style.shadowBlur;
  context.shadowOffsetY = style.shadowOffsetY;
  context.fillStyle = colors.background;
  context.beginPath();
  context.roundRect(left, top, width, height, style.radius);
  context.fill();
  context.shadowBlur = 0;
  context.shadowOffsetY = 0;
  context.lineWidth = style.border;
  context.strokeStyle = colors.outline;
  // The browser has a uniform rounded border, not a separate thick top accent.
  context.beginPath();
  context.roundRect(left + style.border / 2, top + style.border / 2,
    width - style.border, height - style.border, Math.max(0, style.radius - style.border / 2));
  context.stroke();

  context.textAlign = 'left';
  context.textBaseline = 'middle';
  for (const row of rows) {
    context.fillStyle = row.color;
    context.font = `${row.weight} ${row.fontSize}px ${DAY_MARKER_FONT_FAMILY}`;
    const x = left + (width - row.textWidth) / 2;
    if (!row.spacing) {
      context.fillText(row.text, x, top + row.y);
    } else {
      let prefix = '';
      Array.from(row.text).forEach((character, index) => {
        context.fillText(character, x + context.measureText(prefix).width + index * row.spacing, top + row.y);
        prefix += character;
      });
    }
  }
  context.restore();
}

export function drawEndpointMarker(context: CanvasRenderingContext2D, pixel: { x: number; y: number }, label: 'START' | 'GOAL', placement?: PopupPlacement) {
  context.save();
  const margin = 24;
  const bottom = HEIGHT - 70;
  const width = 230;
  const height = 78;
  const gap = 42;
  let left = Math.max(margin, Math.min(WIDTH - margin - width, pixel.x - width / 2));
  const below = pixel.y - height - gap < margin;
  let top = Math.max(margin, Math.min(bottom - height, below ? pixel.y + gap : pixel.y - height - gap));
  if (placement) {
    ({ left, top } = placedPopupRect(pixel, placement, width, height, WIDTH, bottom, margin));
  }
  const anchorX = Math.max(left + 18, Math.min(left + width - 18, pixel.x));

  context.strokeStyle = '#ff8b68';
  context.lineWidth = 5;
  context.beginPath();
  const connectorStart = placement
    ? nearestPointOnRect({ left, top, width, height }, pixel)
    : { x: anchorX, y: below ? top : top + height };
  context.moveTo(connectorStart.x, connectorStart.y);
  context.lineTo(pixel.x, pixel.y);
  context.stroke();
  context.beginPath();
  context.arc(pixel.x, pixel.y, 10, 0, Math.PI * 2);
  context.fillStyle = '#ff5d37';
  context.fill();
  context.lineWidth = 4;
  context.strokeStyle = '#ffffff';
  context.stroke();

  context.shadowColor = 'rgba(7,17,31,.28)';
  context.shadowBlur = 18;
  context.shadowOffsetY = 5;
  context.fillStyle = '#102c4b';
  context.fillRect(left, top, width, height);
  context.shadowBlur = 0;
  context.shadowOffsetY = 0;
  context.lineWidth = 4;
  context.strokeStyle = '#ff8b68';
  context.strokeRect(left, top, width, height);
  context.fillStyle = '#ff8b68';
  context.fillRect(left, top, width, 7);

  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillStyle = '#ffffff';
  context.font = '700 36px system-ui, sans-serif';
  context.fillText(label, left + width / 2, top + height / 2 + 3);
  context.restore();
}

export function drawCurrentPositionMarker(context: CanvasRenderingContext2D, x: number, y: number) {
  context.beginPath();
  context.arc(x, y, 22, 0, Math.PI * 2);
  context.fillStyle = '#ffda57';
  context.fill();
  context.lineWidth = 8;
  context.strokeStyle = '#07111f';
  context.stroke();
}

export function drawMapAttribution(context: CanvasRenderingContext2D) {
  context.fillStyle = 'rgba(255,255,255,.9)';
  context.fillRect(24, HEIGHT - 50, 520, 34);
  context.fillStyle = '#27364a';
  context.font = '22px system-ui, sans-serif';
  context.fillText(GSI_ATTRIBUTION, 34, HEIGHT - 25);
}

export function isInVideoViewport(point: { x: number; y: number }): boolean {
  return point.x >= 0 && point.x <= WIDTH && point.y >= 0 && point.y <= HEIGHT;
}
