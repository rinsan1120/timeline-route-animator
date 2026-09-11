import { getVideoPreviewViewport, VIDEO_VIEWPORT } from '../video/overviewCamera';
import { bindPopupDrag, positionManualPopup } from '../popup/browserPlacement';
import { popupDisplayScale, type PopupPlacement } from '../popup/placement';
import { useLayoutEffect, useMemo, useRef } from 'react';
import type { Map as MapLibreMap } from 'maplibre-gl';
import type { RoutePoint } from '../timeline/types';
import { tripRoutePointProgresses, type DayMarker } from '../route/tripRoute';
import { DAY_MARKER_FONT_FAMILY, dayMarkerColors, dayMarkerConnector, dayMarkerEditingLayout, dayMarkerLayout, dayMarkerStyle } from '../route/dayMarkerStyle';

interface DayMarkerOverlayProps {
  draggable: boolean;
  onPlacement: (id: string, placement: PopupPlacement) => void;
  map: MapLibreMap | null;
  points: RoutePoint[];
  animationPoints: RoutePoint[];
  markers: DayMarker[];
  dayColorsEnabled: boolean;
  previewProgress: number | null;
  reachedPointIndex?: number | null;
}

export default function DayMarkerOverlay({ draggable, onPlacement, map, points, animationPoints, markers, dayColorsEnabled, previewProgress, reachedPointIndex = null }: DayMarkerOverlayProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const isPreviewing = previewProgress !== null;
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
    const measureContext = document.createElement('canvas').getContext('2d');
    if (!measureContext) return;
    let active = true;
    const positionMarkers = () => {
      if (!active) return;
      const mapContainer = map.getContainer();
      const viewport = getVideoPreviewViewport(mapContainer.clientWidth, mapContainer.clientHeight);
      // Render preview in video coordinates, then shrink the entire overlay once.
      // Editing keeps its existing CSS sizes and placement conversion.
      Object.assign(container.style, isPreviewing ? {
        width: `${VIDEO_VIEWPORT.width}px`, height: `${VIDEO_VIEWPORT.height}px`,
        left: `${viewport.left}px`, top: `${viewport.top}px`,
        transform: `scale(${viewport.scale})`, transformOrigin: 'top left',
      } : { width: '', height: '', left: '', top: '', transform: '', transformOrigin: '' });
      const width = container.clientWidth;
      const height = container.clientHeight;
      if (width <= 0 || height <= 0) return;
      const scale = popupDisplayScale(width, height);
      const browserStyle = dayMarkerStyle();
      visible.forEach((marker, index) => {
        const element = container.children[index] as HTMLDivElement;
        const layout = isPreviewing ? dayMarkerLayout(marker, measureContext)
          : dayMarkerEditingLayout(marker, measureContext, { width, height });
        const style = layout.style;
        const colors = dayMarkerColors(marker.dayNumber, dayColorsEnabled);
        Object.assign(element.style, {
          width: `${layout.width * scale}px`, height: `${layout.height * scale}px`, minWidth: '0', maxWidth: 'none',
          padding: `${style.paddingTop * scale}px ${style.paddingX * scale}px ${style.paddingBottom * scale}px`,
          gap: `${style.rowGap * scale}px`, border: `${style.border * scale}px solid ${colors.outline}`,
          borderRadius: `${style.radius * scale}px`, background: colors.background,
          boxShadow: `0 ${style.shadowOffsetY * scale}px ${style.shadowBlur * scale}px ${colors.shadow}`,
          fontFamily: DAY_MARKER_FONT_FAMILY,
        });
        layout.rows.forEach((row) => {
          const text = element.querySelector<HTMLElement>(row.kind === 'day' ? 'strong' : row.kind === 'date' ? 'time' : 'span')!;
          text.textContent = row.text;
          Object.assign(text.style, { fontSize: `${row.fontSize * scale}px`, fontWeight: String(row.weight),
            letterSpacing: `${row.spacing * scale}px`, lineHeight: `${row.height * scale}px`, color: row.color, maxWidth: '100%' });
        });
        element.style.setProperty('--day-connector-width', `${style.connectorWidth * scale}px`);
        element.style.setProperty('--day-manual-connector-width', `${style.manualConnectorWidth * scale}px`);
        element.style.setProperty('--day-anchor-radius', `${style.anchorRadius * scale}px`);
        element.style.setProperty('--day-manual-anchor-radius', `${style.manualAnchorRadius * scale}px`);
        element.style.setProperty('--day-anchor-border', `${style.anchorBorder * scale}px`);
        element.style.setProperty('--day-outline', colors.outline);
        element.style.setProperty('--day-anchor', colors.anchor);
        element.style.setProperty('--day-anchor-outline', colors.text);
        const mapPoint = map.project([marker.point.longitude, marker.point.latitude]);
        const projected = isPreviewing
          ? { x: (mapPoint.x - viewport.left) / viewport.scale, y: (mapPoint.y - viewport.top) / viewport.scale }
          : mapPoint;
        if (projected.x < 0 || projected.x > width || projected.y < 0 || projected.y > height) {
          element.style.visibility = 'hidden';
          return;
        }
        const markerWidth = element.offsetWidth;
        const markerHeight = element.offsetHeight;
        const left = Math.max(browserStyle.margin, Math.min(width - markerWidth - browserStyle.margin, projected.x - markerWidth / 2));
        const gap = browserStyle.anchorGap;
        const below = projected.y - markerHeight - gap < browserStyle.margin;
        const top = Math.max(browserStyle.margin, Math.min(height - markerHeight - browserStyle.bottomMargin, below ? projected.y + gap : projected.y - markerHeight - gap));
        element.style.left = `${left}px`;
        element.style.top = `${top}px`;
        element.style.setProperty('--day-marker-anchor-x', `${Math.max(browserStyle.anchorInset, Math.min(markerWidth - browserStyle.anchorInset, projected.x - left))}px`);
        element.dataset.placement = below ? 'below' : 'above';
        const connector = element.querySelector<SVGSVGElement>('.popup-connector')!;
        connector.style.left = `${-element.clientLeft}px`;
        connector.style.top = `${-element.clientTop}px`;
        const geometry = dayMarkerConnector({ left, top, width: markerWidth, height: markerHeight }, projected, false, below, browserStyle);
        const line = connector.querySelector('line')!;
        line.setAttribute('x1', String(geometry.start.x - left));
        line.setAttribute('y1', String(geometry.start.y - top));
        line.setAttribute('x2', String(geometry.end.x - left));
        line.setAttribute('y2', String(geometry.end.y - top));
        const dot = connector.querySelector('circle')!;
        dot.setAttribute('cx', String(geometry.dot.x - left));
        dot.setAttribute('cy', String(geometry.dot.y - top));
        positionManualPopup(element, container, projected, marker.placement, browserStyle.bottomMargin);
        element.style.visibility = 'visible';
      });
    };
    positionMarkers();
    void document.fonts.ready.then(positionMarkers);
    const cleanups = draggable ? visible.map((marker, index) => bindPopupDrag(container.children[index] as HTMLDivElement, container, () => map.project([marker.point.longitude, marker.point.latitude]), (placement) => onPlacement(marker.pointId, placement), positionMarkers, dayMarkerStyle().bottomMargin)) : [];
    map.on('move', positionMarkers);
    map.on('resize', positionMarkers);
    return () => {
      active = false;
      cleanups.forEach((cleanup) => cleanup());
      map.off('move', positionMarkers);
      map.off('resize', positionMarkers);
    };
  }, [draggable, onPlacement, map, visible, dayColorsEnabled, isPreviewing]);

  return <div ref={containerRef} className="day-marker-overlay">
    {visible.map((marker) => <div key={marker.pointId} className="day-marker" style={{ visibility: 'hidden' }}>
      <svg className="popup-connector" aria-hidden="true"><line /><circle r="5" /></svg>
      <strong>DAY {marker.dayNumber}</strong>
      {marker.date && <time>{marker.date.replaceAll('-', '.')}</time>}
      {marker.note && <span>{marker.note}</span>}
    </div>)}
  </div>;
}
