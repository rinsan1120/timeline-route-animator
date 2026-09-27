# HANDOFF

Last updated: 2026-09-27

## Timeline output DAY filter (2026-09-27)

- Appの一時state selectedOutputDay（all／日付）を追加。開始日・終了日の下に既存selectデザインとHelpTipを配置。計画モードには表示しない。
- 全pointsと既存dayMarkersを正として、DAY開始IDから次DAY開始IDの直前までslice。先頭DAYには先行manual点も含める。日時なしmanual点を除外せず、DAY番号・色・補足・配置を維持。
- dayFilteredPoints → animationPointsの順で絞り、RouteMap／カメラ／停止／HUD／preview／MP4へ反映。rawSignalsの参考表示も選択日のみ。表示中の点数・距離を見出しへ反映。
- 編集は全pointsへIDで反映。追加位置だけ表示中DAYで決め、新規点を全pointsへ挿入。非表示DAYのpointsやannotation、metadataは維持。Undo/Redoは従来の全行程historyを使用。
- 日程切替で選択・アニメ範囲・preview・follow plan・生成済み動画をクリア。元JSON読込／範囲再抽出／作業再開はall、選択日が範囲外・消失した場合もallへ戻す。
- 作業保存は全pointsを維持し、選択stateは非保存。workFile／planFileと両versionは未変更。選択日内で指定したアニメ範囲は従来どおり既存保存項目として扱う。
- 人間側で全日程／各DAY、手動点追加・削除・移動、DAY開始点削除、Undo/Redo、ラベルとDAY情報維持、アニメ範囲リセット、HUD・停止・overview/follow・MP4、全行程保存と再開、PC/Androidを確認。テスト・ブラウザ操作・実MP4生成は実行していない。

## Common balloon pause (2026-09-27)

- ポイント編集欄の「地点で停止」と旧ヘルプを削除。Step 03に共通停止時間（初期0秒、0〜30秒、0.5秒刻み）とHelpTipを追加。AppのcommonPauseSecondsとして保持し、JSONには保存しない。
- balloonPauses.tsがanimationPoints・既存dayMarkers・routeMarkerModeから導出。trim後のラベルあり、またはDAY表示時のDAY 2以降開始地点をOR判定し、同一地点は1回。先頭ラベルも対象、範囲外は除外。
- PlaybackTimelineは外部のポイント別秒数配列を受け取り、RoutePoint.pauseSecondsを参照しない。legacyフィールド・JSON parser・format/versionは維持。
- Appとrendererのoverview/followは同じ停止判定と時間軸生成を使用。停止中は対象pointIndexを使い、地点位置・バルーン到達判定を保持。合計停止時間はUI出力時間と進捗フレーム総数にも反映。
- プレビューも開始前3秒・到着後3秒を含めてMP4の長さへ統一。開始ZoomのON/OFFはカメラ演出のみを切り替える。
- 既存時間軸テストを外部秒数入力へ更新し、条件重複・DAY表示OFF・ラベル・範囲・旧値無視・overview/follow一致のテストを追加。ユーザー指定どおりテスト実行、ブラウザ操作、実MP4生成は行っていない。
- 人間側で提示9ケース、ラベル／DAY変更とUndo/Redo、旧JSON読込、アニメ範囲、PC/Android入力、overview/followのバルーン表示と停止、出力時間とフレーム数、MP4保存を確認する。

## MP4 overwrite diagnostics (2026-09-27)

- 確認できた問題は、Appが保存例外を一律の文言に変換し、失敗段階と原因を確認できなかったこと。現地の上書き失敗は未再現で、ファイルロック・権限等の根本原因は未確定。上書き問題の解消を実証したものではない。
- `saveBlob.ts` はpicker／Blob準備／createWritable／write／close／abort／downloadごとにローカルconsoleへstage・例外name・messageのみ記録。Blob・handle・GPS・JSON内容は記録しない。abort失敗も記録するが、元例外を維持。
- `createWritable({ keepExistingData: false })` で全置換を明示（既存のデフォルト動作と同じ）。追加権限要求・自動再試行・MP4変換は行わない。close成功後はabortせず、失敗時のみ取得済みwritableをabort。closeは一度だけ。
- Chrome公式資料の保存手順と既存手順は一致し、createWritableが権限確認を担うためqueryPermission/requestPermissionは追加しない。参考: https://developer.chrome.com/docs/capabilities/web-apis/file-system-access
- pickerのAbortErrorだけ無操作終了。書込段階のAbortErrorは中断として通知。NoModificationAllowedErrorは使用中の可能性と別保存先、NotAllowedErrorは権限確認を日本語で案内。他に容量不足・保存先消失・セキュリティ制限を区別。
- MP4生成は両カメラ経路ともメモリbufferからvideo/mp4 Blobを作成。保存時にnull／0バイト／MIMEを検査し、正常な同じBlobを新規・上書きへ渡す。Object URL破棄はBlob参照を変更しない。実際の保存成功は人間側確認が必要。
- Timeline／計画JSONのserialize・MIME・候補名、picker非対応時のdownloadとURL破棄は維持。共有の日本語エラー分類だけ両JSONにも適用。
- 人間側で新規MP4／既存MP4上書きと再生、使用中ファイル、キャンセル、両JSON新規／上書き、非対応ブラウザを確認。失敗時は開発者ツールの `[File Save]` のstage・name・messageを確認する。ブラウザ操作・実MP4生成・テスト実行は行っていない。

