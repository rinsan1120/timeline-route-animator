import { useEffect, useRef } from 'react';
import * as maplibregl from 'maplibre-gl';
import type { GeoJSONSource, Map as MapLibreMap, MapMouseEvent, MapLayerMouseEvent, ErrorEvent } from 'maplibre-gl';
import type { RawPosition, RoutePoint } from '../timeline/types';
import { interpolateRoute } from '../route/geometry';

const STYLE_URL = 'https://tiles.openfreemap.org/styles/positron';

function routeCollection(points: RoutePoint[]) {
  return {
    type: 'FeatureCollection' as const,
    features: points.length ? [{ type: 'Feature' as const, properties: {}, geometry: { type: 'LineString' as const, coordinates: points.map((point) => [point.longitude, point.latitude]) } }] : [],
  };
}

function pointCollection(points: RoutePoint[]) {
  return {
    type: 'FeatureCollection' as const,
    features: points.map((point) => ({ type: 'Feature' as const, properties: { id: point.id, manual: !point.original }, geometry: { type: 'Point' as const, coordinates: [point.longitude, point.latitude] } })),
  };
}

function rawCollection(points: RawPosition[]) {
  return {
    type: 'FeatureCollection' as const,
    features: points.map((point) => ({ type: 'Feature' as const, properties: { ...point, accuracyMeters: point.accuracyMeters ?? 0 }, geometry: { type: 'Point' as const, coordinates: [point.longitude, point.latitude] } })),
  };
}

interface RouteMapProps {
  points: RoutePoint[];
  rawPositions: RawPosition[];
  showRaw: boolean;
  editMode: boolean;
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
  const mapRef = useRef<MapLibreMap | null>(null);
  const loadedRef = useRef(false);
  const selectedMarkerRef = useRef<maplibregl.Marker | null>(null);
  const propsRef = useRef(props);
  propsRef.current = props;

  useEffect(() => {
    if (!containerRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: STYLE_URL,
      center: [139.767, 35.681],
      zoom: 10,
      attributionControl: false,
    });
    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right');
    map.on('load', () => {
      loadedRef.current = true;
      map.addSource('route', { type: 'geojson', data: routeCollection(propsRef.current.points) });
      map.addSource('route-points', { type: 'geojson', data: pointCollection(propsRef.current.points) });
      map.addSource('raw-positions', { type: 'geojson', data: rawCollection(propsRef.current.rawPositions) });
      map.addSource('preview-marker', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      map.addLayer({ id: 'route-line', type: 'line', source: 'route', paint: { 'line-color': '#ff5d37', 'line-width': 6, 'line-opacity': 0.92 } });
      map.addLayer({ id: 'raw-points', type: 'circle', source: 'raw-positions', layout: { visibility: propsRef.current.showRaw ? 'visible' : 'none' }, paint: {
        'circle-radius': ['interpolate', ['linear'], ['get', 'accuracyMeters'], 0, 4, 100, 7, 500, 10],
        'circle-color': ['interpolate', ['linear'], ['get', 'accuracyMeters'], 0, '#16c79a', 50, '#f6c945', 200, '#ef476f'],
        'circle-stroke-color': '#ffffff', 'circle-stroke-width': 1.5, 'circle-opacity': 0.8,
      } });
      map.addLayer({ id: 'route-points-layer', type: 'circle', source: 'route-points', layout: { visibility: propsRef.current.editMode ? 'visible' : 'none' }, paint: {
        'circle-radius': 7, 'circle-color': ['case', ['get', 'manual'], '#2dd4bf', '#ffffff'], 'circle-stroke-color': '#10233f', 'circle-stroke-width': 2,
      } });
      map.addLayer({ id: 'preview-marker-layer', type: 'circle', source: 'preview-marker', paint: { 'circle-radius': 11, 'circle-color': '#ffda57', 'circle-stroke-color': '#07111f', 'circle-stroke-width': 4 } });
      refreshMap(map, propsRef.current);
    });
    map.on('error', (event: ErrorEvent) => {
      if (event.error) propsRef.current.onError('地図データを読み込めませんでした。ネットワーク接続を確認してください。');
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
      if (!propsRef.current.addMode) return;
      const hits = map.queryRenderedFeatures(event.point, { layers: ['route-points-layer', 'raw-points'] });
      if (!hits.length) propsRef.current.onAddPoint(event.lngLat.lat, event.lngLat.lng);
    });
    return () => {
      selectedMarkerRef.current?.remove();
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loadedRef.current) return;
    refreshMap(map, props);
  }, [props.points, props.rawPositions, props.showRaw, props.editMode, props.previewProgress, props.revealRoute]);

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
    const bounds = new maplibregl.LngLatBounds();
    props.points.forEach((point) => bounds.extend([point.longitude, point.latitude]));
    map.fitBounds(bounds, { padding: { top: 72, right: 44, bottom: 92, left: 44 }, maxZoom: 16, duration: 500 });
  }, [props.points.length ? `${props.points[0].id}:${props.points.at(-1)?.id}` : 'empty']);

  return <div className={`map ${props.addMode ? 'map--adding' : ''}`} ref={containerRef} />;
}

function refreshMap(map: MapLibreMap, props: RouteMapProps) {
  let visiblePoints = props.points;
  if (props.previewProgress !== null && props.revealRoute && props.points.length > 1) {
    const position = interpolateRoute(props.points, props.previewProgress);
    if (position) visiblePoints = [
      ...props.points.slice(0, position.segmentIndex + 1),
      { id: 'preview-tail', latitude: position.latitude, longitude: position.longitude, source: 'manual', original: false },
    ];
  }
  (map.getSource('route') as GeoJSONSource | undefined)?.setData(routeCollection(visiblePoints));
  (map.getSource('route-points') as GeoJSONSource | undefined)?.setData(pointCollection(props.points));
  (map.getSource('raw-positions') as GeoJSONSource | undefined)?.setData(rawCollection(props.rawPositions));
  if (map.getLayer('raw-points')) map.setLayoutProperty('raw-points', 'visibility', props.showRaw ? 'visible' : 'none');
  if (map.getLayer('route-points-layer')) map.setLayoutProperty('route-points-layer', 'visibility', props.editMode ? 'visible' : 'none');
  let markerFeatures: object[] = [];
  if (props.previewProgress !== null && props.points.length) {
    const position = interpolateRoute(props.points, props.previewProgress);
    if (position) markerFeatures = [{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [position.longitude, position.latitude] } }];
  }
  (map.getSource('preview-marker') as GeoJSONSource | undefined)?.setData({ type: 'FeatureCollection', features: markerFeatures } as never);
}
