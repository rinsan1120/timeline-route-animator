import type { ExtractedTimeline, RawPosition, RoutePoint } from './types';

interface TimelinePathEntry { point?: unknown; time?: unknown }
interface SemanticSegment { timelinePath?: unknown; [key: string]: unknown }
interface RawSignal { position?: Record<string, unknown>; [key: string]: unknown }
interface TimelineDocument { semanticSegments?: unknown; rawSignals?: unknown; [key: string]: unknown }
interface IosTimelinePathEntry { point?: unknown; durationMinutesOffsetFromStartTime?: unknown }
interface IosTimelineSegment { startTime?: unknown; endTime?: unknown; timelinePath?: unknown; [key: string]: unknown }
interface TimezoneAnchor { instant: number; offsetMinutes: number }

export interface TimelineIndex {
  routeByDate: Map<string, RoutePoint[]>;
  rawByDate: Map<string, RawPosition[]>;
}

const COORDINATE_PATTERN = /^\s*([+-]?\d+(?:\.\d+)?)\s*°?\s*,\s*([+-]?\d+(?:\.\d+)?)\s*°?\s*$/;
const DATE_TIME_PATTERN = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/;
const TIMEZONE_OFFSET_PATTERN = /([+-])(\d{2}):(\d{2})$/;

export function parseCoordinate(value: unknown): { latitude: number; longitude: number } | null {
  if (typeof value !== 'string') return null;
  const match = value.match(COORDINATE_PATTERN);
  if (!match) return null;
  const latitude = Number(match[1]);
  const longitude = Number(match[2]);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
  return { latitude, longitude };
}

function timeParts(value: unknown): { date: string; minute: number } | null {
  if (typeof value !== 'string') return null;
  const match = value.match(DATE_TIME_PATTERN);
  if (!match) return null;
  return { date: match[1], minute: Number(match[2]) * 60 + Number(match[3]) };
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function getTimelinePath(segment: SemanticSegment): TimelinePathEntry[] {
  if (Array.isArray(segment.timelinePath)) return segment.timelinePath as TimelinePathEntry[];
  const nested = segment.timelinePath as { points?: unknown } | undefined;
  return Array.isArray(nested?.points) ? nested.points as TimelinePathEntry[] : [];
}

export function buildTimelineIndex(document: TimelineDocument): TimelineIndex {
  if (!Array.isArray(document.semanticSegments)) throw new Error('semanticSegments が見つかりません。Android版Google Maps TimelineのJSONを選択してください。');
  const routeByDate = new Map<string, RoutePoint[]>();
  const rawByDate = new Map<string, RawPosition[]>();
  let routeSequence = 0;
  for (const rawSegment of document.semanticSegments) {
    if (!rawSegment || typeof rawSegment !== 'object') continue;
    // activity.topCandidate.type is intentionally never inspected or used here.
    for (const entry of getTimelinePath(rawSegment as SemanticSegment)) {
      const coordinate = parseCoordinate(entry.point);
      const parts = timeParts(entry.time);
      if (!coordinate || !parts || typeof entry.time !== 'string') continue;
      const point: RoutePoint = {
        id: `timeline-${routeSequence++}`,
        ...coordinate,
        timestamp: entry.time,
        source: 'timelinePath',
        original: true,
      };
      const points = routeByDate.get(parts.date) ?? [];
      points.push(point);
      routeByDate.set(parts.date, points);
    }
  }
  let rawSequence = 0;
  if (Array.isArray(document.rawSignals)) {
    for (const signal of document.rawSignals as RawSignal[]) {
      const position = signal?.position;
      if (!position || typeof position !== 'object') continue;
      const coordinate = parseCoordinate(position.LatLng ?? position.latLng);
      const parts = timeParts(position.timestamp);
      if (!coordinate || !parts || typeof position.timestamp !== 'string') continue;
      const point: RawPosition = {
        id: `raw-${rawSequence++}`,
        ...coordinate,
        timestamp: position.timestamp,
        accuracyMeters: optionalNumber(position.accuracyMeters),
        source: typeof position.source === 'string' ? position.source : undefined,
        altitudeMeters: optionalNumber(position.altitudeMeters),
        speedMetersPerSecond: optionalNumber(position.speedMetersPerSecond),
      };
      const points = rawByDate.get(parts.date) ?? [];
      points.push(point);
      rawByDate.set(parts.date, points);
    }
  }
  for (const points of routeByDate.values()) points.sort((a, b) => (a.timestamp ?? '').localeCompare(b.timestamp ?? ''));
  for (const points of rawByDate.values()) points.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  return { routeByDate, rawByDate };
}

function looksLikeIosTimeline(value: unknown[]): boolean {
  return value.some((segment) => Boolean(
    segment
    && typeof segment === 'object'
    && typeof (segment as IosTimelineSegment).startTime === 'string'
    && Array.isArray((segment as IosTimelineSegment).timelinePath),
  ));
}

function parseTimezoneAnchor(value: unknown): TimezoneAnchor | null {
  if (typeof value !== 'string') return null;
  const match = TIMEZONE_OFFSET_PATTERN.exec(value);
  if (!match) return null;
  const instant = Date.parse(value);
  const hours = Number(match[2]);
  const minutes = Number(match[3]);
  if (!Number.isFinite(instant) || hours > 23 || minutes > 59) return null;
  const offsetMinutes = (hours * 60 + minutes) * (match[1] === '-' ? -1 : 1);
  return { instant, offsetMinutes };
}

function nearestTimezoneOffset(anchors: TimezoneAnchor[], instant: number): number {
  if (!anchors.length) return 0;
  let low = 0;
  let high = anchors.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (anchors[middle].instant < instant) low = middle + 1;
    else high = middle;
  }
  if (low === 0) return anchors[0].offsetMinutes;
  if (low === anchors.length) return anchors[anchors.length - 1].offsetMinutes;
  const before = anchors[low - 1];
  const after = anchors[low];
  return instant - before.instant <= after.instant - instant ? before.offsetMinutes : after.offsetMinutes;
}

