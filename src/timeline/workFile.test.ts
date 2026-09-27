import { describe, expect, it } from 'vitest';
import { historyReducer, emptyHistory } from '../route/history';
import { deriveDayMarkers } from '../route/tripRoute';
import { PLAN_FILE_FORMAT } from '../plan/planFile';
import { parseWorkFile, serializeWorkFile, WORK_FILE_ERROR, type TimelineWorkState } from './workFile';

const state: TimelineWorkState = {
  points: [
    { id: 'timeline-2', latitude: 35, longitude: 135, timestamp: '2026-09-02T10:00:00+09:00', source: 'timelinePath', original: false, pauseSeconds: 2.5,
      annotation: { label: '休憩地点', placement: { offsetX: -120, offsetY: 80 } } },
    { id: 'manual-added', latitude: 35.1, longitude: 135.1, source: 'manual', original: false },
    { id: 'timeline-4', latitude: 35.2, longitude: 135.2, timestamp: '2026-09-04T11:00:00+09:00', source: 'timelinePath', original: true },
  ],
  startDate: '2026-09-01', endDate: '2026-09-04', from: '08:00', to: '18:00',
  dayMarkerNotes: { '2026-09-02': '宿泊', '2026-09-03': '一時的に未使用の補足' },
  dayMarkerPlacements: { '2026-09-02': { offsetX: 10, offsetY: -40 } },
  endpointMarkerPlacements: { START: { offsetX: -50, offsetY: -30 }, GOAL: { offsetX: 70, offsetY: 60 } },
  annotationStyle: { balloonScale: 1.25, fontScale: 1.5 },
  animationStartPointId: 'manual-added', animationEndPointId: 'timeline-4',
};

describe('Timeline work file', () => {
  it('round-trips edited points, annotations, DAY metadata, placements and range without source JSON', () => {
    const saved = parseWorkFile(serializeWorkFile(state));
    expect(saved).toEqual(state);
    expect(deriveDayMarkers(saved.points, saved.dayMarkerNotes, saved.startDate)).toEqual(
      deriveDayMarkers(state.points, state.dayMarkerNotes, state.startDate));
    expect(deriveDayMarkers(saved.points, saved.dayMarkerNotes, saved.startDate).map((marker) => marker.dayNumber)).toEqual([2, 4]);
    const history = historyReducer(emptyHistory, { type: 'load', points: saved.points });
    expect(history.initial).toEqual(state.points);
    expect(history.past).toEqual([]);
    expect(history.future).toEqual([]);
  });

  it('keeps deletions and further edits through repeated saves and does not include transient data', () => {
    const saved = parseWorkFile(serializeWorkFile(state));
    saved.points = saved.points.filter((point) => point.id !== 'timeline-4');
    saved.points[0].annotation!.label = '変更済み';
    saved.animationStartPointId = null;
    saved.animationEndPointId = null;
    const text = serializeWorkFile({ ...saved, rawPositions: [1], history: { past: [state.points] } } as TimelineWorkState);
    const reloaded = parseWorkFile(text);
    expect(reloaded).toEqual(saved);
    expect(reloaded.points.map((point) => point.id)).toEqual(['timeline-2', 'manual-added']);
    expect(JSON.parse(text)).not.toHaveProperty('rawPositions');
    expect(JSON.parse(text)).not.toHaveProperty('history');
  });

  it.each([
    '{', '{}', JSON.stringify({ semanticSegments: [] }),
    JSON.stringify({ ...state, format: PLAN_FILE_FORMAT, version: 1 }),
  ])('rejects invalid JSON and other file formats', (text) => {
    expect(() => parseWorkFile(text)).toThrow(WORK_FILE_ERROR);
  });

  it.each([
    { version: 2 }, { savedAt: undefined }, { points: [] }, { dayMarkerNotes: undefined },
    { points: [{ ...state.points[0], latitude: 91 }] },
    { points: [{ ...state.points[0], longitude: -181 }] },
    { points: [{ ...state.points[0], source: 'rawSignals' }] },
    { points: [{ ...state.points[0], original: undefined }] },
    { points: [{ ...state.points[0], annotation: { label: '地点', placement: { offsetX: 'bad', offsetY: 0 } } }] },
    { points: [state.points[0], state.points[0]] },
    { animationStartPointId: 'missing' }, { endpointMarkerPlacements: { START: null } },
  ])('rejects malformed work data before restoring state', (changes) => {
    const data = { ...JSON.parse(serializeWorkFile(state)), ...changes };
    expect(() => parseWorkFile(JSON.stringify(data))).toThrow(WORK_FILE_ERROR);
  });
});
