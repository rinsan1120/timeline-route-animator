import { saveBlobWithPicker } from '../files/saveBlob';
import { isBalloonFramePosition, parseMarkerFramePositions } from '../popup/placement';
import type { BalloonFramePosition, EndpointMarkerFramePositions, EndpointMarkerPlacements, PopupPlacement } from '../popup/placement';
import { parseAnnotationStyle, type AnnotationStyle } from '../route/annotationStyle';
import { parseVideoSettings, type VideoSettings } from '../video/videoSettings';
import type { RoutePoint } from '../timeline/types';

export const PLAN_FILE_FORMAT = 'timeline-route-animator-plan';
export const PLAN_FILE_VERSION = 1;
export const PLAN_FILE_ERROR = '計画データを読み込めませんでした。ファイル形式を確認してください。';

export interface PlanState {
  points: RoutePoint[];
  planDayStarts: string[];
  planDayNotes: Record<string, string>;
  dayMarkerPlacements: Record<string, PopupPlacement>;
  videoSettings?: VideoSettings;
  annotationStyle?: AnnotationStyle;
  animationStartPointId?: string | null;
  animationEndPointId?: string | null;
  endpointMarkerPlacements?: EndpointMarkerPlacements;
  dayMarkerFramePositions?: Record<string, BalloonFramePosition>;
  endpointMarkerFramePositions?: EndpointMarkerFramePositions;
}

export interface PlanFile extends PlanState {
  format: typeof PLAN_FILE_FORMAT;
  version: typeof PLAN_FILE_VERSION;
  savedAt: string;
}

export function serializePlanFile(state: PlanState, savedAt = new Date()): string {
  const data: PlanFile = {
    format: PLAN_FILE_FORMAT,
    version: PLAN_FILE_VERSION,
    savedAt: savedAt.toISOString(),
    points: state.points,
    planDayStarts: state.planDayStarts,
    planDayNotes: state.planDayNotes,
    dayMarkerPlacements: state.dayMarkerPlacements,
    ...(state.videoSettings !== undefined ? { videoSettings: parseVideoSettings(state.videoSettings) } : {}),
    ...(state.annotationStyle !== undefined ? { annotationStyle: parseAnnotationStyle(state.annotationStyle) } : {}),
    ...(state.animationStartPointId !== undefined ? { animationStartPointId: state.animationStartPointId } : {}),
    ...(state.animationEndPointId !== undefined ? { animationEndPointId: state.animationEndPointId } : {}),
    ...(state.endpointMarkerPlacements !== undefined ? { endpointMarkerPlacements: state.endpointMarkerPlacements } : {}),
    ...(state.dayMarkerFramePositions !== undefined ? { dayMarkerFramePositions: state.dayMarkerFramePositions } : {}),
    ...(state.endpointMarkerFramePositions !== undefined ? { endpointMarkerFramePositions: state.endpointMarkerFramePositions } : {}),
  };
  return JSON.stringify(data, null, 2);
}

