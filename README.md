# Timeline Route Animator

Android版Google Maps TimelineからエクスポートしたJSONを、端末の外へ送信せずに読み込み、1日・時間帯単位でルートを手動編集してFHD MP4動画にするWebアプリです。

## 主な機能

- Timeline JSONをWeb Worker内で解析（日付index、`timelinePath`、`rawSignals.position`）
- `activity.topCandidate.type`に依存しないルート抽出
- 日付とFrom / Toによる一日分の抽出
- MapLibre GL JS + OpenStreetMap標準ラスタータイルによる地図表示
- ルートポイントの追加、連続追加、ドラッグ移動、削除
- Undo / Redo / 初期状態への復元（PCではCmd/Ctrl+Z、Cmd/Ctrl+Shift+Zにも対応）
- rawSignalsの参考表示と精度別の色分け
- 累積距離に基づく一定速度アニメーション
- 任意の地点に0.5秒刻み（最大30秒）の停止時間を設定
- 通常編集画面のルートをDAYごとの固定色で表示
- 全ルート表示 / 通過済みルート表示
- 設定項目や計画モードの編集ツールにある「?」から簡単な説明を表示
- WebCodecs + Mediabunnyによる1920×1080・30fps・H.264 MP4生成
- 計画モードのルート・地点バルーン・DAY情報を専用JSONへ保存し、後から編集を再開

Timeline JSON本体はアップロード、外部API送信、localStorage保存を一切行いません。地図タイルの表示にはOpenStreetMapへのネットワーク接続が必要です。

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
6. 必要な地点に停止時間を設定し、動画時間とルート表示方法を選び、プレビュー後に「MP4を生成」を押します。
7. 完了後、「MP4を保存」から`route-YYYY-MM-DD.mp4`を保存します。

地点ごとの停止時間は移動時間とは別に扱われ、対象地点の停止時間の合計が動画の出力時間へ追加されます。アニメーション範囲の先頭地点と範囲外の地点に設定した停止時間は、その動画には加算されません。

通常編集画面ではDAYごとにルートを固定色で表示し、DAYマーカーの外枠・コネクタ・アンカーも同じ色にします。色は10色のパレットを循環し、DAY11はDAY1と同じ色へ戻ります。動画ではStep 03の「DAYごとにルートを色分け」でプレビュー・MP4の色分けを切り替えられ、ONの場合はDAYマーカーのアクセントと走行距離HUDの各DAY行にもルートと同じ色を表示します。

### 動画プレビューの画角

全体表示・追従表示とも、プレビュー中の中央16:9枠がMP4へ出力される範囲です。全体表示の自動／カスタムZoomは1920×1080基準の共通カメラを使い、ブラウザ側だけ枠の縮小率でZoomを換算します。自動表示の余白と中心位置、開始時ズームも同じ動画座標を基準とし、通常編集時のカメラはプレビュー終了時に復元します。枠外の地図は動画には含まれません。

### 計画モードの概算距離

計画モードの「編集」ツールバーには「選択」「連続追加」「途中追加」「範囲削除」があります。「連続追加」は末尾へ追加し、「途中追加」はクリック位置に最も近い同一DAY内の区間へ挿入します。クリックした緯度経度はそのまま使い、道路やルート線へ吸着させません。途中追加は2点以上で利用でき、追加後も継続できます。DAY境界をまたぐ区間は候補に含めず、候補がなければエラーを表示します。追加した点はUndo／Redo・計画JSON保存の対象になります。

Step 02「ルートを整える」にDAY別の概算距離と合計を表示します。登録ポイント間の地表上の直線距離を合計し、DAY境界をまたぐ区間は除外します。道路に沿った走行距離ではありません。ポイント編集・Undo / Redo・DAY設定変更・作業再開に合わせて更新され、見出しにも同じ合計を表示します。

### Timeline／計画モード共通の概算距離HUD

DAYマーカーの動画用寸法は1920×1080基準（最小幅138px、DAY文字14px等）で固定し、生成端末やブラウザviewportに依存しません。動画プレビューは同じ論理レイアウト全体を動画フレームの倍率で縮小します。通常編集画面では操作しやすい従来のCSS寸法を維持します。日付・補足の有無や文字幅を反映し、保存済みの配置offsetの意味は変更しません。

