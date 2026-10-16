import { useCallback, useEffect, useRef, useState } from 'react';
import { getFrameIndexAtTime, type FramePlan } from './frameTimeline';
import { createPreviewFrameRenderer, type PreviewFrameOptions } from './previewFrameRenderer';
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
  const previousOptionsRef = useRef(options);
  const [retry, setRetry] = useState(0);
  const [framePlan, setFramePlan] = useState<FramePlan | null>(null);
  const [playbackStatus, setPlaybackStatus] = useState<'playing' | 'paused'>('paused');
  const [playheadFrame, setPlayheadFrame] = useState(0);
  const [displayedFrame, setDisplayedFrame] = useState(0);
  const [pendingFrame, setPendingFrame] = useState(false);
  const [events, setEvents] = useState<VideoEvent[]>([]);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [frame, setFrame] = useState<{ options: PreviewFrameOptions; status: 'preparing' | 'ready' | 'error'; error: string; hasDisplayed: boolean }>({ options, status: 'preparing', error: '', hasDisplayed: false });

  const pause = useCallback(() => {
    playingRef.current = false;
    setPlaybackStatus('paused');
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    const renderer = rendererRef.current;
    if (renderer?.getDisplayedState()) {
      requestEpochRef.current += 1;
      const state = renderer.cancelPendingFrames()!;
      if (state.frameIndex !== requestedFrameRef.current) setSelectedEventId(null);
      retainedFrameRef.current = state.frameIndex;
      requestedFrameRef.current = state.frameIndex;
      setDisplayedFrame(state.frameIndex);
      setPlayheadFrame(state.frameIndex);
      setPendingFrame(false);
    }
  }, []);

  const stop = useCallback(() => {
    pause();
    generationRef.current += 1;
    const renderer = rendererRef.current;
    rendererRef.current = null;
    setPendingFrame(false);
    setFrame((current) => ({ ...current, status: 'preparing', hasDisplayed: false }));
    if (renderer) releaseRef.current = Promise.all([releaseRef.current, renderer.dispose()]).then(() => {});
    return releaseRef.current;
  }, [pause]);

  const requestFrame = useCallback(async (index: number) => {
    const renderer = rendererRef.current;
    if (!renderer) return;
    const generation = generationRef.current;
    const epoch = requestEpochRef.current;
    const target = Math.max(0, Math.min(renderer.framePlan.totalFrames - 1, Math.floor(index)));
    requestedFrameRef.current = target;
    setPlayheadFrame(target);
    setPendingFrame(true);
    try {
      const result = await renderer.renderFrame(target);
      if (generation !== generationRef.current || epoch !== requestEpochRef.current || result.status !== 'rendered') return;
      retainedFrameRef.current = result.state.frameIndex;
      setDisplayedFrame(result.state.frameIndex);
      setFrame((current) => ({ ...current, status: 'ready', error: '', hasDisplayed: true }));
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

  useEffect(() => {
    if (previousOptionsRef.current !== options) {
      retainedFrameRef.current = 0;
      setSelectedEventId(null);
      previousOptionsRef.current = options;
    }
    if (!enabled || suspended || !canvasRef.current) return;
    let cancelled = false;
    const generation = ++generationRef.current;
    const canvas = canvasRef.current;
    setFrame({ options, status: 'preparing', error: '', hasDisplayed: false });
    setFramePlan(null);
    setEvents([]);
    void (async () => {
      try {
        await releaseRef.current;
        if (cancelled || generation !== generationRef.current) return;
        const renderer = createPreviewFrameRenderer(canvas, options);
        rendererRef.current = renderer;
        setFramePlan(renderer.framePlan);
        const result = await requestFrame(retainedFrameRef.current);
        if (!cancelled && generation === generationRef.current && result) setEvents(renderer.getEvents());
      } catch (reason) {
        if (!cancelled && generation === generationRef.current) {
          setFrame({ options, status: 'error', error: reason instanceof Error ? reason.message : '映像を準備できませんでした。もう一度お試しください。', hasDisplayed: false });
        }
      }
    })();
    return () => { cancelled = true; void stop(); };
  }, [enabled, suspended, options, retry, requestFrame, stop]);

  useEffect(() => {
    if (!enabled || suspended) return;
    const onVisibilityChange = () => { if (document.hidden) pause(); };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, [enabled, suspended, pause]);

  const play = () => {
    const renderer = rendererRef.current;
    if (!renderer || frame.status !== 'ready' || document.hidden) return;
    pause();
    setSelectedEventId(null);
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
    pause();
    setSelectedEventId(eventId);
    void requestFrame(index);
  };
  const jumpToEvent = (event: VideoEvent) => {
    if (event.frameIndex !== null) seek(event.frameIndex, event.id);
  };
  const reset = useCallback(() => {
    void stop();
    retainedFrameRef.current = 0;
    requestedFrameRef.current = 0;
    setPlayheadFrame(0);
    setDisplayedFrame(0);
    setSelectedEventId(null);
    setEvents([]);
  }, [stop]);

  return {
    canvasRef, framePlan, playbackStatus, playheadFrame, displayedFrame, pendingFrame, events, selectedEventId,
    status: frame.options === options ? frame.status : 'preparing' as const,
    error: frame.options === options ? frame.error : '',
    hasDisplayed: frame.options === options && frame.hasDisplayed,
    play, pause, seek, jumpToEvent, stop, reset, retry: () => setRetry((value) => value + 1),
  };
}

export type VideoPlayer = ReturnType<typeof useVideoPlayer>;
