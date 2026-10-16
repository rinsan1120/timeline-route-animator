import { useEffect, useId, useLayoutEffect, useRef, useState, type PointerEvent, type ReactNode } from 'react';
import HelpTip from '../help/HelpTip';

type SheetState = 'closed' | 'half' | 'full';
const STATES: SheetState[] = ['closed', 'half', 'full'];
const STATE_LABELS = { closed: '閉じる', half: '半開き', full: '全開' };

interface MobileBottomSheetProps {
  children: ReactNode;
  steps: readonly [string, string, string];
  resetKey?: string;
}

export default function MobileBottomSheet({ children, steps, resetKey }: MobileBottomSheetProps) {
  const [state, setState] = useState<SheetState>('closed');
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  const [mobile, setMobile] = useState(() => window.matchMedia('(max-width: 760px)').matches);
  const panelRef = useRef<HTMLElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const focusedInputRef = useRef<HTMLElement | null>(null);
  const gestureRef = useRef<{ id: number; x: number; y: number } | null>(null);
  const suppressClickRef = useRef(false);
  const contentId = useId();

  useEffect(() => {
    setState('closed');
    setKeyboardOpen(false);
    focusedInputRef.current = null;
  }, [resetKey]);
  useEffect(() => {
    const media = window.matchMedia('(max-width: 760px)');
    const update = () => setMobile(media.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  useLayoutEffect(() => {
    const panel = panelRef.current!;
    const workspace = panel.parentElement!;
    // Share the actual sheet height with map overlays without resizing the map.
    const update = () => workspace.style.setProperty('--mobile-sheet-height', `${panel.getBoundingClientRect().height}px`);
    const observer = new ResizeObserver(update);
    observer.observe(panel);
    update();
    return () => { observer.disconnect(); workspace.style.removeProperty('--mobile-sheet-height'); };
  }, []);

  useEffect(() => {
    const shell = panelRef.current?.closest<HTMLElement>('.app-shell');
    const panel = panelRef.current;
    const content = contentRef.current;
    const viewport = window.visualViewport;
    if (!shell || !panel || !content || !mobile) return;
    let normalViewportHeight = viewport?.height ?? window.innerHeight;
    let blurTimer: number | null = null;
    let blurPending = false;
    let frame = 0;

    const scheduleCorrection = () => {
      if (frame) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        frame = 0;
        const input = focusedInputRef.current;
        if (!input || !content.isConnected) return;
        const contentRect = content.getBoundingClientRect();
        const visualTop = viewport?.offsetTop ?? 0;
        const visualBottom = visualTop + (viewport?.height ?? window.innerHeight);
        const visibleTop = Math.max(contentRect.top, visualTop);
        const visibleBottom = Math.min(contentRect.bottom, visualBottom);
        const inputRect = input.getBoundingClientRect();
        let delta = 0;
        if (inputRect.bottom > visibleBottom) delta = inputRect.bottom - visibleBottom + 8;
        else if (inputRect.top < visibleTop) delta = inputRect.top - visibleTop - 8;
        if (delta) content.scrollTop += delta;
      });
    };

    const updateViewport = () => {
      if (viewport) {
        shell.style.setProperty('--mobile-viewport-height', `${viewport.height}px`);
        shell.style.setProperty('--mobile-viewport-offset-top', `${viewport.offsetTop}px`);
        if (focusedInputRef.current) {
          // Keep the expanded sheet through the click that caused the input to blur.
          if (!blurPending) setKeyboardOpen(viewport.height < normalViewportHeight - 1);
        } else {
          normalViewportHeight = viewport.height;
        }
      }
      scheduleCorrection();
    };
    const isTextEntry = (target: HTMLElement) => target.matches(
      'textarea, input:not([type]), input[type="text"], input[type="search"], input[type="email"], input[type="url"], input[type="tel"], input[type="password"], [contenteditable="true"]',
    );
    const onFocusIn = (event: FocusEvent) => {
      const target = event.target;
      if (!(target instanceof HTMLElement) || !content.contains(target) || !isTextEntry(target)) return;
      if (blurTimer !== null) window.clearTimeout(blurTimer);
      blurTimer = null;
      blurPending = false;
      focusedInputRef.current = target;
      scheduleCorrection();
    };
    const onFocusOut = (event: FocusEvent) => {
      if (event.target !== focusedInputRef.current) return;
      blurPending = true;
      if (blurTimer !== null) window.clearTimeout(blurTimer);
      // Let the pointer's click complete before restoring the previous sheet height.
      blurTimer = window.setTimeout(() => {
        blurTimer = null;
        blurPending = false;
        const active = document.activeElement;
        if (active instanceof HTMLElement && content.contains(active) && isTextEntry(active)) {
          focusedInputRef.current = active;
          scheduleCorrection();
          return;
        }
        focusedInputRef.current = null;
        setKeyboardOpen(false);
      }, 350);
    };

    const observer = new ResizeObserver(scheduleCorrection);
    observer.observe(panel);
    observer.observe(content);
    panel.addEventListener('focusin', onFocusIn);
    panel.addEventListener('focusout', onFocusOut);
    // Also follow keyboards on browsers where dvh alone does not shrink.
    updateViewport();
    viewport?.addEventListener('resize', updateViewport);
    viewport?.addEventListener('scroll', updateViewport);
    return () => {
      observer.disconnect();
      panel.removeEventListener('focusin', onFocusIn);
      panel.removeEventListener('focusout', onFocusOut);
      viewport?.removeEventListener('resize', updateViewport);
      viewport?.removeEventListener('scroll', updateViewport);
      if (blurTimer !== null) window.clearTimeout(blurTimer);
      if (frame) cancelAnimationFrame(frame);
      focusedInputRef.current = null;
      setKeyboardOpen(false);
      shell.style.removeProperty('--mobile-viewport-height');
      shell.style.removeProperty('--mobile-viewport-offset-top');
    };
  }, [mobile]);

  const move = (direction: number) => setState((current) => STATES[Math.max(0, Math.min(2, STATES.indexOf(current) + direction))]);
  const finishGesture = (event: PointerEvent<HTMLButtonElement>) => {
    const gesture = gestureRef.current;
    if (!gesture || gesture.id !== event.pointerId) return;
    gestureRef.current = null;
    const delta = event.clientY - gesture.y;
    const moved = Math.hypot(event.clientX - gesture.x, delta) > 10;
    suppressClickRef.current = moved;
    if (Math.abs(delta) >= 30 && Math.abs(delta) > Math.abs(event.clientX - gesture.x)) move(delta < 0 ? 1 : -1);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  return <aside ref={panelRef} className="control-panel mobile-bottom-sheet" data-sheet-state={state} data-keyboard-open={keyboardOpen || undefined}>
    <div className="mobile-sheet-header">
      <button type="button" className="mobile-sheet-handle" aria-expanded={state !== 'closed'} aria-controls={contentId}
        aria-label={`設定パネル：${STATE_LABELS[state]}。タップで開閉、上下矢印キーで高さを変更`}
        onPointerDown={(event) => {
          if (!event.isPrimary || event.button !== 0) return;
          suppressClickRef.current = false;
          gestureRef.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerUp={finishGesture}
        onPointerCancel={() => { gestureRef.current = null; suppressClickRef.current = true; }}
        onLostPointerCapture={() => {
          if (gestureRef.current) suppressClickRef.current = true;
          gestureRef.current = null;
        }}
        onClick={(event) => {
          if (event.detail !== 0 && suppressClickRef.current) { suppressClickRef.current = false; return; }
          setState((current) => current === 'closed' ? 'half' : 'closed');
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowUp' || event.key === 'ArrowDown') { event.preventDefault(); move(event.key === 'ArrowUp' ? 1 : -1); }
          if (event.key === 'Home' || event.key === 'Escape') { event.preventDefault(); setState('closed'); }
          if (event.key === 'End') { event.preventDefault(); setState('full'); }
        }}>
        <span className="mobile-sheet-grip" aria-hidden="true" />
        <span>設定パネル <small>{STATE_LABELS[state]}</small></span>
      </button>
      <div className="mobile-sheet-navigation" hidden={state === 'closed'}>
        <nav aria-label="設定セクションへ移動">{steps.map((title, index) => <button type="button" key={index}
          aria-label={`Step 0${index + 1}：${title}へ移動`}
          onClick={() => {
            const content = contentRef.current;
            const section = content?.querySelectorAll<HTMLElement>(':scope > .panel-section')[index];
            if (content && section) content.scrollTo({ top: section.getBoundingClientRect().top - content.getBoundingClientRect().top + content.scrollTop });
          }}>Step 0{index + 1}</button>)}</nav>
        <HelpTip helpKey="mobileBottomSheet" />
      </div>
    </div>
    <div ref={contentRef} id={contentId} className="mobile-sheet-content" inert={mobile && state === 'closed'}>
      {children}
    </div>
  </aside>;
}
