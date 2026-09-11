import type { PopupPlacement, EndpointMarkerPlacements, EndpointMarkerLabel } from '../popup/placement';
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import * as maplibregl from 'maplibre-gl';
import type { GeoJSONSource, Map as MapLibreMap, MapMouseEvent, MapLayerMouseEvent, ErrorEvent } from 'maplibre-gl';
import type { RawPosition, RoutePoint } from '../timeline/types';
import { interpolateTripRoute, revealedTripRouteSegments, splitRouteByDay, type DayMarker } from '../route/tripRoute';
import { GSI_STYLE } from './gsiStyle';
import AnnotationOverlay from './AnnotationOverlay';
import DayMarkerOverlay from './DayMarkerOverlay';
import EndpointMarkerOverlay from './EndpointMarkerOverlay';
import DistanceHudOverlay from './DistanceHudOverlay';
import type { DistanceHudOptions, DistanceHudPlacement } from '../video/distanceHud';
import type { AnnotationStyle } from '../route/annotationStyle';
import type { RouteMarkerMode } from '../route/routeMarker';
import { sampleFollowOutputPlayback, type FollowCameraPlan, type GeoPosition, type VideoCameraMode } from '../video/followCamera';
import { getIntroStartZoom, interpolateIntroZoom, INTRO_ZOOM_DURATION_SECONDS } from '../video/introZoom';
import { constrainVideoCamera, getVideoPreviewViewport, videoZoomToPreviewZoom, OVERVIEW_FIT_PADDING, VIDEO_FPS, VIDEO_MIN_ZOOM, type VideoCamera, type ViewportSize } from '../video/overviewCamera';
import { samplePlaybackTimeline, type PlaybackTimeline } from '../video/playbackTimeline';

