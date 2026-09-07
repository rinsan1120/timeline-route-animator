import { describe, expect, it } from 'vitest';
import { buildTimelineIndex, extractTimelineRange, getAvailableDates, parseCoordinate } from './parser';

const document = {
  semanticSegments: [
    { activity: { topCandidate: { type: 'WALKING' } }, timelinePath: [{ point: '35.2°, 139.2°', time: '2026-08-08T18:00:00.000+09:00' }] },
    { activity: { topCandidate: { type: 'IN_TRAIN' } }, timelinePath: [{ point: '35.1°, 139.1°', time: '2026-08-08T06:00:00.000+09:00' }] },
    { activity: { topCandidate: { type: 'MOTORCYCLING' } }, timelinePath: [{ point: '36°, 140°', time: '2026-08-09T09:00:00.000+09:00' }] },
  ],
  rawSignals: [{ position: { LatLng: '35.5°, 139.5°', timestamp: '2026-08-08T07:00:00.000+09:00', source: 'CELL' } }],
};

describe('Timeline parser', () => {
  it('parses Google coordinate strings', () => expect(parseCoordinate('35.6064076°, 139.7003083°')).toEqual({ latitude: 35.6064076, longitude: 139.7003083 }));
  it('lists dates', () => expect(getAvailableDates(buildTimelineIndex(document))).toEqual(['2026-08-08', '2026-08-09']));
  it('extracts one time range', () => expect(extractTimelineRange(buildTimelineIndex(document), '2026-08-08', '05:00', '12:00').routePoints).toHaveLength(1));
  it('sorts timelinePath chronologically', () => expect(extractTimelineRange(buildTimelineIndex(document), '2026-08-08', '00:00', '23:59').routePoints.map((point) => point.latitude)).toEqual([35.1, 35.2]));
  it('never filters route data by activity type', () => expect(extractTimelineRange(buildTimelineIndex(document), '2026-08-08', '00:00', '23:59').routePoints).toHaveLength(2));
  it('keeps rawSignals separate from route points', () => {
    const result = extractTimelineRange(buildTimelineIndex(document), '2026-08-08', '00:00', '23:59');
    expect(result.routePoints).toHaveLength(2);
    expect(result.rawPositions).toHaveLength(1);
  });
});
