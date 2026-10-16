import { annotationFramePosition } from '../route/annotationCanvas';
import { DEFAULT_ANNOTATION_STYLE } from '../route/annotationStyle';
import { DAY_MARKER_FONT_FAMILY, dayMarkerLayout, loadDayMarkerFonts } from '../route/dayMarkerStyle';
import { tripRoutePointProgresses, type DayMarker } from '../route/tripRoute';
import { videoMarkerRect, type EndpointMarkerFramePositions, type EndpointMarkerLabel } from '../popup/placement';
import type { RoutePoint } from '../timeline/types';
import type { FrameDrawingOptions } from './frameScene';
import { buildFramePlan, sampleFrame, type FrameState } from './frameTimeline';
import { isInVideoViewport } from './frameDrawing';
import type { VideoCamera } from './overviewCamera';

export type MarkerReferenceProjector = (point: RoutePoint, camera: VideoCamera) => { x: number; y: number };

// Compatibility only: reproduce the archived pre-V1.3-sizing rectangle, not the
// current DAY layout. Do not use these dimensions in ordinary frame drawing.
function legacyDaySize(context: CanvasRenderingContext2D, marker: DayMarker) {
  const rows = [{ text: `DAY ${marker.dayNumber}`, font: 24, weight: 700, spacing: 1.9, limit: Infinity },
    ...(marker.date ? [{ text: marker.date.replaceAll('-', '.'), font: 17, weight: 600, spacing: 0.85, limit: Infinity }] : []),
    ...(marker.note ? [{ text: marker.note, font: 19, weight: 400, spacing: 0, limit: 370 }] : [])];
  let width = 0;
  for (const row of rows) {
    context.font = `${row.weight} ${row.font}px ${DAY_MARKER_FONT_FAMILY}`;
    const measure = (text: string) => context.measureText(text).width + Array.from(text).length * row.spacing;
    const available = Math.min(1904 - 2 * (3.4 + 24), row.limit);
    let text = row.text;
    if (measure(text) > available) {
      const characters = Array.from(text);
      while (characters.length && measure(`${characters.join('')}…`) > available) characters.pop();
      text = `${characters.join('')}…`;
    }
    width = Math.max(width, measure(text));
  }
  return {
    width: Math.ceil(Math.min(1904, Math.max(230, width + 2 * (3.4 + 24)))),
    height: Math.ceil(17 + 15 + 2 * 3.4 + rows.reduce((sum, row) => sum + row.font * 1.25, 0) + (rows.length - 1) * 3.4),
  };
}

export function hasMissingMarkerFramePositions(options: FrameDrawingOptions) {
  if (options.points.length < 2) return false;
  const mode = options.routeMarkerMode ?? 'day';
  if (mode === 'start-goal') return !options.endpointMarkerFramePositions?.START || !options.endpointMarkerFramePositions?.GOAL;
  if (mode !== 'day') return false;
  const ids = new Set(options.points.map((point) => point.id));
  return (options.dayMarkers ?? []).some((marker) => !marker.framePosition && ids.has(marker.pointId));
}

export async function resolveMarkerFramePositions<T extends FrameDrawingOptions>(
  context: CanvasRenderingContext2D, options: T, project: MarkerReferenceProjector, signal?: AbortSignal,
): Promise<T> {
  if (!hasMissingMarkerFramePositions(options)) return options;
  const check = () => { if (signal?.aborted) throw new DOMException('マーカー配置の準備をキャンセルしました。', 'AbortError'); };
  check();
  const mode = options.routeMarkerMode ?? 'day';
  if (mode === 'day') {
    const markers = options.dayMarkers ?? [];
    await loadDayMarkerFonts(markers, options.annotationStyle);
    if (markers.some((marker) => marker.legacyFramePlacement && !marker.framePosition)) {
      await loadDayMarkerFonts(markers, { balloonScale: 1, fontScale: 24 / 28 });
    }
  }
  check();
  // Always sample the actual MP4 plan, including its intro zoom.
  const plan = buildFramePlan(options);
  const arrivals = tripRoutePointProgresses(options.points);
  const last = plan.totalFrames - 1;
  let samples = 0;
  const reached = (state: FrameState, index: number) => state.cameraMode === 'follow' || state.renderPath === 'intro-zoom'
    ? state.playback.reachedPointIndex >= index
    : state.pausePointIndex !== null ? state.pausePointIndex >= index : state.routeProgress >= arrivals[index];
  const findReference = async (index: number, kind: 'day' | EndpointMarkerLabel) => {
    const eligible = (state: FrameState) => kind === 'START' ? true : kind === 'GOAL'
      ? (state.cameraMode === 'overview' && state.renderPath === 'static' ? state.routeProgress >= 1 : reached(state, index))
      : reached(state, index);
    if (!eligible(sampleFrame(plan, last))) return null;
    let low = 0, high = last;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (eligible(sampleFrame(plan, middle))) high = middle;
      else low = middle + 1;
    }
    for (let frame = low; frame <= last; frame += 1) {
      check();
      if (++samples % 128 === 0) { await new Promise<void>((resolve) => window.setTimeout(resolve, 0)); check(); }
      const state = sampleFrame(plan, frame);
      if (!eligible(state)) continue;
      const pixel = project(options.points[index], state.camera);
      const finite = Number.isFinite(pixel.x) && Number.isFinite(pixel.y);
      const staticOverview = state.cameraMode === 'overview' && state.renderPath === 'static';
      if (finite && (kind === 'day' && staticOverview || isInVideoViewport(pixel))) return pixel;
      // This camera will never change again in Overview; no fabricated fallback.
      if (staticOverview) return null;
      if (state.section === 'pre-roll' && !plan.introZoomEnabled) frame = plan.preFrames - 1;
    }
    return null;
  };
  let changed = false;
  let dayMarkers = options.dayMarkers;
  let endpoints: EndpointMarkerFramePositions | undefined = options.endpointMarkerFramePositions;
  if (mode === 'day') {
    const indexes = new Map(options.points.map((point, index) => [point.id, index]));
    const resolved: DayMarker[] = [];
    for (const marker of options.dayMarkers ?? []) {
      const index = indexes.get(marker.pointId);
      const pixel = !marker.framePosition && index !== undefined ? await findReference(index, 'day') : null;
      if (!pixel) { resolved.push(marker); continue; }
      const legacy = marker.legacyFramePlacement;
      const current = legacy ? null : dayMarkerLayout(marker, context, options.annotationStyle ?? DEFAULT_ANNOTATION_STYLE);
      const layout = current ?? legacyDaySize(context, marker);
      const style = current?.style ?? { margin: 8, bottomMargin: 54, anchorGap: 40 };
      const rect = videoMarkerRect(pixel, layout.width, layout.height, style.margin, style.bottomMargin, style.anchorGap, marker.placement);
      resolved.push({ ...marker, framePosition: annotationFramePosition(rect) });
      changed = true;
    }
    dayMarkers = resolved;
  } else if (mode === 'start-goal') {
    endpoints = { ...endpoints };
    for (const label of ['START', 'GOAL'] as const) {
      if (endpoints[label]) continue;
      const pixel = await findReference(label === 'START' ? 0 : options.points.length - 1, label);
      if (!pixel) continue;
      // START/GOAL's archived and current dimensions are the same.
      endpoints[label] = annotationFramePosition(videoMarkerRect(pixel, 230, 78, 24, 70, 42, options.endpointMarkerPlacements?.[label]));
      changed = true;
    }
  }
  check();
  return changed ? { ...options, dayMarkers, endpointMarkerFramePositions: endpoints } : options;
}
