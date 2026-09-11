# HANDOFF

Last updated: 2026-09-11

## Current Status

GitHub `main`、`origin/main`、ローカルHEADが `108f57b` で一致することを確認後、DAYマーカーのアクセントをDAYルート色へ連動。今回の変更は未コミット。

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