function routeCollection(segments: RoutePoint[][]) {
  return {
    type: 'FeatureCollection' as const,
    features: segments.filter((points) => points.length >= 2).map((points) => ({ type: 'Feature' as const, properties: {}, geometry: { type: 'LineString' as const, coordinates: points.map((point) => [point.longitude, point.latitude]) } })),
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
  distanceHud?: DistanceHudOptions;
  distanceHudDraggable?: boolean;
  onDistanceHudPlacement?: (placement: DistanceHudPlacement) => void;
  endpointMarkerPlacements: EndpointMarkerPlacements;
  onAnnotationPlacement: (id: string, placement: PopupPlacement) => void;
  onDayPlacement: (id: string, placement: PopupPlacement) => void;
  onEndpointPlacement: (id: EndpointMarkerLabel, placement: PopupPlacement) => void;
  autoFitRouteChanges: boolean;
  annotationStyle: AnnotationStyle;
  dayMarkers: DayMarker[];
  points: RoutePoint[];
  animationPoints: RoutePoint[];
  rawPositions: RawPosition[];
  showRaw: boolean;
  editMode: boolean;
  animationRangeMode: boolean;
  addMode: boolean;
  insertMode: boolean;
  rangeDeleteMode: boolean;
  rangeDeletePointIds: string[];
  routeMarkerMode: RouteMarkerMode;
  selectedPointId: string | null;
  previewProgress: number | null;
  previewDuration: number;
  playbackTimeline: PlaybackTimeline;
  introZoomEnabled: boolean;
  revealRoute: boolean;
  cameraMode: VideoCameraMode;
  overviewCamera: VideoCamera | null;
  followCameraPlan: FollowCameraPlan | null;
  onMapViewportChange: (viewport: ViewportSize) => void;
  onSelectPoint: (id: string | null) => void;
  onSelectionCandidates: (ids: string[]) => void;
  onSelectRaw: (point: RawPosition | null) => void;
  onAddPoint: (latitude: number, longitude: number) => void;
  onInsertPoint: (latitude: number, longitude: number) => void;
  onMovePoint: (id: string, latitude: number, longitude: number) => void;
  onRangeDeleteSelection: (ids: string[]) => void;
  onError: (message: string) => void;
}

interface MapCameraSnapshot {
  longitude: number;
  latitude: number;
  zoom: number;
  bearing: number;
  pitch: number;
}

interface RangeSelectionRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

interface RangeDeleteDrag {
  pointerId: number;
  startX: number;
  startY: number;
}

const MIN_RANGE_DELETE_DRAG_PIXELS = 4;
const MAX_POINT_SELECTION_DISTANCE = 28;
const OVERLAP_CANDIDATE_PADDING = 6;

function isEditSelectionMode(props: RouteMapProps): boolean {
  return props.editMode && !props.addMode && !props.insertMode && !props.rangeDeleteMode && props.previewProgress === null;
}

function isSelectionAssistActive(props: RouteMapProps): boolean {
  return isEditSelectionMode(props) && props.selectedPointId !== null;
}

export default function RouteMap(props: RouteMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const routeOverlayRef = useRef<SVGPathElement>(null);
  const previewMarkerRef = useRef<SVGCircleElement>(null);
  const editPointsOverlayRef = useRef<SVGSVGElement>(null);
  const rangeDeleteBoxRef = useRef<HTMLDivElement>(null);
  const rangeDeleteHintRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const loadedRef = useRef(false);
  const selectedMarkerRef = useRef<maplibregl.Marker | null>(null);
  const wasPreviewingRef = useRef(false);
  const previewCameraSnapshotRef = useRef<MapCameraSnapshot | null>(null);
  const rangeDeleteDragRef = useRef<RangeDeleteDrag | null>(null);
  const rangeDeleteRectRef = useRef<RangeSelectionRect | null>(null);
  const rangeDeletePendingRectRef = useRef<RangeSelectionRect | null>(null);
  const rangeDeleteFrameRef = useRef<number | null>(null);
  const rangeDeleteSelectionRef = useRef<Set<string>>(new Set());
  const rangeDeletePointsRef = useRef(props.points);
  const [mapStatus, setMapStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [mapZoom, setMapZoom] = useState(10);
  const [videoViewport, setVideoViewport] = useState(() => getVideoPreviewViewport(0, 0));
  const propsRef = useRef(props);
  propsRef.current = props;
  const isPreviewing = props.previewProgress !== null;
  const previewState = getPreviewState(props);

  const cancelRangeDeleteFrame = () => {
    if (rangeDeleteFrameRef.current === null) return;
    cancelAnimationFrame(rangeDeleteFrameRef.current);
    rangeDeleteFrameRef.current = null;
  };

  const showRangeDeleteSelection = (rect: RangeSelectionRect): string[] => {
    rangeDeleteRectRef.current = rect;
    setRangeDeleteBox(rangeDeleteBoxRef.current, rect);
    const map = mapRef.current;
    const ids = map ? findPointsInScreenRect(map, propsRef.current.points, rect) : [];
    rangeDeleteSelectionRef.current = new Set(ids);
    updateRangeDeleteHint(rangeDeleteHintRef.current, ids.length);
    if (map && editPointsOverlayRef.current) {
      updateEditPointsOverlay(map, propsRef.current.points, null, rangeDeleteSelectionRef.current, editPointsOverlayRef.current, false);
    }
    return ids;
  };

  const clearRangeDeleteSelection = () => {
    cancelRangeDeleteFrame();
    rangeDeleteDragRef.current = null;
    rangeDeletePendingRectRef.current = null;
    rangeDeleteRectRef.current = null;
    rangeDeleteSelectionRef.current = new Set();
    setRangeDeleteBox(rangeDeleteBoxRef.current, null);
    updateRangeDeleteHint(rangeDeleteHintRef.current, 0);
    const map = mapRef.current;
    if (map && editPointsOverlayRef.current) {
      updateEditPointsOverlay(map, propsRef.current.points, propsRef.current.selectedPointId, rangeDeleteSelectionRef.current, editPointsOverlayRef.current, isSelectionAssistActive(propsRef.current));
    }
  };

  const handleRangeDeletePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!props.rangeDeleteMode || !event.isPrimary || (event.pointerType === 'mouse' && event.button !== 0)) return;
    event.preventDefault();
    const position = pointerPositionInElement(event, event.currentTarget);
    clearRangeDeleteSelection();
    rangeDeleteDragRef.current = { pointerId: event.pointerId, startX: position.x, startY: position.y };
    propsRef.current.onRangeDeleteSelection([]);
    const rect = selectionRect(position.x, position.y, position.x, position.y);
    rangeDeleteRectRef.current = rect;
    setRangeDeleteBox(rangeDeleteBoxRef.current, rect);
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handleRangeDeletePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = rangeDeleteDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    const position = pointerPositionInElement(event, event.currentTarget);
    rangeDeletePendingRectRef.current = selectionRect(drag.startX, drag.startY, position.x, position.y);
    if (rangeDeleteFrameRef.current !== null) return;
    rangeDeleteFrameRef.current = requestAnimationFrame(() => {
      rangeDeleteFrameRef.current = null;
      const rect = rangeDeletePendingRectRef.current;
      if (rect) showRangeDeleteSelection(rect);
    });
  };

  const handleRangeDeletePointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = rangeDeleteDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    cancelRangeDeleteFrame();
    rangeDeleteDragRef.current = null;
    rangeDeletePendingRectRef.current = null;
    const position = pointerPositionInElement(event, event.currentTarget);
    const rect = selectionRect(drag.startX, drag.startY, position.x, position.y);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (rect.right - rect.left < MIN_RANGE_DELETE_DRAG_PIXELS || rect.bottom - rect.top < MIN_RANGE_DELETE_DRAG_PIXELS) {
      clearRangeDeleteSelection();
      propsRef.current.onRangeDeleteSelection([]);
      return;
    }
    propsRef.current.onRangeDeleteSelection(showRangeDeleteSelection(rect));
  };

  const handleRangeDeletePointerCancel = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = rangeDeleteDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    rangeDeleteDragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    clearRangeDeleteSelection();
    propsRef.current.onRangeDeleteSelection([]);
  };

  useEffect(() => {
    if (!containerRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: GSI_STYLE,
      center: [139.767, 35.681],
      zoom: 10,
      attributionControl: false,
    });
    mapRef.current = map;
    const redrawOverlay = () => {
      const preview = getPreviewState(propsRef.current);
      updateRouteOverlay(map, getVisibleRouteSegments(propsRef.current, preview), routeOverlayRef.current, previewMarkerRef.current, preview?.markerPosition ?? null);
    };
    const updateZoomDisplay = () => setMapZoom(map.getZoom());
    const updateVideoViewport = () => {
      const container = map.getContainer();
      propsRef.current.onMapViewportChange({ width: container.clientWidth, height: container.clientHeight });
      setVideoViewport(getVideoPreviewViewport(container.clientWidth, container.clientHeight));
      const current = propsRef.current;
      if (wasPreviewingRef.current) applyVideoPreviewCamera(map, current);
    };
    map.on('resize', updateVideoViewport);
    updateVideoViewport();
    let genericMapErrorReported = false;
    const handleMapError = (event: ErrorEvent) => {
      if (!event.error) return;
      const details = describeMapLibreError(event.error);
      console.error(`[GSI MapLibre error]\n${details.consoleText}`);
      if (!genericMapErrorReported) {
        genericMapErrorReported = true;
        // Keep the vector source and editable layers alive after individual tile failures.
        propsRef.current.onError('地図の一部を読み込めませんでした。ネットワーク接続を確認してください。');
      }
    };
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
      const preview = getPreviewState(propsRef.current);
      const previewing = propsRef.current.previewProgress !== null;
      if (previewing && !wasPreviewingRef.current) {
        map.stop();
        previewCameraSnapshotRef.current = captureMapCamera(map);
        beginVideoPreview(map);
      }
      if (previewing) applyVideoPreviewCamera(map, propsRef.current, preview);
      refreshMap(map, propsRef.current, preview);
      if (!previewing && wasPreviewingRef.current && previewCameraSnapshotRef.current) {
        map.setTransformConstrain(null);
        restoreMapCamera(map, previewCameraSnapshotRef.current);
      } else if (!previewing && propsRef.current.autoFitRouteChanges) fitRoute(map, propsRef.current.points, 0);
      wasPreviewingRef.current = previewing;
      if (!previewing) {
        previewCameraSnapshotRef.current = null;
      }
      redrawOverlay();
      updateZoomDisplay();
      if (!firstLoad) map.triggerRepaint();
    };
    map.on('style.load', initializeMap);
    map.on('move', redrawOverlay);
    map.on('zoom', updateZoomDisplay);
    map.on('error', handleMapError);
    map.on('click', 'route-points-layer', (event: MapLayerMouseEvent) => {
      if (propsRef.current.rangeDeleteMode || propsRef.current.insertMode) return;
      if (isEditSelectionMode(propsRef.current)) return;
      const id = event.features?.[0]?.properties?.id;
      if (typeof id === 'string') propsRef.current.onSelectPoint(id);
    });
    map.on('click', 'raw-points', (event: MapLayerMouseEvent) => {
      if (propsRef.current.rangeDeleteMode || propsRef.current.insertMode) return;
      const id = event.features?.[0]?.properties?.id;
      propsRef.current.onSelectRaw(propsRef.current.rawPositions.find((point) => point.id === id) ?? null);
    });
    map.on('click', (event: MapMouseEvent) => {
      if (propsRef.current.rangeDeleteMode) return;
      if (propsRef.current.insertMode) {
        if (!propsRef.current.editMode || propsRef.current.previewProgress !== null) return;
        const hits = map.queryRenderedFeatures(event.point, { layers: ['route-points-layer', 'raw-points'] });
        if (!hits.length) propsRef.current.onInsertPoint(event.lngLat.lat, event.lngLat.lng);
        return;
      }
      if (propsRef.current.animationRangeMode) {
        const nearest = findNearestRoutePoint(map, propsRef.current.points, event.point);
        propsRef.current.onSelectPoint(nearest?.id ?? null);
        return;
      }
      if (isEditSelectionMode(propsRef.current)) {
        if (propsRef.current.showRaw && map.queryRenderedFeatures(event.point, { layers: ['raw-points'] }).length) return;
        const candidates = findNearbyRoutePointCandidates(map, propsRef.current.points, event.point);
        propsRef.current.onSelectionCandidates(candidates.ids);
        // onSelectPoint also clears the raw selection in App; do not clear it again afterward.
        if (candidates.nearestId) propsRef.current.onSelectPoint(candidates.nearestId);
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
      map.off('zoom', updateZoomDisplay);
      map.off('resize', updateVideoViewport);
      map.off('error', handleMapError);
      selectedMarkerRef.current?.remove();
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => () => cancelRangeDeleteFrame(), []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loadedRef.current) return;
    const previewStarting = isPreviewing && !wasPreviewingRef.current;
    const previewEnding = !isPreviewing && wasPreviewingRef.current;
    if (previewStarting) {
      map.stop();
      previewCameraSnapshotRef.current = captureMapCamera(map);
      beginVideoPreview(map);
    }
    const preview = getPreviewState(props);
    if (isPreviewing) applyVideoPreviewCamera(map, props, preview);
    refreshMap(map, props, preview);
    map.resize();
    map.triggerRepaint();
    updateRouteOverlay(map, getVisibleRouteSegments(props, preview), routeOverlayRef.current, previewMarkerRef.current, preview?.markerPosition ?? null);
    updateMapDiagnostics(map, props.points);
    if (previewEnding && previewCameraSnapshotRef.current) {
      map.setTransformConstrain(null);
      restoreMapCamera(map, previewCameraSnapshotRef.current);
    }
    wasPreviewingRef.current = isPreviewing;
    if (previewEnding) {
      previewCameraSnapshotRef.current = null;
    }
  }, [props.points, props.animationPoints, props.rawPositions, props.showRaw, props.editMode, props.animationRangeMode, props.selectedPointId, props.previewProgress, props.previewDuration, props.playbackTimeline, props.introZoomEnabled, props.revealRoute, props.cameraMode, props.overviewCamera, props.followCameraPlan, isPreviewing]);

  useEffect(() => {
    const map = mapRef.current;
    const overlay = editPointsOverlayRef.current;
    const pointsChanged = rangeDeletePointsRef.current !== props.points;
    rangeDeletePointsRef.current = props.points;
    if (!props.rangeDeleteMode || pointsChanged) clearRangeDeleteSelection();
    else if (!rangeDeleteDragRef.current) rangeDeleteSelectionRef.current = new Set(props.rangeDeletePointIds);
    if (!map || !overlay || !props.editMode || isPreviewing) return;
    const redraw = () => updateEditPointsOverlay(map, props.points, props.selectedPointId, rangeDeleteSelectionRef.current, overlay, isSelectionAssistActive(props));
    redraw();
    map.on('move', redraw);
    map.on('resize', redraw);
    return () => {
      map.off('move', redraw);
      map.off('resize', redraw);
    };
  }, [props.points, props.selectedPointId, props.editMode, props.addMode, props.insertMode, props.rangeDeleteMode, props.rangeDeletePointIds, isPreviewing]);

  useEffect(() => {
    const map = mapRef.current;
    selectedMarkerRef.current?.remove();
    selectedMarkerRef.current = null;
    if (!map || !props.editMode || props.insertMode || props.rangeDeleteMode || !props.selectedPointId || isPreviewing) return;
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
  }, [props.selectedPointId, props.editMode, props.insertMode, props.rangeDeleteMode, props.points, isPreviewing]);

  useEffect(() => {
    const map = mapRef.current;
    if (!props.autoFitRouteChanges) return;
    if (!map || !loadedRef.current || props.points.length === 0) return;
    fitRoute(map, props.points, 500);
  }, [props.autoFitRouteChanges, props.points.length ? `${props.points[0].id}:${props.points.at(-1)?.id}` : 'empty']);

  return <>
    <div className={`map ${props.addMode || props.insertMode ? 'map--adding' : ''}${props.distanceHud?.settings.enabled ? ' map--distance-hud' : ''}`} ref={containerRef} />
    <svg className="route-overlay" aria-hidden="true">
      <path ref={routeOverlayRef} />
      <circle ref={previewMarkerRef} className="preview-marker" r="11" display="none" />
    </svg>
    {props.editMode && !isPreviewing && <svg ref={editPointsOverlayRef} className="edit-points-overlay" aria-hidden="true">
      <path className="selected-route-before" />
      <path className="selected-route-after" />
      <path className="edit-points-original" />
      <path className="edit-points-manual" />
      <path className="edit-points-before" />
      <path className="edit-points-after" />
      <path className="edit-points-range-selected" />
      <path className="edit-points-selected" />
    </svg>}
    {props.editMode && props.rangeDeleteMode && !isPreviewing && <>
      <div
        className="range-delete-overlay"
        onPointerDown={handleRangeDeletePointerDown}
        onPointerMove={handleRangeDeletePointerMove}
        onPointerUp={handleRangeDeletePointerUp}
        onPointerCancel={handleRangeDeletePointerCancel}
      >
        <div ref={rangeDeleteBoxRef} className="range-delete-box" />
      </div>
      <div ref={rangeDeleteHintRef} className="range-delete-hint">{props.rangeDeletePointIds.length ? `${props.rangeDeletePointIds.length}点を選択中` : 'ドラッグして削除したいポイントを囲ってください'}</div>
    </>}
    <AnnotationOverlay draggable={props.editMode && !props.addMode && !props.insertMode && !props.rangeDeleteMode && props.previewProgress === null} onPlacement={props.onAnnotationPlacement} map={mapRef.current} points={props.points} animationPoints={props.animationPoints} editMode={props.editMode} previewProgress={previewState?.routeProgress ?? null} reachedPointIndex={previewState?.reachedPointIndex} annotationStyle={props.annotationStyle} />
    {props.routeMarkerMode === 'day' && <DayMarkerOverlay draggable={props.editMode && !props.addMode && !props.insertMode && !props.rangeDeleteMode && props.previewProgress === null} onPlacement={props.onDayPlacement} map={mapRef.current} points={props.points} animationPoints={props.animationPoints} markers={props.dayMarkers} previewProgress={previewState?.routeProgress ?? null} reachedPointIndex={previewState?.reachedPointIndex} />}
    {props.routeMarkerMode === 'start-goal' && <EndpointMarkerOverlay draggable={props.editMode && !props.addMode && !props.insertMode && !props.rangeDeleteMode && props.previewProgress === null} onPlacement={props.onEndpointPlacement} placements={props.endpointMarkerPlacements} map={mapRef.current} animationPoints={props.animationPoints} previewProgress={previewState?.routeProgress ?? null} reachedPointIndex={previewState?.reachedPointIndex} />}
    {(isPreviewing || props.distanceHud?.settings.enabled) && <div className="video-preview-frame-overlay" aria-hidden="true">
      <div className="video-preview-frame" style={{ width: videoViewport.width, height: videoViewport.height, left: videoViewport.left, top: videoViewport.top }} />
    </div>}
    {props.distanceHud?.settings.enabled && <DistanceHudOverlay hud={props.distanceHud} viewport={videoViewport}
      routeProgress={previewState?.routeProgress ?? null} reachedPointIndex={previewState?.reachedPointIndex}
      draggable={!isPreviewing && !!props.distanceHudDraggable} onPlacement={(placement) => props.onDistanceHudPlacement?.(placement)} />}
    <div className="map-zoom" aria-hidden="true">Zoom {(getPreviewVideoCamera(props, previewState)?.zoom ?? mapZoom).toFixed(1)}</div>
    {mapStatus !== 'ready' && <div className={`map-status ${mapStatus === 'error' ? 'map-status--error' : ''}`}>
      {mapStatus === 'loading' ? <><span className="spinner" />地図を読み込んでいます…</> : <>地図を表示できません。ネットワーク接続を確認してください。</>}
    </div>}
  </>;
}

