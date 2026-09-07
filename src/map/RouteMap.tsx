import { useEffect, useRef, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import type { GeoJSONSource, Map as MapLibreMap, MapMouseEvent, MapLayerMouseEvent, ErrorEvent } from 'maplibre-gl';
import type { RawPosition, RoutePoint } from '../timeline/types';
import { interpolateRoute } from '../route/geometry';
import { OSM_STYLE } from './osmStyle';
import AnnotationOverlay from './AnnotationOverlay';
import type { AnnotationStyle } from '../route/annotationStyle';

function routeCollection(points: RoutePoint[]) {
  return {
    type: 'FeatureCollection' as const,
    features: points.length ? [{ type: 'Feature' as const, properties: {}, geometry: { type: 'LineString' as const, coordinates: points.map((point) => [point.longitude, point.latitude]) } }] : [],
  };
}

function pointCollection(points: RoutePoint[], selectedPointId: string | null = null) {
  return {
    type: 'FeatureCollection' as const,
    features: points.map((point) => ({ type: 'Feature' as const, properties: { id: point.id, manual: !point.original, selected: point.id === selectedPointId }, geometry: { type: 'Point' as const, coordinates: [point.longitude, point.latitude] } })),
  };
}

function rawCollection(points: RawPosition[]) {
  return {
    type: 'FeatureCollection' as const,
    features: points.map((point) => ({ type: 'Feature' as const, properties: { ...point, accuracyMeters: point.accuracyMeters ?? 0 }, geometry: { type: 'Point' as const, coordinates: [point.longitude, point.latitude] } })),
  };
}

interface RouteMapProps {
  annotationStyle: AnnotationStyle;
  points: RoutePoint[];
  animationPoints: RoutePoint[];
  rawPositions: RawPosition[];
  showRaw: boolean;
  editMode: boolean;
  animationRangeMode: boolean;
  addMode: boolean;
  selectedPointId: string | null;
  previewProgress: number | null;
  revealRoute: boolean;
  onSelectPoint: (id: string | null) => void;
  onSelectRaw: (point: RawPosition | null) => void;
  onAddPoint: (latitude: number, longitude: number) => void;
  onMovePoint: (id: string, latitude: number, longitude: number) => void;
  onError: (message: string) => void;
}

export default function RouteMap(props: RouteMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const routeOverlayRef = useRef<SVGPathElement>(null);
  const previewMarkerRef = useRef<SVGCircleElement>(null);
  const editPointsOverlayRef = useRef<SVGSVGElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const loadedRef = useRef(false);
  const selectedMarkerRef = useRef<maplibregl.Marker | null>(null);
  const [mapStatus, setMapStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const propsRef = useRef(props);
  propsRef.current = props;
  const isPreviewing = props.previewProgress !== null;

  useEffect(() => {
    if (!containerRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: OSM_STYLE,
      center: [139.767, 35.681],
      zoom: 10,
      attributionControl: false,
    });
    mapRef.current = map;
    const redrawOverlay = () => updateRouteOverlay(map, getVisibleRoutePoints(propsRef.current), propsRef.current.animationPoints, routeOverlayRef.current, previewMarkerRef.current, propsRef.current.previewProgress);
    const resizeObserver = new ResizeObserver(() => {
      map.resize();
      redrawOverlay();
    });
    resizeObserver.observe(containerRef.current);
    const loadTimeout = window.setTimeout(() => {
      if (!loadedRef.current) {
        setMapStatus('error');
        propsRef.current.onError('地図の読み込みがタイムアウトしました。ネットワーク接続を確認してください。');
      }
    }, 15_000);
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    map.addControl(new maplibregl.AttributionControl({ compact: false }), 'bottom-right');
    const initializeMap = () => {
      const firstLoad = !loadedRef.current;
      loadedRef.current = true;
      window.clearTimeout(loadTimeout);
      setMapStatus('ready');
      installRouteLayers(map, propsRef.current);
      refreshMap(map, propsRef.current);
      fitRoute(map, propsRef.current.points, 0);
      redrawOverlay();
      if (!firstLoad) map.triggerRepaint();
    };
    map.on('style.load', initializeMap);
    map.on('move', redrawOverlay);
    map.on('error', (event: ErrorEvent) => {
      if (event.error) {
        // Keep the raster source and editable layers alive after individual tile failures.
        propsRef.current.onError('地図の一部を読み込めませんでした。ネットワーク接続を確認してください。');
      }
    });
    map.on('click', 'route-points-layer', (event: MapLayerMouseEvent) => {
      const id = event.features?.[0]?.properties?.id;
      if (typeof id === 'string') propsRef.current.onSelectPoint(id);
    });
    map.on('click', 'raw-points', (event: MapLayerMouseEvent) => {
      const id = event.features?.[0]?.properties?.id;
      propsRef.current.onSelectRaw(propsRef.current.rawPositions.find((point) => point.id === id) ?? null);
    });
    map.on('click', (event: MapMouseEvent) => {
      if (propsRef.current.animationRangeMode) {
        const nearest = findNearestRoutePoint(map, propsRef.current.points, event.point);
        propsRef.current.onSelectPoint(nearest?.id ?? null);
        propsRef.current.onSelectRaw(null);
        return;
      }
      if (propsRef.current.editMode && !propsRef.current.addMode) {
        const nearest = findNearestRoutePoint(map, propsRef.current.points, event.point);
        // onSelectPoint also clears the raw selection in App; do not clear it again afterward.
        if (nearest) propsRef.current.onSelectPoint(nearest.id);
        return;
      }
      if (!propsRef.current.addMode) return;
      const hits = map.queryRenderedFeatures(event.point, { layers: ['route-points-layer', 'raw-points'] });
      if (!hits.length) propsRef.current.onAddPoint(event.lngLat.lat, event.lngLat.lng);
    });
    return () => {
      window.clearTimeout(loadTimeout);
      resizeObserver.disconnect();
      map.off('style.load', initializeMap);
      map.off('move', redrawOverlay);
      selectedMarkerRef.current?.remove();
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loadedRef.current) return;
    refreshMap(map, props);
    map.resize();
    map.triggerRepaint();
    updateRouteOverlay(map, getVisibleRoutePoints(props), props.animationPoints, routeOverlayRef.current, previewMarkerRef.current, props.previewProgress);
    updateMapDiagnostics(map, props.points);
  }, [props.points, props.animationPoints, props.rawPositions, props.showRaw, props.editMode, props.animationRangeMode, props.selectedPointId, props.previewProgress, props.revealRoute]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loadedRef.current || !isPreviewing) return;
    // Fit only when preview starts, not on each frame or display-state update.
    fitRoute(map, propsRef.current.animationPoints, 0);
  }, [isPreviewing]);

  useEffect(() => {
    const map = mapRef.current;
    const overlay = editPointsOverlayRef.current;
    if (!map || !overlay || !props.editMode) return;
    const redraw = () => updateEditPointsOverlay(map, props.points, props.selectedPointId, overlay);
    redraw();
    map.on('move', redraw);
    map.on('resize', redraw);
    return () => {
      map.off('move', redraw);
      map.off('resize', redraw);
    };
  }, [props.points, props.selectedPointId, props.editMode]);

  useEffect(() => {
    const map = mapRef.current;
    selectedMarkerRef.current?.remove();
    selectedMarkerRef.current = null;
    if (!map || !props.editMode || !props.selectedPointId) return;
    const point = props.points.find((candidate) => candidate.id === props.selectedPointId);
    if (!point) return;
    const element = document.createElement('div');
    element.className = 'drag-handle';
    element.setAttribute('aria-label', '選択中のポイントを移動');
    const marker = new maplibregl.Marker({ element, draggable: true })
      .setLngLat([point.longitude, point.latitude])
      .addTo(map);
    marker.on('dragend', () => {
      const position = marker.getLngLat();
      propsRef.current.onMovePoint(point.id, position.lat, position.lng);
    });
    selectedMarkerRef.current = marker;
  }, [props.selectedPointId, props.editMode, props.points]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loadedRef.current || props.points.length === 0) return;
    fitRoute(map, props.points, 500);
  }, [props.points.length ? `${props.points[0].id}:${props.points.at(-1)?.id}` : 'empty']);

  return <>
    <div className={`map ${props.addMode ? 'map--adding' : ''}`} ref={containerRef} />
    <svg className="route-overlay" aria-hidden="true">
      <path ref={routeOverlayRef} />
      <circle ref={previewMarkerRef} className="preview-marker" r="11" display="none" />
    </svg>
    {props.editMode && <svg ref={editPointsOverlayRef} className="edit-points-overlay" aria-hidden="true">
      <path className="edit-points-original" />
      <path className="edit-points-manual" />
      <path className="edit-points-selected" />
    </svg>}
    <AnnotationOverlay map={mapRef.current} points={props.points} animationPoints={props.animationPoints} editMode={props.editMode} previewProgress={props.previewProgress} annotationStyle={props.annotationStyle} />
    {mapStatus !== 'ready' && <div className={`map-status ${mapStatus === 'error' ? 'map-status--error' : ''}`}>
      {mapStatus === 'loading' ? <><span className="spinner" />地図を読み込んでいます…</> : <>地図を表示できません。ネットワーク接続を確認してください。</>}
    </div>}
  </>;
}

