import { useLayoutEffect, useRef } from 'react';
import { bindFrameBalloonDrag } from '../popup/frameDrag';
import type { BalloonFramePosition } from '../popup/placement';
import { annotationFramePosition, annotationLayout } from '../route/annotationCanvas';
import type { AnnotationStyle } from '../route/annotationStyle';
import { VIDEO_VIEWPORT } from './overviewCamera';
import type { PreviewBalloon } from './previewFrameRenderer';
import type { VideoPlayer } from './useVideoPlayer';

interface Props {
  player: VideoPlayer;
  enabled: boolean;
  selectedPointId: string | null;
  annotationStyle: AnnotationStyle;
  viewCancellation: number;
  onSelect: (pointId: string, interaction: BalloonInteraction) => BalloonSelectionResult;
  onCommit: (pointId: string, position: BalloonFramePosition) => void;
}

export type BalloonInteraction = 'focus' | 'drag' | 'drag-confirm' | 'activate';
export type BalloonSelectionResult = boolean | 'selection-only';

function rectStyle(rect: PreviewBalloon['rect']) {
  return { left: `${rect.left / VIDEO_VIEWPORT.width * 100}%`, top: `${rect.top / VIDEO_VIEWPORT.height * 100}%`,
    width: `${rect.width / VIDEO_VIEWPORT.width * 100}%`, height: `${rect.height / VIDEO_VIEWPORT.height * 100}%` };
}

export default function VideoBalloonOverlay(props: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const targetsRef = useRef(new Map<string, HTMLButtonElement>());
  const restoreFocusRef = useRef<string | null>(null);
  const latest = useRef(props);
  latest.current = props;
  const balloons = props.player.balloons;
  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!props.enabled || !container) return;
    // Measurement only; the renderer supplies the actual visible annotations and
    // draws the complete frame. This overlay never paints a second balloon.
    const context = document.createElement('canvas').getContext('2d')!;
    const updateRects = (items: PreviewBalloon[]) => {
      for (const item of items) {
        const target = targetsRef.current.get(item.pointId);
        if (target) Object.assign(target.style, rectStyle(item.rect));
      }
    };
    const bindings = balloons.flatMap((balloon) => {
      const target = targetsRef.current.get(balloon.pointId);
      if (!target) return [];
      return [bindFrameBalloonDrag(target, () => balloon.rect,
        () => container.getBoundingClientRect().width / VIDEO_VIEWPORT.width,
        (center) => annotationFramePosition(annotationLayout(context, { ...balloon.annotation,
          framePosition: { x: center.x / VIDEO_VIEWPORT.width, y: center.y / VIDEO_VIEWPORT.height } }, props.annotationStyle)),
        (position) => {
          const items = latest.current.player.isEditingTarget({ kind: 'balloon', pointId: balloon.pointId }) ? latest.current.player.previewBalloon(position) : [];
          updateRects(items.length ? items : latest.current.player.balloons);
        },
        (position) => { if (latest.current.player.isEditingTarget({ kind: 'balloon', pointId: balloon.pointId })) latest.current.onCommit(balloon.pointId, position); }, {
          threshold: 6, skipUnchanged: true, keepCommittedPreview: true, deferTouchStart: true,
          start: () => {
            if (!latest.current.enabled) return false;
            const selection = latest.current.onSelect(balloon.pointId, 'drag');
            if (!selection) return false;
            if (selection === 'selection-only') return selection;
            if (!latest.current.player.beginBalloonEdit(balloon.pointId)) return false;
            restoreFocusRef.current = balloon.pointId;
            target.focus({ preventScroll: true });
            return true;
          },
          end: (committed) => {
            if (latest.current.player.isEditingTarget({ kind: 'balloon', pointId: balloon.pointId })) latest.current.player.finishBalloonEdit(committed);
            if (!committed) updateRects(latest.current.player.balloons);
          },
          activate: () => { if (latest.current.enabled) latest.current.onSelect(balloon.pointId, 'activate'); },
          blockedMove: () => {
            if (latest.current.enabled && latest.current.onSelect(balloon.pointId, 'drag-confirm')) {
              restoreFocusRef.current = balloon.pointId;
              target.focus({ preventScroll: true });
            }
          },
        })];
    });
    let size = container.getBoundingClientRect();
    const observer = new ResizeObserver(() => {
      const next = container.getBoundingClientRect();
      if (next.width !== size.width || next.height !== size.height) bindings.forEach((binding) => binding.cancel());
      size = next;
    });
    observer.observe(container);
    const cancel = () => bindings.forEach((binding) => binding.cancel());
    const onVisibility = () => { if (document.hidden) cancel(); };
    window.addEventListener('blur', cancel);
    document.addEventListener('visibilitychange', onVisibility);
    const focused = restoreFocusRef.current;
    if (focused && focused === latest.current.selectedPointId
      && (document.activeElement === document.body || container.contains(document.activeElement))) {
      targetsRef.current.get(focused)?.focus({ preventScroll: true });
    }
    return () => {
      observer.disconnect();
      window.removeEventListener('blur', cancel);
      document.removeEventListener('visibilitychange', onVisibility);
      bindings.forEach((cleanup) => cleanup());
    };
  }, [balloons, props.enabled, props.annotationStyle, props.player.editCancellation, props.viewCancellation]);

  if (!props.enabled) return null;
  return <div className="video-balloon-overlay" ref={containerRef} aria-label="映像のバルーン編集">
    {balloons.map((balloon) => <button key={balloon.pointId} type="button" className="video-balloon-hit"
      ref={(target) => { if (target) targetsRef.current.set(balloon.pointId, target); else targetsRef.current.delete(balloon.pointId); }}
      style={rectStyle(balloon.rect)} aria-pressed={props.selectedPointId === balloon.pointId}
      aria-label={`${balloon.annotation.label}のバルーンを選択・移動`}
      onFocus={() => {
        if (props.player.isEditingTarget({ kind: 'balloon', pointId: balloon.pointId })) return;
        if (!props.onSelect(balloon.pointId, 'focus')) {
          const previous = props.selectedPointId && targetsRef.current.get(props.selectedPointId);
          if (previous) previous.focus({ preventScroll: true });
          else targetsRef.current.get(balloon.pointId)?.blur();
          return;
        }
        if (props.player.isEditingBalloon() && !props.player.isEditingTarget({ kind: 'balloon', pointId: balloon.pointId })) props.player.finishBalloonEdit(false);
        restoreFocusRef.current = balloon.pointId;
      }}
      onBlur={(event) => { if (event.relatedTarget instanceof HTMLElement && event.relatedTarget !== document.body
        && !containerRef.current?.contains(event.relatedTarget)) {
        restoreFocusRef.current = null;
        if (props.player.isEditingTarget({ kind: 'balloon', pointId: balloon.pointId })) props.player.finishBalloonEdit(false);
      } }} />)}
  </div>;
}
