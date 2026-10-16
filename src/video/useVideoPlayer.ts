import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { getFrameIndexAtTime, type FramePlan, type FrameState } from './frameTimeline';
import { createPreviewFrameRenderer, type PreviewBalloon, type PreviewFrameOptions } from './previewFrameRenderer';
import type { BalloonFramePosition } from '../popup/placement';
import type { VideoEvent } from './videoEvents';

// UI playback state is deliberately separate from legacy previewProgress and JSON.
export function useVideoPlayer(options: PreviewFrameOptions, enabled: boolean, suspended: boolean) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<ReturnType<typeof createPreviewFrameRenderer> | null>(null);
  const releaseRef = useRef<Promise<void>>(Promise.resolve());
  const generationRef = useRef(0);
  const requestEpochRef = useRef(0);
  const rafRef = useRef<number | null>(null);
  const playingRef = useRef(false);
  const retainedFrameRef = useRef(0);
  const requestedFrameRef = useRef(0);
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const requestedOptionsRef = useRef<PreviewFrameOptions | null>(null);
  const initializationFailedRef = useRef<PreviewFrameOptions | null>(null);
  const appliedOptionsRef = useRef(options);
  const retainedPlanRef = useRef<FramePlan | null>(null);
  const retainedTimeRef = useRef(0);
  const eventAnchorRef = useRef<string | null>(null);
  const updatingRef = useRef(false);
  const balloonEditRef = useRef<{ pointId: string; state: FrameState } | null>(null);
  const pendingEventRef = useRef<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [framePlan, setFramePlan] = useState<FramePlan | null>(null);
  const [playbackStatus, setPlaybackStatus] = useState<'playing' | 'paused'>('paused');
  const [playheadFrame, setPlayheadFrame] = useState(0);
  const [displayedFrame, setDisplayedFrame] = useState(0);
  const [pendingFrame, setPendingFrame] = useState(false);
  const [events, setEvents] = useState<VideoEvent[]>([]);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [balloons, setBalloons] = useState<PreviewBalloon[]>([]);
  const [editingBalloonId, setEditingBalloonId] = useState<string | null>(null);
  const [guidesVisible, setGuidesVisible] = useState(true);
  const [eventJumpNotice, setEventJumpNotice] = useState('');
  const [frame, setFrame] = useState<{ options: PreviewFrameOptions; status: 'preparing' | 'ready' | 'error'; error: string; hasDisplayed: boolean }>({ options, status: 'preparing', error: '', hasDisplayed: false });

  const selectEvent = useCallback((id: string | null) => {
    eventAnchorRef.current = id;
    setSelectedEventId(id);
  }, []);

  const finishBalloonEdit = useCallback((committed: boolean) => {
    const edit = balloonEditRef.current;
    balloonEditRef.current = null;
    setEditingBalloonId(null);
    const renderer = rendererRef.current;
    if (!committed && edit && renderer?.getDisplayedState() === edit.state) {
      renderer.previewBalloonPosition(edit.pointId, null);
    }
  }, []);

  const pausePlayback = useCallback((preserveAnchor: boolean) => {
    playingRef.current = false;
    setPlaybackStatus('paused');
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    const renderer = rendererRef.current;
    if (renderer?.getDisplayedState()) {
      requestEpochRef.current += 1;
      const state = renderer.cancelPendingFrames()!;
      if (!preserveAnchor && !updatingRef.current && state.frameIndex !== requestedFrameRef.current) selectEvent(null);
      retainedFrameRef.current = state.frameIndex;
      retainedPlanRef.current = renderer.getDisplayedPlan();
      retainedTimeRef.current = state.outputTimeSeconds;
      requestedFrameRef.current = state.frameIndex;
      setDisplayedFrame(state.frameIndex);
      setPlayheadFrame(state.frameIndex);
      setPendingFrame(false);
      setBalloons(renderer.getDisplayedBalloons());
    }
  }, [selectEvent]);
  const pause = useCallback(() => { if (!updatingRef.current && !balloonEditRef.current) pausePlayback(false); }, [pausePlayback]);

  const stop = useCallback(() => {
    finishBalloonEdit(false);
    pausePlayback(false);
    generationRef.current += 1;
    const renderer = rendererRef.current;
    rendererRef.current = null;
    setPendingFrame(false);
    setFrame((current) => ({ ...current, status: 'preparing', hasDisplayed: false }));
    if (renderer) releaseRef.current = Promise.all([releaseRef.current, renderer.dispose()]).then(() => {});
    return releaseRef.current;
  }, [pausePlayback, finishBalloonEdit]);

  const requestFrame = useCallback(async (index: number) => {
    const renderer = rendererRef.current;
    if (!renderer) return;
    const generation = generationRef.current;
    const epoch = requestEpochRef.current;
    const currentOptions = appliedOptionsRef.current;
    const target = Math.max(0, Math.min(renderer.framePlan.totalFrames - 1, Math.floor(index)));
    requestedFrameRef.current = target;
    setPlayheadFrame(target);
    setPendingFrame(true);
    try {
      const result = await renderer.renderFrame(target);
      if (generation !== generationRef.current || epoch !== requestEpochRef.current || result.status !== 'rendered') return;
      retainedFrameRef.current = result.state.frameIndex;
      retainedPlanRef.current = result.framePlan;
      retainedTimeRef.current = result.state.outputTimeSeconds;
      setDisplayedFrame(result.state.frameIndex);
      if (!playingRef.current) setBalloons(renderer.getDisplayedBalloons());
      setFrame({ options: currentOptions, status: 'ready', error: '', hasDisplayed: true });
      if (requestedFrameRef.current === target) setPendingFrame(false);
      if (playingRef.current && result.state.frameIndex === renderer.framePlan.totalFrames - 1) pause();
      return result;
    } catch (reason) {
      if (generation !== generationRef.current || epoch !== requestEpochRef.current) return;
      pause();
      setPendingFrame(false);
      setFrame((current) => ({ ...current, status: 'error', error: reason instanceof Error ? reason.message : '映像を準備できませんでした。もう一度お試しください。' }));
    }
  }, [pause]);

  const updatePreview = useCallback(async (renderer: ReturnType<typeof createPreviewFrameRenderer>, next: PreviewFrameOptions) => {
    finishBalloonEdit(false);
    // Keep the event anchor even if an earlier settings update is still pending.
    pausePlayback(true);
    const epoch = ++requestEpochRef.current;
    const generation = generationRef.current;
    requestedOptionsRef.current = next;
    updatingRef.current = true;
    setPendingFrame(true);
    setFrame({ options: next, status: 'preparing', error: '', hasDisplayed: false });
    const eventJump = pendingEventRef.current;
    try {
      const result = await renderer.updateOptions(next, {
        timeSeconds: retainedTimeRef.current, frameIndex: retainedFrameRef.current,
        eventAnchorId: eventJump ?? eventAnchorRef.current, framePlan: retainedPlanRef.current, forceEvent: !!eventJump,
      });
      if (generation !== generationRef.current || epoch !== requestEpochRef.current || result.status !== 'rendered') return;
      appliedOptionsRef.current = next;
      retainedFrameRef.current = result.state.frameIndex;
      retainedPlanRef.current = result.framePlan;
      retainedTimeRef.current = result.state.outputTimeSeconds;
      requestedFrameRef.current = result.state.frameIndex;
      setFramePlan(result.framePlan);
      setEvents(result.events ?? []);
      setBalloons(renderer.getDisplayedBalloons());
      if (eventJump) {
        pendingEventRef.current = null;
        setEventJumpNotice(result.eventAnchorId ? '' : 'このバルーンは動画内には表示されません。');
      }
      selectEvent(result.eventAnchorId ?? null);
      setPlayheadFrame(result.state.frameIndex);
      setDisplayedFrame(result.state.frameIndex);
      setPendingFrame(false);
      updatingRef.current = false;
      setFrame({ options: next, status: 'ready', error: '', hasDisplayed: true });
    } catch (reason) {
      if (generation !== generationRef.current || epoch !== requestEpochRef.current) return;
      updatingRef.current = false;
      setPendingFrame(false);
      setFrame({ options: next, status: 'error', error: reason instanceof Error ? reason.message : '映像を準備できませんでした。もう一度お試しください。', hasDisplayed: false });
    }
  }, [pausePlayback, selectEvent, finishBalloonEdit]);

  useEffect(() => {
    if (!enabled) { pendingEventRef.current = null; return; }
    if (suspended || !canvasRef.current) return;
    let cancelled = false;
    const generation = ++generationRef.current;
    const canvas = canvasRef.current;
    initializationFailedRef.current = null;
    setFrame({ options: optionsRef.current, status: 'preparing', error: '', hasDisplayed: false });
    setFramePlan(null);
    setEvents([]);
    void (async () => {
      try {
        await releaseRef.current;
        if (cancelled || generation !== generationRef.current) return;
        const next = optionsRef.current;
        const renderer = createPreviewFrameRenderer(canvas, next);
        rendererRef.current = renderer;
        await updatePreview(renderer, next);
      } catch (reason) {
        if (!cancelled && generation === generationRef.current) {
          initializationFailedRef.current = optionsRef.current;
          setFrame({ options: optionsRef.current, status: 'error', error: reason instanceof Error ? reason.message : '映像を準備できませんでした。もう一度お試しください。', hasDisplayed: false });
        }
      }
    })();
    return () => { cancelled = true; void stop(); };
  }, [enabled, suspended, retry, updatePreview, stop]);

  // Invalidate before painting a changed setting; lifecycle/disposal is separate.
  useLayoutEffect(() => {
    const renderer = rendererRef.current;
    if (enabled && !suspended && renderer && requestedOptionsRef.current !== options) void updatePreview(renderer, options);
    else if (enabled && !suspended && !renderer && initializationFailedRef.current && initializationFailedRef.current !== options) {
      initializationFailedRef.current = null;
      setRetry((value) => value + 1);
    }
  }, [options, enabled, suspended, updatePreview]);

  useEffect(() => {
    if (!enabled || suspended) return;
    const onVisibilityChange = () => { if (document.hidden) pause(); };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, [enabled, suspended, pause]);

  const play = () => {
    const renderer = rendererRef.current;
    if (!renderer || frame.status !== 'ready' || document.hidden || balloonEditRef.current) return;
    pause();
    selectEvent(null);
    const plan = renderer.framePlan;
    const fromFrame = retainedFrameRef.current === plan.totalFrames - 1 ? 0 : retainedFrameRef.current;
    const origin = performance.now();
    let lastRequested = fromFrame;
    playingRef.current = true;
    setPlaybackStatus('playing');
    if (fromFrame !== retainedFrameRef.current) void requestFrame(fromFrame);
    const tick = (now: number) => {
      if (!playingRef.current || rendererRef.current !== renderer) return;
      const target = getFrameIndexAtTime(plan, fromFrame / plan.fps + (now - origin) / 1000);
      if (target !== lastRequested) { lastRequested = target; void requestFrame(target); }
      // Stay playing until the final request has actually published its frame.
      if (target < plan.totalFrames - 1) rafRef.current = requestAnimationFrame(tick);
      else rafRef.current = null;
    };
    rafRef.current = requestAnimationFrame(tick);
  };
  const seek = (index: number, eventId: string | null = null) => {
    if (balloonEditRef.current) return;
    pause();
    selectEvent(eventId);
    void requestFrame(index);
  };
  const jumpToEvent = (event: VideoEvent) => {
    if (event.frameIndex !== null) seek(event.frameIndex, event.id);
  };
  const reset = useCallback(() => {
    void stop();
    retainedFrameRef.current = 0;
    retainedPlanRef.current = null;
    retainedTimeRef.current = 0;
    updatingRef.current = false;
    initializationFailedRef.current = null;
    requestedFrameRef.current = 0;
    setPlayheadFrame(0);
    setDisplayedFrame(0);
    selectEvent(null);
    setEvents([]);
    setBalloons([]);
    pendingEventRef.current = null;
    setEventJumpNotice('');
    setGuidesVisible(true);
  }, [stop, selectEvent]);

  const beginBalloonEdit = useCallback((pointId: string) => {
    const renderer = rendererRef.current;
    const state = renderer?.getDisplayedState();
    if (!renderer || !state || playingRef.current || updatingRef.current || balloonEditRef.current
      || optionsRef.current !== appliedOptionsRef.current || requestedFrameRef.current !== state.frameIndex) return false;
    if (!renderer.getDisplayedBalloons().some((balloon) => balloon.pointId === pointId)) return false;
    requestEpochRef.current += 1;
    renderer.cancelPendingFrames();
    balloonEditRef.current = { pointId, state };
    setEditingBalloonId(pointId);
    return true;
  }, []);
  const previewBalloon = useCallback((position: BalloonFramePosition | null) => {
    const edit = balloonEditRef.current;
    const renderer = rendererRef.current;
    if (!edit || renderer?.getDisplayedState() !== edit.state) return [];
    return renderer.previewBalloonPosition(edit.pointId, position);
  }, []);
  const pauseForSelection = useCallback(() => {
    if (updatingRef.current || balloonEditRef.current) return [];
    pausePlayback(true);
    return rendererRef.current?.getDisplayedBalloons() ?? [];
  }, [pausePlayback]);
  const requestBalloonEvent = (pointId: string) => {
    if (balloonEditRef.current) return;
    pendingEventRef.current = `balloon:${pointId}`;
    setEventJumpNotice('');
    setGuidesVisible(true);
    if (enabled && !suspended && rendererRef.current) void updatePreview(rendererRef.current, optionsRef.current);
  };
  const toggleGuides = () => {
    finishBalloonEdit(false);
    setGuidesVisible((visible) => !visible);
  };

  return {
    canvasRef, framePlan, playbackStatus, playheadFrame, displayedFrame, pendingFrame, events, selectedEventId,
    status: frame.options === options ? frame.status : 'preparing' as const,
    error: frame.options === options ? frame.error : '',
    hasDisplayed: frame.options === options && frame.hasDisplayed,
    updating: retainedPlanRef.current !== null && (frame.options !== options || frame.status === 'preparing'),
    balloons, editingBalloonId, guidesVisible, eventJumpNotice, beginBalloonEdit, finishBalloonEdit, previewBalloon,
    pauseForSelection, requestBalloonEvent, toggleGuides, isEditingBalloon: () => balloonEditRef.current !== null,
    play, pause, seek, jumpToEvent, stop, reset, retry: () => setRetry((value) => value + 1),
  };
}

export type VideoPlayer = ReturnType<typeof useVideoPlayer>;