export function downloadPlanFile(state: PlanState, suggestedName = 'route-plan.json'): Promise<string | null> {
  const savedAt = new Date();
  return saveBlobWithPicker(() => new Blob([serializePlanFile(state, savedAt)], { type: 'application/json' }), {
    suggestedName, mimeType: 'application/json', extension: '.json',
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isId(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function parsePlacement(value: unknown): PopupPlacement {
  if (!isRecord(value) || !isFiniteNumber(value.offsetX) || !isFiniteNumber(value.offsetY)) {
    throw new Error(PLAN_FILE_ERROR);
  }
  return { offsetX: value.offsetX, offsetY: value.offsetY };
}

function parsePoint(value: unknown): RoutePoint {
  if (!isRecord(value) || !isId(value.id)
    || !isFiniteNumber(value.latitude) || Math.abs(value.latitude) > 90
    || !isFiniteNumber(value.longitude) || Math.abs(value.longitude) > 180
    || (value.source !== 'manual' && value.source !== 'timelinePath')
    || typeof value.original !== 'boolean'
    || (value.timestamp !== undefined && typeof value.timestamp !== 'string')) {
    throw new Error(PLAN_FILE_ERROR);
  }
  const point: RoutePoint = {
    id: value.id,
    latitude: value.latitude,
    longitude: value.longitude,
    source: value.source,
    original: value.original,
    ...(value.timestamp !== undefined ? { timestamp: value.timestamp } : {}),
  };
  if (value.pauseSeconds !== undefined) {
    if (!isFiniteNumber(value.pauseSeconds) || value.pauseSeconds < 0 || value.pauseSeconds > 30) throw new Error(PLAN_FILE_ERROR);
    if (value.pauseSeconds > 0) point.pauseSeconds = value.pauseSeconds;
  }
  if (value.annotation !== undefined) {
    if (!isRecord(value.annotation) || typeof value.annotation.label !== 'string') throw new Error(PLAN_FILE_ERROR);
    if (value.annotation.framePosition !== undefined && !isBalloonFramePosition(value.annotation.framePosition)) throw new Error(PLAN_FILE_ERROR);
    point.annotation = {
      label: value.annotation.label,
      ...(value.annotation.placement !== undefined ? { placement: parsePlacement(value.annotation.placement) } : {}),
      ...(value.annotation.framePosition !== undefined ? { framePosition: { ...value.annotation.framePosition } } : {}),
    };
  }
  return point;
}

export function parsePlanFile(text: string): PlanState {
  const data: unknown = JSON.parse(text);
  if (!isRecord(data) || data.format !== PLAN_FILE_FORMAT || data.version !== PLAN_FILE_VERSION
    || !Array.isArray(data.points) || !Array.isArray(data.planDayStarts) || !data.planDayStarts.every(isId)
    || !isRecord(data.planDayNotes) || !isRecord(data.dayMarkerPlacements)) {
    throw new Error(PLAN_FILE_ERROR);
  }
  const points = data.points.map(parsePoint);
  if (new Set(points.map((point) => point.id)).size !== points.length) throw new Error(PLAN_FILE_ERROR);
  const planDayNotes = Object.fromEntries(Object.entries(data.planDayNotes).map(([id, note]): [string, string] => {
    if (!isId(id) || typeof note !== 'string') throw new Error(PLAN_FILE_ERROR);
    return [id, note];
  }));
  const dayMarkerPlacements = Object.fromEntries(Object.entries(data.dayMarkerPlacements).map(([id, placement]): [string, PopupPlacement] => {
    if (!isId(id)) throw new Error(PLAN_FILE_ERROR);
    return [id, parsePlacement(placement)];
  }));
  // Keep IDs, including temporarily unused DAY metadata retained by route editing.
  const state: PlanState = { points, planDayStarts: data.planDayStarts, planDayNotes, dayMarkerPlacements };
  try {
    if (data.dayMarkerFramePositions !== undefined) state.dayMarkerFramePositions = parseMarkerFramePositions(data.dayMarkerFramePositions, isId);
    if (data.endpointMarkerFramePositions !== undefined) state.endpointMarkerFramePositions = parseMarkerFramePositions(data.endpointMarkerFramePositions, (key) => key === 'START' || key === 'GOAL');
  } catch { throw new Error(PLAN_FILE_ERROR); }
  if (data.videoSettings !== undefined) {
    try { state.videoSettings = parseVideoSettings(data.videoSettings); }
    catch { throw new Error(PLAN_FILE_ERROR); }
  }
  if (data.annotationStyle !== undefined) {
    try { state.annotationStyle = parseAnnotationStyle(data.annotationStyle); }
    catch { throw new Error(PLAN_FILE_ERROR); }
  }
  const ids = new Set(points.map((point) => point.id));
  for (const key of ['animationStartPointId', 'animationEndPointId'] as const) {
    const id = data[key];
    if (id === undefined) continue;
    if (id !== null && (!isId(id) || !ids.has(id))) throw new Error(PLAN_FILE_ERROR);
    state[key] = id;
  }
  if (data.endpointMarkerPlacements !== undefined) {
    if (!isRecord(data.endpointMarkerPlacements)) throw new Error(PLAN_FILE_ERROR);
    state.endpointMarkerPlacements = Object.fromEntries(Object.entries(data.endpointMarkerPlacements).map(([label, placement]) => {
      if (label !== 'START' && label !== 'GOAL') throw new Error(PLAN_FILE_ERROR);
      return [label, parsePlacement(placement)];
    }));
  }
  return state;
}