function describeMapLibreError(error: unknown): { consoleText: string } {
  const record = error && typeof error === 'object' ? error as Record<string, unknown> : null;
  const name = error instanceof Error ? error.name : typeof record?.name === 'string' ? record.name : 'UnknownError';
  const message = error instanceof Error ? error.message : typeof record?.message === 'string' ? record.message : String(error);
  const details = [`name: ${name}`, `message: ${message}`];
  for (const key of ['url', 'status', 'statusCode', 'code', 'type']) {
    const value = record?.[key];
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') details.push(`${key}: ${value}`);
  }
  const stack = error instanceof Error ? error.stack : typeof record?.stack === 'string' ? record.stack : undefined;
  if (stack) details.push(`stack: ${stack}`);
  const consoleText = details.join('\n');
  return { consoleText };
}

function installRouteLayers(map: MapLibreMap, props: RouteMapProps) {
  if (!map.getSource('route')) map.addSource('route', { type: 'geojson', data: routeCollection(splitRouteByDay(props.points)) });
  if (!map.getSource('route-points')) map.addSource('route-points', { type: 'geojson', data: pointCollection(props.points, props.selectedPointId) });
  if (!map.getSource('raw-positions')) map.addSource('raw-positions', { type: 'geojson', data: rawCollection(props.rawPositions) });
  if (!map.getLayer('route-line')) map.addLayer({ id: 'route-line', type: 'line', source: 'route', paint: { 'line-color': '#ff5d37', 'line-width': 6, 'line-opacity': 0.92 } });
  if (!map.getLayer('raw-points')) map.addLayer({ id: 'raw-points', type: 'circle', source: 'raw-positions', layout: { visibility: props.showRaw ? 'visible' : 'none' }, paint: {
    'circle-radius': ['interpolate', ['linear'], ['get', 'accuracyMeters'], 0, 4, 100, 7, 500, 10],
    'circle-color': ['interpolate', ['linear'], ['get', 'accuracyMeters'], 0, '#16c79a', 50, '#f6c945', 200, '#ef476f'],
    'circle-stroke-color': '#ffffff', 'circle-stroke-width': 1.5, 'circle-opacity': 0.8,
  } });
  if (!map.getLayer('route-points-layer')) map.addLayer({ id: 'route-points-layer', type: 'circle', source: 'route-points', layout: { visibility: shouldShowRoutePoints(props) ? 'visible' : 'none' }, paint: {
    'circle-radius': ['case', ['get', 'selected'], 12, props.animationRangeMode ? 9 : 7],
    'circle-color': ['case', ['get', 'selected'], '#3b82f6', ['get', 'manual'], '#2dd4bf', '#ffffff'],
    'circle-stroke-color': '#10233f', 'circle-stroke-width': ['case', ['get', 'selected'], 4, 2],
  } });
}

