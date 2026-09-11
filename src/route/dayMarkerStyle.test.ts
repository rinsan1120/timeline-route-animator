import { describe, expect, it } from 'vitest';
import { DAY_MARKER_COLORS, dayMarkerColors } from './dayMarkerStyle';
import { dayRouteColor } from './dayRouteColor';

describe('DAY marker colors', () => {
  it('preserves the existing colors when DAY route colors are disabled', () => {
    expect(dayMarkerColors(2, false)).toBe(DAY_MARKER_COLORS);
  });

  it('uses the matching route color for the outline and anchor', () => {
    const colors = dayMarkerColors(3, true);
    expect(colors.outline).toBe(dayRouteColor(3));
    expect(colors.anchor).toBe(dayRouteColor(3));
  });

  it('uses the existing palette cycle after DAY 10', () => {
    const colors = dayMarkerColors(11, true);
    expect(colors.outline).toBe(dayRouteColor(11));
    expect(colors.anchor).toBe(dayRouteColor(11));
  });

  it('preserves the background, text, date, and shadow colors when enabled', () => {
    const colors = dayMarkerColors(5, true);
    expect(colors.background).toBe(DAY_MARKER_COLORS.background);
    expect(colors.text).toBe(DAY_MARKER_COLORS.text);
    expect(colors.date).toBe(DAY_MARKER_COLORS.date);
    expect(colors.shadow).toBe(DAY_MARKER_COLORS.shadow);
  });
});
