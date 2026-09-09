import { useLayoutEffect, useMemo, useRef } from 'react';
import type { Map as MapLibreMap } from 'maplibre-gl';
import type { RoutePoint } from '../timeline/types';
import { tripRoutePointProgresses, type DayMarker } from '../route/tripRoute';

interface DayMarkerOverlayProps {
  map: MapLibreMap | null;
  points: RoutePoint[];
  animationPoints: RoutePoint[];
  markers: DayMarker[];
  previewProgress: number | null;
  reachedPointIndex?: number | null;
}

export default function DayMarkerOverlay({ map, points, animationPoints, markers, previewProgress, reachedPointIndex = null }: DayMarkerOverlayProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const visible = useMemo(() => {
    const pointsById = new Map(points.map((point) => [point.id, point]));
    const markerPoints = markers.flatMap((marker) => {
      const point = pointsById.get(marker.pointId);
      return point ? [{ ...marker, point }] : [];
    });
    if (previewProgress === null) return markerPoints;
    const arrivals = tripRoutePointProgresses(animationPoints);
    const arrivalByPointId = new Map(animationPoints.map((point, index) => [point.id, { progress: arrivals[index], pointIndex: index }]));
    return markerPoints.filter((marker) => {
      const arrival = arrivalByPointId.get(marker.pointId);
      return arrival !== undefined && previewProgress >= arrival.progress && (reachedPointIndex === null || arrival.pointIndex <= reachedPointIndex);
    });
  }, [points, animationPoints, markers, previewProgress, reachedPointIndex]);

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

  return <div ref={containerRef} className="day-marker-overlay">
    {visible.map((marker) => <div key={marker.pointId} className="day-marker" style={{ visibility: 'hidden' }}>
      <strong>DAY {marker.dayNumber}</strong>
      {marker.date && <time>{marker.date.replaceAll('-', '.')}</time>}
      {marker.note && <span>{marker.note}</span>}
    </div>)}
  </div>;
}
