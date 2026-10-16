export interface AnnotationStyle {
  /** Video JSON compatibility only; normalized to 1. Spot images keep their existing scale. */
  balloonScale: number;
  fontScale: number;
  minimumWidth?: number;
  minimumWidthForDay?: boolean;
  minimumWidthForBalloon?: boolean;
}

export const DEFAULT_ANNOTATION_STYLE: Required<AnnotationStyle> = {
  balloonScale: 1, fontScale: 1, minimumWidth: 280, minimumWidthForDay: false, minimumWidthForBalloon: false,
};

export function parseAnnotationStyle(value: unknown): Required<AnnotationStyle> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('バルーン表示設定が不正です。');
  const data = value as Record<string, unknown>;
  const validScale = (scale: unknown): scale is number => typeof scale === 'number' && Number.isFinite(scale) && scale >= 0.5 && scale <= 2;
  if (!validScale(data.balloonScale) || !validScale(data.fontScale)
    || (data.minimumWidth !== undefined && (typeof data.minimumWidth !== 'number' || !Number.isFinite(data.minimumWidth) || data.minimumWidth < 160 || data.minimumWidth > 440))
    || (data.minimumWidthForDay !== undefined && typeof data.minimumWidthForDay !== 'boolean')
    || (data.minimumWidthForBalloon !== undefined && typeof data.minimumWidthForBalloon !== 'boolean')) throw new Error('バルーン表示設定が不正です。');
  return { balloonScale: 1, fontScale: data.fontScale,
    minimumWidth: typeof data.minimumWidth === 'number' ? data.minimumWidth : DEFAULT_ANNOTATION_STYLE.minimumWidth,
    minimumWidthForDay: data.minimumWidthForDay === true,
    minimumWidthForBalloon: data.minimumWidthForBalloon === true };
}

export function annotationMinimumWidth(style: AnnotationStyle, target: 'day' | 'balloon') {
  return (target === 'day' ? style.minimumWidthForDay : style.minimumWidthForBalloon)
    ? style.minimumWidth ?? DEFAULT_ANNOTATION_STYLE.minimumWidth : 0;
}

export const ANNOTATION_BASE_METRICS = { fontSize: 28, paddingX: 20, paddingY: 16 } as const;
