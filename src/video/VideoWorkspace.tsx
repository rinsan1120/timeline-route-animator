import { useEffect, useId, useMemo, useRef, useState } from 'react';
import HelpTip from '../help/HelpTip';
import type { VideoPlayer } from './useVideoPlayer';

interface VideoWorkspaceProps {
  player: VideoPlayer;
  suspended: boolean;
}

function formatVideoTime(seconds: number) {
  const tenths = Math.floor(seconds * 10 + 1e-7);
  return `${String(Math.floor(tenths / 600)).padStart(2, '0')}:${String(Math.floor(tenths / 10) % 60).padStart(2, '0')}.${tenths % 10}`;
}

export default function VideoWorkspace({ player, suspended }: VideoWorkspaceProps) {
  const { canvasRef, status, error, framePlan, playbackStatus, playheadFrame, displayedFrame, pendingFrame, events, selectedEventId } = player;
  const holderRef = useRef<HTMLDivElement>(null);
  const [frameWidth, setFrameWidth] = useState(0);
  const [listOpen, setListOpen] = useState(false);
  const listId = useId();
  const available = events.filter((event) => event.frameIndex !== null);
  const selectedIndex = available.findIndex((event) => event.id === selectedEventId);
  const previous = selectedIndex >= 0 ? available[selectedIndex - 1] : available.filter((event) => event.frameIndex! < playheadFrame).at(-1);
  const next = selectedIndex >= 0 ? available[selectedIndex + 1] : available.find((event) => event.frameIndex! > playheadFrame);
  const selected = events.find((event) => event.id === selectedEventId);
  const markers = useMemo(() => {
    const groups = new Map<number, string[]>();
    for (const event of events) if (event.frameIndex !== null) groups.set(event.frameIndex, [...(groups.get(event.frameIndex) ?? []), event.name]);
    return [...groups];
  }, [events]);
  const disabled = suspended || status !== 'ready' || !framePlan;
  const fps = framePlan?.fps ?? 30;
  const lastFrame = (framePlan?.totalFrames ?? 1) - 1;
  useEffect(() => {
    const holder = holderRef.current!;
    const observer = new ResizeObserver(([entry]) => {
      // Display scaling only; all drawing remains in 1920×1080 video coordinates.
      setFrameWidth(Math.max(0, Math.min(entry.contentRect.width, entry.contentRect.height * 16 / 9)));
    });
    observer.observe(holder);
    return () => observer.disconnect();
  }, []);
  return <section className="video-workspace" aria-label="映像画面" aria-busy={!suspended && status === 'preparing'}>
    <p className="video-workspace-caption">{playbackStatus === 'playing' ? '再生中' : '一時停止'}{pendingFrame && player.hasDisplayed ? ` · ${formatVideoTime(playheadFrame / fps)}を準備中` : ''}</p>
    <div className="video-frame-holder" ref={holderRef}>
      <div className="video-frame" style={{ width: frameWidth }}>
        <canvas ref={canvasRef} width="1920" height="1080" role="img" aria-label={`動画映像 ${formatVideoTime(displayedFrame / fps)}`}
          style={{ visibility: player.hasDisplayed && !suspended ? 'visible' : 'hidden' }} />
      </div>
      {(suspended || status !== 'ready') && <div className="video-frame-status" role={status === 'error' && !suspended ? 'alert' : 'status'}>
        {suspended ? <p>MP4生成中は映像確認を休止しています。</p>
          : status === 'error' ? <><p>{error}</p><button type="button" className="secondary-button" onClick={player.retry}>再試行</button></>
            : <><span className="spinner" /><p>{player.updating ? '設定を反映して映像を更新しています…' : '映像を準備しています…'}</p></>}
      </div>}
    </div>
    <div className="video-player-controls" aria-label="映像プレイヤー">
      <div className="video-playback-row">
        <button type="button" disabled={disabled} onClick={playbackStatus === 'playing' ? player.pause : player.play}>{playbackStatus === 'playing' ? '一時停止' : '再生'}</button>
        <output aria-label="表示中の動画時刻">{formatVideoTime(displayedFrame / fps)} / {formatVideoTime((framePlan?.totalFrames ?? 0) / fps)}</output>
        <HelpTip helpKey="videoPlayer" variant="toolbar" />
      </div>
      <div className="video-seek">
        <input type="range" aria-label="動画の再生位置" aria-valuetext={`${formatVideoTime(playheadFrame / fps)}、フレーム${playheadFrame}`}
          min={0} max={lastFrame} step={1} value={Math.min(playheadFrame, lastFrame)} disabled={disabled}
          onPointerDown={player.pause}
          onKeyDown={(event) => { if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'].includes(event.key)) player.pause(); }}
          onChange={(event) => player.seek(Number(event.target.value))} />
        <div className="video-event-markers" aria-hidden="true">
          {markers.map(([index, names]) => <span key={index} style={{ left: `${lastFrame ? index / lastFrame * 100 : 0}%` }} title={names.join('、')} />)}
        </div>
      </div>
      <div className="video-event-buttons">
        <button type="button" disabled={disabled || !previous} onClick={() => previous && player.jumpToEvent(previous)}>前のイベント</button>
        <button type="button" disabled={disabled || !next} onClick={() => next && player.jumpToEvent(next)}>次のイベント</button>
        <button type="button" aria-expanded={listOpen} aria-controls={listId} onClick={() => setListOpen(!listOpen)}>一覧{listOpen ? 'を閉じる' : 'を開く'}</button>
      </div>
      <p className="video-selected-event" aria-live="polite">{selected ? `${selected.kind === 'balloon' ? 'バルーン：' : ''}${selected.name}` : 'イベント未選択'}</p>
      <div id={listId} className="video-event-list" hidden={!listOpen} role="region" aria-label="動画のイベント一覧">
        {events.map((event) => <div key={event.id} className="video-event-entry">
          <button type="button" disabled={disabled || event.frameIndex === null} aria-pressed={event.id === selectedEventId} onClick={() => player.jumpToEvent(event)}>
            <span>{event.kind === 'balloon' ? 'バルーン：' : ''}{event.name}</span><small>{event.frameIndex === null ? '表示なし' : formatVideoTime(event.frameIndex / fps)}</small>
          </button>
          {event.unavailableReason && <p>{event.unavailableReason}</p>}
        </div>)}
      </div>
    </div>
  </section>;
}
