# HANDOFF

Last updated: 2026-09-07

## Current Status

V1の主要フロー（Timeline JSON読込、1日・時間範囲抽出、地図表示、手動編集、プレビュー、MP4生成）はコード上実装済み。直近では「ポイント数は表示されるが右側の地図が空白になる」問題に対し、MapLibre WorkerのVite設定、地図初期化競合、コンテナサイズ追従、背景地図失敗時のルート表示フォールバックを修正した。修正はまだコミットされておらず、ユーザー環境のChromeでの再確認待ち。

## Completed

- React + TypeScript + Viteのクライアントサイドアプリ基盤。
- Web Worker内でのTimeline JSON読込・`JSON.parse`・日付index作成・日付/From/To抽出。
- `semanticSegments[].timelinePath`の時系列ルート化と、`rawSignals[].position`の参考データ分離。
- activity typeをルート抽出条件に使わない実装と回帰テスト。
- MapLibre GL JS + OpenFreeMap、route/rawSignalsのGeoJSON source/layer、attribution、`fitBounds`。
- ルートポイントの選択、ドラッグ移動、最寄り区間への連続追加、削除、Undo/Redo、初期状態復元。
- 累積距離ベースの補間と、全ルート表示/通過済み部分表示のプレビュー。
- WebCodecs対応判定、MediabunnyによるFHD/30fps/H.264 MP4生成、進捗、キャンセル、保存UI。
- OpenFreeMap読込失敗時のローカル背景、SVGルートオーバーレイ、動画背景フォールバック。
- 56MB級のローカル実サンプルを使う条件付き統合テスト。実データは`.gitignore`対象。
- READMEにセットアップ、操作、GitHub Pages、制約を記載。

## In Progress

- 直近の地図空白対策が未コミット。対象は`src/map/RouteMap.tsx`、`src/styles.css`、`src/video/renderer.ts`、`vite.config.ts`など。
- ユーザーが報告した「186点読込後に右側が空白」の同一条件について、外部Chromeでの修正後再確認が未完了。
- その他のコード作業は現在進行していない。

## Known Issues

- `pnpm build`は成功するが、メインJS chunkが約1.37MBでViteの500kB超過警告が出る。
- OpenFreeMapが広告ブロッカーやネットワーク設定で遮断されると背景地図は表示できない。現在はルートのみ表示するフォールバックへ切り替わる。
- 実際のMP4生成・保存・動画仕様の検査は未実施。
- Android Chrome、外部デスクトップChromeでの最終確認、GitHub Pagesへの実デプロイは未実施。
- リポジトリ整理が必要。`.pnpm-store/`、`*.tsbuildinfo`、`vite.config.js`、`vite.config.d.ts`が追跡済みで、ルートに`gitignore`と`.gitignore`が併存している。
- `pnpm-lock.yaml`が追跡済みの一方、`package-lock.json`は未追跡。利用するパッケージマネージャーを決めて整理する必要がある。

## Next Actions

1. 開発サーバーを再起動し、ユーザーが使用した同じ日付/時間範囲（186点）を外部Chromeで読み込み、OpenFreeMap背景、ルート線、attribution、ズーム操作を確認する。問題が残る場合はChrome DevToolsのConsole/NetworkでMapLibre Workerと`tiles.openfreemap.org`を確認する。
2. `src/map/RouteMap.tsx`の直近修正について、ポイント選択・移動・連続追加・削除・Undo/Redo・rawSignals表示が退行していないかデスクトップと幅360pxで操作確認する。
3. H.264対応Chromeで5秒MP4を実生成し、1920x1080、30fps、MP4保存、attribution、全ルート/通過済み表示の両方を確認する。
4. Android Chrome実機でJSON読込、編集、保存を確認し、その後GitHub Pagesへ試験デプロイしてサブディレクトリ配信とWorker URLを確認する。
5. 検証後、追跡済み生成物・重複gitignore・lockfile方針を整理し、現在の未コミット修正をレビューしてコミットする。

## Verification

- `pnpm test`: passed（3 files、13 tests。ローカル実サンプルの条件付きテストを含む）
- `pnpm build`: passed
- TypeScript check: passed（`pnpm build`内の`tsc -b`）
- Build warning: main JS chunk約1.37MB
- Codex in-app Chromium（1280px）: 実サンプル読込、ルートlayer作成、ルート全体が表示範囲内、950x606の地図領域、SVGルート線表示を確認
- External desktop Chrome after latest fix: not checked
- Android Chrome: not checked
- GitHub Pages: not checked
- MP4 export: not checked
- `npm test` / `npm run build`: not run（この確認ではpnpmを使用）

## Important Context

- 直近の原因調査では、Vite dev serverが`maplibre-gl-worker.mjs`を依存最適化先で見失うログがあり、`vite.config.ts`の`optimizeDeps.exclude`へ`maplibre-gl`を追加した。
- MapLibreのstyle/tile失敗時でも経路を失わないよう、ローカル背景とMapLibre投影に同期するSVG route overlayを暫定互換経路として追加している。削除する前に外部ChromeとAndroidでMapLibre layer単独の描画を確認すること。
- 現在のGit branchは`main`で`origin/main`を追跡。ステージ済み変更はない。
- HANDOFF作成前の未コミット状態: modifiedは`README.md`、`src/map/RouteMap.tsx`、`src/styles.css`、`src/video/renderer.ts`、`vite.config.ts`、生成済み`vite.config.js`、2つの`*.tsbuildinfo`。untrackedは`AGENTS.md`と`package-lock.json`。この`HANDOFF.md`も新規未追跡ファイルとなる。
- `docs/SPEC.md`および`docs/`ディレクトリは現時点では存在しない。
