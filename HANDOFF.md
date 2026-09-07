# HANDOFF

Last updated: 2026-09-07

## Current Status

V1の主要フロー（Timeline JSON読込、1日・時間範囲抽出、地図表示、手動編集、プレビュー、MP4生成）はコード上実装済み。ローカルChromeの地図表示修正はユーザー確認済みで、commit `be9e455`まで`origin/main`と同期している。現在はGitHub Pagesがリポジトリ直下の未ビルド`index.html`を配信して起動画面で停止する問題に対応中。`dist/`を公開するGitHub Actions workflowを追加したが、未コミット・未デプロイ。

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

- `.github/workflows/deploy-pages.yml`を新規追加し、`main`へのpush時に`npm ci`、テスト、ビルド、`dist/`のPagesデプロイを行う構成にした。未コミット。
- `README.md`のGitHub Pages手順を、SettingsでSourceをGitHub Actionsに設定する内容へ更新した。未コミット。
- workflowをpush後、GitHub側のPages設定変更と実デプロイ確認が必要。

## Known Issues

- `pnpm build`は成功するが、メインJS chunkが約1.37MBでViteの500kB超過警告が出る。
- OpenFreeMapが広告ブロッカーやネットワーク設定で遮断されると背景地図は表示できない。現在はルートのみ表示するフォールバックへ切り替わる。
- 実際のMP4生成・保存・動画仕様の検査は未実施。
- Android ChromeとGitHub Actions経由のPages実デプロイは未確認。
- 現在公開中のGitHub Pagesはリポジトリ直下の1645-byte `index.html`を配信しており、`/src/main.tsx`を参照するため「アプリを起動しています…」で停止する。新workflowはまだ公開環境へ反映されていない。
- リポジトリ整理が必要。`.pnpm-store/`、`*.tsbuildinfo`、`vite.config.js`、`vite.config.d.ts`が追跡済みで、ルートに`gitignore`と`.gitignore`が併存している。
- `pnpm-lock.yaml`が追跡済みの一方、`package-lock.json`は未追跡。利用するパッケージマネージャーを決めて整理する必要がある。

## Next Actions

1. `README.md`、`.github/workflows/deploy-pages.yml`、`HANDOFF.md`をレビューしてコミットし、`main`へpushする。
2. GitHubの **Settings → Pages → Build and deployment → Source** を **GitHub Actions** に変更し、「Deploy to GitHub Pages」workflowのbuild/deploy完了を確認する。
3. `https://rinsan1120.github.io/timeline-route-animator/`を強制再読み込みし、ビルド済み`./assets/index-*.js`が配信されてアプリUIへ切り替わること、Worker・地図・JSON読込が動くことを確認する。
4. ポイント選択・移動・連続追加・削除・Undo/Redo・rawSignals表示をデスクトップと幅360pxで確認する。
5. H.264対応Chromeで5秒MP4を実生成し、1920x1080、30fps、MP4保存、attributionを確認する。その後Android Chrome実機でも主要フローを確認する。
6. 追跡済み生成物・重複gitignore・lockfile方針を別作業として整理する。

## Verification

- `pnpm test`: passed（3 files、13 tests。ローカル実サンプルの条件付きテストを含む）
- `pnpm build`: passed
- TypeScript check: passed（`pnpm build`内の`tsc -b`）
- Build warning: main JS chunk約1.37MB
- Codex in-app Chromium（1280px）: 実サンプル読込、ルートlayer作成、ルート全体が表示範囲内、950x606の地図領域、SVGルート線表示を確認
- External desktop Chrome local map: user confirmed
- Android Chrome: not checked
- Current GitHub Pages: failed（未ビルドのルート`index.html`を配信して起動画面で停止することをHTTP応答とファイルサイズで確認）
- New GitHub Actions Pages deployment: not checked（未コミット）
- MP4 export: not checked
- `npm test` / `npm run build`: not run（この確認ではpnpmを使用）
- `package-lock.json`: package.jsonのdependencies/devDependenciesとの一致を確認

## Important Context

- Pages停止の原因はアプリコードの実行時エラーではなく、Pagesが`dist/`ではなくソースルートを公開していること。公開HTMLは1645 bytesで、ソース`index.html`と一致した。ローカルビルドの`dist/index.html`は`./assets/index-*.js`を正しく参照する。
- 新workflowは`actions/checkout@v4`、`actions/setup-node@v4`（Node 22）、`actions/configure-pages@v5`、`actions/upload-pages-artifact@v4`、`actions/deploy-pages@v4`を使用する。
- 現在のGit branchは`main`で`origin/main`を追跡。ステージ済み変更はない。
- 現在の未コミット変更は`README.md`、`HANDOFF.md`、新規`.github/workflows/deploy-pages.yml`。アプリ本体コードの未コミット変更はない。
- `docs/SPEC.md`および`docs/`ディレクトリは現時点では存在しない。
