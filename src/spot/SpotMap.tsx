import CoordinateJumpControl from '../map/CoordinateJumpControl';
import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { createPortal } from 'react-dom';
import * as maplibregl from 'maplibre-gl';
import AnnotationOverlay from '../map/AnnotationOverlay';
import { GSI_STYLE } from '../map/gsiStyle';
import { installTerrainTintFallback, isTerrainTintError } from '../map/gsiTerrainTint';
import type { RoutePoint } from '../timeline/types';
import type { AnnotationStyle } from '../route/annotationStyle';
import type { PopupPlacement } from '../popup/placement';
import { imageRectangle, moveImageRectangle, type ImageBounds, type Pixel } from './imageBounds';

export type SpotTool = 'select' | 'add' | 'bounds';
interface Props {
  points: RoutePoint[]; selectedId: string | null; tool: SpotTool; busy: boolean;
  bounds: ImageBounds | null; fitRequest: number; annotationStyle: AnnotationStyle;
  onSelect: (id: string) => void;
  onAdd: (latitude: number, longitude: number) => void;
  onMove: (id: string, latitude: number, longitude: number) => void;
  onPlacement: (id: string, placement: PopupPlacement) => void;
  onBounds: (bounds: ImageBounds) => void;
  onError: (message: string) => void;
}

