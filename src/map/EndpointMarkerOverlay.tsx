import { useLayoutEffect, useMemo, useRef } from 'react';
import type { Map as MapLibreMap } from 'maplibre-gl';
import type { RoutePoint } from '../timeline/types';

interface EndpointMarkerOverlayProps {
  map: MapLibreMap | null;
  animationPoints: RoutePoint[];
  previewProgress: number | null;
  reachedPointIndex?: number | null;
}

interface EndpointMarker {
  label: 'START' | 'GOAL';
  point: RoutePoint;
}

export default function EndpointMarkerOverlay({ map, animationPoints, previewProgress, reachedPointIndex = null }: EndpointMarkerOverlayProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const visible = useMemo(() => {
    const start = animationPoints[0];
    if (!start) return [];
    const markers: EndpointMarker[] = [{ label: 'START', point: start }];
    if (animationPoints.length === 1) return markers;
    const goalReached = previewProgress === null
      || (reachedPointIndex !== null
        ? reachedPointIndex >= animationPoints.length - 1
        : previewProgress >= 1);
    if (goalReached) markers.push({ label: 'GOAL', point: animationPoints.at(-1)! });
    return markers;
  }, [animationPoints, previewProgress, reachedPointIndex]);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!map || !container) return;
    const positionMarkers = () => {
      const width = container.clientWidth;
      const height = container.clientHeight;
      visible.forEach((marker, index) => {
        const element = container.children[index] as HTMLDivElement;
        const projected = map.project([marker.point.longitude, marker.point.latitude]);
        if (projected.x < 0 || projected.x > width || projected.y < 0 || projected.y > height) {
          element.style.visibility = 'hidden';
          return;
        }
        const markerWidth = element.offsetWidth;
        const markerHeight = element.offsetHeight;
        const left = Math.max(8, Math.min(width - markerWidth - 8, projected.x - markerWidth / 2));
        const gap = 24;
        const below = projected.y - markerHeight - gap < 8;
        const top = Math.max(8, Math.min(height - markerHeight - 54, below ? projected.y + gap : projected.y - markerHeight - gap));
        element.style.left = `${left}px`;
        element.style.top = `${top}px`;
        element.style.setProperty('--day-marker-anchor-x', `${Math.max(12, Math.min(markerWidth - 12, projected.x - left))}px`);
        element.dataset.placement = below ? 'below' : 'above';
        element.style.visibility = 'visible';
      });
    };
    positionMarkers();
    map.on('move', positionMarkers);
    map.on('resize', positionMarkers);
    return () => {
      map.off('move', positionMarkers);
      map.off('resize', positionMarkers);
    };
  }, [map, visible]);

  return <div ref={containerRef} className="day-marker-overlay endpoint-marker-overlay">
    {visible.map((marker) => <div key={marker.label} className="day-marker endpoint-marker" style={{ visibility: 'hidden' }}>
      <strong>{marker.label}</strong>
    </div>)}
  </div>;
}
