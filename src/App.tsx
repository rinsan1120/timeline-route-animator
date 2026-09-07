import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import RouteMap from './map/RouteMap';
import { addPoint, deletePoint, movePoint } from './route/editor';
import { formatDistance, routeDistance } from './route/geometry';
import { emptyHistory, historyReducer } from './route/history';
import type { RawPosition, WorkerResponse } from './timeline/types';
import { renderRouteVideo, type VideoProgress } from './video/renderer';

type Duration = 5 | 10 | 15;

export default function App() {
  const workerRef = useRef<Worker | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [dates, setDates] = useState<string[]>([]);
  const [date, setDate] = useState('');
  const [from, setFrom] = useState('00:00');
  const [to, setTo] = useState('23:59');
  const [fileName, setFileName] = useState('');
  const [rawPositions, setRawPositions] = useState<RawPosition[]>([]);
  const [showRaw, setShowRaw] = useState(false);
  const [selectedRaw, setSelectedRaw] = useState<RawPosition | null>(null);
  const [selectedPointId, setSelectedPointId] = useState<string | null>(null);
  const [history, dispatch] = useReducer(historyReducer, emptyHistory);
  const [editMode, setEditMode] = useState(false);
  const [addMode, setAddMode] = useState(false);
  const [duration, setDuration] = useState<Duration>(10);
  const [revealRoute, setRevealRoute] = useState(true);
  const [previewProgress, setPreviewProgress] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [videoProgress, setVideoProgress] = useState<VideoProgress | null>(null);
  const [videoUrl, setVideoUrl] = useState('');

  const points = history.present;
  const selectedPoint = points.find((point) => point.id === selectedPointId) ?? null;
  const distance = useMemo(() => routeDistance(points), [points]);

  const extract = useCallback((selectedDate = date, start = from, end = to) => {
    setError('');
    setBusy(true);
    workerRef.current?.postMessage({ type: 'extract', date: selectedDate, from: start, to: end });
  }, [date, from, to]);

  useEffect(() => {
    const worker = new Worker(new URL('./timeline/worker.ts', import.meta.url), { type: 'module' });
    workerRef.current = worker;
    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const message = event.data;
      if (message.type === 'error') {
        setError(message.message);
        setBusy(false);
      } else if (message.type === 'loaded') {
        setDates(message.dates);
        setDate(message.dates[0]);
        setFileName(message.fileName);
        setNotice(`${message.dates.length}日分の日付を検出しました。`);
        worker.postMessage({ type: 'extract', date: message.dates[0], from: '00:00', to: '23:59' });
      } else {
        dispatch({ type: 'load', points: message.routePoints });
        setRawPositions(message.rawPositions);
        setSelectedPointId(null);
        setSelectedRaw(null);
        setBusy(false);
        setNotice(message.routePoints.length ? `${message.routePoints.length}点のルートを読み込みました。` : '指定時間内にtimelinePathがありません。時間範囲を変更してください。');
      }
    };
    worker.onerror = () => { setError('JSON処理Workerでエラーが発生しました。'); setBusy(false); };
    return () => worker.terminate();
  }, []);

  useEffect(() => {
    if (previewProgress === null) return;
    const startedAt = performance.now() - previewProgress * duration * 1000;
    let frame = 0;
    const animate = (now: number) => {
      const progress = Math.min(1, (now - startedAt) / (duration * 1000));
      setPreviewProgress(progress);
      if (progress < 1) frame = requestAnimationFrame(animate);
      else window.setTimeout(() => setPreviewProgress(null), 350);
    };
    frame = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frame);
  }, [previewProgress === null, duration]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'z') return;
      event.preventDefault();
      dispatch({ type: event.shiftKey ? 'redo' : 'undo' });
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  useEffect(() => () => { if (videoUrl) URL.revokeObjectURL(videoUrl); }, [videoUrl]);

  const loadFile = async (file: File) => {
    setBusy(true);
    setError('');
    setNotice('JSONを端末内で解析しています…');
    try {
      workerRef.current?.postMessage({ type: 'load', file, fileName: file.name });
    } catch {
      setError('ファイルを読み込めませんでした。');
      setBusy(false);
    }
  };

  const commitAdd = (latitude: number, longitude: number) => {
    const next = addPoint(points, latitude, longitude);
    dispatch({ type: 'commit', points: next });
    setSelectedPointId(next.find((point) => !points.some((old) => old.id === point.id))?.id ?? null);
  };

  const generateVideo = async () => {
    setError('');
    setVideoProgress({ current: 0, total: duration * 30, percent: 0 });
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const blob = await renderRouteVideo({ points, duration, revealRoute, signal: controller.signal, onProgress: setVideoProgress });
      if (videoUrl) URL.revokeObjectURL(videoUrl);
      setVideoUrl(URL.createObjectURL(blob));
      setNotice('MP4を生成しました。端末へ保存できます。');
    } catch (reason) {
      if (reason instanceof DOMException && reason.name === 'AbortError') setNotice('動画生成をキャンセルしました。');
      else setError(reason instanceof Error ? reason.message : '動画生成に失敗しました。');
    } finally {
      abortRef.current = null;
      setVideoProgress(null);
    }
  };

  const downloadProject = () => {
    const blob = new Blob([JSON.stringify({ version: 1, sourceFileName: fileName, date, from, to, editedRoute: points, video: { width: 1920, height: 1080, fps: 30, duration, revealRoute } }, null, 2)], { type: 'application/json' });
    downloadBlob(blob, `route-project-${date || 'untitled'}.json`);
  };

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-mark" aria-hidden="true"><span /></div>
        <div className="brand-copy">
          <h1>Timeline Route Animator</h1>
          <p>移動の軌跡を、一本の映像へ。</p>
        </div>
        <button className="file-button" onClick={() => fileInputRef.current?.click()} disabled={busy}>
          <span>JSONを開く</span><small>端末内で処理</small>
        </button>
        <input ref={fileInputRef} type="file" accept="application/json,.json" hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) void loadFile(file); event.currentTarget.value = ''; }} />
      </header>

      <section className="privacy-note"><span>●</span> 位置履歴JSONは端末内でのみ処理され、外部へ送信されません</section>

      <div className="workspace">
        <aside className="control-panel">
          <section className="panel-section source-section">
            <div className="section-heading"><span className="step">01</span><div><h2>範囲を選ぶ</h2><p>{fileName || 'Timeline JSONを読み込んでください'}</p></div></div>
            <label>日付<select value={date} disabled={!dates.length || busy} onChange={(event) => setDate(event.target.value)}>{dates.map((item) => <option key={item} value={item}>{item.replaceAll('-', ' / ')}</option>)}</select></label>
            <div className="time-grid">
              <label>From<input type="time" value={from} onChange={(event) => setFrom(event.target.value)} /></label>
              <span className="time-arrow">→</span>
              <label>To<input type="time" value={to} onChange={(event) => setTo(event.target.value)} /></label>
            </div>
            <button className="secondary-button wide" disabled={!date || busy} onClick={() => extract()}>この範囲を読み込む</button>
          </section>

          <section className="panel-section">
            <div className="section-heading"><span className="step">02</span><div><h2>ルートを整える</h2><p>{points.length ? `${points.length} points · ${formatDistance(distance)}` : 'ルートは未選択です'}</p></div></div>
            <div className="mode-switch">
              <button className={!editMode ? 'active' : ''} onClick={() => { setEditMode(false); setAddMode(false); }}>表示</button>
              <button className={editMode ? 'active' : ''} onClick={() => setEditMode(true)}>編集</button>
            </div>
            <label className="toggle-row"><span><strong>測位データを表示</strong><small>rawSignals（参考情報）</small></span><input type="checkbox" checked={showRaw} onChange={(event) => setShowRaw(event.target.checked)} /><i /></label>
            {selectedPoint && <div className="detail-card"><strong>選択中のルートポイント</strong><span>{selectedPoint.source === 'manual' ? '手動追加' : 'timelinePath'}</span><code>{selectedPoint.latitude.toFixed(6)}, {selectedPoint.longitude.toFixed(6)}</code>{selectedPoint.timestamp && <time>{formatTimestamp(selectedPoint.timestamp)}</time>}</div>}
            {selectedRaw && <RawDetail point={selectedRaw} onClose={() => setSelectedRaw(null)} />}
          </section>

          <section className="panel-section video-section">
            <div className="section-heading"><span className="step">03</span><div><h2>動画にする</h2><p>FHD · 30fps · MP4（H.264）</p></div></div>
            <label>動画時間<div className="duration-options">{([5, 10, 15] as Duration[]).map((value) => <button key={value} className={duration === value ? 'active' : ''} onClick={() => setDuration(value)}>{value}秒</button>)}</div></label>
            <label className="select-label">ルート表示<select value={revealRoute ? 'reveal' : 'all'} onChange={(event) => setRevealRoute(event.target.value === 'reveal')}><option value="reveal">通過済み部分だけ表示</option><option value="all">全ルートを最初から表示</option></select></label>
            <button className="preview-button" disabled={points.length < 2 || previewProgress !== null} onClick={() => setPreviewProgress(0)}><span>▶</span> プレビュー</button>
            <button className="generate-button" disabled={points.length < 2 || !!videoProgress} onClick={() => void generateVideo()}>MP4を生成 <span>→</span></button>
            {videoProgress && <div className="progress-card"><div><strong>動画生成中</strong><span>{videoProgress.current} / {videoProgress.total} frames</span></div><b>{videoProgress.percent}%</b><progress max="100" value={videoProgress.percent} /><button onClick={() => abortRef.current?.abort()}>キャンセル</button></div>}
            {videoUrl && <a className="download-button" href={videoUrl} download={`route-${date}.mp4`}>MP4を保存</a>}
            {points.length > 0 && <button className="text-button" onClick={downloadProject}>編集プロジェクトJSONを保存</button>}
          </section>
        </aside>

        <section className="map-stage">
          <RouteMap points={points} rawPositions={rawPositions} showRaw={showRaw} editMode={editMode} addMode={addMode} selectedPointId={selectedPointId} previewProgress={previewProgress} revealRoute={revealRoute} onSelectPoint={(id) => { setSelectedPointId(id); setSelectedRaw(null); }} onSelectRaw={(point) => { setSelectedRaw(point); setSelectedPointId(null); }} onAddPoint={commitAdd} onMovePoint={(id, latitude, longitude) => dispatch({ type: 'commit', points: movePoint(points, id, latitude, longitude) })} onError={setError} />
          {!points.length && <div className="empty-map"><div className="empty-route-icon">⌁</div><h2>Timeline JSONから旅を始めよう</h2><p>ファイルを読み込むと、ここにルートが現れます。</p><button onClick={() => fileInputRef.current?.click()}>JSONを選択</button></div>}
          {busy && <div className="loading-overlay"><span className="spinner" />端末内で処理しています…</div>}
          {(error || notice) && <div className={`toast ${error ? 'toast--error' : ''}`} role="status"><span>{error ? '!' : '✓'}</span><p>{error || notice}</p><button aria-label="閉じる" onClick={() => { setError(''); setNotice(''); }}>×</button></div>}
          {editMode && <nav className="edit-toolbar" aria-label="ルート編集">
            <button className={!addMode ? 'active' : ''} onClick={() => setAddMode(false)}><span>⌖</span>選択</button>
            <button className={addMode ? 'active' : ''} onClick={() => setAddMode((value) => !value)}><span>＋</span>連続追加</button>
            <button disabled={!selectedPoint} onClick={() => { if (selectedPointId) dispatch({ type: 'commit', points: deletePoint(points, selectedPointId) }); setSelectedPointId(null); }}><span>⌫</span>削除</button>
            <i />
            <button disabled={!history.past.length} onClick={() => dispatch({ type: 'undo' })}><span>↶</span>元に戻す</button>
            <button disabled={!history.future.length} onClick={() => dispatch({ type: 'redo' })}><span>↷</span>やり直す</button>
            <button disabled={!history.initial.length} onClick={() => { dispatch({ type: 'reset' }); setSelectedPointId(null); }}><span>↺</span>初期状態</button>
          </nav>}
        </section>
      </div>
    </main>
  );
}

function RawDetail({ point, onClose }: { point: RawPosition; onClose: () => void }) {
  return <div className="detail-card raw-detail"><button onClick={onClose} aria-label="閉じる">×</button><strong>参考測位点</strong><time>{formatTimestamp(point.timestamp)}</time>{point.source && <span>source: {point.source}</span>}{point.accuracyMeters !== undefined && <span>accuracy: {point.accuracyMeters} m</span>}{point.altitudeMeters !== undefined && <span>altitude: {point.altitudeMeters} m</span>}{point.speedMetersPerSecond !== undefined && <span>speed: {point.speedMetersPerSecond} m/s</span>}</div>;
}

function formatTimestamp(timestamp: string) { return timestamp.replace('T', ' ').replace(/\.\d{3}/, ''); }

function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
