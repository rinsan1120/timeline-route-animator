import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import RouteMap from './map/RouteMap';
import { DEFAULT_ANNOTATION_STYLE, type AnnotationStyle } from './route/annotationStyle';
import { addPoint, deletePoint, movePoint } from './route/editor';
import { formatDistance, routeDistance } from './route/geometry';
import { emptyHistory, historyReducer } from './route/history';
import type { RawPosition, WorkerResponse } from './timeline/types';
import { readTimelineFile } from './timeline/fileLoader';
import { renderRouteVideo, type VideoProgress } from './video/renderer';

type MapMode = 'display' | 'edit' | 'animation-range';

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
  const [annotationLabel, setAnnotationLabel] = useState('');
  const [annotationStyle, setAnnotationStyle] = useState<AnnotationStyle>(DEFAULT_ANNOTATION_STYLE);
  const [history, dispatch] = useReducer(historyReducer, emptyHistory);
  const [mapMode, setMapMode] = useState<MapMode>('display');
  const [addMode, setAddMode] = useState(false);
  const [animationStartPointId, setAnimationStartPointId] = useState<string | null>(null);
  const [animationEndPointId, setAnimationEndPointId] = useState<string | null>(null);
  const [duration, setDuration] = useState<number>(10);
  const [durationInput, setDurationInput] = useState('10');
  const [revealRoute, setRevealRoute] = useState(true);
  const [previewProgress, setPreviewProgress] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [videoProgress, setVideoProgress] = useState<VideoProgress | null>(null);
  const [videoUrl, setVideoUrl] = useState('');

  const points = history.present;
  const editMode = mapMode === 'edit';
  const animationRangeMode = mapMode === 'animation-range';
  const selectedPoint = points.find((point) => point.id === selectedPointId) ?? null;
  useEffect(() => {
    setAnnotationLabel(selectedPoint?.annotation?.label ?? '');
  }, [selectedPoint?.id, selectedPoint?.annotation?.label]);

  const saveAnnotation = () => {
    if (!selectedPoint) return;
    const label = annotationLabel.trim();
    if (!label || Array.from(label).length > 30) {
      setError('地点ラベルは1〜30文字で入力してください。');
      return;
    }
    if (selectedPoint.annotation?.label !== label) {
      dispatch({ type: 'commit', points: points.map((point) => point.id === selectedPoint.id ? { ...point, annotation: { label } } : point) });
    }
    setAnnotationLabel(label);
    setError('');
  };

  const removeAnnotation = () => {
    if (!selectedPoint?.annotation) return;
    dispatch({ type: 'commit', points: points.map((point) => {
      if (point.id !== selectedPoint.id) return point;
      const { annotation, ...rest } = point;
      return rest;
    }) });
    setError('');
  };
  const distance = useMemo(() => routeDistance(points), [points]);
  const animationPoints = useMemo(() => {
    if (points.length < 2) return points;
    const startIndex = animationStartPointId ? points.findIndex((point) => point.id === animationStartPointId) : 0;
    const endIndex = animationEndPointId ? points.findIndex((point) => point.id === animationEndPointId) : points.length - 1;
    return startIndex >= 0 && endIndex > startIndex ? points.slice(startIndex, endIndex + 1) : points;
  }, [points, animationStartPointId, animationEndPointId]);

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
        setAnimationStartPointId(null);
        setAnimationEndPointId(null);
        setBusy(false);
        setNotice(message.routePoints.length ? `${message.routePoints.length}点のルートを読み込みました。` : '指定時間内にtimelinePathがありません。時間範囲を変更してください。');
      }
    };
    worker.onerror = () => { setError('Worker処理に失敗しました。'); setBusy(false); };
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

  useEffect(() => {
    const startMissing = animationStartPointId && !points.some((point) => point.id === animationStartPointId);
    const endMissing = animationEndPointId && !points.some((point) => point.id === animationEndPointId);
    if (startMissing || endMissing) {
      setAnimationStartPointId(null);
      setAnimationEndPointId(null);
      setNotice('指定したポイントが削除されたため、アニメ範囲を全ルートへ戻しました。');
    }
  }, [points, animationStartPointId, animationEndPointId]);

  const loadFile = async (file: File) => {
    setBusy(true);
    setError('');
    setNotice('JSONを端末内で解析しています…');
    try {
      const buffer = await readTimelineFile(file);
      const worker = workerRef.current;
      if (!worker) throw new Error('Worker処理に失敗しました。');
      console.info('[Timeline] sending buffer to Worker', { byteLength: buffer.byteLength });
      worker.postMessage({ type: 'load', buffer, fileName: file.name }, [buffer]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'ファイル内容を読み取れませんでした。');
      setBusy(false);
    }
  };

  const commitAdd = (latitude: number, longitude: number) => {
    const next = addPoint(points, latitude, longitude);
    dispatch({ type: 'commit', points: next });
    setSelectedPointId(next.find((point) => !points.some((old) => old.id === point.id))?.id ?? null);
  };

  const setAnimationStart = () => {
    if (!selectedPointId) return;
    const selectedIndex = points.findIndex((point) => point.id === selectedPointId);
    const endIndex = animationEndPointId ? points.findIndex((point) => point.id === animationEndPointId) : points.length - 1;
    if (selectedIndex < 0 || selectedIndex >= endIndex) {
      setError('開始地点は終了地点より前のポイントを選択してください。');
      return;
    }
    setError('');
    setAnimationStartPointId(selectedPointId);
  };

  const setAnimationEnd = () => {
    if (!selectedPointId) return;
    const selectedIndex = points.findIndex((point) => point.id === selectedPointId);
    const startIndex = animationStartPointId ? points.findIndex((point) => point.id === animationStartPointId) : 0;
    if (selectedIndex <= startIndex) {
      setError('終了地点は開始地点より後のポイントを選択してください。');
      return;
    }
    setError('');
    setAnimationEndPointId(selectedPointId);
  };

  const resetAnimationRange = () => {
    setAnimationStartPointId(null);
    setAnimationEndPointId(null);
    setError('');
  };

  const generateVideo = async () => {
    setError('');
    setVideoProgress({ current: 0, total: duration * 30, percent: 0 });
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const blob = await renderRouteVideo({ points: animationPoints, duration, revealRoute, annotationStyle, signal: controller.signal, onProgress: setVideoProgress });
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
    const blob = new Blob([JSON.stringify({ version: 1, sourceFileName: fileName, date, from, to, editedRoute: points, animationRange: { startPointId: animationStartPointId ?? points[0]?.id ?? null, endPointId: animationEndPointId ?? points.at(-1)?.id ?? null }, video: { width: 1920, height: 1080, fps: 30, duration, revealRoute, annotationStyle } }, null, 2)], { type: 'application/json' });
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
              <button className={mapMode === 'display' ? 'active' : ''} onClick={() => { setMapMode('display'); setAddMode(false); }}>表示</button>
              <button className={editMode ? 'active' : ''} onClick={() => setMapMode('edit')}>編集</button>
              <button className={animationRangeMode ? 'active' : ''} onClick={() => { setMapMode('animation-range'); setAddMode(false); }}>アニメ範囲</button>
            </div>
            <label className="toggle-row"><span><strong>測位データを表示</strong><small>rawSignals（参考情報）</small></span><input type="checkbox" checked={showRaw} onChange={(event) => setShowRaw(event.target.checked)} /><i /></label>
            {selectedPoint && <div className="detail-card"><strong>選択中のルートポイント</strong><span>{selectedPoint.source === 'manual' ? '手動追加' : 'timelinePath'}</span><code>{selectedPoint.latitude.toFixed(6)}, {selectedPoint.longitude.toFixed(6)}</code>{selectedPoint.timestamp && <time>{formatTimestamp(selectedPoint.timestamp)}</time>}
              {editMode && <div className="annotation-editor">
                <label htmlFor="annotation-label">地点ラベル（最大30文字）</label>
                <input id="annotation-label" type="text" value={annotationLabel} onChange={(event) => setAnnotationLabel(event.currentTarget.value)} onKeyDown={(event) => {
                  // Text editing keeps its own Undo/Redo instead of changing route history.
                  event.stopPropagation();
                }} placeholder="美瑛・青い池" />
                <button className="secondary-button" disabled={!annotationLabel.trim() || Array.from(annotationLabel.trim()).length > 30} onClick={saveAnnotation}>{selectedPoint.annotation ? '変更' : 'バルーンを設定'}</button>
                {selectedPoint.annotation && <button className="secondary-button" onClick={removeAnnotation}>バルーンを削除</button>}
              </div>}
            </div>}
            {animationRangeMode && <div className="detail-card animation-range-card">
              <strong>アニメーション範囲</strong>
              <span>開始: {animationPoints[0] ? `${points.indexOf(animationPoints[0]) + 1}番目` : '未選択'}</span>
              <span>終了: {animationPoints.at(-1) ? `${points.indexOf(animationPoints.at(-1)!) + 1}番目` : '未選択'}</span>
              <div className="animation-range-actions">
                <button className="secondary-button" disabled={!selectedPoint} onClick={setAnimationStart}>ここを開始地点に設定</button>
                <button className="secondary-button" disabled={!selectedPoint} onClick={setAnimationEnd}>ここを終了地点に設定</button>
              </div>
              <button className="text-button" onClick={resetAnimationRange}>全ルートを使用</button>
            </div>}
            {selectedRaw && <RawDetail point={selectedRaw} onClose={() => setSelectedRaw(null)} />}
          </section>

          <section className="panel-section video-section">
            <div className="section-heading"><span className="step">03</span><div><h2>動画にする</h2><p>FHD · 30fps · MP4（H.264）</p></div></div>
            <div className="duration-controls">
              <label htmlFor="video-duration-range">動画時間</label>
              <input id="video-duration-range" type="range" min="5" max="60" step="1" value={duration} disabled={previewProgress !== null || !!videoProgress} onChange={(event) => {
                const value = Number(event.currentTarget.value);
                setDuration(value);
                setDurationInput(String(value));
              }} />
              <div className="duration-limits"><span>5秒</span><span>60秒</span></div>
              <label className="duration-number" htmlFor="video-duration-number">
                <input id="video-duration-number" aria-label="動画時間（秒）" type="number" inputMode="numeric" min="5" max="60" step="1" value={durationInput} disabled={previewProgress !== null || !!videoProgress} onChange={(event) => {
                  const value = event.currentTarget.value;
                  setDurationInput(value);
                  if (value !== '' && Number.isFinite(Number(value))) setDuration(Math.min(60, Math.max(5, Math.round(Number(value)))));
                }} onBlur={() => setDurationInput(String(duration))} />
                秒
              </label>
            </div>
            <div className="annotation-style-controls">
              <h3>バルーン表示</h3>
              {(['balloonScale', 'fontScale'] as const).map((key) => <label key={key}>
                {key === 'balloonScale' ? 'バルーンサイズ' : '文字サイズ'} <span>{Math.round(annotationStyle[key] * 100)}%</span>
                <input type="range" min="50" max="200" step="10" value={Math.round(annotationStyle[key] * 100)} onChange={(event) => setAnnotationStyle((current) => ({ ...current, [key]: Number(event.target.value) / 100 }))} />
              </label>)}
            </div>
            <label className="select-label">ルート表示<select value={revealRoute ? 'reveal' : 'all'} onChange={(event) => setRevealRoute(event.target.value === 'reveal')}><option value="reveal">通過済み部分だけ表示</option><option value="all">全ルートを最初から表示</option></select></label>
            <button className="preview-button" disabled={animationPoints.length < 2 || previewProgress !== null} onClick={() => setPreviewProgress(0)}><span>▶</span> プレビュー</button>
            <button className="generate-button" disabled={animationPoints.length < 2 || !!videoProgress} onClick={() => void generateVideo()}>MP4を生成 <span>→</span></button>
            {videoProgress && <div className="progress-card"><div><strong>動画生成中</strong><span>{videoProgress.current} / {videoProgress.total} frames</span></div><b>{videoProgress.percent}%</b><progress max="100" value={videoProgress.percent} /><button onClick={() => abortRef.current?.abort()}>キャンセル</button></div>}
            {videoUrl && <a className="download-button" href={videoUrl} download={`route-${date}.mp4`}>MP4を保存</a>}
            {points.length > 0 && <button className="text-button" onClick={downloadProject}>編集プロジェクトJSONを保存</button>}
          </section>
        </aside>

        <section className="map-stage">
          <RouteMap annotationStyle={annotationStyle} points={points} animationPoints={animationPoints} rawPositions={rawPositions} showRaw={showRaw} editMode={editMode} animationRangeMode={animationRangeMode} addMode={addMode} selectedPointId={selectedPointId} previewProgress={previewProgress} revealRoute={revealRoute} onSelectPoint={(id) => { setSelectedPointId(id); setSelectedRaw(null); }} onSelectRaw={(point) => { setSelectedRaw(point); setSelectedPointId(null); }} onAddPoint={commitAdd} onMovePoint={(id, latitude, longitude) => dispatch({ type: 'commit', points: movePoint(points, id, latitude, longitude) })} onError={setError} />
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
