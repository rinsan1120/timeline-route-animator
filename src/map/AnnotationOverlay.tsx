import { bindPopupDrag, positionManualPopup } from '../popup/browserPlacement';
import type { PopupPlacement } from '../popup/placement';
import { useLayoutEffect, useMemo, useRef } from 'react';
import type { Map as MapLibreMap } from 'maplibre-gl';
import type { RoutePoint } from '../timeline/types';
import { tripRoutePointProgresses } from '../route/tripRoute';
import type { AnnotationStyle } from '../route/annotationStyle';
import type { CSSProperties } from 'react';

interface AnnotationOverlayProps {
  draggable: boolean;
  onPlacement: (id: string, placement: PopupPlacement) => void;
  map: MapLibreMap | null;
  points: RoutePoint[];
  animationPoints: RoutePoint[];
  editMode: boolean;
  previewProgress: number | null;
  reachedPointIndex?: number | null;
  annotationStyle: AnnotationStyle;
}

export default function AnnotationOverlay({ draggable, onPlacement, map, points, animationPoints, editMode, previewProgress, reachedPointIndex = null, annotationStyle }: AnnotationOverlayProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const arrivals = useMemo(() => {
    const progresses = tripRoutePointProgresses(animationPoints);
    return animationPoints.flatMap((point, index) => point.annotation?.label ? [{ point, pointIndex: index, progress: progresses[index] }] : []);
  }, [animationPoints]);
  const editedAnnotations = useMemo(() => points.filter((point) => point.annotation?.label), [points]);
  const visible = useMemo(() => previewProgress !== null
    ? arrivals.filter((entry) => previewProgress >= entry.progress && (reachedPointIndex === null || entry.pointIndex <= reachedPointIndex)).map((entry) => entry.point)
    : editMode ? editedAnnotations : [], [arrivals, editedAnnotations, editMode, previewProgress, reachedPointIndex]);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!map || !container) return;
    const positionBalloons = () => {
      const width = container.clientWidth;
      const height = container.clientHeight;
      visible.forEach((point, index) => {
        const element = container.children[index] as HTMLDivElement;
        const projected = map.project([point.longitude, point.latitude]);
        if (projected.x < 0 || projected.x > width || projected.y < 0 || projected.y > height) {
          element.style.visibility = 'hidden';
          return;
        }
        const balloonWidth = element.offsetWidth;
        const balloonHeight = element.offsetHeight;
        const left = Math.max(8, Math.min(width - balloonWidth - 8, projected.x - balloonWidth / 2));
        const gap = 20 * annotationStyle.balloonScale;
        const below = projected.y - balloonHeight - gap < 8;
        const top = Math.max(8, Math.min(height - balloonHeight - 8, below ? projected.y + gap : projected.y - balloonHeight - gap));
        element.style.left = `${left}px`;
        element.style.top = `${top}px`;
        const inset = 10 * annotationStyle.balloonScale;
        element.style.setProperty('--pointer-left', `${Math.max(inset, Math.min(balloonWidth - inset, projected.x - left))}px`);
        element.dataset.placement = below ? 'below' : 'above';
        positionManualPopup(element, container, projected, point.annotation?.placement, 8);
        element.style.visibility = 'visible';
      });
    };
    positionBalloons();
    const cleanups = draggable ? visible.map((point, index) => bindPopupDrag(container.children[index] as HTMLDivElement, container, () => map.project([point.longitude, point.latitude]), (placement) => onPlacement(point.id, placement), positionBalloons, 8)) : [];
    map.on('move', positionBalloons);
    map.on('resize', positionBalloons);
    return () => {
      cleanups.forEach((cleanup) => cleanup());
      map.off('move', positionBalloons);
      map.off('resize', positionBalloons);
    };
  }, [draggable, onPlacement, map, visible, annotationStyle]);

  return <div ref={containerRef} className="annotation-overlay" style={{ '--balloon-scale': annotationStyle.balloonScale, '--font-scale': annotationStyle.fontScale } as CSSProperties}>
    {visible.map((point) => <div key={point.id} className="annotation-balloon" style={{ visibility: 'hidden' }}>
      <svg className="popup-connector" aria-hidden="true"><line /></svg>
      <span>{point.annotation!.label}</span>
    </div>)}
  </div>;
}