function captureMapCamera(map: MapLibreMap): MapCameraSnapshot {
  const center = map.getCenter();
  return {
    longitude: center.lng,
    latitude: center.lat,
    zoom: map.getZoom(),
    bearing: map.getBearing(),
    pitch: map.getPitch(),
  };
}

function restoreMapCamera(map: MapLibreMap, snapshot: MapCameraSnapshot) {
  map.jumpTo({
    center: [snapshot.longitude, snapshot.latitude],
    zoom: snapshot.zoom,
    bearing: snapshot.bearing,
    pitch: snapshot.pitch,
  });
}

function getPreviewVideoCamera(props: RouteMapProps, preview = getPreviewState(props)): VideoCamera | null {
  if (props.previewProgress === null) return null;
  const target = props.cameraMode === 'follow'
    ? preview?.cameraCenter && preview.zoom !== undefined
      ? { ...preview.cameraCenter, zoom: preview.zoom, bearing: 0, pitch: 0 }
      : null
    : props.overviewCamera;
  if (!target) return null;
  const introProgress = getPreviewIntroProgress(props);
  const zoom = introProgress === null ? target.zoom
    : interpolateIntroZoom(getIntroStartZoom(target.zoom, VIDEO_MIN_ZOOM), target.zoom, introProgress);
  return constrainVideoCamera({ ...target, zoom });
}

