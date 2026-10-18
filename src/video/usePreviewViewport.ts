import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type MouseEvent as ReactMouseEvent } from 'react';

interface Point { x: number; y: number }
interface View extends Point { scale: number }
interface Options {
  enabled: boolean;
  isTarget: (target: EventTarget, x: number, y: number) => boolean;
  interrupt: () => void;
}

const INITIAL_VIEW: View = { scale: 1, x: 0, y: 0 };
function clampView(view: View): View {
  const scale = Number.isFinite(view.scale) ? Math.max(1, Math.min(3, view.scale)) : 1;
  const limit = 1 - scale;
  return { scale, x: Number.isFinite(view.x) ? Math.max(limit, Math.min(0, view.x)) : 0,
    y: Number.isFinite(view.y) ? Math.max(limit, Math.min(0, view.y)) : 0 };
}

// All offsets are fractions of the fitted viewport, independent of video pixels.
export function usePreviewViewport(options: Options) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const latest = useRef(options);
  latest.current = options;
  const [view, setView] = useState(INITIAL_VIEW);
  const viewRef = useRef(view);
  const [cancellation, setCancellation] = useState(0);
  const pointers = useRef(new Map<number, Point>());
  const locked = useRef(false);
  const suppressClick = useRef(false);
  const single = useRef<{ id: number; start: Point; view: View; background: boolean; moved: boolean } | null>(null);
  const pinch = useRef<{ distance: number; center: Point; view: View } | null>(null);
  const hover = useRef<Point | null>(null);
  const trackpad = useRef<{ scale: number; center: Point; view: View } | null>(null);
  const update = (next: View) => { viewRef.current = clampView(next); setView(viewRef.current); };
  const interrupt = () => { latest.current.interrupt(); setCancellation((value) => value + 1); };
  const release = (id: number) => {
    const viewport = viewportRef.current;
    if (viewport?.hasPointerCapture(id)) viewport.releasePointerCapture(id);
  };
  const cancel = () => {
    const ids = [...pointers.current.keys()];
    if (ids.length) suppressClick.current = true;
    pointers.current.clear();
    locked.current = false;
    single.current = null;
    pinch.current = null;
    trackpad.current = null;
    ids.forEach(release);
    interrupt();
  };
  const local = (point: Point): Point | null => {
    const rect = viewportRef.current?.getBoundingClientRect();
    return rect && rect.width > 0 && rect.height > 0
      ? { x: (point.x - rect.left) / rect.width, y: (point.y - rect.top) / rect.height } : null;
  };
  const pair = () => {
    const [a, b] = [...pointers.current.values()];
    if (!a || !b) return null;
    const center = local({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
    const distance = Math.hypot(b.x - a.x, b.y - a.y);
    return center && distance > 0 ? { center, distance } : null;
  };
  const consume = (event: ReactPointerEvent) => { event.preventDefault(); event.stopPropagation(); };
  const ignored = (target: EventTarget) => target instanceof Element && !!target.closest('.video-preview-reset');

  const onPointerDownCapture = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!latest.current.enabled || event.button !== 0 || !pointers.current.size && !event.isPrimary) return;
    if (!pointers.current.size) {
      suppressClick.current = false;
      if (ignored(event.target)) return;
    }
    const point = { x: event.clientX, y: event.clientY };
    hover.current = point;
    pointers.current.set(event.pointerId, point);
    if (pointers.current.size > 1 || locked.current) {
      if (!locked.current) { locked.current = true; suppressClick.current = true; interrupt(); }
      single.current = null;
      const next = pair();
      pinch.current = next ? { ...next, view: viewRef.current } : null;
      // Transfer any child capture; subsequent events stay in this viewport.
      for (const id of pointers.current.keys()) event.currentTarget.setPointerCapture(id);
      consume(event);
    } else {
      single.current = { id: event.pointerId, start: point, view: viewRef.current,
        background: !latest.current.isTarget(event.target, point.x, point.y), moved: false };
    }
  };
  const onPointerMoveCapture = (event: ReactPointerEvent<HTMLDivElement>) => {
    hover.current = { x: event.clientX, y: event.clientY };
    if (!pointers.current.has(event.pointerId)) return;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (locked.current) {
      consume(event);
      const next = pair();
      const start = pinch.current;
      if (!next) return;
      if (!start) { pinch.current = { ...next, view: viewRef.current }; return; }
      const scale = Math.max(1, Math.min(3, start.view.scale * next.distance / start.distance));
      update({ scale, x: next.center.x - (start.center.x - start.view.x) * scale / start.view.scale,
        y: next.center.y - (start.center.y - start.view.y) * scale / start.view.scale });
      return;
    }
    const start = single.current;
    if (!start || start.id !== event.pointerId || !start.background) return;
    if (!start.moved && Math.hypot(event.clientX - start.start.x, event.clientY - start.start.y) < 6) return;
    if (!start.moved) {
      start.moved = true;
      suppressClick.current = true;
      interrupt();
      event.currentTarget.setPointerCapture(event.pointerId);
    }
    consume(event);
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) update({ ...start.view,
      x: start.view.x + (event.clientX - start.start.x) / rect.width,
      y: start.view.y + (event.clientY - start.start.y) / rect.height });
  };
  const onPointerUpCapture = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(event.pointerId)) return;
    const suppress = locked.current || !!single.current?.background && !!single.current.moved;
    pointers.current.delete(event.pointerId);
    if (locked.current) {
      const next = pair();
      pinch.current = next ? { ...next, view: viewRef.current } : null;
    }
    if (!pointers.current.size) { locked.current = false; single.current = null; pinch.current = null; }
    if (suppress) { release(event.pointerId); consume(event); }
  };
  const onPointerCancelCapture = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(event.pointerId)) return;
    cancel();
  };
  const onLostPointerCaptureCapture = (event: ReactPointerEvent<HTMLDivElement>) => {
    // Child capture loss during transfer must not abort the new viewport gesture.
    if (event.target !== event.currentTarget && (locked.current || single.current?.background && single.current.moved)) return;
    if (pointers.current.has(event.pointerId)) cancel();
  };

  const onClickCapture = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (suppressClick.current && (event.detail !== 0 || 'pointerType' in event.nativeEvent && event.nativeEvent.pointerType)) {
      event.preventDefault(); event.stopPropagation();
    }
  };
  const handlers = { onPointerDownCapture, onPointerMoveCapture, onPointerUpCapture,
    onPointerCancelCapture, onLostPointerCaptureCapture, onClickCapture };
  const controls = useRef({ cancel, interrupt, update, local });
  controls.current = { cancel, interrupt, update, local };
  useLayoutEffect(() => {
    if (!options.enabled) controls.current.cancel();
  }, [options.enabled]);
  useEffect(() => {
    const viewport = viewportRef.current!;
    const wheel = (event: WheelEvent) => {
      if (!event.ctrlKey || !latest.current.enabled || ignored(event.target!)) return;
      event.preventDefault();
      if (pointers.current.size || trackpad.current || !Number.isFinite(event.deltaY)) return;
      const anchor = controls.current.local({ x: event.clientX, y: event.clientY });
      if (!anchor) return;
      const current = viewRef.current;
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? viewport.clientHeight : 1;
      const scale = Math.max(1, Math.min(3, current.scale * Math.exp(Math.max(-4, Math.min(4, -event.deltaY * unit * 0.002)))));
      if (scale === current.scale) return;
      controls.current.interrupt();
      controls.current.update({ scale, x: anchor.x - (anchor.x - current.x) * scale / current.scale,
        y: anchor.y - (anchor.y - current.y) * scale / current.scale });
    };
    // Safari can supply native gesture events instead of Ctrl+wheel.
    const gesture = (event: Event) => {
      const input = event as Event & { scale: number; clientX?: number; clientY?: number };
      if (!latest.current.enabled || !Number.isFinite(input.scale) || input.scale <= 0) return;
      if (pointers.current.size) { event.preventDefault(); return; }
      const point = Number.isFinite(input.clientX) && Number.isFinite(input.clientY)
        ? { x: input.clientX!, y: input.clientY! } : hover.current;
      const center = point && controls.current.local(point);
      if (!center) return;
      if (event.type === 'gesturestart') {
        controls.current.interrupt();
        trackpad.current = { scale: input.scale, center, view: viewRef.current };
      }
      const start = trackpad.current;
      if (!start) return;
      event.preventDefault();
      const scale = Math.max(1, Math.min(3, start.view.scale * input.scale / start.scale));
      controls.current.update({ scale, x: center.x - (start.center.x - start.view.x) * scale / start.view.scale,
        y: center.y - (start.center.y - start.view.y) * scale / start.view.scale });
    };
    const gestureEnd = (event: Event) => {
      if (trackpad.current) { event.preventDefault(); trackpad.current = null; }
    };
    const cancel = () => controls.current.cancel();
    const scroll = () => { if (pointers.current.size) cancel(); };
    const visibility = () => { if (document.hidden) cancel(); };
    viewport.addEventListener('wheel', wheel, { passive: false });
    viewport.addEventListener('gesturestart', gesture, { passive: false });
    viewport.addEventListener('gesturechange', gesture, { passive: false });
    viewport.addEventListener('gestureend', gestureEnd, { passive: false });
    window.addEventListener('blur', cancel);
    window.addEventListener('orientationchange', cancel);
    window.addEventListener('scroll', scroll, true);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      viewport.removeEventListener('wheel', wheel);
      viewport.removeEventListener('gesturestart', gesture);
      viewport.removeEventListener('gesturechange', gesture);
      viewport.removeEventListener('gestureend', gestureEnd);
      window.removeEventListener('blur', cancel);
      window.removeEventListener('orientationchange', cancel);
      window.removeEventListener('scroll', scroll, true);
      document.removeEventListener('visibilitychange', visibility);
      const ids = [...pointers.current.keys()];
      pointers.current.clear();
      ids.forEach(release);
    };
  }, []);
  useLayoutEffect(() => {
    const viewport = viewportRef.current!;
    let rect = viewport.getBoundingClientRect();
    const observer = new ResizeObserver(() => {
      const next = viewport.getBoundingClientRect();
      if (next.width !== rect.width || next.height !== rect.height) {
        controls.current.cancel();
        controls.current.update(viewRef.current);
      }
      rect = next;
    });
    observer.observe(viewport);
    return () => observer.disconnect();
  }, []);

  return { viewportRef, handlers, cancellation, scale: view.scale,
    transform: `translate(${view.x * 100}%, ${view.y * 100}%) scale(${view.scale})`,
    reset: () => { cancel(); update(INITIAL_VIEW); } };
}
