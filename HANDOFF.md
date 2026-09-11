# HANDOFF

Last updated: 2026-09-11

## Current Status

GitHubから取得した最新 `origin/main` とローカルHEADが `9236ed9951b6fb3eedfd97441f7f03a3c767bd7a` で一致することを確認し、DAYマーカーの端末viewport依存を修正。今回の変更は未コミット。

## DAY marker video sizing fix (2026-09-11)

- `dayMarkerStyle()`／`dayMarkerLayout()` は1920×1080動画用の固定論理寸法を返す。幅・高さ・文字・border・connector・anchor・shadowへ端末viewportの逆補正を適用しない。
- 通常編集のCSS寸法維持は `dayMarkerEditingLayout()` に分離。編集時のドラッグ処理・保存済み `PopupPlacement` の1920×1080基準offsetは維持。
- 動画プレビューではDAYマーカー層を1920×1080でレイアウトし、動画フレームと同じ倍率・余白で層全体を縮小。地図投影点をこの論理座標へ変換する。
- rendererのoverview／follow／開始時ズーム／通常フレームが同じ固定レイアウトを使用。`dayMarkerReferenceViewport` と、その専用経路だったAppの `mapViewportRef`／RouteMapの通知を削除。
- DAY色、内容、距離HUD、地点バルーン、START／GOAL、カメラ、Zoom、タイル取得、動画形式には変更なし。
- `npm test`: 12ファイル・52テスト成功、任意の実データ用1ファイルはスキップ。異なるviewport／DPRでの論理寸法、編集サイズ維持、補足文幅を回帰テストで確認。
- `npm run build`: TypeScript／Viteビルド成功（チャンクサイズ警告あり）。`git diff --check`: 問題なし。
- ユーザー指定に従い、ブラウザ操作・実機確認・実MP4生成は未実施。テストのrenderer／エンコーダはモック。

## Distance HUD extension (2026-09-11)

- Step 03の既存「走行距離表示」UIをTimeline／計画モードで共用。ON/OFF・サイズ・ドラッグ移動・位置リセット・disabled条件・CSSを維持。
- `routeDistancesByDay(points, dayMarkers)` と `routeDistanceProgress.ts` の共通距離モデルを使用。`planRouteDistances` の既存契約・計算結果は維持。
- 両モードとも編集済みポイント間の地表距離を積算した概算距離。DAY境界間の接続距離は除外。Timelineの既存DAY番号を維持し、欠測日による飛び番を再採番しない。
- DAYマーカーが空の場合は先頭ポイントからDAY 1として計算。
- 通常地図は全ルートの最終距離、preview／MP4は既存のアニメーション範囲に基づく進行距離を表示。overview／follow双方で同じモデル・進行計算・描画経路を使用し、pause／camera transitionの到達判定を維持。
- DAY色分けとの連動を維持。通常地図も既存RouteMapの色判定に従う。HUD幅は実際のDAY番号のラベル長から算出。
- HelpTip本文とREADMEを両モード共通の概算距離説明へ更新。
- 設定stateを共用し、計画JSON形式・`PLAN_FILE_VERSION`・保存対象は変更なし。Undo / Redoの意味も変更なし。points／DAY境界の変更時にモデルを再計算。
- Timeline抽出・rawSignals・カメラ・動画時間軸・DAY生成・レスポンシブCSS・依存関係は変更なし。

### Verification for this extension

- `npm test`: 12ファイル・45テスト成功、任意の実データ用1ファイルはスキップ。
- 追加5テストで計画距離互換、Timeline DAY分割・飛び番、境界距離除外、空マーカー、範囲指定・進行・到達判定、HUDラベル幅・DAY色を確認。
- `npm run build`: TypeScript／Viteビルド成功。チャンクサイズ警告あり。
- `git diff --check`: 問題なし。
- ブラウザ・Android実機・生成MP4の目視確認はユーザー側で実施予定。今回こちらでは未実施。

## Previous work (historical notes)

## Completed

