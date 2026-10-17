import type { RoutePoint } from '../timeline/types';
import type { BalloonFramePosition, EndpointMarkerFramePositions, EndpointMarkerPlacements, PopupPlacement } from '../popup/placement';
import { applyBalloonFramePositions } from './balloonFrame';
import { sameRouteGeometry } from '../video/previewUpdates';
import { DEFAULT_DISTANCE_HUD, type DistanceHudPlacement } from '../video/distanceHud';

export interface EditSnapshot {
  points: RoutePoint[];
  dayMarkerPlacements: Record<string, PopupPlacement>;
  endpointMarkerPlacements: EndpointMarkerPlacements;
  dayMarkerFramePositions: Record<string, BalloonFramePosition>;
  endpointMarkerFramePositions: EndpointMarkerFramePositions;
  distanceHudPlacement: DistanceHudPlacement;
  /** Session-only compatibility metadata; never saved to JSON. */
  legacyDayKeys: ReadonlySet<string>;
}

type Snapshot = RoutePoint[] | EditSnapshot;
export interface RouteHistory<T extends Snapshot = RoutePoint[]> {
  past: T[];
  present: T;
  future: T[];
  initial: T;
}
export interface EditHistory extends RouteHistory<EditSnapshot> { revision: number }

export type HistoryAction =
  | { type: 'resolve-balloon-positions'; positions: ReadonlyMap<string, BalloonFramePosition> }
  | { type: 'resolve-marker-positions'; source: EditSnapshot; days: Record<string, BalloonFramePosition>; endpoints: EndpointMarkerFramePositions }
  | { type: 'sync-hud-position'; placement: DistanceHudPlacement }
  | { type: 'load'; points: RoutePoint[]; edit?: Partial<EditSnapshot>; preserveEdit?: boolean }
  | { type: 'commit'; points?: RoutePoint[]; edit?: Partial<EditSnapshot> }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'reset' };

export const emptyHistory: RouteHistory = { past: [], present: [], future: [], initial: [] };

function createEditSnapshot(points: RoutePoint[], edit?: Partial<EditSnapshot>): EditSnapshot {
  return { dayMarkerPlacements: {}, endpointMarkerPlacements: {}, dayMarkerFramePositions: {}, endpointMarkerFramePositions: {},
    distanceHudPlacement: { x: DEFAULT_DISTANCE_HUD.x, y: DEFAULT_DISTANCE_HUD.y }, legacyDayKeys: new Set(), ...edit, points };
}
const emptyEdit = createEditSnapshot([]);
export const emptyEditHistory: EditHistory = { past: [], present: emptyEdit, future: [], initial: emptyEdit, revision: 0 };

const pointsOf = (snapshot: Snapshot) => Array.isArray(snapshot) ? snapshot : snapshot.points;
function withPoints<T extends Snapshot>(snapshot: T, points: RoutePoint[]): T {
  return (points === pointsOf(snapshot) ? snapshot : Array.isArray(snapshot) ? points : { ...snapshot, points }) as T;
}
function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) || Array.isArray(b)) return Array.isArray(a) && Array.isArray(b)
    && a.length === b.length && a.every((value, index) => sameValue(value, b[index]));
  if (a instanceof Set || b instanceof Set) return a instanceof Set && b instanceof Set && a.size === b.size && [...a].every((value) => b.has(value));
  const keys = (value: object) => Object.keys(value).filter((key) => (value as Record<string, unknown>)[key] !== undefined);
  const first = keys(a), second = keys(b);
  return first.length === second.length && first.every((key) => Object.hasOwn(b, key)
    && sameValue((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]));
}

