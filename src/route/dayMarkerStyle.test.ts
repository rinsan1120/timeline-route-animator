import { placedPopupRect, popupDisplayScale } from '../popup/placement';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DAY_MARKER_COLORS, dayMarkerColors, dayMarkerConnector, dayMarkerEditingLayout, dayMarkerEditingStyle, dayMarkerLayout, dayMarkerStyle } from './dayMarkerStyle';
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
      expect(layout.width).toBe(230);
      expect(layout.height).toBe(121);
      expect(layout.rows.map(row => row.fontSize)).toEqual([24, 17, 19]);
      expect(layout.style).toMatchObject({ border: 3.4, connectorWidth: 3.4, connectorLength: 30,
        anchorRadius: 5, anchorBorder: 3.4, manualConnectorWidth: 6.8, manualAnchorRadius: 8.5,
        shadowBlur: 24, shadowOffsetY: 6.8 });
      const rect = { left: 100, top: 100, width: layout.width, height: layout.height };
      const connector = dayMarkerConnector(rect, { x: 150, y: 220 }, false, false, layout.style);
      expect(connector).toMatchObject({ start: { x: 150, y: 221 }, end: { x: 150, y: 251 },
        dot: { x: 150, y: 255 }, width: 3.4, radius: 5 });
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
    expect(dayMarkerLayout({ dayNumber: 1 }, measureContext()).height).toBe(69);
  });
});


it('scales all editing dimensions without changing video layout or placement coordinates', () => {
  const context = measureContext();
  const reference = { width: 360, height: 800 };
  const displayScale = popupDisplayScale(reference.width, reference.height);
  const placement = Object.freeze({ offsetX: 20, offsetY: -40 });
  const anchor = { x: 180, y: 400 };
  for (const data of [{ dayNumber: 1 }, { dayNumber: 3, date: '2026-09-03' }, marker]) {
    const video = dayMarkerLayout(data, context);
    const baseline = dayMarkerEditingStyle();
    for (const scale of [0.75, 1, 1.25, 1.5, 1.75]) {
      const editing = dayMarkerEditingLayout(data, context, reference, scale);
      for (const key of Object.keys(baseline) as (keyof typeof baseline)[]) {
        expect(editing.style[key] * displayScale).toBeCloseTo(baseline[key] *
          (key === 'margin' || key === 'bottomMargin' ? 1 : scale));
      }
      const width = editing.width * displayScale;
      const height = editing.height * displayScale;
      expect(Math.abs(width - 138 * scale)).toBeLessThanOrEqual(1);
      const rect = placedPopupRect(anchor, placement, width, height, 360, 746, 8, displayScale);
      // Existing drag serialization uses actual panel center and only the video display scale.
      expect((rect.left + width / 2 - anchor.x) / displayScale).toBeCloseTo(placement.offsetX);
      expect((rect.top + height / 2 - anchor.y) / displayScale).toBeCloseTo(placement.offsetY);
      const edge = placedPopupRect({ x: 359, y: 799 }, placement, width, height, 360, 746, 8, displayScale);
      expect(edge.left + width).toBeLessThanOrEqual(352);
      expect(edge.top + height).toBeLessThanOrEqual(746);
      expect(dayMarkerLayout(data, context)).toEqual(video);
    }
  }
});