- クリック／タップとキーボードで開閉できる共通 `HelpTip` を `src/help/HelpTip.tsx` に追加。
- 17項目分の日本語ヘルプ文言と型安全な `HelpKey` を `src/help/helpContent.ts` に一元管理。
- Timelineの読み込み範囲、Step 02の表示・編集項目、Step 03の動画設定へ、概念単位の「?」ボタンを追加。
- ヘルプ本文を対象項目の直下へインライン表示し、親コンテナ内で自然に折り返すレスポンシブCSSを追加。
- `AGENTS.md` に、今後左側パネルへ設定・編集項目・操作概念を追加するときは、明示的な指示がなくても同時にコンテキストヘルプを追加する恒久ルールを追記。
- READMEへ左側パネルの「?」から説明を確認できることを追記。
- 計画モードの「選択」「連続追加」「途中追加」「範囲削除」「削除」「元に戻す」「やり直す」「初期状態」へヘルプを追加。
- ツールバー用の8項目の文言を `src/help/helpContent.ts` に追加し、既存の `HelpKey` と `HelpTip` を再利用。
- ツールバー用ヘルプ本文を横スクロール領域外へ表示する最小限の `toolbar` バリエーションを追加。
- 空状態の「JSONを選択」を「JSONファイルを選択」へ変更。ファイル選択処理とヘッダー文言は変更していない。
- `AGENTS.md` のコンテキストヘルプ規則を、左側パネル限定からユーザー向けUI全般へ拡張。
- `HelpTip` に任意のcontrolled propsを追加し、既存の内部state方式との互換性を維持。
- Appで開いているtoolbar用 `HelpKey` を1つだけ管理し、別の「?」を押すと現在のヘルプを閉じて新しいヘルプだけを表示。
- 同じ「?」の再操作、編集モード終了、ツールバー非表示、Timeline／計画モード切替でtoolbarヘルプをクリア。
- inline／toolbar共通で、淡い青系背景、青灰色の枠線、左アクセント、タイトル先頭の丸囲み「?」を使用。
- inlineヘルプだけに、ヘルプボタンとの関係を示す小さな吹き出し突起を追加。toolbarのportal／fixed配置は変更していない。
- DAY色分け時、DAYマーカーの外枠・コネクタ・アンカーを既存の `dayRouteColor(dayNumber)` と同じ色へ変更。
- `dayMarkerColors()` に色決定を共通化し、背景・文字・日付・影・アンカー白枠は従来デザインを維持。
- 通常地図では既存ルートと同様に常時DAY色を使い、プレビュー／MP4では既存のStep 03トグルへ連動。
- overview／followの両動画描画経路とブラウザ表示で共通のDAYマーカー色決定ロジックを使用。

## Preserved Behavior

- inlineヘルプは各 `HelpTip` 内の独立した一時stateを維持し、toolbarヘルプだけをApp内の一時stateで排他管理する。いずれもRoutePoint、計画JSON、localStorage、Undo / Redo履歴へ保存しない。
- Timeline／計画モード、ポイント編集、DAY設定・色分け、地点停止、地点バルーン、START / GOAL、距離HUD、アニメーション範囲、プレビュー、カメラ、Zoom、MP4生成の処理は変更していない。
- 既存のDOM ID、設定値、保存形式、`PLAN_FILE_VERSION` は変更していない。
- ヘルプボタンは既存の `label` の外へ配置し、入力コントロールとの関連付けを維持している。
- ツールバーの操作ボタンとヘルプボタンは兄弟要素で、操作ボタンのイベント処理、disabled条件、表示条件は変更していない。
- 計画JSON、編集履歴、ルート編集ロジック、プレビュー／MP4ロジックは変更していない。
- 今回の変更はヘルプ専用CSSのみで、開閉挙動、文言、データ構造、通常の `.detail-card` デザインは変更していない。
- DAY色はDAY番号から都度導出し、RoutePoint、DayMarker、計画JSON、Undo / Redo履歴へ保存しない。`PLAN_FILE_VERSION` も変更していない。

## Verification

- TypeScriptの `HelpKey` により、存在しないヘルプキーを `HelpTip` へ指定できない構造。
- DAYマーカー色のOFF時互換、ON時のoutline／anchor、DAY 11循環、背景・文字・日付・影の維持をテストへ追加。
- `npm test`: 12ファイル・41テスト成功。
- `npm run build`: TypeScript/Viteビルド成功（既存のチャンクサイズ警告のみ）。
- `git diff --check`: 問題なし。
- ブラウザ表示とAndroid実機の目視確認はユーザー側で実施予定。

## Important Context

- ヘルプ文言の変更・追加は `src/help/helpContent.ts`、表示挙動の変更は `src/help/HelpTip.tsx` を使用する。
- 新しいユーザー向け設定、編集ツール、操作モード、地図上ボタン、ツールバー項目を追加する際は、配置場所を問わずヘルプの要否を検討する。
- ツールバーでは `variant="toolbar"` を使い、本文を横スクロール領域外へ表示する。
- toolbarの `HelpTip` は `open` / `onOpenChange` を渡すcontrolled mode、inlineの `HelpTip` はpropsを省略するuncontrolled modeで使用する。
- 単純な削除、Undo、保存、リセット等へは機械的にヘルプを追加しない。
