import type { BalloonFramePosition, PopupPlacement } from '../popup/placement';
import { DEFAULT_ANNOTATION_STYLE, annotationMinimumWidth, parseAnnotationStyle } from '../route/annotationStyle';
import { buildRoutePointDayNumbers } from '../route/dayRouteColor';
import type { RoutePoint } from '../timeline/types';
import { balloonPauseSeconds } from './balloonPauses';
import { clampDistanceHudPlacement, distanceHudLayout } from './distanceHud';
import { FOLLOW_ZOOM_BY_PRESET } from './followCamera';
import { createOverviewCamera } from './overviewCamera';
import { DEFAULT_POST_ROLL_SECONDS, DEFAULT_PRE_ROLL_SECONDS } from './outputTiming';
import { normalizePauseSeconds } from './playbackTimeline';
import type { RenderVideoOptions } from './renderer';

export type VideoOutputOptions = Omit<RenderVideoOptions, 'signal' | 'onProgress'>;
const placement = (value?: PopupPlacement) => value ? [value.offsetX, value.offsetY] : null;
const framePosition = (value?: BalloonFramePosition) => value ? [value.x, value.y] : null;
const geometry = (point: RoutePoint) => [point.id, point.longitude, point.latitude, point.timestamp?.slice(0, 10) ?? null];

// A session-local comparison string, never logged, persisted or sent elsewhere.
// Derived camera plans are deterministic from these inputs; do not serialize or
// rebuild them here. The caller builds its export plan from the captured inputs.
export function createVideoOutputSnapshot(options: VideoOutputOptions): string {
  const mode = options.routeMarkerMode ?? 'day';
  const cameraMode = options.cameraMode ?? 'overview';
  const preRoll = normalizePauseSeconds(options.preRollSeconds ?? DEFAULT_PRE_ROLL_SECONDS);
  const pointIds = new Set(options.points.map((point) => point.id));
  const markers = (options.dayMarkers ?? []).filter((marker) => pointIds.has(marker.pointId));
  const colorNumbers = options.dayRouteColorsEnabled
    ? options.dayNumberByPointId ?? buildRoutePointDayNumbers(options.points, options.dayMarkers ?? []) : null;
  const camera = cameraMode === 'overview' ? options.overviewCamera ?? createOverviewCamera(options.points,
    options.overviewZoomMode === 'custom' ? options.overviewCustomZoom ?? 10 : undefined) : null;
  const preset = options.followZoomPreset ?? 'standard';
  const annotations = options.points.map((point) => {
    const note = point.annotation;
    if (!note?.label) return null;
    return [note.label, note.framePosition ? [note.framePosition.x, note.framePosition.y] : null,
      note.framePosition ? null : placement(note.placement)];
  });
  const style = options.annotationStyle ?? DEFAULT_ANNOTATION_STYLE;
  const hud = options.distanceHud?.settings.enabled ? options.distanceHud : null;
  const hudLayout = hud ? distanceHudLayout(hud.model, hud.settings.scale) : null;
  const hudPlacement = hud && hudLayout ? clampDistanceHudPlacement(hud.settings, hudLayout) : null;
  return JSON.stringify({
    route: options.points.map(geometry),
    recordedTimes: options.recordedTimeClockEnabled ? options.points.map((point) => point.timestamp ?? null) : null,
    annotations,
    annotationStyle: annotations.some(Boolean) || (mode === 'day' && markers.length > 0) ? [style.fontScale,
      mode === 'day' && markers.length > 0 ? annotationMinimumWidth(style, 'day') : 0,
      annotations.some(Boolean) ? annotationMinimumWidth(style, 'balloon') : 0] : null,
    pauses: balloonPauseSeconds(options.points, options.dayMarkers ?? [], mode, options.commonPauseSeconds ?? 0),
    duration: options.duration,
    preRoll, postRoll: normalizePauseSeconds(options.postRollSeconds ?? DEFAULT_POST_ROLL_SECONDS),
    introZoom: preRoll > 0 && !!options.introZoomEnabled,
    cameraMode,
    camera: camera ? [camera.longitude, camera.latitude, camera.zoom, camera.bearing, camera.pitch] : null,
    follow: cameraMode === 'follow' ? [preset === 'custom' ? options.followCustomZoom ?? 10 : FOLLOW_ZOOM_BY_PRESET[preset], options.followViewMode ?? 'top'] : null,
    // Follow always reveals the travelled route, regardless of this option.
    revealRoute: cameraMode === 'overview' ? options.revealRoute : true,
    markerMode: mode,
    dayMarkers: mode === 'day' ? markers.map((marker) => [marker.pointId, marker.dayNumber, marker.date || null, marker.note ?? '',
      framePosition(marker.framePosition), marker.framePosition ? Boolean(marker.placement) : placement(marker.placement)]) : null,
    endpoints: mode === 'start-goal' ? (['START', 'GOAL'] as const).map((label) => [framePosition(options.endpointMarkerFramePositions?.[label]),
      options.endpointMarkerFramePositions?.[label] ? null : placement(options.endpointMarkerPlacements?.[label])]) : null,
    dayColors: !!options.dayRouteColorsEnabled,
    routeDayNumbers: colorNumbers ? options.points.map((point) => colorNumbers.get(point.id) ?? null) : null,
    hud: hud && hudLayout && hudPlacement ? {
      placement: [hudPlacement.x, hudPlacement.y], scale: hudLayout.scale, dayColors: !!hud.dayColorsEnabled,
      totals: [hud.model.totals.totalMeters, hud.model.totals.days.map((day) => [day.dayNumber, day.distanceMeters])],
      atPoint: hud.model.animationPoints.map((point) => {
        const at = hud.model.atPoint.get(point.id);
        return at ? [at.dayIndex, at.meters] : null;
      }),
      route: hud.model.animationPoints === options.points ? null : hud.model.animationPoints.map(geometry),
    } : null,
  });
}

