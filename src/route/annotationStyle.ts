export interface AnnotationStyle {
  balloonScale: number;
  fontScale: number;
}

export const DEFAULT_ANNOTATION_STYLE: AnnotationStyle = { balloonScale: 1, fontScale: 1 };

export const ANNOTATION_BASE_METRICS = { fontSize: 28, paddingX: 20, paddingY: 16 } as const;