Step 03「動画にする」の「走行距離表示」をONにすると、Timeline／計画モードともに地図とMP4（overview／follow）にDAY別・TOTALの概算距離HUDを表示します（初期OFF）。編集画面ではルート全体の最終距離、プレビューと動画では現在地点までの距離をkm小数1桁で表示します。アニメ範囲の途中開始では、それ以前の走行距離も含みます。DAY間の接続区間やカメラ移動だけの間は加算しません。

両モードともポイント間距離を積算した概算値です。GPSの記録飛びや道路形状との差によって実走行距離とは異なる場合があります。TimelineのDAY番号は欠測日があっても再採番せず、既存の番号とDAY色を維持します。

サイズは50〜200%で調整でき、地図上のHUDをドラッグすると1920×1080の動画フレーム内で位置を変更できます。「位置をリセット」で左上へ戻せます。DAY数などによりパネルが動画より大きくなる場合は、全体が収まる倍率まで縮小します。プレビュー・動画生成中は配置変更できません。HUD設定は計画JSONに保存せず、新しい計画・作業再開時にOFF／100%／初期位置へ戻ります。

### 計画モードの作業保存・再開

「計画モード」の「ルートを計画する」内で、1点以上あるときに「作業を保存」を押すと、`route-plan-YYYYMMDD-HHmmss.json`を端末へ保存します。「作業を再開」からこのファイルを選ぶと、現在のルートを保存状態へ置き換え、ポイントID・地点バルーンの文言と配置・DAY区切り・DAY補足と配置を復元します。

動画設定やUndo / Redo履歴は含みません。再開した状態が新しい初期状態になります。ヘッダーの「JSONを開く」はTimeline専用です。計画JSONはサーバーへ送信されませんが、位置情報を含むため取扱いに注意してください。

## GitHub Pagesへ公開

`vite.config.ts`のbaseはProject Pagesの公開パス`/timeline-route-animator/`に設定されています。

1. GitHubリポジトリの **Settings → Pages → Build and deployment → Source** を **GitHub Actions** に設定します。
2. `main`へpushすると、`.github/workflows/deploy.yml`がテストとビルドを実行し、生成された`dist/`だけをPagesへ公開します。
3. Actionsの「Deploy to GitHub Pages」が完了してから公開URLを開きます。リポジトリ直下を直接Pagesへ公開すると、未ビルドの`/src/main.tsx`が参照されてアプリは起動しません。

実Timeline JSONや`sample-data/`はpushしないでください。

公開URL: <https://rinsan1120.github.io/timeline-route-animator/>

## 実装上の制約

- ルート本体には`semanticSegments[].timelinePath`だけを使用します。
- `rawSignals.position`は人間が補正するときの参考表示専用です。
- activity type、Routing API、道路スナップ、AI推定、自動GPS補完は使用しません。
- 動画生成時は専用MapLibre mapを一度読み込み、背景を1回だけCanvasへキャプチャします。各フレームでは背景を再利用し、ルートとマーカーだけを描画します。
- OSMタイルの一部が読み込めなくても、背景全体を無効化せずルート表示・編集を維持します。動画用地図の読込がタイムアウトした場合はローカル背景で動画化します。
- 背景styleは`src/map/osmStyle.ts`で共通定義し、`https://tile.openstreetmap.org/{z}/{x}/{y}.png`を使用します。[OSM Tile Usage Policy](https://operations.osmfoundation.org/policies/tiles/)に従い、ブラウザの通常キャッシュとRefererを利用します。viewportに必要なタイルのみ取得し、bulk download・複数zoomの事前取得・offline download・tile archiveは実装しません。
- 数十MBのJSONでもUIを長時間止めないよう、ファイルの読み取り・`JSON.parse`・index作成・範囲抽出はWorkerで行います。ただし標準の`JSON.parse`自体は全体を一度メモリへ展開します。
- V1ではGPX/KML、4K、60fps、カメラ追従、任意PNGマーカー、複数日結合には対応しません。

## Attribution

編集画面ではMapLibreのAttributionControlを折りたたまず表示し、生成動画には`© OpenStreetMap contributors`を白い背景に22pxの文字で焼き込みます。
