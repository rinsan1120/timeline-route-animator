import type { BalloonFramePosition, PopupPlacement } from '../popup/placement';
import { drawAnnotation, type CanvasAnnotation } from '../route/annotationCanvas';
import type { AnnotationStyle } from '../route/annotationStyle';
import type { RouteDistanceProgress } from '../route/routeDistanceProgress';
import { drawDistanceHud, type DistanceHudOptions } from './distanceHud';
import { drawCurrentPositionMarker, drawDayMarker, drawEndpointMarker, drawMapAttribution, type VideoDayMarker } from './frameDrawing';
import { drawRouteClock } from './routeClock';

// All coordinates are already projected into the 1920×1080 video frame.
// Visibility and progress are resolved by each mode before composition.
export interface VideoFrameScene {
  background: CanvasImageSource;
  routeSegments: { color: string; pixels: { x: number; y: number }[] }[];
  markerPosition: { x: number; y: number };
  clockText: string | null;
  annotations: CanvasAnnotation[];
  annotationStyle: AnnotationStyle;
  dayMarkers: VideoDayMarker[];
  dayRouteColorsEnabled: boolean;
  endpointMarkers: { pixel: { x: number; y: number }; label: 'START' | 'GOAL'; placement?: PopupPlacement; framePosition?: BalloonFramePosition }[];
  distanceHud?: { progress: RouteDistanceProgress; options: DistanceHudOptions };
}

export function drawVideoFrame(context: CanvasRenderingContext2D, scene: VideoFrameScene) {
  context.drawImage(scene.background, 0, 0);
  context.lineCap = 'round';
  context.lineJoin = 'round';
  context.lineWidth = 10;
  context.shadowColor = 'rgba(0,0,0,.22)';
  context.shadowBlur = 8;
  for (const segment of scene.routeSegments) {
    // Preserve a beginPath/stroke even for empty or single-point segments.
    context.beginPath();
    segment.pixels.forEach((pixel, index) => {
      if (index === 0) context.moveTo(pixel.x, pixel.y);
      else context.lineTo(pixel.x, pixel.y);
    });
    context.strokeStyle = segment.color;
    context.stroke();
  }
  context.shadowBlur = 0;

  const { x, y } = scene.markerPosition;
  drawCurrentPositionMarker(context, x, y);
  drawRouteClock(context, scene.clockText, x, y);
  for (const annotation of scene.annotations) drawAnnotation(context, annotation, scene.annotationStyle);
  for (const dayMarker of scene.dayMarkers) drawDayMarker(context, dayMarker, scene.dayRouteColorsEnabled, scene.annotationStyle);
  for (const endpoint of scene.endpointMarkers) drawEndpointMarker(context, endpoint.pixel, endpoint.label, endpoint.placement, endpoint.framePosition);
  if (scene.distanceHud) drawDistanceHud(context, scene.distanceHud.progress, scene.distanceHud.options);
  // Intentionally keep the existing Canvas state inheritance and draw this last.
  drawMapAttribution(context);
}
