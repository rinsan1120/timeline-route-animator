# Timeline Route Animator

Android版Google Maps TimelineからエクスポートしたJSONを、端末の外へ送信せずに読み込み、1日・時間帯単位でルートを手動編集してFHD MP4動画にするWebアプリです。

## 主な機能

- Timeline JSONをWeb Worker内で解析（日付index、`timelinePath`、`rawSignals.position`）
- `activity.topCandidate.type`に依存しないルート抽出
- 日付とFrom / Toによる一日分の抽出
- MapLibre GL JS + OpenFreeMapによる地図表示
- ルートポイントの追加、連続追加、ドラッグ移動、削除
- Undo / Redo / 初期状態への復元（PCではCmd/Ctrl+Z、Cmd/Ctrl+Shift+Zにも対応）
- rawSignalsの参考表示と精度別の色分け
- 累積距離に基づく一定速度アニメーション
- 全ルート表示 / 通過済みルート表示
- WebCodecs + Mediabunnyによる1920×1080・30fps・H.264 MP4生成
- 編集済みルートだけを含むプロジェクトJSONの保存

Timeline JSON本体はアップロード、外部API送信、localStorage保存を一切行いません。地図タイルの表示にはOpenFreeMapへのネットワーク接続が必要です。

## 対応ブラウザ

- Android版Google Chrome最新版（最優先）
- Windows / macOS版Google Chrome最新版

MP4生成にはWebCodecsのH.264エンコーダーが必要です。非対応環境では日本語のエラーを表示します。端末性能や空きメモリによってはFHD生成に時間がかかります。

## セットアップ

Node.js 20以降を用意してください。

```bash
npm install
npm run dev
```

表示されたローカルURLをChromeで開きます。

## テストとビルド

```bash
npm run test
npm run build
```

`sample-data/`に実Timeline JSONがある場合、テストはそのファイルも自動で解析します。位置や時刻はテスト出力へ表示しません。`sample-data/`、`*.private.json`、Timelineの標準ファイル名は`.gitignore`で除外されています。

## 操作方法

1. 「JSONを開く」からAndroid版Google Maps TimelineのJSONを選びます。
2. 検出された日付を1つ選び、From / Toを指定して「この範囲を読み込む」を押します。
3. 「編集」に切り替えます。ポイントをタップして選び、大きなオレンジのハンドルをドラッグして移動します。
4. 「連続追加」を選ぶと、地図をタップするたびに最も近いルート区間へ手動点を挿入します。道路スナップや自動補完は行いません。
5. 必要に応じて「測位データを表示」を有効にし、参考点をタップしてsourceやaccuracyを確認します。rawSignalsはルートへ自動追加されません。
6. 動画時間とルート表示方法を選び、プレビュー後に「MP4を生成」を押します。
7. 完了後、「MP4を保存」から`route-YYYY-MM-DD.mp4`を保存します。

## GitHub Pagesへ公開

`vite.config.ts`は相対baseを使用しているため、ユーザー/組織ページとプロジェクトページの両方に対応します。

1. `npm run build`を実行します。
2. GitHubリポジトリの Settings → Pages で、GitHub Actionsまたは`dist`を公開する任意の静的ホスティング手順を設定します。
3. Actionsを使う場合は、Nodeをセットアップして`npm ci`、`npm run build`を実行し、`dist/`をPages artifactとしてdeployします。

実Timeline JSONや`sample-data/`はpushしないでください。

## 実装上の制約

- ルート本体には`semanticSegments[].timelinePath`だけを使用します。
- `rawSignals.position`は人間が補正するときの参考表示専用です。
- activity type、Routing API、道路スナップ、AI推定、自動GPS補完は使用しません。
- 動画生成時は専用MapLibre mapを一度読み込み、背景を1回だけCanvasへキャプチャします。各フレームでは背景を再利用し、ルートとマーカーだけを描画します。
- 数十MBのJSONでもUIを長時間止めないよう、ファイルの読み取り・`JSON.parse`・index作成・範囲抽出はWorkerで行います。ただし標準の`JSON.parse`自体は全体を一度メモリへ展開します。
- V1ではGPX/KML、4K、60fps、カメラ追従、任意PNGマーカー、複数日結合には対応しません。

## Attribution

編集画面ではMapLibreのAttributionControlを表示し、生成動画には`© OpenFreeMap © OpenStreetMap contributors`を焼き込みます。