export default function SpotMap(props: Props) {
  const container = useRef<HTMLDivElement>(null);
  const rectangle = useRef<HTMLDivElement>(null);
  const current = useRef(props); current.current = props;
  const [map, setMap] = useState<maplibregl.Map | null>(null);
  const [mapZoom, setMapZoom] = useState(8);
  const drag = useRef<{ id: number; start: Pixel } | null>(null);
  const moving = useRef<{
    id: number; start: Pixel; initial: ReturnType<typeof imageRectangle>;
    rect: ReturnType<typeof imageRectangle>; cancel: () => void;
  } | null>(null);
  const redrawBounds = useRef<() => void>(() => {});
  const [draft, setDraft] = useState<ReturnType<typeof imageRectangle> | null>(null);
  useEffect(() => {
    const instance = new maplibregl.Map({ container: container.current!, style: GSI_STYLE,
      center: [139.767, 35.681], zoom: 8, maxZoom: 16, attributionControl: false, dragRotate: false, pitchWithRotate: false, touchPitch: false });
    instance.touchZoomRotate.disableRotation();
    instance.keyboard.disableRotation();
    installTerrainTintFallback(instance);
    instance.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    instance.addControl(new maplibregl.AttributionControl({ compact: false }), 'bottom-right');
    const updateZoomDisplay = () => setMapZoom(instance.getZoom());
    instance.on('zoom', updateZoomDisplay);
    updateZoomDisplay();
    instance.on('error', (event) => { if (!isTerrainTintError(event)) current.current.onError('地図の一部を読み込めませんでした。ネットワーク接続を確認してください。'); });
    instance.on('click', (event) => {
      if (event.originalEvent.target instanceof HTMLElement && event.originalEvent.target.closest('.spot-anchor')) return;
      if (!current.current.busy && current.current.tool === 'add') current.current.onAdd(event.lngLat.lat, event.lngLat.lng);
    });
    const observer = new ResizeObserver(() => instance.resize()); observer.observe(container.current!);
    setMap(instance);
    return () => { moving.current?.cancel(); observer.disconnect(); instance.off('zoom', updateZoomDisplay); instance.remove(); };
  }, []);
  useEffect(() => {
    if (!map) return;
    const markers = props.points.map((point, index) => {
      const element = document.createElement('button'); element.type = 'button';
      element.className = `spot-anchor${point.id === props.selectedId ? ' spot-anchor--selected' : ''}`;
      element.setAttribute('aria-label', point.annotation?.label || `スポット ${index + 1}`);
      element.disabled = props.busy || props.tool === 'bounds';
      element.addEventListener('click', (event) => { event.stopPropagation(); if (!current.current.busy) current.current.onSelect(point.id); });
      const marker = new maplibregl.Marker({ element, draggable: !props.busy && props.tool === 'select' })
        .setLngLat([point.longitude, point.latitude]).addTo(map);
      marker.on('dragend', () => { const position = marker.getLngLat(); current.current.onMove(point.id, position.lat, position.lng); });
      return marker;
    });
    return () => markers.forEach((marker) => marker.remove());
  }, [map, props.points, props.selectedId, props.busy, props.tool]);
  useEffect(() => {
    if (!map) return;
    const choosing = props.tool === 'bounds';
    for (const handler of [map.dragPan, map.touchZoomRotate, map.scrollZoom, map.doubleClickZoom, map.boxZoom, map.keyboard]) {
      if (choosing) handler.disable(); else handler.enable();
    }
    map.touchZoomRotate.disableRotation();
    map.keyboard.disableRotation();
    return () => { drag.current = null; setDraft(null); };
  }, [map, props.tool]);
  useEffect(() => () => { moving.current?.cancel(); }, [map, props.tool, props.busy, props.bounds, props.fitRequest]);
  useEffect(() => {
    if (!map) return;
    const draw = () => {
      if (moving.current) return;
      const element = rectangle.current;
      if (!element) return;
      const bounds = props.bounds;
      if (!bounds) { element.style.display = 'none'; return; }
      const topLeft = map.project([bounds.west, bounds.north]);
      const bottomRight = map.project([bounds.east, bounds.south]);
      Object.assign(element.style, { display: 'block', left: `${topLeft.x}px`, top: `${topLeft.y}px`, width: `${bottomRight.x - topLeft.x}px`, height: `${bottomRight.y - topLeft.y}px` });
    };
    redrawBounds.current = draw;
    draw(); map.on('move', draw); map.on('resize', draw);
    return () => { map.off('move', draw); map.off('resize', draw); };
  }, [map, props.bounds]);
  useEffect(() => {
    if (map && props.fitRequest && current.current.bounds) {
      const bounds = current.current.bounds;
      map.fitBounds([[bounds.west, bounds.south], [bounds.east, bounds.north]], { padding: 35, duration: 0, maxZoom: 16 });
    }
  }, [map, props.fitRequest]);
  const pixel = (event: PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: Math.max(0, Math.min(rect.width, event.clientX - rect.left)), y: Math.max(0, Math.min(rect.height, event.clientY - rect.top)) };
  };
  const dragRectangle = (event: PointerEvent<HTMLDivElement>) => imageRectangle(drag.current!.start, pixel(event), { width: event.currentTarget.clientWidth, height: event.currentTarget.clientHeight });
  const moveRectangle = (event: PointerEvent<HTMLDivElement>) => {
    const active = moving.current;
    if (!active || active.id !== event.pointerId || !container.current) return;
    event.preventDefault(); event.stopPropagation();
    active.rect = moveImageRectangle(active.initial, { x: event.clientX - active.start.x, y: event.clientY - active.start.y },
      { width: container.current.clientWidth, height: container.current.clientHeight });
    Object.assign(event.currentTarget.style, { left: `${active.rect.left}px`, top: `${active.rect.top}px` });
  };
  return <>
    <CoordinateJumpControl map={map} hostId="spot-coordinate-jump" disabled={props.busy} onError={props.onError} />
    <div ref={container} className={`map${props.tool === 'add' ? ' map--adding' : ''}`} />
    <div className="map-zoom" aria-hidden="true">Zoom {mapZoom.toFixed(1)}</div>
    {map && createPortal(<div className="spot-bounds-overlay" aria-hidden="true"><div ref={rectangle}
      className={`spot-image-rectangle${props.tool === 'select' && !props.busy ? ' spot-image-rectangle--movable' : ''}`}
      title="ドラッグして画像範囲を移動"
      onPointerDown={(event) => {
        if (props.tool !== 'select' || props.busy || !props.bounds || event.button !== 0 || !event.isPrimary || moving.current || drag.current) return;
        event.preventDefault(); event.stopPropagation(); map.stop();
        const nw = map.project([props.bounds.west, props.bounds.north]);
        const se = map.project([props.bounds.east, props.bounds.south]);
        const initial = { left: nw.x, top: nw.y, width: se.x - nw.x, height: se.y - nw.y };
        const element = event.currentTarget;
        const pointerId = event.pointerId;
        // Freeze the camera only for this gesture; restore each handler's original state.
        const handlers = [map.dragPan, map.touchZoomRotate, map.scrollZoom, map.doubleClickZoom, map.boxZoom, map.keyboard];
        const enabled = handlers.map((handler) => handler.isEnabled());
        handlers.forEach((handler) => handler.disable());
        const cancel = () => {
          if (!moving.current) return;
          moving.current = null;
          map.off('resize', cancel); map.off('movestart', cancel);
          handlers.forEach((handler, index) => { if (enabled[index]) handler.enable(); });
          element.dataset.moving = 'false';
          if (element.hasPointerCapture(pointerId)) element.releasePointerCapture(pointerId);
          redrawBounds.current();
        };
        moving.current = { id: pointerId, start: { x: event.clientX, y: event.clientY }, initial, rect: initial, cancel };
        element.dataset.moving = 'true';
        element.setPointerCapture(pointerId);
        map.on('resize', cancel); map.on('movestart', cancel);
      }}
      onPointerMove={moveRectangle}
      onPointerUp={(event) => {
        const active = moving.current;
        if (!active || active.id !== event.pointerId) return;
        moveRectangle(event);
        const rect = active.rect;
        const nw = map.unproject([rect.left, rect.top]);
        const se = map.unproject([rect.left + rect.width, rect.top + rect.height]);
        active.cancel();
        if (rect.left !== active.initial.left || rect.top !== active.initial.top) props.onBounds({ west: nw.lng, east: se.lng, north: nw.lat, south: se.lat });
      }}
      onPointerCancel={(event) => { if (moving.current?.id === event.pointerId) moving.current.cancel(); }}
      onLostPointerCapture={(event) => { if (moving.current?.id === event.pointerId) moving.current.cancel(); }} />
      {draft && <div className="spot-image-rectangle spot-image-rectangle--draft" style={draft} />}</div>, map.getCanvasContainer())}
    <AnnotationOverlay map={map} points={props.points} animationPoints={props.points} editMode previewProgress={null}
      draggable={!props.busy && props.tool === 'select'} onPlacement={props.onPlacement} annotationStyle={props.annotationStyle} />
    {props.tool === 'bounds' && !props.busy && <div className="spot-bounds-input"
      onPointerDown={(event) => {
        if (event.button !== 0 || drag.current || !map) return;
        event.preventDefault(); map.stop(); drag.current = { id: event.pointerId, start: pixel(event) };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => { if (drag.current?.id === event.pointerId) { event.preventDefault(); setDraft(dragRectangle(event)); } }}
      onPointerUp={(event) => {
        if (drag.current?.id !== event.pointerId || !map) return;
        const rect = dragRectangle(event); drag.current = null; setDraft(null);
        event.currentTarget.releasePointerCapture(event.pointerId);
        if (rect.width < 20) { props.onError('もう少し大きくドラッグして画像範囲を指定してください。'); return; }
        const nw = map.unproject([rect.left, rect.top]); const se = map.unproject([rect.left + rect.width, rect.top + rect.height]);
        props.onBounds({ west: nw.lng, east: se.lng, north: nw.lat, south: se.lat });
      }}
      onPointerCancel={() => { drag.current = null; setDraft(null); }}
      onLostPointerCapture={() => { drag.current = null; setDraft(null); }} />}
  </>;
}
