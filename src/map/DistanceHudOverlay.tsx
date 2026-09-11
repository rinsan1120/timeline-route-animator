import { useEffect, useRef, type PointerEvent } from 'react';
import { routeDistanceProgress } from '../route/routeDistanceProgress';
import { clampDistanceHudPlacement, distanceHudLayout, drawDistanceHudPanel, type DistanceHudOptions, type DistanceHudPlacement } from '../video/distanceHud';

interface Props {
  hud: DistanceHudOptions;
  viewport: { left: number; top: number; scale: number };
  routeProgress: number | null;
  reachedPointIndex?: number | null;
  draggable: boolean;
  onPlacement: (placement: DistanceHudPlacement) => void;
}

export default function DistanceHudOverlay({ hud, viewport, routeProgress, reachedPointIndex, draggable, onPlacement }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dragRef = useRef<{ id: number; clientX: number; clientY: number; placement: DistanceHudPlacement } | null>(null);
  const layout = distanceHudLayout(hud.model, hud.settings.scale);
  const placement = clampDistanceHudPlacement(hud.settings, layout);
  const displayScale = viewport.scale * layout.scale;
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const density = Math.max(1, displayScale * window.devicePixelRatio);
    canvas.width = Math.ceil(layout.width * density);
    canvas.height = Math.ceil(layout.height * density);
    const context = canvas.getContext('2d');
    if (!context) return;
    context.scale(density, density);
    drawDistanceHudPanel(context, routeDistanceProgress(hud.model, routeProgress, reachedPointIndex), layout, hud.dayColorsEnabled);
  }, [hud.model, hud.dayColorsEnabled, routeProgress, reachedPointIndex, layout.width, layout.height, displayScale]);

  useEffect(() => { if (!draggable) dragRef.current = null; }, [draggable]);
  const endDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.id !== event.pointerId) return;
    event.stopPropagation();
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  return <div className="distance-hud-overlay">
    <div className="distance-hud-panel" role="img" aria-label="概算距離HUD"
      style={{ left: viewport.left + placement.x * viewport.scale, top: viewport.top + placement.y * viewport.scale,
        width: layout.width, height: layout.height, transform: `scale(${displayScale})`,
        pointerEvents: draggable ? 'auto' : 'none', cursor: draggable ? 'grab' : 'default' }}
      onClick={(event) => event.stopPropagation()}
      onPointerDown={(event) => {
        if (!draggable || !event.isPrimary || (event.pointerType === 'mouse' && event.button !== 0)) return;
        event.preventDefault();
        event.stopPropagation();
        dragRef.current = { id: event.pointerId, clientX: event.clientX, clientY: event.clientY, placement };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        const drag = dragRef.current;
        if (!draggable || !drag || drag.id !== event.pointerId) return;
        event.preventDefault();
        event.stopPropagation();
        onPlacement(clampDistanceHudPlacement({
          x: drag.placement.x + (event.clientX - drag.clientX) / viewport.scale,
          y: drag.placement.y + (event.clientY - drag.clientY) / viewport.scale,
        }, layout));
      }}
      onPointerUp={endDrag} onPointerCancel={endDrag} onLostPointerCapture={() => { dragRef.current = null; }}>
      <canvas ref={canvasRef} style={{ width: layout.width, height: layout.height }} />
    </div>
  </div>;
}
