import { saveBlobWithPicker } from '../files/saveBlob';
import type { EndpointMarkerPlacements, PopupPlacement } from '../popup/placement';
import type { AnnotationStyle } from '../route/annotationStyle';
import type { RoutePoint } from './types';

export const WORK_FILE_FORMAT = 'timeline-route-animator-work';
export const WORK_FILE_VERSION = 1;
export const WORK_FILE_ERROR = 'Timeline作業データを読み込めませんでした。専用の作業JSONと対応するバージョンか確認してください。';

export interface TimelineWorkState {
  points: RoutePoint[];
  startDate: string;
  endDate: string;
  from: string;
  to: string;
  dayMarkerNotes: Record<string, string>;
  dayMarkerPlacements: Record<string, PopupPlacement>;
  endpointMarkerPlacements: EndpointMarkerPlacements;
  annotationStyle: AnnotationStyle;
  animationStartPointId: string | null;
  animationEndPointId: string | null;
}

export interface TimelineWorkFile extends TimelineWorkState {
  format: typeof WORK_FILE_FORMAT;
  version: typeof WORK_FILE_VERSION;
  savedAt: string;
}

export function serializeWorkFile(state: TimelineWorkState, savedAt = new Date()): string {
  const data: TimelineWorkFile = {
    format: WORK_FILE_FORMAT,
    version: WORK_FILE_VERSION,
    savedAt: savedAt.toISOString(),
    points: state.points,
    startDate: state.startDate,
    endDate: state.endDate,
    from: state.from,
    to: state.to,
    dayMarkerNotes: state.dayMarkerNotes,
    dayMarkerPlacements: state.dayMarkerPlacements,
    endpointMarkerPlacements: state.endpointMarkerPlacements,
    annotationStyle: state.annotationStyle,
    animationStartPointId: state.animationStartPointId,
    animationEndPointId: state.animationEndPointId,
  };
  return JSON.stringify(data, null, 2);
}

export function downloadWorkFile(state: TimelineWorkState, suggestedName = 'route-work.json'): Promise<string | null> {
  const savedAt = new Date();
  return saveBlobWithPicker(() => new Blob([serializeWorkFile(state, savedAt)], { type: 'application/json' }), {
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

function isDate(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}

function isTime(value: unknown): value is string {
  return typeof value === 'string' && (value === '' || /^([01]\d|2[0-3]):[0-5]\d$/.test(value));
}

function parsePlacement(value: unknown): PopupPlacement {
  if (!isRecord(value) || !isFiniteNumber(value.offsetX) || !isFiniteNumber(value.offsetY)) throw new Error(WORK_FILE_ERROR);
  return { offsetX: value.offsetX, offsetY: value.offsetY };
}

function parsePoint(value: unknown): RoutePoint {
  if (!isRecord(value) || !isId(value.id)
    || !isFiniteNumber(value.latitude) || Math.abs(value.latitude) > 90
    || !isFiniteNumber(value.longitude) || Math.abs(value.longitude) > 180
    || (value.source !== 'manual' && value.source !== 'timelinePath')
    || typeof value.original !== 'boolean'
    || (value.timestamp !== undefined && (typeof value.timestamp !== 'string' || !Number.isFinite(Date.parse(value.timestamp))))) {
    throw new Error(WORK_FILE_ERROR);
  }
  const point: RoutePoint = {
    id: value.id, latitude: value.latitude, longitude: value.longitude,
    source: value.source, original: value.original,
    ...(value.timestamp !== undefined ? { timestamp: value.timestamp } : {}),
  };
  if (value.pauseSeconds !== undefined) {
    if (!isFiniteNumber(value.pauseSeconds) || value.pauseSeconds < 0 || value.pauseSeconds > 30) throw new Error(WORK_FILE_ERROR);
    point.pauseSeconds = value.pauseSeconds;
  }
  if (value.annotation !== undefined) {
    if (!isRecord(value.annotation) || typeof value.annotation.label !== 'string') throw new Error(WORK_FILE_ERROR);
    point.annotation = {
      label: value.annotation.label,
      ...(value.annotation.placement !== undefined ? { placement: parsePlacement(value.annotation.placement) } : {}),
    };
  }
  return point;
}

export function parseWorkFile(text: string): TimelineWorkState {
  try {
    const data: unknown = JSON.parse(text);
    if (!isRecord(data) || data.format !== WORK_FILE_FORMAT || data.version !== WORK_FILE_VERSION
      || typeof data.savedAt !== 'string' || !Number.isFinite(Date.parse(data.savedAt))
      || !Array.isArray(data.points) || !data.points.length
      || !(data.startDate === '' || isDate(data.startDate)) || !(data.endDate === '' || isDate(data.endDate))
      || !isTime(data.from) || !isTime(data.to)
      || !isRecord(data.dayMarkerNotes) || !isRecord(data.dayMarkerPlacements)
      || !isRecord(data.endpointMarkerPlacements) || !isRecord(data.annotationStyle)
      || !isFiniteNumber(data.annotationStyle.balloonScale) || data.annotationStyle.balloonScale < 0.5 || data.annotationStyle.balloonScale > 2
      || !isFiniteNumber(data.annotationStyle.fontScale) || data.annotationStyle.fontScale < 0.5 || data.annotationStyle.fontScale > 2) throw new Error(WORK_FILE_ERROR);
    const points = data.points.map(parsePoint);
    const ids = new Set(points.map((point) => point.id));
    if (ids.size !== points.length) throw new Error(WORK_FILE_ERROR);
    const parseRangeId = (id: unknown): string | null => {
      if (id === null) return null;
      if (!isId(id) || !ids.has(id)) throw new Error(WORK_FILE_ERROR);
      return id;
    };
    const dayMarkerNotes = Object.fromEntries(Object.entries(data.dayMarkerNotes).map(([date, note]) => {
      if (!isDate(date) || typeof note !== 'string') throw new Error(WORK_FILE_ERROR);
      return [date, note];
    }));
    const dayMarkerPlacements = Object.fromEntries(Object.entries(data.dayMarkerPlacements).map(([date, placement]) => {
      if (!isDate(date)) throw new Error(WORK_FILE_ERROR);
      return [date, parsePlacement(placement)];
    }));
    const endpointMarkerPlacements = Object.fromEntries(Object.entries(data.endpointMarkerPlacements).map(([label, placement]) => {
      if (label !== 'START' && label !== 'GOAL') throw new Error(WORK_FILE_ERROR);
      return [label, parsePlacement(placement)];
    }));
    return {
      points, startDate: data.startDate, endDate: data.endDate, from: data.from, to: data.to,
      dayMarkerNotes, dayMarkerPlacements, endpointMarkerPlacements,
      annotationStyle: { balloonScale: data.annotationStyle.balloonScale, fontScale: data.annotationStyle.fontScale },
      animationStartPointId: parseRangeId(data.animationStartPointId),
      animationEndPointId: parseRangeId(data.animationEndPointId),
    };
  } catch {
    throw new Error(WORK_FILE_ERROR);
  }
}