// The array form remains supported for spot editing and existing route callers.
// App uses EditSnapshot so a user operation is committed/restored atomically.
function reduceHistory<T extends Snapshot>(state: RouteHistory<T>, action: HistoryAction): RouteHistory<T> {
  switch (action.type) {
    case 'resolve-balloon-positions': {
      const resolvedPoints = new Map<RoutePoint[], RoutePoint[]>();
      const resolve = (snapshot: T) => {
        const points = pointsOf(snapshot);
        let resolved = resolvedPoints.get(points);
        if (!resolved) { resolved = applyBalloonFramePositions(points, action.positions); resolvedPoints.set(points, resolved); }
        return withPoints(snapshot, resolved);
      };
      return { past: state.past.map(resolve), present: resolve(state.present), future: state.future.map(resolve), initial: resolve(state.initial) };
    }
    case 'resolve-marker-positions': {
      const matchingRoute = (snapshot: EditSnapshot) => snapshot.points === action.source.points || sameRouteGeometry(snapshot.points, action.source.points)
        && snapshot.points.every((point, index) => point.pauseSeconds === action.source.points[index].pauseSeconds
          && !!point.annotation?.label.trim() === !!action.source.points[index].annotation?.label.trim());
      // HUD clamping / balloon completion can be queued ahead of this result.
      // Accept those updates, but never a different placement or work session.
      if (Array.isArray(state.present) || state.present.dayMarkerPlacements !== action.source.dayMarkerPlacements
        || state.present.endpointMarkerPlacements !== action.source.endpointMarkerPlacements
        || state.present.legacyDayKeys !== action.source.legacyDayKeys || !matchingRoute(state.present)) return state;
      const resolve = (snapshot: T): T => {
        if (Array.isArray(snapshot) || !matchingRoute(snapshot)) return snapshot;
        const days = { ...snapshot.dayMarkerFramePositions }, endpoints = { ...snapshot.endpointMarkerFramePositions };
        let changed = false;
        for (const [key, position] of Object.entries(action.days)) {
          if (!days[key] && snapshot.dayMarkerPlacements[key] === action.source.dayMarkerPlacements[key]
            && snapshot.legacyDayKeys.has(key) === action.source.legacyDayKeys.has(key)) { days[key] = position; changed = true; }
        }
        for (const key of ['START', 'GOAL'] as const) {
          if (!endpoints[key] && action.endpoints[key] && snapshot.endpointMarkerPlacements[key] === action.source.endpointMarkerPlacements[key]) {
            endpoints[key] = action.endpoints[key]; changed = true;
          }
        }
        return changed ? { ...snapshot, dayMarkerFramePositions: days, endpointMarkerFramePositions: endpoints } : snapshot;
      };
      return { ...state, past: state.past.map(resolve), present: resolve(state.present), future: state.future.map(resolve), initial: resolve(state.initial) };
    }
    case 'sync-hud-position': {
      if (Array.isArray(state.present) || sameValue(state.present.distanceHudPlacement, action.placement)) return state;
      return { ...state, present: { ...state.present, distanceHudPlacement: action.placement } };
    }
    case 'load': {
      const present = (Array.isArray(state.present) ? action.points
        : createEditSnapshot(action.points, { ...(action.preserveEdit ? state.present : {}), ...action.edit })) as T;
      return { past: [], present, future: [], initial: present };
    }
    case 'commit': {
      const present = (Array.isArray(state.present) ? action.points ?? state.present
        : { ...state.present, ...action.edit, points: action.points ?? action.edit?.points ?? state.present.points }) as T;
      return sameValue(present, state.present) ? state : { ...state, past: [...state.past, state.present], present, future: [] };
    }
    case 'undo': {
      if (!state.past.length) return state;
      const previous = state.past.at(-1)!;
      return { ...state, past: state.past.slice(0, -1), present: previous, future: [state.present, ...state.future] };
    }
    case 'redo': {
      if (!state.future.length) return state;
      return { ...state, past: [...state.past, state.present], present: state.future[0], future: state.future.slice(1) };
    }
    case 'reset': {
      const present = withPoints(state.present, pointsOf(state.initial));
      return sameValue(present, state.present) ? state : { ...state, past: [...state.past, state.present], present, future: [] };
    }
  }
}

export const historyReducer = (state: RouteHistory, action: HistoryAction) => reduceHistory(state, action);
export const editHistoryReducer = (state: EditHistory, action: HistoryAction): EditHistory => {
  const automatic = action.type === 'resolve-balloon-positions' || action.type === 'resolve-marker-positions' || action.type === 'sync-hud-position';
  const next = reduceHistory(state, action);
  return { ...next, revision: state.revision + (automatic ? 0 : 1) };
};
