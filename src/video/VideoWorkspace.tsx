import { useEffect, useRef, useState, type RefObject } from 'react';

interface VideoWorkspaceProps {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  status: 'preparing' | 'ready' | 'error';
  error: string;
  suspended: boolean;
  onRetry: () => void;
}

export default function VideoWorkspace({ canvasRef, status, error, suspended, onRetry }: VideoWorkspaceProps) {
  const holderRef = useRef<HTMLDivElement>(null);
  const [frameWidth, setFrameWidth] = useState(0);
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
    <p className="video-workspace-caption">動画の先頭フレームを停止表示しています。</p>
    <div className="video-frame-holder" ref={holderRef}>
      <div className="video-frame" style={{ width: frameWidth }}>
        <canvas ref={canvasRef} width="1920" height="1080" role="img" aria-label="動画の先頭フレーム"
          style={{ visibility: status === 'ready' && !suspended ? 'visible' : 'hidden' }} />
      </div>
      {(suspended || status !== 'ready') && <div className="video-frame-status" role={status === 'error' && !suspended ? 'alert' : 'status'}>
        {suspended ? <p>MP4生成中は映像確認を休止しています。</p>
          : status === 'error' ? <><p>{error}</p><button type="button" className="secondary-button" onClick={onRetry}>再試行</button></>
            : <><span className="spinner" /><p>映像を準備しています…</p></>}
      </div>}
    </div>
  </section>;
}
