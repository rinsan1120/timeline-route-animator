# HANDOFF

Last updated: 2026-09-07

## Latest Update: OSM raster background (2026-09-07)

- 最新の明示要件により、AGENTS.mdのOpenFreeMap指定を上書きし、背景をOpenStreetMap標準ラスタータイルへ変更。MapLibre、ルート編集、JSON処理、Pages設定は維持。
- `src/map/osmStyle.ts`の型付きinline styleをRouteMapと動画rendererで共用。URLは`https://tile.openstreetmap.org/{z}/{x}/{y}.png`、tileSize 256、maxzoom 19。外部style JSONは使用しない。
- RouteMapのエラー回数による背景style切替を削除。一部タイルエラーは日本語通知のみとし、地図・ルートlayerを維持。attributionは折りたたまず表示。
- 動画はstyle準備→fitBounds→idle待機→背景1回キャプチャ→map解放→背景再利用。タイムアウト時の単色背景fallbackは維持。動画クレジットは`© OpenStreetMap contributors`。
- `npm ci`成功。`npm test`成功（13 tests、実サンプルなしの条件付きsuiteはskip）、`npm run build`成功（既存の約1.37MB chunk警告）。追加テストで共通style、fitBounds/idleの順序、背景1回取得、150フレーム再利用、map解放を検証。
- ローカルWindows Chromeの合成ルート確認ページでOSM地図、ルート線、編集点、preview marker、360px幅の地図クレジットを確認。OSM PNG要求あり、OpenFreeMap要求0件。
- 同ページで実MP4生成成功（1,834,657 bytes、ブラウザmetadata: 1920×1080、5秒）。30fpsはエンコーダー設定と150フレームの回帰テストで確認。
- Chrome拡張のファイルアクセス権限不足でアプリ本体のJSONファイル選択検証は不可。Android JSON問題の修正は今回含めない。Android実機・Pagesへの反映は未確認、未コミット・未デプロイ。
- 以下は以前の引継ぎ記録。OpenFreeMapや公開状態に関する記述は当時の状況。

## Current Status

V1の主要フロー（Timeline JSON読込、1日・時間範囲抽出、地図表示、手動編集、プレビュー、MP4生成）はコード上実装済み。ローカルChromeの地図表示はユーザー確認済み。GitHub Project Pages対応としてVite baseを`/timeline-route-animator/`へ変更し、公式Pages Actions方式で`dist/`を公開する`.github/workflows/deploy.yml`を整備した。変更は未コミット・未デプロイ。

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
- ローカルChromeで、JSON読込後の地図とルート表示をユーザーが確認済み。

## In Progress

- `vite.config.ts`のbaseを`/timeline-route-animator/`へ変更した。未コミット。
- 旧`.github/workflows/deploy-pages.yml`を`.github/workflows/deploy.yml`へ置き換えた。`main` push時に`npm ci`、テスト、ビルド、`dist/`のPagesデプロイを行う。未コミット。
- `README.md`のProject Pages公開手順と公開URLを更新した。未コミット。
- push後、GitHub側のPages Source変更と実デプロイ確認が必要。

## Known Issues

- `pnpm build`は成功するが、メインJS chunkが約1.37MBでViteの500kB超過警告が出る。
- OpenFreeMapが広告ブロッカーやネットワーク設定で遮断されると背景地図は表示できない。現在はルートのみ表示するフォールバックへ切り替わる。
- 実際のMP4生成・保存・動画仕様の検査は未実施。
- Android ChromeとGitHub Actions経由のPages実デプロイは未確認。
- 現在公開中のGitHub Pagesはリポジトリ直下の1645-byte `index.html`を配信しており、`/src/main.tsx`を参照するため「アプリを起動しています…」で停止する。新workflowはまだ公開環境へ反映されていない。
- リポジトリ整理が必要。`.pnpm-store/`、`*.tsbuildinfo`、`vite.config.js`、`vite.config.d.ts`が追跡済みで、ルートに`gitignore`と`.gitignore`が併存している。
- `pnpm-lock.yaml`が追跡済みの一方、`package-lock.json`は未追跡。利用するパッケージマネージャーを決めて整理する必要がある。