const copyPlacement = (value?: PopupPlacement) => value ? { ...value } : undefined;
const copyFramePosition = (value?: BalloonFramePosition) => value ? { ...value } : undefined;
const copyPoint = (point: RoutePoint): RoutePoint => ({ ...point, annotation: point.annotation ? {
  ...point.annotation, placement: copyPlacement(point.annotation.placement),
  framePosition: point.annotation.framePosition ? { ...point.annotation.framePosition } : undefined,
} : undefined });

// Copy only export data at generation start, including nested placements and HUD
// lookup values. Never clone a FramePlan, MapLibre map, bitmap or video Blob.
export function captureVideoOutputOptions(options: VideoOutputOptions): VideoOutputOptions {
  const points = options.points.map(copyPoint);
  const hud = options.distanceHud;
  const hudPoints = hud?.model.animationPoints === options.points ? points : hud?.model.animationPoints.map(copyPoint);
  return {
    ...options, points,
    dayMarkers: options.dayMarkers?.map((marker) => ({ ...marker, placement: copyPlacement(marker.placement), framePosition: copyFramePosition(marker.framePosition) })),
    dayNumberByPointId: options.dayNumberByPointId
      ? new Map(points.flatMap((point) => {
        const day = options.dayNumberByPointId!.get(point.id);
        return day === undefined ? [] : [[point.id, day] as const];
      })) : undefined,
    endpointMarkerPlacements: { START: copyPlacement(options.endpointMarkerPlacements?.START), GOAL: copyPlacement(options.endpointMarkerPlacements?.GOAL) },
    endpointMarkerFramePositions: { START: copyFramePosition(options.endpointMarkerFramePositions?.START), GOAL: copyFramePosition(options.endpointMarkerFramePositions?.GOAL) },
    annotationStyle: options.annotationStyle ? parseAnnotationStyle(options.annotationStyle) : undefined,
    overviewCamera: options.overviewCamera ? { ...options.overviewCamera } : undefined,
    followCameraPlan: undefined,
    distanceHud: hud && hudPoints ? {
      ...hud, settings: { ...hud.settings }, model: {
        totals: { totalMeters: hud.model.totals.totalMeters, days: hud.model.totals.days.map((day) => ({ ...day })) },
        atPoint: new Map(hudPoints.flatMap((point) => {
          const at = hud.model.atPoint.get(point.id);
          return at ? [[point.id, { ...at }] as const] : [];
        })),
        animationPoints: hudPoints,
      },
    } : undefined,
  };
}