function installRouteLayers(map: MapLibreMap, props: RouteMapProps) {
  if (!map.getSource('route')) map.addSource('route', { type: 'geojson', data: routeCollection(props.points) });
  if (!map.getSource('route-points')) map.addSource('route-points', { type: 'geojson', data: pointCollection(props.points, props.selectedPointId) });
  if (!map.getSource('raw-positions')) map.addSource('raw-positions', { type: 'geojson', data: rawCollection(props.rawPositions) });
  if (!map.getSource('preview-marker')) map.addSource('preview-marker', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  if (!map.getLayer('route-line')) map.addLayer({ id: 'route-line', type: 'line', source: 'route', paint: { 'line-color': '#ff5d37', 'line-width': 6, 'line-opacity': 0.92 } });
  if (!map.getLayer('raw-points')) map.addLayer({ id: 'raw-points', type: 'circle', source: 'raw-positions', layout: { visibility: props.showRaw ? 'visible' : 'none' }, paint: {
    'circle-radius': ['interpolate', ['linear'], ['get', 'accuracyMeters'], 0, 4, 100, 7, 500, 10],
    'circle-color': ['interpolate', ['linear'], ['get', 'accuracyMeters'], 0, '#16c79a', 50, '#f6c945', 200, '#ef476f'],
    'circle-stroke-color': '#ffffff', 'circle-stroke-width': 1.5, 'circle-opacity': 0.8,
  } });
  if (!map.getLayer('route-points-layer')) map.addLayer({ id: 'route-points-layer', type: 'circle', source: 'route-points', layout: { visibility: props.editMode || props.animationRangeMode ? 'visible' : 'none' }, paint: {
    'circle-radius': ['case', ['get', 'selected'], 12, props.animationRangeMode ? 9 : 7],
    'circle-color': ['case', ['get', 'selected'], '#3b82f6', ['get', 'manual'], '#2dd4bf', '#ffffff'],
    'circle-stroke-color': '#10233f', 'circle-stroke-width': ['case', ['get', 'selected'], 4, 2],
  } });
  if (!map.getLayer('preview-marker-layer')) map.addLayer({ id: 'preview-marker-layer', type: 'circle', source: 'preview-marker', paint: { 'circle-radius': 11, 'circle-color': '#ffda57', 'circle-stroke-color': '#07111f', 'circle-stroke-width': 4 } });
}

function fitRoute(map: MapLibreMap, points: RoutePoint[], duration: number) {
  if (!points.length) return;
  const bounds = new maplibregl.LngLatBounds();
  points.forEach((point) => bounds.extend([point.longitude, point.latitude]));
  const northEast = bounds.getNorthEast();
  const southWest = bounds.getSouthWest();
  if (points.length === 1 || (northEast.lng === southWest.lng && northEast.lat === southWest.lat)) {
    map.easeTo({ center: [points[0].longitude, points[0].latitude], zoom: 16, duration });
    return;
  }
  map.fitBounds(bounds, { padding: { top: 72, right: 44, bottom: 92, left: 44 }, maxZoom: 16, duration });
}

function updateMapDiagnostics(map: MapLibreMap, points: RoutePoint[]) {
  const container = map.getContainer();
  container.dataset.routePointCount = String(points.length);
  container.dataset.routeLayerReady = String(Boolean(map.getLayer('route-line')));
  container.dataset.routeInView = String(points.length > 0 && points.every((point) => map.getBounds().contains([point.longitude, point.latitude])));
  requestAnimationFrame(() => {
    container.dataset.routeRendered = String(Boolean(map.getLayer('route-line')) && map.queryRenderedFeatures({ layers: ['route-line'] }).length > 0);
  });
}

function refreshMap(map: MapLibreMap, props: RouteMapProps) {
  const visiblePoints = getVisibleRoutePoints(props);
  (map.getSource('route') as GeoJSONSource | undefined)?.setData(routeCollection(visiblePoints));
  (map.getSource('route-points') as GeoJSONSource | undefined)?.setData(pointCollection(props.points, props.selectedPointId));
  (map.getSource('raw-positions') as GeoJSONSource | undefined)?.setData(rawCollection(props.rawPositions));
  if (map.getLayer('raw-points')) map.setLayoutProperty('raw-points', 'visibility', props.showRaw ? 'visible' : 'none');
  if (map.getLayer('route-points-layer')) map.setLayoutProperty('route-points-layer', 'visibility', props.editMode || props.animationRangeMode ? 'visible' : 'none');
  if (map.getLayer('route-points-layer')) map.setPaintProperty('route-points-layer', 'circle-radius', ['case', ['get', 'selected'], 12, props.animationRangeMode ? 9 : 7]);
  let markerFeatures: object[] = [];
  if (props.previewProgress !== null && props.animationPoints.length) {
    const position = interpolateRoute(props.animationPoints, props.previewProgress);
    if (position) markerFeatures = [{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [position.longitude, position.latitude] } }];
  }
  (map.getSource('preview-marker') as GeoJSONSource | undefined)?.setData({ type: 'FeatureCollection', features: markerFeatures } as never);
}

