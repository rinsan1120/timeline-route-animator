import type { PlanDistanceModel, PlanDistanceProgress } from '../route/planDistanceProgress';
import { VIDEO_VIEWPORT } from './overviewCamera';

export interface DistanceHudPlacement { x: number; y: number }
export interface DistanceHudSettings extends DistanceHudPlacement { enabled: boolean; scale: number }
export interface DistanceHudOptions { settings: DistanceHudSettings; model: PlanDistanceModel }
export const DEFAULT_DISTANCE_HUD: DistanceHudSettings = { enabled: false, x: 48, y: 48, scale: 1 };

export const DISTANCE_HUD_LAYOUT = {
  padding: 24, titleHeight: 48, rowHeight: 38, totalHeight: 52,
  fontSize: 26, radius: 14,
};
export const distanceHudKilometers = (meters: number) => `${(meters / 1000).toFixed(1)} km`;

export function distanceHudLayout(model: PlanDistanceModel, scale: number) {
  const { padding, titleHeight, rowHeight, totalHeight } = DISTANCE_HUD_LAYOUT;
  const longestNumber = Math.max(6, distanceHudKilometers(model.totals.totalMeters).length);
  const longestLabel = Math.max(5, `DAY ${model.totals.days.length}`.length);
  // Monospaced numeric columns reserve room for final values, never current values.
  const width = Math.max(340, padding * 2 + (longestNumber + longestLabel) * 17 + 36);
  const height = padding * 2 + titleHeight + model.totals.days.length * rowHeight + totalHeight;
  const fittedScale = Math.min(Math.max(0.5, Math.min(2, scale)), VIDEO_VIEWPORT.width / width, VIDEO_VIEWPORT.height / height);
  return { width, height, scale: fittedScale };
}

export function clampDistanceHudPlacement(placement: DistanceHudPlacement, layout: ReturnType<typeof distanceHudLayout>): DistanceHudPlacement {
  return {
    x: Math.max(0, Math.min(VIDEO_VIEWPORT.width - layout.width * layout.scale, placement.x)),
    y: Math.max(0, Math.min(VIDEO_VIEWPORT.height - layout.height * layout.scale, placement.y)),
  };
}

// This same panel is rendered into the browser overlay and the MP4 canvas.
export function drawDistanceHudPanel(context: CanvasRenderingContext2D, data: PlanDistanceProgress, layout: ReturnType<typeof distanceHudLayout>) {
  const { padding, titleHeight, rowHeight, fontSize, radius } = DISTANCE_HUD_LAYOUT;
  context.save();
  context.shadowBlur = 0;
  context.shadowOffsetX = 0;
  context.shadowOffsetY = 0;
  context.beginPath();
  context.roundRect(0.5, 0.5, layout.width - 1, layout.height - 1, radius);
  context.fillStyle = 'rgba(10,28,49,.84)';
  context.fill();
  context.strokeStyle = 'rgba(255,255,255,.3)';
  context.lineWidth = 1;
  context.stroke();
  context.fillStyle = '#fff';
  context.textBaseline = 'middle';
  context.textAlign = 'left';
  context.font = `600 ${fontSize}px system-ui, sans-serif`;
  context.fillText('概算距離', padding, padding + titleHeight / 2);
  context.font = `${fontSize}px monospace`;
  const row = (label: string, meters: number, y: number) => {
    context.textAlign = 'left';
    context.fillText(label, padding, y);
    context.textAlign = 'right';
    context.fillText(distanceHudKilometers(meters), layout.width - padding, y);
  };
  data.days.forEach((day, index) => row(`DAY ${day.dayNumber}`, day.currentMeters, padding + titleHeight + (index + 0.5) * rowHeight));
  const separatorY = padding + titleHeight + data.days.length * rowHeight + 6;
  context.beginPath();
  context.moveTo(padding, separatorY);
  context.lineTo(layout.width - padding, separatorY);
  context.stroke();
  context.font = `600 ${fontSize}px monospace`;
  row('TOTAL', data.currentTotalMeters, separatorY + 30);
  context.restore();
}

export function drawDistanceHud(context: CanvasRenderingContext2D, data: PlanDistanceProgress, options: DistanceHudOptions) {
  if (!options.settings.enabled) return;
  const layout = distanceHudLayout(options.model, options.settings.scale);
  const placement = clampDistanceHudPlacement(options.settings, layout);
  context.save();
  context.translate(placement.x, placement.y);
  context.scale(layout.scale, layout.scale);
  drawDistanceHudPanel(context, data, layout);
  context.restore();
}
