import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { getFrameIndexAtTime, type FramePlan, type FrameState } from './frameTimeline';
import { createPreviewFrameRenderer, previewMarkerId, type PreviewBalloon, type PreviewFrameOptions, type PreviewMarker, type PreviewMarkerPosition, type PreviewMarkerTarget } from './previewFrameRenderer';
import type { BalloonFramePosition } from '../popup/placement';
import type { VideoEvent } from './videoEvents';

// Playback and retained Canvas pixels belong to this session, never to JSON.
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
  // Keep the existing guard/API names compatible: they cover every frame edit.
  const balloonEditRef = useRef<{ target: { kind: 'balloon'; pointId: string } | PreviewMarkerTarget; state: FrameState } | null>(null);
  const pendingEventRef = useRef<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [framePlan, setFramePlan] = useState<FramePlan | null>(null);
  const [playbackStatus, setPlaybackStatus] = useState<'playing' | 'paused'>('paused');
  const [playheadFrame, setPlayheadFrame] = useState(0);
  const [displayedFrame, setDisplayedFrame] = useState(0);
  const [pendingFrame, setPendingFrame] = useState(false);
  const [hasRetainedCanvas, setHasRetainedCanvas] = useState(false);
  const [events, setEvents] = useState<VideoEvent[]>([]);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [balloons, setBalloons] = useState<PreviewBalloon[]>([]);
  const [markers, setMarkers] = useState<PreviewMarker[]>([]);
  const [editingBalloonId, setEditingBalloonId] = useState<string | null>(null);
  const [editCancellation, setEditCancellation] = useState(0);
  const editingAvailableRef = useRef(false);
  editingAvailableRef.current = enabled && !suspended;
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
    if (edit && !committed) setEditCancellation((value) => value + 1);
    const renderer = rendererRef.current;
    if (!committed && edit && renderer?.getDisplayedState() === edit.state) {
      if (edit.target.kind === 'balloon') renderer.previewBalloonPosition(edit.target.pointId, null);
      else renderer.previewMarkerPosition(edit.target, null);
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
      setMarkers(renderer.getDisplayedMarkers());
    }
  }, [selectEvent]);
  const pause = useCallback(() => { if (!updatingRef.current && !balloonEditRef.current) pausePlayback(false); }, [pausePlayback]);

  const stop = useCallback(() => {
    finishBalloonEdit(false);
    pausePlayback(false);
    generationRef.current += 1;
    const renderer = rendererRef.current;
    if (renderer?.getDisplayedState()) setHasRetainedCanvas(true);
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
      setHasRetainedCanvas(true);
      if (!playingRef.current) { setBalloons(renderer.getDisplayedBalloons()); setMarkers(renderer.getDisplayedMarkers()); }
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
      setMarkers(renderer.getDisplayedMarkers());
      if (eventJump) {
        pendingEventRef.current = null;
        setEventJumpNotice(result.eventAnchorId ? '' : 'このバルーンは動画内には表示されません。');
      }
      selectEvent(result.eventAnchorId ?? null);
      setPlayheadFrame(result.state.frameIndex);
      setDisplayedFrame(result.state.frameIndex);
      setHasRetainedCanvas(true);
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
    if (!enabled) { pendingEventRef.current = null; setHasRetainedCanvas(false); return; }
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
        setHasRetainedCanvas(false);
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
    const onVisibilityChange = () => { if (document.hidden) { finishBalloonEdit(false); pause(); } };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, [enabled, suspended, pause, finishBalloonEdit]);

  const play = () => {
    const renderer = rendererRef.current;
    if (!renderer || frame.status !== 'ready' || document.hidden || balloonEditRef.current) return;
    pause();
    selectEvent(null);
    const plan = renderer.framePlan;
    const fromFrame = retainedFrameRef.current === plan.totalFrames - 1 ? 0 : retainedFrameRef.current;
    playingRef.current = true;
    setPlaybackStatus('playing');
    const epoch = requestEpochRef.current;
    const isPlaying = () => playingRef.current && rendererRef.current === renderer && epoch === requestEpochRef.current;
    const origin = performance.now();
    let lastRequested = fromFrame;
    if (fromFrame !== retainedFrameRef.current) void requestFrame(fromFrame);
    const tick = (now: number) => {
      if (!isPlaying()) return;
      const target = getFrameIndexAtTime(plan, fromFrame / plan.fps + (now - origin) / 1000);
      if (target !== lastRequested) { lastRequested = target; void requestFrame(target); }
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
    setHasRetainedCanvas(false);
    selectEvent(null);
    setEvents([]);
    setBalloons([]);
    setMarkers([]);
    pendingEventRef.current = null;
    setEventJumpNotice('');
  }, [stop, selectEvent]);

  const beginEdit = useCallback((target: { kind: 'balloon'; pointId: string } | PreviewMarkerTarget) => {
    const renderer = rendererRef.current;
    const state = renderer?.getDisplayedState();
    if (!editingAvailableRef.current || !renderer || !state || playingRef.current || updatingRef.current || balloonEditRef.current
      || optionsRef.current !== appliedOptionsRef.current || requestedFrameRef.current !== state.frameIndex) return false;
    if (target.kind === 'balloon'
      ? !renderer.getDisplayedBalloons().some((balloon) => balloon.pointId === target.pointId)
      : !renderer.getDisplayedMarkers().some((marker) => previewMarkerId(marker.target) === previewMarkerId(target))) return false;
    requestEpochRef.current += 1;
    renderer.cancelPendingFrames();
    balloonEditRef.current = { target, state };
    setEditingBalloonId(target.kind === 'balloon' ? target.pointId : previewMarkerId(target));
    return true;
  }, []);
  const beginBalloonEdit = useCallback((pointId: string) => beginEdit({ kind: 'balloon', pointId }), [beginEdit]);
  const beginMarkerEdit = useCallback((target: PreviewMarkerTarget) => beginEdit(target), [beginEdit]);
  const isEditingTarget = (target: { kind: 'balloon'; pointId: string } | PreviewMarkerTarget) => {
    const active = balloonEditRef.current?.target;
    if (!active || active.kind !== target.kind) return false;
    return active.kind === 'balloon' && target.kind === 'balloon' ? active.pointId === target.pointId
      : active.kind !== 'balloon' && target.kind !== 'balloon' && previewMarkerId(active) === previewMarkerId(target);
  };
  const previewBalloon = useCallback((position: BalloonFramePosition | null) => {
    const edit = balloonEditRef.current;
    const renderer = rendererRef.current;
    if (!edit || edit.target.kind !== 'balloon' || renderer?.getDisplayedState() !== edit.state) return [];
    return renderer.previewBalloonPosition(edit.target.pointId, position);
  }, []);
  const previewMarker = useCallback((position: PreviewMarkerPosition | null) => {
    const edit = balloonEditRef.current;
    const renderer = rendererRef.current;
    if (!edit || edit.target.kind === 'balloon' || renderer?.getDisplayedState() !== edit.state) return [];
    return renderer.previewMarkerPosition(edit.target, position);
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
    if (enabled && !suspended && rendererRef.current) void updatePreview(rendererRef.current, optionsRef.current);
  };

  return {
    canvasRef, framePlan, playbackStatus, playheadFrame, displayedFrame, pendingFrame, events, selectedEventId, hasRetainedCanvas,
    status: frame.options === options ? frame.status : 'preparing' as const,
    error: frame.options === options ? frame.error : '',
    hasDisplayed: frame.options === options && frame.hasDisplayed,
    updating: retainedPlanRef.current !== null && (frame.options !== options || frame.status === 'preparing'),
    balloons, markers, editingBalloonId, editCancellation, eventJumpNotice, beginBalloonEdit, beginMarkerEdit, finishBalloonEdit, previewBalloon, previewMarker,
    isEditingTarget,
    getVisibleBalloons: () => rendererRef.current?.getDisplayedBalloons() ?? [],
    getVisibleMarkers: () => rendererRef.current?.getDisplayedMarkers() ?? [],
    pauseForSelection, requestBalloonEvent, isEditingBalloon: () => balloonEditRef.current !== null,
    play, pause, seek, jumpToEvent, stop, reset, retry: () => setRetry((value) => value + 1),
  };
}

export type VideoPlayer = ReturnType<typeof useVideoPlayer>;