function formatTimestampWithOffset(instant: number, offsetMinutes: number): string | null {
  const localInstant = instant + offsetMinutes * 60_000;
  const localDate = new Date(localInstant);
  if (!Number.isFinite(localDate.getTime())) return null;
  const absoluteOffset = Math.abs(offsetMinutes);
  const sign = offsetMinutes < 0 ? '-' : '+';
  const hours = String(Math.floor(absoluteOffset / 60)).padStart(2, '0');
  const minutes = String(absoluteOffset % 60).padStart(2, '0');
  return `${localDate.toISOString().slice(0, -1)}${sign}${hours}:${minutes}`;
}

function parseIosCoordinate(value: unknown): { latitude: number; longitude: number } | null {
  return typeof value === 'string' && value.startsWith('geo:') ? parseCoordinate(value.slice(4)) : null;
}

function buildIosTimelineIndex(segments: unknown[]): TimelineIndex {
  const timezoneAnchors: TimezoneAnchor[] = [];
  for (const rawSegment of segments) {
    if (!rawSegment || typeof rawSegment !== 'object') continue;
    const segment = rawSegment as IosTimelineSegment;
    const startAnchor = parseTimezoneAnchor(segment.startTime);
    const endAnchor = parseTimezoneAnchor(segment.endTime);
    if (startAnchor) timezoneAnchors.push(startAnchor);
    if (endAnchor) timezoneAnchors.push(endAnchor);
  }
  timezoneAnchors.sort((a, b) => a.instant - b.instant);

  const routeByDate = new Map<string, RoutePoint[]>();
  let routeSequence = 0;
  for (const rawSegment of segments) {
    if (!rawSegment || typeof rawSegment !== 'object') continue;
    const segment = rawSegment as IosTimelineSegment;
    if (typeof segment.startTime !== 'string' || !Array.isArray(segment.timelinePath)) continue;
    const segmentStart = Date.parse(segment.startTime);
    if (!Number.isFinite(segmentStart)) continue;
    for (const entry of segment.timelinePath as IosTimelinePathEntry[]) {
      if (!entry || typeof entry !== 'object') continue;
      const coordinate = parseIosCoordinate(entry.point);
      const rawOffset = entry.durationMinutesOffsetFromStartTime;
      if (!coordinate || (typeof rawOffset !== 'string' && typeof rawOffset !== 'number') || (typeof rawOffset === 'string' && !rawOffset.trim())) continue;
      const offsetFromStart = Number(rawOffset);
      if (!Number.isFinite(offsetFromStart)) continue;
      const instant = segmentStart + offsetFromStart * 60_000;
      if (!Number.isFinite(instant)) continue;
      const timestamp = formatTimestampWithOffset(instant, nearestTimezoneOffset(timezoneAnchors, instant));
      const parts = timeParts(timestamp);
      if (!timestamp || !parts) continue;
      const point: RoutePoint = {
        id: `timeline-${routeSequence++}`,
        ...coordinate,
        timestamp,
        source: 'timelinePath',
        original: true,
      };
      const points = routeByDate.get(parts.date) ?? [];
      points.push(point);
      routeByDate.set(parts.date, points);
    }
  }
  if (!routeSequence) throw new Error('Timeline形式のデータを確認できませんでした。');
  for (const points of routeByDate.values()) points.sort((a, b) => Date.parse(a.timestamp ?? '') - Date.parse(b.timestamp ?? ''));
  return { routeByDate, rawByDate: new Map() };
}