## JSON detection and Save As (2026-09-27)

- 上部のJSON読込は `readLeadingFileFormat()` で先頭4KBのルート先頭formatを判定。workはStep 01と共通の `restoreWorkFile()` → `parseWorkFile()` → State復元へ分岐し、Workerへ送らない。planは計画モードからの再開を案内。それ以外は既存のArrayBuffer転送／Worker解析を維持。
- `src/files/saveBlob.ts` に保存処理を集約。対応時はクリック起点で毎回pickerを開き、選択後にBlobを書き込み。ハンドルは保持しない。pickerのAbortErrorは無操作で終了。書込失敗は日本語エラー、API非対応時だけObject URL／downloadへフォールバックし、URLを破棄。
- JSON serialize・形式・versionと動画Blob生成は変更なし。JSON候補名はroute-work.json／route-plan.json、再開・保存後はそのファイル名を使用。MP4は生成Blobを参照し、保存ボタン押下時だけpickerを起動。再生用Object URLと既存破棄処理を維持。
- 人間側で両経路からの作業復元、大容量元JSONの読込、計画JSONの案内、3種類の保存・上書き・キャンセル・非対応環境のダウンロード、MP4再生を確認する。テスト実行・ブラウザ操作・実MP4生成は行っていない。

## Timeline work save/resume (2026-09-27)

- `src/timeline/workFile.ts` に専用形式 `timeline-route-animator-work` / version 1を追加。計画用形式・version・処理は変更なし。
- Timeline Step 01へ「作業を保存／再開」を追加。React Stateから編集済みpoints、日時範囲、DAY補足／配置、START／GOAL配置、バルーンサイズ、アニメ範囲を保存。DAY境界は日時と開始日から既存ロジックで復元。
- 全データ検証後に直接Stateを復元し、historyのloadで履歴を初期化。Workerへ作業JSONを送らず、元JSONも要求しない。再開時はdatesを空にして古いWorkerデータからの再抽出を防ぐ。
- rawSignals・元JSON・Undo履歴・一時UI・スマホDAY倍率・距離HUD・その他動画設定は保存対象外。rawSignalsは空／非表示、HUDとスマホDAY倍率は初期値へ戻す。
- 再保存、削除維持、annotation往復、DAY番号、形式／version／構造不正拒否のテストを既存Vitest環境に追加。ユーザー指定によりテスト実行、ブラウザ操作、実機確認、実MP4生成は未実施。
- `npm run build` 成功（チャンクサイズ警告あり）。`git diff --check` 問題なし。
- 人間側で元Timeline抽出→編集→保存→ページ再読込→作業再開→再編集／再保存、および計画モード、PC／Android表示、プレビュー／MP4を確認する。

## Current Status

最新GitHub `origin/main` とローカルHEADが `f0c8e0c3769218093404a5ed7883dc2ca9e8572a` で一致することを確認し、固定動画サイズの適正化とスマホ編集表示倍率を実装。今回の変更は未コミット。

## DAY marker fixed size and mobile editing scale (2026-09-11)

- `VIDEO_DAY_STYLE` をFHD固定値（最小幅230px、DAY文字24px）へ拡大。日付・補足・padding・枠・connector・anchor・影も同程度に調整。画面端の余白は維持。
- renderer／動画プレビューは同じ `dayMarkerLayout()` を継続使用。viewport・DPR・編集倍率による動画サイズ補正は追加していない。
- 従来の編集用CSS寸法を `EDITING_DAY_STYLE` に分離し、PC通常編集は138px／14pxの操作感を維持。
- 760px以下のDAY編集欄だけに「DAY編集表示サイズ」を追加（75〜175%、25%刻み、初期100%）。共通HelpTipで編集専用・非保存を説明。Timeline／計画で共用。
- `mobileDayMarkerEditingScale` はAppの一時state。OverlayはmatchMediaの760px境界で通常編集時のみ適用し、PC表示や動画プレビューには適用しない。renderer、動画設定、計画JSONへ渡さない。
- CSS transformで編集倍率を変更せず、レイアウト寸法・文字・枠・connector・anchor・影を直接更新。実際のoffsetWidth／offsetHeightで配置・clamp・ドラッグを計算。PopupPlacementとドラッグ保存座標の仕様は変更なし。
- `npm test`: 12ファイル・53テスト成功、任意の実データ1ファイルはスキップ。端末viewport／DPR非依存、新動画サイズ、編集倍率の全寸法への適用、動画への非干渉、日付・補足、配置座標・画面端clampを確認。
- `npm run build`: 成功（チャンクサイズ警告あり）。`git diff --check`: 問題なし。
- 指定どおりブラウザ操作・実機確認・実MP4生成は未実施。

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
