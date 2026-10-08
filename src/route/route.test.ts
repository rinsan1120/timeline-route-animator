import { describe, expect, it, vi } from 'vitest';
import { bindFrameBalloonDrag } from '../popup/frameDrag';
import { addPoint, deletePoint, movePoint } from './editor';
import { distanceMeters, interpolateRoute, routeDistance } from './geometry';
import { emptyHistory, historyReducer } from './history';
import type { RoutePoint } from '../timeline/types';

const point = (id: string, latitude: number, longitude: number): RoutePoint => ({ id, latitude, longitude, source: 'timelinePath', original: true });
const route = [point('a', 35, 139), point('b', 35, 140), point('c', 35, 142)];

describe('route geometry', () => {
  it('calculates route distance', () => expect(routeDistance(route)).toBeCloseTo(distanceMeters(route[0], route[1]) + distanceMeters(route[1], route[2]), 5));
  it('interpolates by cumulative distance, not point index', () => {
    const middle = interpolateRoute(route, 0.5)!;
    expect(middle.segmentIndex).toBe(1);
    expect(middle.longitude).toBeCloseTo(140.5, 1);
  });
});

describe('route editing', () => {
  it('restores fixed balloon positions through drag, label changes, point move, deletion, undo and redo', () => {
    const original = route.map((point) => point.id === 'b' ? { ...point, annotation: { label: '地点', placement: { offsetX: 30, offsetY: -20 } } } : point);
    let state = historyReducer(emptyHistory, { type: 'load', points: original });
    const initialPosition = { x: 0.5, y: 0.4 };
    state = historyReducer(state, { type: 'resolve-balloon-positions', positions: new Map([['b', initialPosition]]) });
    expect(state.past).toHaveLength(0);
    expect(state.initial[1].annotation?.framePosition).toEqual(initialPosition);
    const changedPosition = { x: 0.8, y: 0.2 };
    state = historyReducer(state, { type: 'commit', points: state.present.map((point) => point.annotation ? { ...point, annotation: { ...point.annotation, framePosition: changedPosition } } : point) });
    expect(state.past).toHaveLength(1);
    state = historyReducer(state, { type: 'undo' });
    expect(state.present[1].annotation?.framePosition).toEqual(initialPosition);
    state = historyReducer(state, { type: 'redo' });
    expect(state.present[1].annotation?.framePosition).toEqual(changedPosition);
    state = historyReducer(state, { type: 'commit', points: movePoint(state.present.map((point) => point.annotation ? { ...point, annotation: { ...point.annotation, label: '変更' } } : point), 'b', 36, 141) });
    expect(state.present[1].annotation).toEqual({ label: '変更', placement: { offsetX: 30, offsetY: -20 }, framePosition: changedPosition });
    state = historyReducer(state, { type: 'commit', points: deletePoint(state.present, 'b') });
    state = historyReducer(state, { type: 'undo' });
    expect(state.present[1].annotation?.framePosition).toEqual(changedPosition);
    state = historyReducer(state, { type: 'redo' });
    expect(state.present.some((point) => point.id === 'b')).toBe(false);
  });
  it('initializes legacy positions in past, future and initial without overwriting edited positions', () => {
    const legacy = [{ ...route[0], annotation: { label: '旧地点', placement: { offsetX: 20, offsetY: 10 } } }];
    let state = historyReducer(emptyHistory, { type: 'load', points: legacy });
    state = historyReducer(state, { type: 'commit', points: movePoint(legacy, 'a', 36, 140) });
    state = historyReducer(state, { type: 'undo' });
    state = historyReducer(state, { type: 'resolve-balloon-positions', positions: new Map([['a', { x: 0.6, y: 0.3 }]]) });
    expect(state.future[0][0].annotation?.framePosition).toEqual({ x: 0.6, y: 0.3 });
    state = historyReducer(state, { type: 'resolve-balloon-positions', positions: new Map([['a', { x: 0.1, y: 0.1 }]]) });
    expect(state.present[0].annotation?.framePosition).toEqual({ x: 0.6, y: 0.3 });
  });
  it('adds into the nearest segment', () => expect(addPoint(route, 35, 140.5, 'new').map((item) => item.id)).toEqual(['a', 'b', 'new', 'c']));
  it('deletes a point', () => expect(deletePoint(route, 'b').map((item) => item.id)).toEqual(['a', 'c']));
  it('moves a point', () => expect(movePoint(route, 'b', 36, 141).find((item) => item.id === 'b')).toMatchObject({ latitude: 36, longitude: 141, original: false }));
  it('keeps a point pause when moving it', () => expect(movePoint(route.map((item) => item.id === 'b' ? { ...item, pauseSeconds: 3 } : item), 'b', 36, 141).find((item) => item.id === 'b')?.pauseSeconds).toBe(3));
  it('supports undo and redo', () => {
    let state = historyReducer(emptyHistory, { type: 'load', points: route });
    const edited = deletePoint(route, 'b');
    state = historyReducer(state, { type: 'commit', points: edited });
    state = historyReducer(state, { type: 'undo' });
    expect(state.present).toEqual(route);
    state = historyReducer(state, { type: 'redo' });
    expect(state.present).toEqual(edited);
  });

  it('keeps pause changes in undo and redo history', () => {
    const route = [point('a', 35, 139), point('b', 36, 140)];
    let state = historyReducer(emptyHistory, { type: 'load', points: route });
    state = historyReducer(state, { type: 'commit', points: route.map((item) => item.id === 'b' ? { ...item, pauseSeconds: 3 } : item) });
    expect(state.present[1].pauseSeconds).toBe(3);
    state = historyReducer(state, { type: 'undo' });
    expect(state.present[1].pauseSeconds).toBeUndefined();
    state = historyReducer(state, { type: 'redo' });
    expect(state.present[1].pauseSeconds).toBe(3);
  });
});

