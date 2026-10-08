import { useLayoutEffect, useMemo, useRef } from 'react';
import type { Map as MapLibreMap } from 'maplibre-gl';
import type { RoutePoint } from '../timeline/types';
import type { BalloonFramePosition } from '../popup/placement';
import { bindFrameBalloonDrag } from '../popup/frameDrag';
import { annotationFramePosition, annotationLayout, drawAnnotation, isAnnotationAnchorVisible } from '../route/annotationCanvas';
import type { AnnotationStyle } from '../route/annotationStyle';
import { tripRoutePointProgresses } from '../route/tripRoute';
import { getVideoPreviewViewport, VIDEO_VIEWPORT } from '../video/overviewCamera';

interface Props {
  map: MapLibreMap | null;
  points: RoutePoint[];
  animationPoints: RoutePoint[];
  visibleInEditor: boolean;
  draggable: boolean;
  previewProgress: number | null;
  reachedPointIndex?: number | null;
  annotationStyle: AnnotationStyle;
  onFramePosition: (id: string, position: BalloonFramePosition) => void;
}

export default function FrameAnnotationOverlay(props: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const visible = useMemo(() => {
    if (props.previewProgress === null) return props.visibleInEditor ? props.points.filter((point) => point.annotation?.label) : [];
    const arrivals = tripRoutePointProgresses(props.animationPoints);
    return props.animationPoints.filter((point, index) => point.annotation?.label
      && props.previewProgress! >= arrivals[index] && (props.reachedPointIndex == null || index <= props.reachedPointIndex));
  }, [props.points, props.animationPoints, props.visibleInEditor, props.previewProgress, props.reachedPointIndex]);

  useLayoutEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    const map = props.map;
    const context = canvas?.getContext('2d');
    if (!map || !container || !canvas || !context) return;
    const drafts = new Map<string, BalloonFramePosition>();
    let viewport = getVideoPreviewViewport(container.clientWidth, container.clientHeight);
    const annotation = (point: RoutePoint) => {
      const pixel = map.project([point.longitude, point.latitude]);
      return { ...point.annotation!, framePosition: drafts.get(point.id) ?? point.annotation!.framePosition,
        pixel: { x: (pixel.x - viewport.left) / viewport.scale, y: (pixel.y - viewport.top) / viewport.scale } };
    };
    const redraw = () => {
      viewport = getVideoPreviewViewport(container.clientWidth, container.clientHeight);
      Object.assign(canvas.style, { left: `${viewport.left}px`, top: `${viewport.top}px`, width: `${viewport.width}px`, height: `${viewport.height}px` });
      context.clearRect(0, 0, VIDEO_VIEWPORT.width, VIDEO_VIEWPORT.height);
      visible.forEach((point, index) => {
        const target = container.children[index + 1] as HTMLButtonElement;
        const note = annotation(point);
        // Wait for the deterministic reference-camera migration before showing
        // legacy data; never resolve it from a live, zoomable editor camera.
        const shown = Boolean(note.framePosition) && isAnnotationAnchorVisible(note.pixel);
        target.style.visibility = shown ? 'visible' : 'hidden';
        if (!shown) return;
        const layout = annotationLayout(context, note, props.annotationStyle);
        drawAnnotation(context, note, props.annotationStyle, layout);
        Object.assign(target.style, { left: `${viewport.left + layout.left * viewport.scale}px`, top: `${viewport.top + layout.top * viewport.scale}px`, width: `${layout.width * viewport.scale}px`, height: `${layout.height * viewport.scale}px` });
      });
    };
    redraw();
    const cleanups = props.draggable ? visible.map((point, index) => bindFrameBalloonDrag(
      container.children[index + 1] as HTMLButtonElement,
      () => annotationLayout(context, annotation(point), props.annotationStyle), () => viewport.scale,
      (center) => annotationFramePosition(annotationLayout(context, { ...annotation(point), framePosition: { x: center.x / VIDEO_VIEWPORT.width, y: center.y / VIDEO_VIEWPORT.height } }, props.annotationStyle)),
      (position) => { if (position) drafts.set(point.id, position); else drafts.delete(point.id); redraw(); },
      (position) => props.onFramePosition(point.id, position),
    )) : [];
    map.on('move', redraw);
    map.on('resize', redraw);
    return () => {
      cleanups.forEach((cleanup) => cleanup());
      map.off('move', redraw);
      map.off('resize', redraw);
    };
  }, [props.map, props.annotationStyle, props.draggable, props.onFramePosition, visible]);

  return <div className="annotation-overlay frame-annotation-overlay" ref={containerRef}>
    <canvas ref={canvasRef} width={VIDEO_VIEWPORT.width} height={VIDEO_VIEWPORT.height} aria-hidden="true" />
    {visible.map((point) => <button key={point.id} type="button" className="frame-balloon-hit"
      style={{ visibility: 'hidden' }} disabled={!props.draggable} tabIndex={props.draggable ? 0 : -1}
      aria-label={`${point.annotation!.label}のバルーンを移動`} />)}
  </div>;
}