function beginVideoPreview(map: MapLibreMap) {
  // Constrain in video space instead: portrait/landscape margins outside the
  // frame must not make MapLibre shift the center or zoom to fill the container.
  map.setTransformConstrain((center, zoom) => ({ center, zoom }));
}

function applyVideoPreviewCamera(map: MapLibreMap, props: RouteMapProps, preview = getPreviewState(props)) {
  const camera = getPreviewVideoCamera(props, preview);
  if (!camera) return;
  const container = map.getContainer();
  const { scale } = getVideoPreviewViewport(container.clientWidth, container.clientHeight);
  map.jumpTo({
    center: [camera.longitude, camera.latitude],
    zoom: videoZoomToPreviewZoom(camera.zoom, scale),
    bearing: camera.bearing,
    pitch: camera.pitch,
  });
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
  map.fitBounds(bounds, { padding: OVERVIEW_FIT_PADDING, maxZoom: 16, duration });
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

function refreshMap(map: MapLibreMap, props: RouteMapProps, preview = getPreviewState(props)) {
  const visibleSegments = getVisibleRouteSegments(props, preview);
  (map.getSource('route') as GeoJSONSource | undefined)?.setData(routeCollection(visibleSegments));
  (map.getSource('route-points') as GeoJSONSource | undefined)?.setData(pointCollection(props.points, props.selectedPointId));
  (map.getSource('raw-positions') as GeoJSONSource | undefined)?.setData(rawCollection(props.rawPositions));
  if (map.getLayer('raw-points')) map.setLayoutProperty('raw-points', 'visibility', props.showRaw ? 'visible' : 'none');
  if (map.getLayer('route-points-layer')) map.setLayoutProperty('route-points-layer', 'visibility', shouldShowRoutePoints(props) ? 'visible' : 'none');
  if (map.getLayer('route-points-layer')) map.setPaintProperty('route-points-layer', 'circle-radius', ['case', ['get', 'selected'], 12, props.animationRangeMode ? 9 : 7]);
}

function shouldShowRoutePoints(props: RouteMapProps): boolean {
  return props.previewProgress === null && (props.editMode || props.animationRangeMode);
}

function getVisibleRouteSegments(props: RouteMapProps, preview = getPreviewState(props)): RoutePoint[][] {
  if (!preview) return splitRouteByDay(props.points);
  return props.revealRoute
    ? revealedTripRouteSegments(props.animationPoints, preview.routeProgress)
    : splitRouteByDay(props.animationPoints);
}

function updateRouteOverlay(
  map: MapLibreMap,
  segments: RoutePoint[][],
  path: SVGPathElement | null,
  previewMarker: SVGCircleElement | null,
  markerPosition: GeoPosition | null,
) {
  if (!path) {
    return;
  }
  if (!segments.some((points) => points.length >= 2)) {
    path?.setAttribute('d', '');
  } else {
    path.setAttribute('d', segments.map((points) => {
      const projected = points.map((point) => map.project([point.longitude, point.latitude]));
      return projected.map((point, index) => `${index === 0 ? 'M' : 'L'}${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(' ');
    }).join(' '));
  }
  updateOverlayMarker(map, markerPosition, previewMarker);
}

interface MapPreviewState {
  routeProgress: number;
  markerPosition: GeoPosition;
  reachedPointIndex: number | null;
  cameraCenter?: GeoPosition;
  zoom?: number;
}

function getPreviewState(props: RouteMapProps): MapPreviewState | null {
  if (props.previewProgress === null || !props.animationPoints.length) return null;
  const outputElapsedSeconds = getPreviewOutputElapsed(props);
  if (props.cameraMode === 'follow' && props.followCameraPlan) {
    return sampleFollowOutputPlayback(props.followCameraPlan, props.playbackTimeline, outputElapsedSeconds);
  }
  const timelineSample = samplePlaybackTimeline(props.playbackTimeline, outputElapsedSeconds);
  const movementProgress = timelineSample.baseElapsedSeconds / props.previewDuration;
  const position = interpolateTripRoute(props.animationPoints, movementProgress);
  return position ? { routeProgress: movementProgress, markerPosition: position, reachedPointIndex: null } : null;
}

function getPreviewOutputElapsed(props: RouteMapProps): number {
  if (props.previewProgress === null) return 0;
  if (!props.introZoomEnabled) return props.previewProgress * props.playbackTimeline.outputDurationSeconds;
  const totalDuration = INTRO_ZOOM_DURATION_SECONDS + props.playbackTimeline.outputDurationSeconds;
  const elapsed = props.previewProgress * totalDuration;
  return Math.max(0, Math.min(props.playbackTimeline.outputDurationSeconds, elapsed - INTRO_ZOOM_DURATION_SECONDS));
}

function getPreviewIntroProgress(props: RouteMapProps): number | null {
  if (!props.introZoomEnabled || props.previewProgress === null) return null;
  const elapsed = props.previewProgress * (INTRO_ZOOM_DURATION_SECONDS + props.playbackTimeline.outputDurationSeconds);
  // MP4 samples the intro at frames 0..89, reaching the target on frame 89.
  // Match that camera trajectory without changing preview route timing.
  return elapsed <= INTRO_ZOOM_DURATION_SECONDS
    ? Math.min(1, elapsed * VIDEO_FPS / (INTRO_ZOOM_DURATION_SECONDS * VIDEO_FPS - 1)) : null;
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

function findNearestRoutePoint(map: MapLibreMap, points: RoutePoint[], clickPoint: MapMouseEvent['point'], maxDistance = MAX_POINT_SELECTION_DISTANCE): RoutePoint | null {
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

function findNearbyRoutePointCandidates(map: MapLibreMap, points: RoutePoint[], clickPoint: MapMouseEvent['point']): { ids: string[]; nearestId: string | null } {
  const nearby: Array<{ id: string; distance: number }> = [];
  let nearestId: string | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const point of points) {
    const screenPoint = map.project([point.longitude, point.latitude]);
    const distance = Math.hypot(screenPoint.x - clickPoint.x, screenPoint.y - clickPoint.y);
    if (distance > MAX_POINT_SELECTION_DISTANCE) continue;
    nearby.push({ id: point.id, distance });
    if (distance < bestDistance) {
      nearestId = point.id;
      bestDistance = distance;
    }
  }
  if (!nearestId) return { ids: [], nearestId: null };
  const candidateDistance = Math.min(MAX_POINT_SELECTION_DISTANCE, bestDistance + OVERLAP_CANDIDATE_PADDING);
  return { ids: nearby.filter((candidate) => candidate.distance <= candidateDistance).map((candidate) => candidate.id), nearestId };
}

function pointerPositionInElement(event: ReactPointerEvent<HTMLDivElement>, element: HTMLDivElement) {
  const bounds = element.getBoundingClientRect();
  return {
    x: Math.max(0, Math.min(bounds.width, event.clientX - bounds.left)),
    y: Math.max(0, Math.min(bounds.height, event.clientY - bounds.top)),
  };
}

function selectionRect(startX: number, startY: number, currentX: number, currentY: number): RangeSelectionRect {
  return {
    left: Math.min(startX, currentX),
    top: Math.min(startY, currentY),
    right: Math.max(startX, currentX),
    bottom: Math.max(startY, currentY),
  };
}

function setRangeDeleteBox(element: HTMLDivElement | null, rect: RangeSelectionRect | null) {
  if (!element) return;
  if (!rect) {
    element.style.display = 'none';
    return;
  }
  element.style.display = 'block';
  element.style.left = `${rect.left}px`;
  element.style.top = `${rect.top}px`;
  element.style.width = `${rect.right - rect.left}px`;
  element.style.height = `${rect.bottom - rect.top}px`;
}

function updateRangeDeleteHint(element: HTMLDivElement | null, count: number) {
  if (element) element.textContent = count ? `${count}点を選択中` : 'ドラッグして削除したいポイントを囲ってください';
}

function findPointsInScreenRect(map: MapLibreMap, points: RoutePoint[], rect: RangeSelectionRect): string[] {
  const ids: string[] = [];
  for (const point of points) {
    const screen = map.project([point.longitude, point.latitude]);
    if (screen.x >= rect.left && screen.x <= rect.right && screen.y >= rect.top && screen.y <= rect.bottom) {
      ids.push(point.id);
    }
  }
  return ids;
}

function updateEditPointsOverlay(
  map: MapLibreMap,
  points: RoutePoint[],
  selectedPointId: string | null,
  rangeDeletePointIds: ReadonlySet<string>,
  overlay: SVGSVGElement,
  selectionAssistActive: boolean,
) {
  const original: string[] = [];
  const manual: string[] = [];
  const before: string[] = [];
  const after: string[] = [];
  const rangeSelected: string[] = [];
  let selected = '';
  const selectedIndex = selectionAssistActive ? points.findIndex((point) => point.id === selectedPointId) : -1;
  const beforeStart = Math.max(0, selectedIndex - 10);
  const afterEnd = Math.min(points.length - 1, selectedIndex + 10);
  // Batch circles into paths instead of creating a DOM element for every route point.
  for (const [index, point] of points.entries()) {
    const screen = map.project([point.longitude, point.latitude]);
    const rangeDeleteSelected = rangeDeletePointIds.has(point.id);
    const radius = rangeDeleteSelected ? 9 : point.id === selectedPointId ? 10 : 7;
    const circle = `M${screen.x - radius},${screen.y}a${radius},${radius} 0 1,0 ${radius * 2},0a${radius},${radius} 0 1,0 ${-radius * 2},0Z`;
    if (point.id === selectedPointId) selected = circle;
    else if (rangeDeleteSelected) rangeSelected.push(circle);
    else if (selectedIndex >= 0 && index >= beforeStart && index < selectedIndex) before.push(circle);
    else if (selectedIndex >= 0 && index > selectedIndex && index <= afterEnd) after.push(circle);
    else (point.original ? original : manual).push(circle);
  }
  setEditOverlayPath(overlay, 'selected-route-before', selectedIndex >= 0 ? projectedRoutePath(map, points.slice(beforeStart, selectedIndex + 1)) : '');
  setEditOverlayPath(overlay, 'selected-route-after', selectedIndex >= 0 ? projectedRoutePath(map, points.slice(selectedIndex, afterEnd + 1)) : '');
  setEditOverlayPath(overlay, 'edit-points-original', original.join(' '));
  setEditOverlayPath(overlay, 'edit-points-manual', manual.join(' '));
  setEditOverlayPath(overlay, 'edit-points-before', before.join(' '));
  setEditOverlayPath(overlay, 'edit-points-after', after.join(' '));
  setEditOverlayPath(overlay, 'edit-points-range-selected', rangeSelected.join(' '));
  setEditOverlayPath(overlay, 'edit-points-selected', selected);
}

function projectedRoutePath(map: MapLibreMap, points: RoutePoint[]): string {
  return splitRouteByDay(points).filter((segment) => segment.length >= 2).map((segment) => segment.map((point, index) => {
    const screen = map.project([point.longitude, point.latitude]);
    return `${index === 0 ? 'M' : 'L'}${screen.x.toFixed(1)},${screen.y.toFixed(1)}`;
  }).join(' ')).join(' ');
}

function setEditOverlayPath(overlay: SVGSVGElement, className: string, path: string) {
  overlay.querySelector<SVGPathElement>(`.${className}`)?.setAttribute('d', path);
}