## Next Actions

1. `vite.config.ts`、生成済み`vite.config.js`、`.github/workflows/deploy.yml`、`README.md`、`HANDOFF.md`をレビューしてコミットし、`main`へpushする。旧`.github/workflows/deploy-pages.yml`の削除も含める。
2. GitHubの **Settings → Pages → Build and deployment → Source** を **GitHub Actions** に変更し、「Deploy to GitHub Pages」workflowのbuild/deploy完了を確認する。
3. `https://rinsan1120.github.io/timeline-route-animator/`を強制再読み込みし、ビルド済み`./assets/index-*.js`が配信されてアプリUIへ切り替わること、Worker・地図・JSON読込が動くことを確認する。
4. ポイント選択・移動・連続追加・削除・Undo/Redo・rawSignals表示をデスクトップと幅360pxで確認する。
5. H.264対応Chromeで5秒MP4を実生成し、1920x1080、30fps、MP4保存、attributionを確認する。その後Android Chrome実機でも主要フローを確認する。
6. 追跡済み生成物・重複gitignore・lockfile方針を別作業として整理する。

## Verification

- `pnpm test`: passed（3 files、13 tests。ローカル実サンプルの条件付きテストを含む）
- `pnpm build`: passed
- `npm ci`: passed（116 packages、0 vulnerabilities）
- `npm test`: passed（3 files、13 tests）
- `npm run build`: passed
- `npm run dev`: startup passed。`http://127.0.0.1:5173/timeline-route-animator/`が表示された
- TypeScript check: passed（`pnpm build`内の`tsc -b`）
- Build warning: main JS chunk約1.37MB
- Codex in-app Chromium（1280px）: 実サンプル読込、ルートlayer作成、ルート全体が表示範囲内、950x606の地図領域、SVGルート線表示を確認
- External desktop Chrome local map: user confirmed
- Android Chrome: not checked
- Current GitHub Pages: failed（未ビルドのルート`index.html`を配信して起動画面で停止することをHTTP応答とファイルサイズで確認）
- New GitHub Actions Pages deployment: not checked（未コミット）
- MP4 export: not checked
- `package-lock.json`: package.jsonのdependencies/devDependenciesとの一致を確認
- Built JS/CSS refs: `/timeline-route-animator/assets/...`を確認
- Built Worker ref: `/timeline-route-animator/assets/worker-RlgR-A05.js`を確認し、ファイル存在も確認
- PWA manifest / service worker: not present

## Important Context

- Pages停止の原因はアプリコードの実行時エラーではなく、Pagesが`dist/`ではなくソースルートを公開していること。公開HTMLは1645 bytesで、ソース`index.html`と一致した。ローカルビルドの`dist/index.html`は`./assets/index-*.js`を正しく参照する。
- 新workflowは`actions/checkout@v4`、`actions/setup-node@v4`（Node 22）、`actions/configure-pages@v5`、`actions/upload-pages-artifact@v4`、`actions/deploy-pages@v4`を使用する。buildとdeployは別jobで、deployは`github-pages` environmentを使用する。
- Worker生成元は`src/App.tsx`の`new Worker(new URL('./timeline/worker.ts', import.meta.url), { type: 'module' })`で、固定URLは使用していない。
- 現在のGit branchは`main`で`origin/main`を追跡。ステージ済み変更はない。
- 現在の未コミット変更は`vite.config.ts`、生成済み`vite.config.js`、`README.md`、`HANDOFF.md`、2つの`*.tsbuildinfo`、旧`.github/workflows/deploy-pages.yml`の削除、新規`.github/workflows/deploy.yml`。`src/`配下のアプリ本体コードは変更していない。
- `docs/SPEC.md`および`docs/`ディレクトリは現時点では存在しない。
