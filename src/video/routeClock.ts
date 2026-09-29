import type { FollowPlaybackState } from './followCamera';
import type { RoutePoint } from '../timeline/types';
import { distanceMeters } from '../route/geometry';
import { interpolateTripRoute, splitRouteByDay } from '../route/tripRoute';

interface RecordedTime { milliseconds: number; offsetMinutes: number }

function recordedTime(timestamp?: string): RecordedTime | null {
  if (!timestamp) return null;
  const match = /^(\d{4}-\d{2}-\d{2})T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/i.exec(timestamp);
  if (!match) return null;
  const zone = match[2];
  // Offsetのない記録も端末のtimezoneに依存させず、記録された壁時計時刻を扱う。
  const milliseconds = Date.parse(zone ? timestamp : `${timestamp}Z`);
  if (!Number.isFinite(milliseconds)) return null;
  const digits = zone?.replace(':', '');
  const offsetMinutes = !digits || digits.toUpperCase() === 'Z' ? 0
    : (digits[0] === '-' ? -1 : 1) * (Number(digits.slice(1, 3)) * 60 + Number(digits.slice(3, 5)));
  return { milliseconds, offsetMinutes };
}

function formatTime(time: RecordedTime): string {
  return new Date(time.milliseconds + time.offsetMinutes * 60_000).toISOString().slice(11, 16);
}

export function hasRecordedRouteTime(points: RoutePoint[]): boolean {
  return splitRouteByDay(points).some((day) => {
    const anchors = day.map((point) => recordedTime(point.timestamp)).filter((time): time is RecordedTime => time !== null);
    return anchors.some((time, index) => index > 0 && time.milliseconds >= anchors[index - 1].milliseconds);
  });
}

// 再生秒数は使わず、既存マーカーと同じ距離進行・停止地点から算出する。RoutePointは変更しない。
export function sampleRecordedRouteTime(points: RoutePoint[], progress: number, pausePointIndex: number | null = null): string | null {
  if (!points.length || !Number.isFinite(progress)) return null;
  const position = interpolateTripRoute(points, progress);
  if (!position) return null;
  const exactIndex = pausePointIndex ?? (position.fromIndex === position.toIndex || position.segmentProgress <= 1e-9
    ? position.fromIndex : position.segmentProgress >= 1 - 1e-9 ? position.toIndex : null);
  if (exactIndex !== null) {
    if (!points[exactIndex]) return null;
    const exact = recordedTime(points[exactIndex].timestamp);
    if (exact) return formatTime(exact);
  }
  const from = exactIndex ?? position.fromIndex;
  const to = exactIndex ?? position.toIndex;
  let start = 0;
  for (const day of splitRouteByDay(points)) {
    const end = start + day.length;
    if (from >= start && to < end) {
      const distances = [0];
      for (let i = 1; i < day.length; i++) distances.push(distances[i - 1] + distanceMeters(day[i - 1], day[i]));
      const localFrom = from - start;
      const localTo = to - start;
      const target = distances[localFrom] + (distances[localTo] - distances[localFrom]) * (exactIndex === null ? position.segmentProgress : 0);
      let left = localFrom;
      let right = localTo;
      while (left >= 0 && !recordedTime(day[left].timestamp)) left--;
      while (right < day.length && !recordedTime(day[right].timestamp)) right++;
      if (left < 0 || right >= day.length || left === right) return null;
      const a = recordedTime(day[left].timestamp)!;
      const b = recordedTime(day[right].timestamp)!;
      const length = distances[right] - distances[left];
      if (!(length > 0) || b.milliseconds < a.milliseconds) return null;
      const fraction = (target - distances[left]) / length;
      if (fraction < 0 || fraction > 1) return null;
      // Offsetが変わる区間は左アンカーのoffsetを使用し、右の実績地点に到達したらその記録へ切り替える。
      return formatTime({ milliseconds: Math.round(a.milliseconds + (b.milliseconds - a.milliseconds) * fraction), offsetMinutes: a.offsetMinutes });
    }
    start = end;
  }
  return null;
}

export const ROUTE_CLOCK_STYLE = {
  width: 56, height: 24, fontSize: 14, radius: 6, markerRadius: 11, gap: 6,
  background: 'rgba(255,255,255,0.92)', color: '#07111f', border: 'rgba(7,17,31,0.35)',
} as const;

export function routeClockRect(x: number, y: number, width: number, height: number, scale = 1) {
  const w = ROUTE_CLOCK_STYLE.width * scale;
  const h = ROUTE_CLOCK_STYLE.height * scale;
  const clearance = (ROUTE_CLOCK_STYLE.markerRadius + ROUTE_CLOCK_STYLE.gap) * scale;
  const above = y - clearance - h;
  return {
    x: Math.max(0, Math.min(width - w, x - w / 2)),
    y: Math.max(0, Math.min(height - h, above < 0 ? y + clearance : above)),
    width: w, height: h,
  };
}

export function drawRouteClock(context: CanvasRenderingContext2D, text: string | null, x: number, y: number) {
  if (!text) return;
  const rect = routeClockRect(x, y, context.canvas.width, context.canvas.height, 2);
  context.save();
  context.shadowBlur = 0;
  context.beginPath();
  context.roundRect(rect.x, rect.y, rect.width, rect.height, ROUTE_CLOCK_STYLE.radius * 2);
  context.fillStyle = ROUTE_CLOCK_STYLE.background;
  context.fill();
  context.strokeStyle = ROUTE_CLOCK_STYLE.border;
  context.lineWidth = 2;
  context.stroke();
  context.fillStyle = ROUTE_CLOCK_STYLE.color;
  context.font = `600 ${ROUTE_CLOCK_STYLE.fontSize * 2}px system-ui, sans-serif`;
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(text, rect.x + rect.width / 2, rect.y + rect.height / 2);
  context.restore();
}

// DAY移動のパン中はマーカーが前日の終点に残るため、その地点を優先する。
export function followClockPointIndex(playback: FollowPlaybackState, pausePointIndex: number | null): number | null {
  return pausePointIndex ?? (playback.phase === 'day-transition' ? playback.reachedPointIndex : null);
}
