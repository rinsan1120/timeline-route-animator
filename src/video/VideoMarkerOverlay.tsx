import { useLayoutEffect, useRef } from 'react';
import { bindFrameBalloonDrag } from '../popup/frameDrag';
import { VIDEO_VIEWPORT } from './overviewCamera';
import { previewMarkerId, type PreviewMarker, type PreviewMarkerPosition, type PreviewMarkerTarget } from './previewFrameRenderer';
import type { VideoPlayer } from './useVideoPlayer';

interface Props {
  player: VideoPlayer;
  enabled: boolean;
  viewCancellation: number;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onCommit: (target: PreviewMarkerTarget, position: PreviewMarkerPosition) => void;
}
const rectStyle = (rect: PreviewMarker['rect']) => ({
  left: `${rect.left / VIDEO_VIEWPORT.width * 100}%`, top: `${rect.top / VIDEO_VIEWPORT.height * 100}%`,
  width: `${rect.width / VIDEO_VIEWPORT.width * 100}%`, height: `${rect.height / VIDEO_VIEWPORT.height * 100}%`,
});

export default function VideoMarkerOverlay(props: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const targetsRef = useRef(new Map<string, HTMLButtonElement>());
  const restoreFocusRef = useRef<string | null>(null);
  const latest = useRef(props);
  latest.current = props;
  const markers = props.player.markers;
  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!props.enabled || !container) return;
    const updateRects = (items: PreviewMarker[]) => {
      for (const item of items) {
        const target = targetsRef.current.get(previewMarkerId(item.target));
        if (target) Object.assign(target.style, rectStyle(item.rect));
      }
    };
    const bindings = markers.flatMap((marker) => {
      const id = previewMarkerId(marker.target), target = targetsRef.current.get(id);
      if (!target) return [];
      return [bindFrameBalloonDrag(target, () => marker.rect,
        () => container.getBoundingClientRect().width / VIDEO_VIEWPORT.width, marker.positionAt,
        (position) => {
          const items = latest.current.player.isEditingTarget(marker.target) ? latest.current.player.previewMarker(position) : [];
          updateRects(items.length ? items : latest.current.player.markers);
        }, (position) => { if (latest.current.player.isEditingTarget(marker.target)) latest.current.onCommit(marker.target, position); }, {
          threshold: 6, skipUnchanged: true, keepCommittedPreview: true, deferTouchStart: true,
          start: () => {
            if (!latest.current.enabled || !latest.current.player.beginMarkerEdit(marker.target)) return false;
            latest.current.onSelect(id);
            target.focus({ preventScroll: true });
            return true;
          },
          end: (committed) => {
            if (latest.current.player.isEditingTarget(marker.target)) latest.current.player.finishBalloonEdit(committed);
            if (!committed) updateRects(latest.current.player.markers);
          },
          activate: () => {
            if (!latest.current.enabled) return;
            latest.current.onSelect(id);
            restoreFocusRef.current = id;
            target.focus({ preventScroll: true });
          },
        })];
    });
    const cancel = () => bindings.forEach((binding) => binding.cancel());
    const onVisibility = () => { if (document.hidden) cancel(); };
    let size = container.getBoundingClientRect();
    const observer = new ResizeObserver(() => {
      const next = container.getBoundingClientRect();
      if (next.width !== size.width || next.height !== size.height || next.left !== size.left || next.top !== size.top) cancel();
      size = next;
    });
    observer.observe(container);
    const holder = container.closest('.video-frame-holder');
    if (holder) observer.observe(holder);
    window.addEventListener('blur', cancel);
    window.addEventListener('scroll', cancel, true);
    window.addEventListener('orientationchange', cancel);
    document.addEventListener('visibilitychange', onVisibility);
    const focused = restoreFocusRef.current;
    if (focused && focused === latest.current.selectedId
      && (document.activeElement === document.body || container.contains(document.activeElement))) {
      targetsRef.current.get(focused)?.focus({ preventScroll: true });
    }
    return () => {
      observer.disconnect();
      window.removeEventListener('blur', cancel);
      window.removeEventListener('scroll', cancel, true);
      window.removeEventListener('orientationchange', cancel);
      document.removeEventListener('visibilitychange', onVisibility);
      bindings.forEach((cleanup) => cleanup());
    };
  }, [markers, props.enabled, props.player.editCancellation, props.viewCancellation]);

  if (!props.enabled) return null;
  return <div className="video-balloon-overlay" ref={containerRef} aria-label="映像のDAY・端点・距離HUD編集">
    {markers.map((marker) => {
      const id = previewMarkerId(marker.target);
      return <button key={id} type="button" className="video-balloon-hit video-marker-hit"
        ref={(target) => { if (target) targetsRef.current.set(id, target); else targetsRef.current.delete(id); }}
        style={rectStyle(marker.rect)} aria-pressed={props.selectedId === id} aria-label={`${marker.label}を選択・移動`}
        onFocus={() => {
          if (props.player.isEditingBalloon() && !props.player.isEditingTarget(marker.target)) props.player.finishBalloonEdit(false);
          restoreFocusRef.current = id; props.onSelect(id);
        }}
        onBlur={(event) => { if (event.relatedTarget instanceof HTMLElement && event.relatedTarget !== document.body
          && !containerRef.current?.contains(event.relatedTarget)) {
          restoreFocusRef.current = null;
          if (props.player.isEditingTarget(marker.target)) props.player.finishBalloonEdit(false);
        } }} />;
    })}
  </div>;
}
