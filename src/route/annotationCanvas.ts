import { nearestPointOnRect, placedPopupRect, type BalloonFramePosition, type PopupPlacement } from '../popup/placement';
import type { AnnotationStyle } from './annotationStyle';
import { VIDEO_VIEWPORT } from '../video/overviewCamera';
const { width: WIDTH, height: HEIGHT } = VIDEO_VIEWPORT;
export interface CanvasAnnotation { label: string; pixel: { x: number; y: number }; placement?: PopupPlacement; framePosition?: BalloonFramePosition }

export function isAnnotationAnchorVisible(pixel: { x: number; y: number }) {
  return Number.isFinite(pixel.x) && Number.isFinite(pixel.y) && pixel.x >= 0 && pixel.x <= WIDTH && pixel.y >= 0 && pixel.y <= HEIGHT;
}

export function annotationFramePosition(rect: { left: number; top: number; width: number; height: number }): BalloonFramePosition {
  return { x: (rect.left + rect.width / 2) / WIDTH, y: (rect.top + rect.height / 2) / HEIGHT };
}

export function annotationLayout(context: CanvasRenderingContext2D, annotation: CanvasAnnotation, style: AnnotationStyle, clamp = true) {
  const scale = style.balloonScale;
  const fontSize = 28 * style.fontScale;
  const paddingX = 20 * scale;
  const paddingY = 16 * scale;
  const gap = 40 * scale;
  const margin = 24;
  // Reserve the bottom strip for attribution, which is drawn last.
  const bottom = HEIGHT - 70;
  context.font = `${fontSize}px system-ui, sans-serif`;
  const maxTextWidth = WIDTH - margin * 2 - paddingX * 2;
  let label = annotation.label;
  if (context.measureText(label).width > maxTextWidth) {
    const characters = Array.from(label);
    while (characters.length && context.measureText(`${characters.join('')}…`).width > maxTextWidth) characters.pop();
    label = `${characters.join('')}…`;
  }
  const width = context.measureText(label).width + paddingX * 2;
  const radius = Math.min(10 * scale, width / 4);
  const pointerSize = Math.min(12 * scale, width / 8);
  const height = fontSize * 1.4 + paddingY * 2;
  let left = Math.max(margin, Math.min(WIDTH - margin - width, annotation.pixel.x - width / 2));
  const below = annotation.pixel.y - height - gap < margin;
  let top = Math.max(margin, Math.min(bottom - height - pointerSize, below ? annotation.pixel.y + gap : annotation.pixel.y - height - gap));
  if (annotation.placement) {
    ({ left, top } = placedPopupRect(annotation.pixel, annotation.placement, width, height, WIDTH, bottom, margin));
  }
  if (!clamp) {
    left = annotation.pixel.x - width / 2;
    top = annotation.pixel.y - height - gap;
    if (annotation.placement) {
      left += annotation.placement.offsetX;
      top = annotation.pixel.y + annotation.placement.offsetY - height / 2;
    }
  }
  if (annotation.framePosition) {
    ({ left, top } = placedPopupRect({ x: annotation.framePosition.x * WIDTH, y: annotation.framePosition.y * HEIGHT },
      { offsetX: 0, offsetY: 0 }, width, height, WIDTH, bottom, margin));
  }
  return { scale, fontSize, paddingX, label, width, height, radius, pointerSize, left, top, below: clamp && !annotation.framePosition ? below : false };
}

export function drawAnnotation(context: CanvasRenderingContext2D, annotation: CanvasAnnotation, style: AnnotationStyle, layout?: ReturnType<typeof annotationLayout>) {
  if (annotation.framePosition && !isAnnotationAnchorVisible(annotation.pixel)) return;
  context.save();
  const { scale, fontSize, paddingX, label, width, height, radius, pointerSize, left, top, below } = layout ?? annotationLayout(context, annotation, style);
  context.font = `${fontSize}px system-ui, sans-serif`;
  const pointerX = Math.max(left + radius + pointerSize, Math.min(left + width - radius - pointerSize, annotation.pixel.x));
  if (annotation.placement || annotation.framePosition) {
    const edge = nearestPointOnRect({ left, top, width, height }, annotation.pixel);
    context.strokeStyle = '#ff8b68';
    context.lineWidth = 2 * scale;
    context.beginPath();
    context.moveTo(edge.x, edge.y);
    context.lineTo(annotation.pixel.x, annotation.pixel.y);
    context.stroke();
  }
  // Match the browser note balloon: lighter navy than DAY / START / GOAL.
  context.fillStyle = '#2d4f73';
  context.strokeStyle = '#ff8b68';
  context.lineWidth = 2 * scale;
  context.shadowColor = 'rgba(7,17,31,.28)';
  context.shadowBlur = 28 * scale;
  context.shadowOffsetY = 8 * scale;
  context.beginPath();
  context.moveTo(left + radius, top);
  if (!annotation.placement && !annotation.framePosition && below) {
    context.lineTo(pointerX - pointerSize, top);
    context.lineTo(pointerX, top - pointerSize);
    context.lineTo(pointerX + pointerSize, top);
  }
  context.lineTo(left + width - radius, top);
  context.quadraticCurveTo(left + width, top, left + width, top + radius);
  context.lineTo(left + width, top + height - radius);
  context.quadraticCurveTo(left + width, top + height, left + width - radius, top + height);
  if (!annotation.placement && !annotation.framePosition && !below) {
    context.lineTo(pointerX + pointerSize, top + height);
    context.lineTo(pointerX, top + height + pointerSize);
    context.lineTo(pointerX - pointerSize, top + height);
  }
  context.lineTo(left + radius, top + height);
  context.quadraticCurveTo(left, top + height, left, top + height - radius);
  context.lineTo(left, top + radius);
  context.quadraticCurveTo(left, top, left + radius, top);
  context.closePath();
  context.fill();
  context.shadowBlur = 0;
  context.shadowOffsetY = 0;
  context.stroke();
  context.fillStyle = '#ffffff';
  context.textBaseline = 'middle';
  context.textAlign = 'left';
  context.fillText(label, left + paddingX, top + height / 2);
  context.restore();
}

