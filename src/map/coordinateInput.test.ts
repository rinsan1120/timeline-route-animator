import { describe, expect, it } from 'vitest';
import { normalizePosition, parseCoordinateInput } from './coordinateInput';

describe('local coordinate input compatibility', () => {
  it.each([
    ['35.681236, 139.767125', 35.681236, 139.767125],
    [' +.5 , -139. ', 0.5, -139], ['-90,180', -90, 180],
  ])('keeps valid decimal syntax: %s', (value, latitude, longitude) => {
    expect(parseCoordinateInput(String(value))).toEqual({ latitude, longitude });
  });
  it.each(['91,139', '35,-181', '9999999999999999999999999999999999999999,139'])('rejects out-of-range coordinates: %s', (value) => {
    expect(parseCoordinateInput(value)).toBeNull();
  });
  it.each(['小作', '草津温泉', '施設名,支店', '35,139 text', ''])('rejects invalid coordinate syntax: %s', (value) => {
    expect(parseCoordinateInput(value)).toBeNull();
  });
});

describe('coordinate validation', () => {
  it('accepts numeric and string coordinates', () => {
    expect(normalizePosition(35.5, 139.5)).toEqual({ latitude: 35.5, longitude: 139.5 });
    expect(normalizePosition('35.5', '139.5')).toEqual({ latitude: 35.5, longitude: 139.5 });
  });
  it.each([[NaN, 139], [35, Infinity], [91, 139], [35, -181], ['', 139], [null, 139], [true, 139], ['invalid', 139]])('rejects invalid coordinates %s, %s', (lat, lng) => {
    expect(normalizePosition(lat, lng)).toBeNull();
  });
});