describe('balloon pointer capture', () => {
  class Target extends EventTarget {
    dataset: Record<string, string> = {};
    captured = new Set<number>();
    setPointerCapture(id: number) { this.captured.add(id); }
    hasPointerCapture(id: number) { return this.captured.has(id); }
    releasePointerCapture(id: number) { this.captured.delete(id); }
  }
  const pointer = (type: string, x: number, y: number) => Object.assign(new Event(type, { cancelable: true }), { pointerId: 1, button: 0, isPrimary: true, clientX: x, clientY: y });
  it.each([0.5, 360 / 1920])('commits one logical placement per mouse/touch drag at scale %s', (scale) => {
    const target = new Target();
    const preview = vi.fn();
    const commit = vi.fn();
    const cleanup = bindFrameBalloonDrag(target as unknown as HTMLButtonElement, () => ({ left: 900, top: 400, width: 120, height: 80 }), () => scale,
      (center) => ({ x: center.x / 1920, y: center.y / 1080 }), preview, commit);
    target.dispatchEvent(pointer('pointerdown', 100, 100));
    expect(target.hasPointerCapture(1)).toBe(true);
    target.dispatchEvent(pointer('pointermove', 100 + 192 * scale, 100 + 108 * scale));
    target.dispatchEvent(pointer('pointerup', 100 + 192 * scale, 100 + 108 * scale));
    expect(commit).toHaveBeenCalledOnce();
    expect(commit.mock.calls[0][0].x).toBeCloseTo(0.6);
    expect(commit.mock.calls[0][0].y).toBeCloseTo(548 / 1080);
    expect(target.hasPointerCapture(1)).toBe(false);
    cleanup();
  });
  it.each(['pointercancel', 'lostpointercapture'])('restores the saved position on %s without history changes', (event) => {
    const target = new Target();
    const preview = vi.fn();
    const commit = vi.fn();
    const cleanup = bindFrameBalloonDrag(target as unknown as HTMLButtonElement, () => ({ left: 900, top: 400, width: 120, height: 80 }), () => 0.5,
      (center) => ({ x: center.x / 1920, y: center.y / 1080 }), preview, commit);
    target.dispatchEvent(pointer('pointerdown', 100, 100));
    target.dispatchEvent(pointer('pointermove', 160, 100));
    target.dispatchEvent(pointer(event, 160, 100));
    expect(commit).not.toHaveBeenCalled();
    expect(preview).toHaveBeenLastCalledWith(null);
    expect(target.hasPointerCapture(1)).toBe(false);
    cleanup();
  });
});