export function getAvailableDates(index: TimelineIndex): string[] {
  return [...new Set([...index.routeByDate.keys(), ...index.rawByDate.keys()])].sort();
}

function parseMinute(time: string): number {
  const match = /^(\d{2}):(\d{2})$/.exec(time);
  if (!match) throw new Error('時刻の形式が正しくありません。');
  return Number(match[1]) * 60 + Number(match[2]);
}

export function extractTimelineRange(index: TimelineIndex, date: string, from: string, to: string): ExtractedTimeline {
  const fromMinute = parseMinute(from);
  const toMinute = parseMinute(to);
  if (fromMinute >= toMinute) throw new Error('FromはToより前の時刻を指定してください。');
  const inRange = (timestamp: string) => {
    const parts = timeParts(timestamp);
    return parts?.date === date && parts.minute >= fromMinute && parts.minute <= toMinute;
  };
  return {
    routePoints: (index.routeByDate.get(date) ?? []).filter((point) => point.timestamp && inRange(point.timestamp)),
    rawPositions: (index.rawByDate.get(date) ?? []).filter((point) => inRange(point.timestamp)),
  };
}

export function extractTimelineDateRange(index: TimelineIndex, startDate: string, endDate: string, from: string, to: string): ExtractedTimeline {
  if (startDate > endDate) throw new Error('開始日は終了日以前の日付を指定してください。');
  if (startDate === endDate) return extractTimelineRange(index, startDate, from, to);
  const fromMinute = parseMinute(from);
  const toMinute = parseMinute(to);
  const dates = [...new Set([...index.routeByDate.keys(), ...index.rawByDate.keys()])]
    .filter((date) => date >= startDate && date <= endDate)
    .sort();
  const routePoints: RoutePoint[] = [];
  const rawPositions: RawPosition[] = [];
  for (const date of dates) {
    const inRange = (timestamp: string) => {
      const parts = timeParts(timestamp);
      if (!parts || parts.date !== date) return false;
      if (date === startDate) return parts.minute >= fromMinute;
      if (date === endDate) return parts.minute <= toMinute;
      return true;
    };
    routePoints.push(...(index.routeByDate.get(date) ?? []).filter((point) => point.timestamp && inRange(point.timestamp)));
    rawPositions.push(...(index.rawByDate.get(date) ?? []).filter((point) => inRange(point.timestamp)));
  }
  return { routePoints, rawPositions };
}

export function parseTimelineText(text: string): TimelineIndex {
  let value: unknown;
  value = JSON.parse(text);
  if (Array.isArray(value)) {
    if (!looksLikeIosTimeline(value)) throw new Error('Timeline JSONの形式が正しくありません。');
    return buildIosTimelineIndex(value);
  }
  if (!value || typeof value !== 'object' || !Array.isArray((value as TimelineDocument).semanticSegments)) throw new Error('Timeline JSONの形式が正しくありません。');
  return buildTimelineIndex(value as TimelineDocument);
}
