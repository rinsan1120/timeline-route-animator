import type { PopupPlacement } from '../popup/placement';
import type { RoutePoint } from '../timeline/types';

export const PLAN_FILE_FORMAT = 'timeline-route-animator-plan';
export const PLAN_FILE_VERSION = 1;
export const PLAN_FILE_ERROR = '計画データを読み込めませんでした。ファイル形式を確認してください。';

export interface PlanState {
  points: RoutePoint[];
  planDayStarts: string[];
  planDayNotes: Record<string, string>;
  dayMarkerPlacements: Record<string, PopupPlacement>;
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
  };
  return JSON.stringify(data, null, 2);
}

export function downloadPlanFile(state: PlanState): void {
  const savedAt = new Date();
  const pad = (value: number) => String(value).padStart(2, '0');
  const date = `${savedAt.getFullYear()}${pad(savedAt.getMonth() + 1)}${pad(savedAt.getDate())}`;
  const time = `${pad(savedAt.getHours())}${pad(savedAt.getMinutes())}${pad(savedAt.getSeconds())}`;
  const url = URL.createObjectURL(new Blob([serializePlanFile(state, savedAt)], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `route-plan-${date}-${time}.json`;
  document.body.appendChild(link);
  try {
    link.click();
  } finally {
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
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
    point.annotation = {
      label: value.annotation.label,
      ...(value.annotation.placement !== undefined ? { placement: parsePlacement(value.annotation.placement) } : {}),
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
  return { points, planDayStarts: data.planDayStarts, planDayNotes, dayMarkerPlacements };
}
