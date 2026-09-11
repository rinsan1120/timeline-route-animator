import { afterEach, describe, expect, it, vi } from 'vitest';
import { DAY_MARKER_COLORS, dayMarkerColors, dayMarkerConnector, dayMarkerEditingLayout, dayMarkerLayout, dayMarkerStyle } from './dayMarkerStyle';
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


const marker = { dayNumber: 10, date: '2026-09-10', note: '宿泊地' };
function measureContext() {
  const context = {
    font: '',
    measureText(text: string) {
      return { width: Array.from(text).length * Number(/([\d.]+)px/.exec(this.font)?.[1] ?? 14) * 0.5 };
    },
  };
  return context as unknown as CanvasRenderingContext2D;
}

describe('DAY marker video coordinates', () => {
  afterEach(() => vi.unstubAllGlobals());

  it.each([[1920, 1080, 1], [360, 800, 3], [390, 844, 3], [768, 1024, 2], [960, 540, 1]])(
    'keeps all logical dimensions independent of a %i x %i device at DPR %i', (width, height, devicePixelRatio) => {
      const expected = dayMarkerLayout(marker, measureContext());
      vi.stubGlobal('window', { innerWidth: width, innerHeight: height, devicePixelRatio });
      const layout = dayMarkerLayout(marker, measureContext());
      expect(layout).toEqual(expected);
      expect(layout.width).toBe(138);
      expect(layout.height).toBe(71);
      expect(layout.rows.map(row => row.fontSize)).toEqual([14, 10, 11]);
      expect(layout.style).toMatchObject({ border: 2, connectorWidth: 2, connectorLength: 18,
        anchorRadius: 3, anchorBorder: 2, manualConnectorWidth: 4, manualAnchorRadius: 5,
        shadowBlur: 14, shadowOffsetY: 4 });
      const rect = { left: 100, top: 100, width: layout.width, height: layout.height };
      const connector = dayMarkerConnector(rect, { x: 150, y: 220 }, false, false, layout.style);
      expect(connector).toMatchObject({ start: { x: 150, y: 171 }, end: { x: 150, y: 189 },
        dot: { x: 150, y: 191 }, width: 2, radius: 3 });
    },
  );

  it('retains editing CSS sizes without affecting the video layout', () => {
    const context = measureContext();
    const video = dayMarkerLayout(marker, context);
    for (const width of [360, 768, 960, 1920]) {
      const height = width * 9 / 16;
      const scale = width / 1920;
      const editing = dayMarkerEditingLayout(marker, context, { width, height });
      expect(editing.width * scale).toBeCloseTo(138);
      expect(editing.style.dayFont * scale).toBeCloseTo(14);
      expect(editing.style.border * scale).toBeCloseTo(2);
      expect(dayMarkerLayout(marker, context)).toEqual(video);
    }
  });

  it('uses fixed logical limits for long notes and optional rows', () => {
    const layout = dayMarkerLayout({ ...marker, note: '長い補足文'.repeat(40) }, measureContext());
    expect(layout.rows[2].text.endsWith('…')).toBe(true);
    expect(layout.rows[2].textWidth).toBeLessThanOrEqual(dayMarkerStyle().noteMaxWidth);
    expect(dayMarkerLayout({ dayNumber: 1 }, measureContext()).height).toBe(41);
  });
});
