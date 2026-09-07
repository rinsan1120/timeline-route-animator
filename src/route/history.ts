import type { RoutePoint } from '../timeline/types';

export interface RouteHistory {
  past: RoutePoint[][];
  present: RoutePoint[];
  future: RoutePoint[][];
  initial: RoutePoint[];
}

export type HistoryAction =
  | { type: 'load'; points: RoutePoint[] }
  | { type: 'commit'; points: RoutePoint[] }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'reset' };

export const emptyHistory: RouteHistory = { past: [], present: [], future: [], initial: [] };

export function historyReducer(state: RouteHistory, action: HistoryAction): RouteHistory {
  switch (action.type) {
    case 'load': return { past: [], present: action.points, future: [], initial: action.points };
    case 'commit': return action.points === state.present ? state : { ...state, past: [...state.past, state.present], present: action.points, future: [] };
    case 'undo': {
      if (!state.past.length) return state;
      const previous = state.past.at(-1)!;
      return { ...state, past: state.past.slice(0, -1), present: previous, future: [state.present, ...state.future] };
    }
    case 'redo': {
      if (!state.future.length) return state;
      return { ...state, past: [...state.past, state.present], present: state.future[0], future: state.future.slice(1) };
    }
    case 'reset': return { ...state, past: state.present === state.initial ? state.past : [...state.past, state.present], present: state.initial, future: [] };
  }
}