function getVisibleRoutePoints(props: RouteMapProps): RoutePoint[] {
  let visiblePoints = props.previewProgress === null ? props.points : props.animationPoints;
  if (props.previewProgress !== null && props.revealRoute && props.animationPoints.length > 1) {
    const position = interpolateRoute(props.animationPoints, props.previewProgress);
    if (position) visiblePoints = [
      ...props.animationPoints.slice(0, position.segmentIndex + 1),
      { id: 'preview-tail', latitude: position.latitude, longitude: position.longitude, source: 'manual', original: false },
    ];
  }
  return visiblePoints;
}

function updateRouteOverlay(
  map: MapLibreMap,
  points: RoutePoint[],
  animationPoints: RoutePoint[],
  path: SVGPathElement | null,
  previewMarker: SVGCircleElement | null,
  previewProgress: number | null,
) {
  if (!path || points.length < 2) {
    path?.setAttribute('d', '');
  } else {
    const projected = points.map((point) => map.project([point.longitude, point.latitude]));
    path.setAttribute('d', projected.map((point, index) => `${index === 0 ? 'M' : 'L'}${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(' '));
  }
  const position = previewProgress !== null && animationPoints.length
    ? interpolateRoute(animationPoints, previewProgress)
    : null;
  updateOverlayMarker(map, position, previewMarker);
}

function updateOverlayMarker(map: MapLibreMap, point: { longitude: number; latitude: number } | null, marker: SVGCircleElement | null) {
  if (!marker) return;
  if (!point) {
    marker.setAttribute('display', 'none');
    return;
  }
  const projected = map.project([point.longitude, point.latitude]);
  marker.setAttribute('cx', projected.x.toFixed(1));
  marker.setAttribute('cy', projected.y.toFixed(1));
  marker.removeAttribute('display');
}

function findNearestRoutePoint(map: MapLibreMap, points: RoutePoint[], clickPoint: MapMouseEvent['point'], maxDistance = 28): RoutePoint | null {
  let nearest: RoutePoint | null = null;
  let nearestDistance = maxDistance;
  for (const point of points) {
    const screenPoint = map.project([point.longitude, point.latitude]);
    const distance = Math.hypot(screenPoint.x - clickPoint.x, screenPoint.y - clickPoint.y);
    if (distance <= nearestDistance) {
      nearest = point;
      nearestDistance = distance;
    }
  }
  return nearest;
}

function updateEditPointsOverlay(map: MapLibreMap, points: RoutePoint[], selectedPointId: string | null, overlay: SVGSVGElement) {
  const original: string[] = [];
  const manual: string[] = [];
  let selected = '';
  // Batch circles into paths instead of creating a DOM element for every route point.
  for (const point of points) {
    const screen = map.project([point.longitude, point.latitude]);
    const radius = point.id === selectedPointId ? 10 : 7;
    const circle = `M${screen.x - radius},${screen.y}a${radius},${radius} 0 1,0 ${radius * 2},0a${radius},${radius} 0 1,0 ${-radius * 2},0Z`;
    if (point.id === selectedPointId) selected = circle;
    else (point.original ? original : manual).push(circle);
  }
  overlay.children[0].setAttribute('d', original.join(' '));
  overlay.children[1].setAttribute('d', manual.join(' '));
  overlay.children[2].setAttribute('d', selected);
}
