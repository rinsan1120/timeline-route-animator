# HANDOFF

## Shared edit Undo / Redo — V1.3 第3回

- Appはhistory.tsのEditSnapshot（points、DAY／端点の旧placementと動画固定座標、HUDのx/y、セッション内の旧DAY互換キー）を単一Reducerのpast／present／futureで管理する。地図・映像の既存ボタンとCtrl／Cmd+Z・Shift+Zは同じ履歴を操作する。スポット編集等の従来の配列形式APIは同じReducerコアのラッパーとして維持し、スポットの仕様は変更しない。
- 地点と通常バルーンは従来のcommit経路、DAY／START・GOALの地図移動・位置リセットはplacement変更と対象固定座標の無効化を1件でcommitする。無関係な位置は維持。内容が同じcommitは履歴やRedoを変更しない。地図ポップアップのドラッグが開始位置へ戻った場合も確定しない。
- DistanceHudOverlayはローカルのドラフトだけをPointerMoveで動かし、正常PointerUpの実移動を1回だけ親へ通知する。キャンセル・キャプチャ喪失・非活性化・作品／履歴／レイアウト変更・画面離脱でドラフトとキャプチャを破棄する。HUD位置リセットも1件のcommit。enabled／scaleはAppの別stateで管理し、Undoで巻き戻さない。モデル・サイズ由来の自動clampは履歴を増やさない専用更新。
- 新規作品・JSON復元は配置と地点をloadでまとめて設定し、過去／未来をクリアする。時間範囲再抽出は従来どおり配置を保持して履歴をクリア。「初期状態」はpointsだけを初期値へ戻すUndo可能な操作であり、DAY／端点／HUDの位置や動画設定をリセットしない。
- 通常バルーンの自動補完は過去／現在／未来／初期へ従来どおり反映し、共有していた地点配列の参照を維持する。DAY／端点の自動解決も履歴を増やさず、同じルート形状・停止条件・対象placement・旧DAY互換区分の未設定座標だけを補完する。既存固定座標は上書きしない。Undo／Redoを含む確定操作でrevisionを進め、元snapshot照合と既存token／AbortSignalで古い結果を遮断する。第2回の旧寸法・投影・基準フレーム計算は変更しない。
- 保存は現在の確定値だけを従来のJSONフィールドへ渡す。HUDドラフトと履歴、互換キーは保存しない。既存の未保存比較・MP4鮮度比較・生成時コピーはReducerの現在値を参照する。format／version:1と既存フィールドは変更しない。
- 第4回の映像上DAY／START・GOAL／HUD直接ドラッグは未実装。実装時もドラフトを保存状態から分離し、PointerUpで対象の固定座標だけを同じcommitへ渡すこと。HUDの履歴位置（x/y）と非履歴設定（enabled／scale）を再統合しないこと。依頼に沿いテスト・ビルド・ブラウザ／実機確認は未実施。

## DAY / START / GOAL frame positions — V1.3 第2回

- 作業JSON／計画JSONともトップレベルの任意フィールドdayMarkerFramePositionsとendpointMarkerFramePositionsを追加。値は通常バルーンと同じ{x,y}（1920×1080矩形中心の0〜1正規化座標）。DAYキーはTimelineの日付／計画DAY開始地点ID、端点はSTART／GOAL。有限数・範囲と日付／空でないID／端点ラベルを検証する。format／version:1、旧placement、videoSettingsは維持。削除中・出力範囲外のDAY情報も既存メタデータと同様に保持する。
- markerFramePositions.tsが実MP4のbuildFramePlan／sampleFrameを使い、到達条件と従来の画角内判定を満たす最初のフレームを探索する。STARTイベントのpreFramesを変換基準と決め打ちせず、実描画の開始条件を使う。開始時ズームもMP4の中間カメラで評価する。編集地図のtransformを1920×1080・動画FOV・動画の制約で複製した参照投影を使い、地図の移動やタイル取得は行わない。長い探索は128サンプルごとにUIへ制御を戻す。
- 旧JSONの未設定DAYは、下記に保存した旧寸法・旧省略処理・clampから旧矩形中心を算出する。新規DAYと地図で変更したDAYは現行寸法を使う。端点は旧／現行とも230×78と従来の余白・gapを使用。互換矩形は変換専用に閉じ込め、旧レイアウト記録は変更しない。
- Appで結果を編集状態へ確定し、以後はカメラ・文字サイズ変更やシークで再変換しない。表示対象でない／有効フレームのないマーカーには座標を捏造せず、旧情報を残し出力範囲等の変更で再試行する。自動解決完了までプレビューを準備状態とし、保存・生成の入口でも同じ解決処理を待つ。入力トークン・編集世代・AbortSignalで古い結果を遮断する。
- 地図のドラッグ／リセットは従来のplacementを更新し、対応する固定座標だけを無効化して再解決する。他の固定位置を巻き込まない。描画は共通videoMarkerRectで固定中心と現在寸法からclampし、地理アンカー／接続線は各フレームの投影に追従する。通常バルーン・HUDの描画、地図編集用DAYレイアウトと操作、プレビューのみ開始時ズームを省略する仕様は維持。
- 新座標は未保存比較へ含め、自動解決は履歴へ積まず、保存成功時のみ既存の保存基準を更新する。MP4鮮度比較では現在出力するマーカーモードの新座標を優先し、生成開始時に座標をコピーする。計算済みフレーム・カメラ・互換判定フラグ・地図オブジェクトは保存しない。
- 第3回ではこの独立した配置stateと地図更新の履歴統合を扱うこと。第4回の映像上ドラッグは未実装。旧情報を残した未解決対象を一括で中央配置したり、保存済み固定位置をカメラ変更で再初期化しないこと。依頼に沿いテスト・ビルド・ブラウザ／実機確認は未実施。

## Preview omits intro zoom; MP4 keeps it

- オーナー決定により開始時ズームはMP4出力だけに適用。映像タブではON／OFFに関係なく、Pre-rollの全フレームをズーム完了後の画角で静止表示する。Pre-roll 0秒は停止区間なし。Follow本編のカメラ追従・Zoom変化とOverviewの設定Zoomは維持。
- previewFrameRenderer内で元のFramePlanを時間軸・イベント番号・既存JSONバルーン位置補完用として保持し、描画のsampleFrameだけintroZoomEnabled:falseのコピーを使う。preFrames／FPS／総フレーム数・再生時刻は元のまま。イベント探索は従来の計画と地図を動かさない参照投影を使い、イベントのフレーム番号を維持する。
- OverviewのPre-rollは本編と同じ静的背景キャッシュを使う。元設定ON時は従来の冒頭のreachedPointIndex=0によるバルーン・DAY等の表示条件と時計／HUDを保持し、カメラだけ完成画角にする。Followは同じ初期画角の背景・投影・prepareCameraを再利用し、Pre-roll終了時も既存の連続したカメラ計算へつなぐ。描画用にズーム途中のカメラは生成しない。
- 不要になったズーム専用先行準備・順序再生・buffering状態を撤去。通常の最新要求優先再生、epoch／request IDによる中断、描画済みCanvas保持、直接編集保護は維持。下記「Intro zoom preview playback waits for rendering」は今回より前の実装記録。
- App設定にMP4専用の説明と常時表示の注意を追加し、introZoom／videoPlayer等のヘルプを更新。MP4生成処理・共通FramePlan／sampleFrame・補間・保存値・JSON形式・鮮度比較は変更しない。プレビュー専用の計画コピーを出力オプションへ戻さないこと。
- 依頼に沿いテスト・ビルド・ブラウザ／実機確認は未実施。

## DAY note width — V1.3 第1回追加修正②

- 動画用DAYのnoteMaxWidthを370px（balloonScale連動）から独立上限なしへ変更。補足を1行で実測し、見出し・日付・補足の最大行幅＋共通余白・枠から横幅を決定する。プレビュー／MP4、Overview／Follow／開始時Zoomは既存の同じレイアウトと矩形配置・接続線計算を使う。
- 動画フレーム1920×1080と画面端余白を含む幅制限は維持。文字がその内側に収まる限り省略せず、収まらない場合だけ既存の「…」処理を使う。自動改行・縮小等の新しい表示方式は追加しない。地図編集用noteMaxWidth 220pxと編集倍率・表示寸法は変更しない。
- 第2回の旧JSON座標変換では、旧動画を再現するため下記記録のnoteMaxWidth 370pxと旧省略後の矩形を使うこと。今回の拡張後の矩形を旧位置の算出に使わない。旧レイアウト記録は変更していない。
- 既存テストの幅上限期待値だけをフレーム内の利用可能幅へ更新。依頼に沿いテスト・ビルド・ブラウザ／実機確認は未実施。

## Intro zoom preview playback waits for rendering

- 従来は実時間から要求フレームを進め、rendererが最新要求を優先するため、毎フレーム地図カメラが変わる開始時ズームで未表示フレームを破棄していた。
- useVideoPlayerの開始時ズーム連続再生だけを、公開済みフレーム＋1の準備・公開へ同期。1/fps刻みの次の予定時刻以降に、準備完了したフレームだけを公開する。描画待ちやブラウザの長い停止後は公開時刻から進行を再開し、待機時間を進行へ加算しない。最終イントロフレーム公開後に通常の実時間再生へ戻す。FramePlan／sampleFrame／MP4処理・補間・設定上の時間とフレーム数は未変更。
- 先行完成フレームの上限は1枚。既存1920×1080の作業Canvas（RGBA換算約7.9MiB）を再利用し、先行フレーム用Canvas／ImageBitmap配列は追加しない。表示Canvasと既存背景キャッシュを維持し、先行準備中は表示を上書きしない。
- rendererのprepareFrameとpublishPreparedFrameを分離。新しい要求・一時停止・シーク・設定更新・disposeで先行フレームを無効化し、公開時もrequest IDを照合する。フック側は既存epoch／renderer同一性を照合し、停止・再生再開後に古い非同期処理が進行しないようにする。画面切替・生成移行・バックグラウンド化の既存停止処理もこの経路を使う。
- 描画が予定時刻に間に合わなければ「映像を準備しています…」を表示。操作を無効化せず、一時停止・シーク等を継続可能。低性能端末やタイル取得待ちでは実際のプレビュー所要時間が設定時間より長くなる。ユーザー指示に沿いテスト・ビルド・ブラウザ／実機確認は未実施。

## DAY text clipping follow-up — V1.3 第1回追加修正①

- コード上、地図DAYはfonts.ready後に再配置するが、映像プレビュー／MP4はフォント準備待ちがなかった。DAY見出し・日付の幅も文字列全体で実測する一方、描画は字間付きの1文字単位で行い、カーニングによる実幅の差が生じ得た。報告端末での原因の独立再現は未実施。
- DAYの行定義・フォント文字列を共通化し、使用文字・weight・サイズを指定してFontFaceSet.loadとreadyを待ってから描画する。Webフォント失敗時は宣言済みフォールバックを使用。プレビューではDAY情報／文字倍率変更時に準備を更新し、待機中に古くなった要求は既存request IDで破棄する。背景・カメラ・投影は再生成しない。
- 映像用DAYは実際の文字ごとの描画位置から行幅を計算し、その位置を描画でも使用する。補足は文字列全体を同一フォントで実測・描画。地図編集用の既存実測・配置、共通基本寸法／倍率、補足幅上限と省略処理、旧JSON変換用の旧レイアウト記録は維持。
- テスト・ビルド・ブラウザ／実機確認は依頼に沿い未実施。差分の確認のみ。

## Shared DAY / balloon video sizing — V1.3 第1回

- 通常バルーン基準の文字28px・左右余白20px・上下余白16pxをannotationStyle.tsで共通化。DAY動画の固定最小幅230pxを廃止し、文字実測から幅・行数から高さを計算する。日付／補足の文字サイズ比率は見出しの17/24・19/24を維持。
- 共通balloonScaleでDAYの余白・枠・角丸・行間・接続線・影・補足幅上限等を、fontScaleで文字と字間を倍率計算する。画面端margin／bottomMarginは固定。drawVideoFrameのscene.annotationStyleをDAYまで渡すため、全体表示・追従・開始時Zoomとプレビュー／MP4は同じ計算を使う。地図編集用DAY寸法・編集表示倍率は独立のまま。
- MP4鮮度比較は、出力ルート内にDAYがありrouteMarkerModeがdayの場合も共通倍率を含める。通常バルーンも出力対象DAYもなければ倍率を比較しない。保存形式・位置情報・カメラ・投影・時間軸・背景キャッシュは変更しない。
- テスト追加・実行、ビルド、ブラウザ／実機確認は依頼に沿い未実施。既存DAYレイアウトテストの旧寸法期待値のみ新しい既定寸法に更新。

### 第2回の旧JSON座標変換用：変更前のDAY動画レイアウト

以下は今回の共通倍率適用前の定数（参照：commit 6531dbaのdayMarkerStyle.ts／frameDrawing.ts／popup/placement.ts）。旧動画の矩形を再現する際は新しいdayMarkerLayoutをそのまま使わず、この旧値と旧ルールを使うこと。旧DAY動画寸法はannotationStyleの倍率を受けていなかった。地図編集用寸法や端末CSS寸法を変換基準にしない。文字実測には旧動画と同じフォントの読み込み状態も必要。

```ts
const LEGACY_VIDEO_DAY_STYLE = {
  minWidth: 230, noteMaxWidth: 370, paddingX: 24, paddingTop: 17, paddingBottom: 15,
  dayFont: 24, dateFont: 17, noteFont: 19, daySpacing: 1.9, dateSpacing: 0.85,
  border: 3.4, radius: 8.5, rowGap: 3.4, anchorGap: 40, anchorInset: 20,
  connectorWidth: 3.4, connectorLength: 30, anchorOffset: 34, anchorRadius: 5,
  manualConnectorWidth: 6.8, manualAnchorRadius: 8.5, anchorBorder: 3.4,
  shadowBlur: 24, shadowOffsetY: 6.8, margin: 8, bottomMargin: 54,
};
```

- 基準は1920×1080、popupDisplayScaleは1。フォントは`"DM Sans", "Noto Sans JP", system-ui, sans-serif`。行順は`DAY ${dayNumber}`（weight 700、24px、字間1.9）、存在する日付（ハイフンをドットへ置換、weight 600、17px、字間0.85）、存在する補足（weight 400、19px、字間0）。各行高はfontSize×1.25。
- 文字実測幅は`context.measureText(text).width + Array.from(text).length * spacing`（末尾分の字間も含む）。全体幅上限は1904。行の利用可能幅は`1904 - 2 * (3.4 + 24)`、補足のみさらに370で制限。超過時は末尾の文字を削り「…」付きで収まるまで省略する。
- 幅は`ceil(min(1904, max(230, 最大行実測幅 + 2 * (3.4 + 24))))`。高さは`ceil(17 + 15 + 2 * 3.4 + 各行高の合計 + (行数 - 1) * 3.4)`。各行の中心Yはborder＋paddingTopから行高の半分を足し、次行へ行高＋rowGapを進める。
- 投影地点を`(x,y)`、旧矩形を`(w,h)`とする。自動配置のleftは`clamp(x - w/2, 8, 1920 - 8 - w)`。`y - h - 40 < 8`なら下側、そうでなければ上側。topは`clamp(下側 ? y + 40 : y - h - 40, 8, 1026 - h)`。
- 旧placementがある場合は自動配置を上書きし、leftは`clamp(x + offsetX - w/2, 8, 1920 - w - 8)`、topは`clamp(y + offsetY - h/2, 8, 1026 - h)`。clampは現行placedPopupRect同様の`max(minimum, min(maximum, value))`。画面固定座標へ変換する場合は、この旧矩形の中心を基準フレーム内で算出する必要がある。
- 自動接続線のXは地点Xを矩形の左右20px内側へ制限。上配置なら矩形下辺から下へ30px（丸印中心は34px）、下配置なら矩形上辺から上へ同量。手動placementでは矩形上の地点に最も近い点から投影地点まで接続し、丸印も投影地点。旧JSONの変換と新しい配置情報の追加は今回未実装。

## Independent STEP panels (Issue #15)

- MobileBottomSheetのsteps定義をPC／スマホ共通のSTEP切替に使用。選択中のSTEPだけを表示し、上部の直接選択と下部の戻る／次へを追加。初期・resetKey切替時はSTEP 01へ戻す。
- 各STEPのReact subtreeはマウントしたまま非選択パネルをhidden／inertにし、入力値・編集状態・副作用を維持。STEP単位でスクロール位置を保存・復元し、選択変更時に隠れる入力のフォーカスを解除する。
- モバイルのシート3状態、キーボード時の一時拡大・入力欄追従、地図／映像状態は変更しない。STEPナビの既存HelpTip文言を切替操作に合わせて更新。

## Unsaved edit protection (Issue #1)

- TimelineWorkState／PlanStateと同じ保存対象をキー順のJSON比較で未保存判定。初回抽出・正常読込・新規計画・保存成功時に基準を更新し、保存キャンセル／エラーと形式不正では更新しない。保存は開始時の状態を基準にする。
- 置換前に必要時だけ日本語confirmを表示し、Timeline workerの新規indexと編集状態は抽出成功まで保留する。スポットはpoints・画像範囲・ラベル・スタイルの未保存状態だけ親へ通知し、PNG保存は編集状態を保存済みにしない。映像バルーン編集中の保存／読込／破棄を抑止する。

## Android text input and mobile sheet (Issue #14)

- MobileBottomSheet内の通常テキスト入力／textareaへフォーカスすると、visualViewportの高さ・offsetTop・resize／scrollとシート寸法を監視し、入力欄と内容領域の実測位置から必要な分だけ内部スクロールする。
- キーボード表示中だけ通常stateとは別にシートを作業領域いっぱいへ一時拡大。入力をblurしてもクリック処理を待ってから元の高さへ戻し、キーボードを閉じても入力フォーカスが残る場合はviewport復帰を検知する。IME・入力値・カーソル・PCレイアウトは変更しない。

## Mobile header mode menu (Issue #3)

- 760px以下では、Timelineモードかつ地点0件の初期案内を従来のロゴ／3モード案内で維持する。地点読み込み後と計画／スポット画像モードでは高さ56pxのテキストブランド＋現在モード名＋モードメニューへ切り替える。
- メニューは既存のWORKSPACE_MODE_COPYとstartPlanMode／startSpotMode／JSON選択処理を利用し、外側タップ・Escape・選択で閉じる。地図／映像上へ重ね、低い画面では内部スクロールする。HelpTipを追加。761px以上のヘッダーや作業データ処理は変更しない。

## Mobile UI and legacy preview cleanup — v1.3 Step 8 (2026-10-16)

- Appの旧previewProgress、rAF／終了タイマー、専用Follow計画・未使用開始関数・balloonFrameEditingと旧配置入口関数を撤去。RouteMapの旧動画時刻補間・移動マーカー／時計・プレビュー用カメラ切替／復元と専用props、未使用ヘルプ／CSSも削除した。地図／映像とStep 03「映像で確認」へ集約済みの操作入口を維持し、地図から直接MP4を生成できる。
- 通常地図のルート線・地点選択／移動／範囲操作、FrameAnnotationOverlay、DAY／Endpoint／DistanceHudOverlayは維持。HUD用16:9枠とgetVideoPreviewViewport、framePositionと旧JSON補完、参照カメラのclone投影、共有frameDrag／Canvas描画・フレーム計算は残した。編集地図は映像切替中も同じインスタンスを保持するため、通常カメラ／Zoomの保存復元を新設する必要はない。
- PCは左設定／右映像を維持。プレイヤーのシーク・ヘルプを44px以上へ調整し、狭い映像領域ではガイド／Undo／Redo等を折り返す。イベント名の省略／一覧で全文表示、縦スクロールを維持。スマホはSafe Areaの左右と既存シート高を考慮し、切替・映像操作はシート外。MobileBottomSheetの3状態・ジェスチャー・resetKeyは未変更。表示サイズ変更はCSS倍率だけで、1920×1080・16:9、再生位置／選択／履歴を初期化しない。
- Canvasとシークのtouch-actionを分離し、シークはPointer Captureを使用。バルーンは既存共有Pointer Captureとサイズ変更時キャンセルを継続。背後の編集地図は既存inert／visibilityで操作を遮断する。
- useVideoPlayerは正常描画済みCanvasの有無を保持。MP4生成中はMapLibre／背景Bitmapを解放しても出力Canvasの画素をそのまま静止表示し、VideoWorkspaceが半透明の生成進捗を重ねる。追加の地図読込やBitmapコピーはしない。既存の解放Promiseを待ってMP4を開始し、終了・キャンセル後はStep 6-Aの保持位置から停止状態でセッションを再開する。正常フレームがない場合は進捗のみ表示。新規セッション／作品resetで画素の有効フラグを解除する。
- 今後もプレイヤー状態・Canvas保持・ガイドをJSON／履歴／MP4鮮度へ混ぜないこと。共通フレーム・カメラ・MP4エンコードは変更していない。旧プレビューという名前だけで地図編集用共通処理を削除しないこと。
- `npm run build`（TypeScript／Vite）成功、既存チャンクサイズ警告のみ。依頼に沿いテスト・ブラウザ／PC・スマホ実機操作・実MP4比較は未実施。

## Direct video balloon editing — v1.3 Step 7 (2026-10-16)

- 共有sceneのバルーンへpointIdを付与し、previewFrameRendererが実際に公開したsceneとFrameStateを保持する。getDisplayedBalloonsはそのsceneの実表示対象とannotationLayoutから1920×1080の矩形を取得。VideoBalloonOverlayは矩形を表示倍率で配置した透明buttonと選択枠のみを持ち、バルーン本体を二重描画しない。選択はAppのselectedPointIdと共有し、DAY／START・GOAL／HUD等は編集しない。再生中の映像タップは公開済みフレームで停止してヒット判定する。
- popup/frameDragの既存Pointer Capture・位置変換・5px／Shift20pxキー操作を小さく拡張。映像側だけ画面6px閾値、開始／終了通知、実質同位置の除外、確定時のドラフト維持を使用する。旧地図側の既定操作は維持。位置はannotationLayout＋annotationFramePositionで24px／下70pxの既存制限を再利用し、保存は従来のannotation.framePosition。新オーバーレイはMapLibre投影に依存しない。
- ドラッグ中は公開sceneの背景・ルート・地点投影・カメラ・フレームを固定し、renderer.previewBalloonPositionで対象1件だけframePositionを上書きしたsceneを共有drawVideoFrameへ渡す。履歴・FramePlan・カメラ計画・投影・タイルを更新しない。最後の表示sceneの背景Bitmapは、未完了要求やキャッシュ失効で早期closeされないよう次の正常公開／破棄まで保持する。
- 正常pointerupで位置が変わった場合だけ既存setBalloonFramePosition→historyReducer commitを1回実行。キャンセル／capture喪失／画面終了／ガイド非表示／対象や設定の変更・表示サイズ変更ではドラフトを戻して履歴を追加しない。通常release前にdragをnullにしてlostpointercaptureの二重終了を防ぐ。確定後・Undo／RedoはStep 6-Aの同フレーム再合成へ接続。入力欄の標準Undo／Redoを奪わず、映像側のボタンも既存のpast／futureへ接続する。
- ガイド表示はuseVideoPlayerの非保存状態。停止・描画完了時だけ選択枠とヒット領域を表示し、再生中／ガイド非表示／排他処理中は編集不可。ドラッグ中は再生・シーク・イベント移動・動画設定・MP4生成保存をUIと実処理で制限する。ガイドや選択・未確定位置は出力スナップショットへ入れず、確定したRoutePoint更新でStep 6-Bの再生成判定が自然に更新される。
- 地点詳細の「映像で確認」は既存balloon:pointIdイベントを強制アンカーとして同じプレイヤーへ要求し、最初の実表示フレームへ停止移動、地点選択とガイド表示を維持する。範囲外は地図側で案内、表示不可は指定文で案内し別イベントやカメラを選ばない。Step 02の旧専用配置入口・構図セレクター・専用終了toolbarは撤去。FrameAnnotationOverlay、旧JSON補完、通常地図のバルーン操作、旧内部互換コードは維持する。
- Step 8へ：旧previewProgressやballoonFrameEditingの内部状態・未使用入口関数と関連ヘルプ／CSSは今回全面削除していない。共有frameDrag、描画済みsceneのバルーンID／矩形、正規化座標・補完処理、生成Blobとの鮮度比較を保ちながら整理すること。MP4描画・エンコードとJSON format／versionは未変更。
- `npm run build`（TypeScript／Vite）成功、既存チャンクサイズ警告のみ。依頼に沿いテスト実行・ブラウザ／PC・スマホ実機操作・実MP4比較は未実施。

## Generated MP4 freshness — v1.3 Step 6-B (2026-10-16)

- `video/videoOutputSnapshot.ts`のcreateVideoOutputSnapshotが、renderRouteVideoへ渡す出力入力を固定順のJSON文字列へ正規化。対象ルートの順序・座標・DAY分割用日付、実績時計有効時の時刻、バルーン、実際の共通停止配列、時間・有効カメラ・開始Zoom、マーカー／配置・DAY色分け、HUDの実表示寸法／配置・距離モデルの必要値を比較する。非表示HUDの位置・サイズ、無効なカメラ設定、マーカー非表示時の配置、ラベルなしのバルーン寸法、互換用pauseSeconds等は除外。Mapは対象地点順の値配列へ変換し、参照・UI状態・進捗・Signal・FramePlan／地図／画像／Blobは比較しない。比較値はブラウザの制作セッション内だけに保持し、ログ・外部通信・JSON保存へ出さない。
- Appの確定PreviewFrameOptionsを生成・比較の共通入力とし、useMemoで制作状態の変更時だけ比較値を作る。再生／シーク・選択・画面切替・ヘルプ・ボトムシート開閉等では再シリアライズしない。captureVideoOutputOptionsが生成開始時に対象ルート・入れ子の配置、DAY・カメラ・スタイル・HUDモデル／Map値をコピーし、その同じ入力から生成時比較値を作る。Follow計画もコピー済みルートから生成時に構築し、共有参照の変更で生成途中の入力が変わらないようにする。FramePlan／背景の複製は行わない。
- 正常生成後だけBlob・Object URL・生成時比較値を確定。完了時の現状態が異なる場合も開始時比較値を保持し古いMP4として扱う。失敗／キャンセル時は旧正常MP4を維持し、終了直前のキャンセルも登録前に確認する。DAY切替での無条件破棄を撤去。Undo／設定を戻して一致すれば再度保存可能になる。新規作品・作業／計画読込ではBlobと比較値をクリアし、URLは置換・作品終了・unmountで解放、unmount時は生成も中断する。
- Step 03で不一致時に「再生成が必要」＋短い案内、「MP4を再生成」を表示し保存ボタンを無効化。saveVideoも比較値を確認して不一致なら保存ダイアログより前に拒否する。既存busy／videoProgressを利用し、生成／保存中は設定・ルート編集領域をinert、バルーンサイズ入力とキーボードUndo／Redoも制限。生成キャンセル・既存モバイルシート操作は維持し、描画・エンコード・JSON形式・履歴処理は未変更。
- Step 7へ：直接編集が既存RoutePoint.annotationのlabel／framePosition等を更新すれば、そのまま比較対象になる。新たなdirtyカウンターやプレイヤー状態を判定へ混ぜないこと。出力へ影響する新入力を増やす場合は、共通出力入力・生成用コピー・比較正規化を揃える。バルーン直接編集・地点詳細からのジャンプ・ガイド切替等には未着手。
- `npm run build`（TypeScript／Vite）成功、既存チャンクサイズ警告のみ。依頼に沿いテスト実行・ブラウザ／PC・スマホ実機操作・実MP4比較は未実施。

## Live video settings and position retention — v1.3 Step 6-A (2026-10-16)

- `useVideoPlayer`は描画セッションの生成／解放と、設定反映を分離。確定したPreviewFrameOptionsの変更をlayout effectで検知し、再生を停止・旧要求を無効化して同じrendererの`updateOptions`へ送る。Step 03の既存UIは維持し、再生中に設定欄へフォーカス／タップした時点でも停止する。文字列入力と確定数値stateの既存区別、MP4中の操作制限、MobileBottomSheetのジェスチャー／開閉状態は変更しない。
- 最後に公開されたFrameStateとFramePlan・経過秒数を保持し、選択イベントは地点ID＋種別のIDをeventAnchorRefへ保持する。`previewUpdates.ts`が旧表示計画と新計画の停止・パン／DAY切替・ルート構成等を比較し、時間軸が変わる場合だけ有効な同一イベントへ対応付ける。それ以外は同じFPSのフレーム（経過秒数）を維持し有効範囲へclamp。イベントが消えた／表示不可なら選択を解除して旧経過秒数へ戻す。手動シーク・通常再生はアンカー解除。設定変更や地図編集による先頭リセットを撤去し、新しい作品へのresetは維持する。
- `previewFrameRenderer.updateOptions(next, position)`はフレームと同じ最新要求優先の直列キューを利用。処理中1件＋待機最新1件に設定スナップショットを持たせ、共有状態の更新と地図操作を同時実行しない。旧結果は要求ID・フックのepoch／世代で破棄し、新設定の完成フレームと計画・イベント・アンカーをまとめてUIへ反映する。描画中は「設定を反映して映像を更新しています…」を表示し、旧画像を新設定の成功表示にしない。失敗時は旧位置基準を保持して再試行できる。
- Canvasのみの設定は既存FramePlan・Follow計画・イベント・背景を維持。Overviewの事前投影データ、Followのカメラごとの投影キャッシュを再利用し、HUD／時計／バルーン寸法変更で背景を取得し直さない。マーカー／DAY色分け等は必要な描画メタデータを更新。時間変更時は必要なFramePlan／イベントを再計算し、同じFollowカメラ計画は再利用する。カメラ変更は同じMapLibreセッションを動かし、背景キーに一致する場合のみキャッシュを使用。背景・カメラ・投影の組を維持し、エラー時は背景と投影キャッシュを破棄する。
- `frameScene`の2つの準備関数はprojectだけを受け取れる型へ最小拡張し、MP4は従来のMapLibre、プレビューはキャッシュ付きprojectを渡す。Canvas描画仕様・FramePlanの補間・MP4エンコードは未変更。既存annotation.framePositionを優先し、サイズ変更で位置を補正しない。READMEと共有ヘルプを更新した。
- Step 6-Bへ：今回のスナップショットは再生位置保持用で、生成済みMP4との一致／鮮度判定には使用していない。鮮度表示・保存制御・MP4生成時比較、Step 7の直接編集、旧プレビュー削除には未着手。JSON形式・地図編集・Undo／Redo・スポット画像・MP4生成保存は維持する。
- `npm run build`（TypeScript／Vite）成功、既存チャンクサイズ警告のみ。依頼に沿いテスト実行・ブラウザ／PC・スマホ実機操作・実MP4比較は未実施。

## Video playback, seeking and event navigation — v1.3 Step 5-B (2026-10-16)

- `video/useVideoPlayer.ts`が非保存のplaying／paused、要求位置playheadFrame、実表示displayedFrame、準備／失敗、selectedEventIdを管理。requestAnimationFrameの経過時間をFramePlan.fpsとgetFrameIndexAtTimeでフレームへ変換し、従来のpreviewProgressから独立して共有renderFrameへ要求する。最終フレームの描画成功後に停止し、終端からの再生は先頭へ戻る。
- 一時停止はrendererの実際の公開済みFrameStateを取得し、cancelPendingFramesで要求IDを進めて処理中／待機中の旧要求を無効化する。Step 3-Cの処理中1件＋待機最新1件と完成Canvasの同期公開を維持。フック側もセッション世代と要求epochで遅れた結果を無効化する。高速シークは一時停止して最新位置だけを要求する。時刻欄は実表示、バーは要求位置を示す。
- 地図への切替・タブ非表示で停止し、同一作品の映像再入場／MP4生成後は最終表示位置を停止状態で復元。新規読込・作業／計画再開・制作モード変更時はreset。設定オブジェクト変更時はStep 5-A同様に先頭へ戻す。地図保持・解放Promiseによるプレビュー／MP4セッションの直列化を維持する。
- `video/videoEvents.ts`は種別＋地点IDの安定IDを持つSTART／DAY／バルーン／GOALを生成。STARTはpreFrames、GOALはsampleFrameで到着した最初のフレーム。DAYはday設定時のみ。地点配列からラベルを抽出するため停止0秒も対象になる。到達条件はOverviewのprogress／pausePointIndexとFollow・Overview introのreachedPointIndexを区別する。
- イベント探索は共有sampleFrameと実動画用MapLibre transformのクローンによる投影・既存画面内判定を利用。到達・停止境界、intro／パン／斜め旋回中の候補フレームを調べ、停止区間の同一カメラをまとめる。全フレームのCanvas描画／タイル取得は行わない。Overview通常DAYのクランプ表示とFollow／introの画面外非表示、固定バルーンのアンカー判定を維持。未表示バルーンは理由付きframeIndex:nullで保持し前後移動から除外する。
- `VideoWorkspace`に再生／停止、フレーム刻みのrange、現在／総時刻、前後イベント、選択名、通常閉じたスクロール一覧を追加。同フレームの印は1つにまとめ、一覧では個別選択。イベント印は位置表示専用、選択は前後ボタン／一覧から行う。スマホも設定シート外に配置し、既存16:9とResizeObserver、シート回避を維持。Step 03の既存preview-buttonは「映像で確認」へ接続。旧プレビュー内部と「動画構図で配置」はStep 8／7まで残す。
- Step 6-Aへ：イベントIDと要求フレーム／実表示フレームは別情報。手動シーク・連続再生時は選択IDを解除する。設定変更後の同一イベント基準の復元は未実装で、現在は先頭リセット。バルーン直接編集、MP4鮮度管理、旧プレビュー削除にも未着手。JSON・MP4エンコード・RouteMap・MobileBottomSheetは未変更。
- `npm run build`（TypeScript／Vite）成功、既存チャンクサイズ警告のみ。依頼に沿いテスト実行・ブラウザ／PC・スマホ実機操作・実MP4比較は未実施。

## Map/video workspace views — v1.3 Step 5-A (2026-10-16)

- Appに非保存のworkspaceView（map／video、初期map）を追加。移動実績／計画のanimationPointsが2点以上のとき、設定パネル外の表示領域上部へ切替・役割説明と既存HelpTipによる案内を表示する。新規読込／作業再開／制作モード変更・ルート無効時はmapへ戻す。初回のルート確認案内は既存通知と1つにまとめ、5秒後に消す。Step 01〜03と既存DOM属性を維持して説明・カメラ見出しを調整。
- map-edit-viewは寸法を保ったままvisibility＋inert＋aria-hiddenで非表示化。RouteMapと座標検索host・編集ツールを同じDOMに保持し、切替だけでMapLibreを再生成／再フィットしない。RouteMapとMobileBottomSheetは未変更。旧プレビューと「動画構図で配置」は地図へ戻して従来どおり実行する。
- 新規VideoWorkspaceはCanvasと準備中／完了／失敗・再試行の表示だけを担当。Appが確定設定からPreviewFrameOptionsをmemo化し、createPreviewFrameRenderer → renderFrame(0)で共有FramePlan・scene・Canvas・動画用地図を利用する。設定オブジェクトの一致と描画完了を確認してCanvasを表示し、設定変更時は旧セッションを破棄して先頭を描き直す。旧previewProgressから映像を計算しない。
- 映像Canvasは1920×1080を固定し、表示枠のResizeObserverは16:9で収まるCSS幅だけを計算。モバイルは既存--mobile-sheet-height（safe area込み）の分を避けて映像を配置し、切替はシートより上層に置く。バルーン等の描画座標・寸法は再計算しない。
- previewFrameRenderer.dispose()が解放完了Promiseを返すよう最小拡張。Appは世代番号と解放Promiseで、設定変更・画面終了時の旧描画を無効化し、直前の解放後に新セッションを開始する。MP4生成も先にstopVideoPreviewをawaitしてから従来のrenderRouteVideoを呼ぶ。生成中はプレビュー地図を作らず、終了後に映像画面なら再準備する。MP4の描画・ループ・エンコードは未変更。
- Step 5-Bへ：今回はフレーム0の停止表示のみ。旧「プレビュー」ボタンは維持。再生・シーク・イベントジャンプ・位置維持・バルーン直接編集・MP4鮮度管理は未着手。今後もプレビュー用地図の解放完了を待ち、設定更新中や失敗画像を完成映像として表示しないこと。
- `npm run build`（TypeScript／Vite）成功、既存チャンクサイズ警告のみ。依頼に沿いテスト実行・ブラウザ／PC・スマホ実機操作・実MP4確認は未実施。

## Persisted video settings — v1.3 Step 4 (2026-10-16)

- Step 3-Cコミット `4566792` を基準に同じ `feature/video-editor-v13` で実装。作業／計画JSONのformat・version 1は維持し、任意のvideoSettingsに時間4項目、Overview／Followのカメラ・Zoom・視点・開始Zoom、マーカー・DAY色・実績時計・距離HUDのenabled／x／y／scaleを保存。1920×1080・FPS・revealRoute等の固定仕様や計算結果・再生位置は保存しない。
- `video/videoSettings.ts` が共通型・現行と同じDEFAULT_VIDEO_SETTINGS・parseVideoSettingsを提供。存在するvideoSettingsは全既知項目を検証し、数値範囲・刻み・列挙値・boolean・HUDを確認。未知フィールドは無視する。workFile／planFileは全データの検証後に返し、不正設定は各既存エラーへ変換して編集状態を置き換えない。
- 作業JSONの既存トップレベル構図情報は移動せず維持し、selectedOutputDayだけを追加（不正形式は拒否、該当日程なし／期間外はall）。計画JSONには任意のトップレベルannotationStyle・animationStartPointId／animationEndPointId・endpointMarkerPlacementsを追加。ポイントID参照、サイズ、配置を検証し、videoSettingsへ同じ値を二重保存しない。既存DAY情報・framePosition／placement・旧pauseSeconds処理は維持。
- Appは確定した数値stateを保存し、復元時はapplyVideoSettingsで数値と文字列入力を同じバッチ内で同期。旧JSONの追加項目は省略可能のまま受理し、Appで欠落した動画設定を共通既定値へ戻す。旧作業JSONのannotationStyle等は保存値を維持し、旧計画JSONの未保存構図項目は既定サイズ／範囲なし／配置なしへ戻す。新規Timeline読込成功・新規計画開始も既定値へ戻し、同一作品の通常編集・期間再抽出では動画設定をリセットしない。ファイル形式確認前のモード／選択変更も撤去し、読込拒否時は元作品を保持する。
- READMEと関連する共有ヘルプの保存説明を更新。Step 5-Aへ：保存対象は制作設定だけで、Undo履歴や生成MP4／プレビューセッション・派生カメラ計画は含まない。復元後の派生値は既存処理で再計算する。新UI・動画設定Undo／Redo・生成MP4鮮度管理・Step 5以降とStep 1〜3-Cの内部基盤は未変更。
- `npm run build`（TypeScript／Vite）成功、既存チャンクサイズ警告のみ。依頼に沿いテスト実行・ブラウザ／実機操作・実MP4確認は未実施。

## Preview request coordination and background reuse — v1.3 Step 3-C (2026-10-16)

- Step 3-Bコミット `a8215a6` を基準に同じ `feature/video-editor-v13` で実装。`previewFrameRenderer.ts` のrenderFrame引数・framePlan／dispose入口は維持し、要求IDで最新要求を識別。処理中1件＋待機最新1件だけを保持し、中間要求は省略する。MapLibreの準備・カメラ変更・投影・背景取得・合成は同じ処理ループで直列実行。
- 戻り値は `PreviewFrameResult`。成功は `{ status: 'rendered', requestId, canvas, state }`、古い要求／破棄時は `{ status: 'discarded', requestId, frameIndex, reason: 'superseded' | 'disposed', error? }`。最新要求のエラーは従来どおりrejectし、古い要求の失敗はdiscarded.errorへ保持して次の要求を続行。dispose後の新規要求はAbortErrorでrejectする。
- 背景取得と共通Canvas合成は内部作業Canvasで実施し、完成・要求の有効性・地図エラーを確認してから出力Canvasへ同期コピーする。古い結果・途中画像・失敗した画像で既存の完成フレームを上書きしない。返却Canvasは引き続き同じ出力先で、スナップショットではない。
- キャッシュはOverview固定背景＋事前投影と、Follow／Overview開始Zoomの直近背景各1件まで。GSI_STYLE固定のセッション内で1920×1080／pixelRatio=1・中心座標・zoom・bearing・pitchをキーにし、同じカメラはMap準備／背景取得も再利用する。動的背景は投影に使うMapとカメラを合わせる。最後の開始Zoomフレームは既存MP4相当の準備を一度確認。地図エラー・Map再生成・要求処理の失敗時はキャッシュを無効化し、置換Bitmapはcloseする。
- dispose／外部signalのabortは新規要求を拒否し待機要求を破棄。進行中の地図待機をabortし、非同期処理の終了後にMap・Bitmap・内部Canvas・コンテナを解放する。解放後に古い要求が描画／反映しない。繰り返しdisposeは安全。出力Canvasは呼び出し側所有で、最後の完成フレームを残す。
- Step 4／5へ：呼び出し側はstatusを判別し、rejectも処理する。ルート／カメラ／表示設定変更時は旧セッションをdisposeして再生成し、利用中の入力やCanvas状態を外から変更しない。画面切替・UI・30fps再生スケジューラ・フレームスキップ・MP4との同時利用管理は未着手。MP4ループ／背景キャッシュ・共有FramePlan／Canvas描画・videoMapSessionは未変更。
- `npm run build`（TypeScript／Vite）成功、既存チャンクサイズ警告のみ。`git diff --check` 問題なし。依頼に沿いテスト実行・ブラウザ／実機操作・実MP4確認は未実施。

## Canvas frame preview foundation — v1.3 Step 3-B (2026-10-16)

- Step 3-Aコミット `3bd9d3f` を基準に同じ `feature/video-editor-v13` で実装。`createPreviewFrameRenderer(canvas, options)`（`src/video/previewFrameRenderer.ts`）が `framePlan` / `renderFrame(frameIndex)` / `dispose()` を公開。optionsはルート・動画／描画設定と任意のsignalを受け、WebCodecs・Mediabunny・Reactへ依存しない。
- `renderFrame()` は番号を整数へ切り下げて `0..totalFrames-1` に収める（NaNは0）。共通 `sampleFrame()` → `frameScene.ts` の共通描画データ準備 → `drawVideoFrame()` で1920×1080 Canvasを描き、`{ canvas, state }` を返す。返却Canvasは次の要求で上書きされる同じ出力先であり、フレームのコピーではない。
- `frameScene.ts` へ既存MP4のOverview事前投影・モード別scene準備・DAY地点索引・時計引数選択・旧バルーン位置解決を移動し、MP4とプレビュー双方で使用。元RoutePointは変更しない。Overview開始Zoomの時計は地点0、FollowのDAY切替時計は従来のfollowClockPointIndexを使用。MP4のループ・背景キャッシュ・エンコード／後始末とStep 1の計算式は維持。
- プレビュー初回はMP4と同じ初期カメラで旧バルーン配置を解決し、途中フレームからでも同じ固定位置を使用。Overview通常は固定背景Bitmapと事前投影を保持し、Zoomへ戻っても再利用。FollowとOverview開始Zoomは指定FrameStateのカメラでprepareして既存Follow sceneを作る。Followは従来どおり走行済みルートを表示し、Overview開始ZoomだけrevealRoute設定を尊重する。
- セッションが非表示1920×1080コンテナと独立した動画用MapLibreを所有。地図準備エラーはrejectし、準備前の画像を成功として返さない。dispose（外部signalのabort時も呼ぶ）は進行中の待機を中断し、Map・Bitmap・コンテナを解放する。Canvasは呼び出し側所有。利用中のルート／設定・Canvas寸法／描画状態は外部から変更せず、変更時はセッションを作り直す。
- Step 3-Cへ：renderFrameは1件ずつawaitする契約。要求の競合／順序制御・最新要求優先・高速シーク・Follow背景キャッシュ最適化・再生スケジューラは未実装。UI接続やMP4との同時利用管理も後続Stepの対象で、今回は未着手。
- `npm run build`（TypeScript／Vite）成功、既存チャンクサイズ警告のみ。依頼に沿いテスト実行・ブラウザ／実機操作・実MP4確認は未実施。

## Reusable video map session — v1.3 Step 3-A (2026-10-16)

- Step 2-Bコミット `e491637` を基準に同じ `feature/video-editor-v13` で実装。`src/video/videoMapSession.ts` が `createVideoMapSession(container, signal?)` を公開し、返り値の `prepare(camera, move = true)` / `dispose()` / `hasError()` を従来どおり利用する。React・MP4エンコーダーへの依存はない。
- セッションは必要時に最大1個のMapLibreを生成・再利用。既存GSI_STYLE・カメラ・pixelRatio等、地形色フォールバック、style待機と `waitForExportViewportReady()` の必須ソース／idle判定、20秒timeout、失敗地図を解放して1回再試行、AbortSignalと日本語エラーをそのまま移動。disposeはerror listener・Map・参照を解放してエラーを初期化し、再度呼んでも安全。
- `renderer.ts` は独立モジュールをimportするだけで、Overviewの初期／開始Zoom／固定背景取得後の解放と、Followの初期／カメラ変更時準備・背景キー／lastIntroFrame判定、双方のfinallyを維持。Step 1・2-A・2-Bの計算／Canvas合成は未変更。
- Step 3-Bへ：コンテナの作成・配置・寸法・削除、背景キャッシュとImageBitmapの寿命管理は呼び出し側の責務。prepareは逐次awaitし、返却された準備済みMapで投影・背景取得する。非同期シークの競合制御やキューは未実装（Step 3-Cの対象）。プレビューUI・新規DOM・Step 3-B以降は未着手。
- `npm run build`（TypeScript／Vite）成功、既存チャンクサイズ警告のみ。`git diff --check` 問題なし。依頼に沿いテスト実行・ブラウザ／実機操作・実MP4確認は未実施。

## Shared frame composition — v1.3 Step 2-B (2026-10-16)

- Step 1・2-Aコミット済みの `feature/video-editor-v13`（`e3a3ae6`）を基準に実装。新規 `src/video/frameRenderer.ts` の `drawVideoFrame(context, scene: VideoFrameScene)` が、背景→ルート→現在地→時計→バルーン→DAY／START・GOAL→HUD→出典のCanvas合成を担当。Step 2-Aと既存annotationCanvas／routeClock／distanceHudの描画を再利用する。
- `renderer.ts` の `drawFrame()` / `drawFollowFrame()` はモード別に描画データを準備して共通入口を呼ぶ。Overviewは事前投影座標を再利用し、進捗／停止地点・線の末尾補間・表示条件を維持。Followは現在カメラでの投影、reachedPointIndex・画面内判定・ルート区間／DAY色の生成を維持。HUD進行計算も従来どおり各モードに残す。Overview開始時Zoomは既存Follow経路から同じ共通合成へ接続。
- Step 3-Aへ：sceneは1920×1080動画座標と表示対象を確定済みの配列・算出済み時計文字列／HUDデータを受け取る。共通合成は投影・カメラ計画・表示判定・時刻／距離計算を行わない。空／1点のルート区間のbeginPath／strokeも保持し、save/restoreの追加やCanvas状態の初期化・隔離はしていない。背景の準備・キャッシュ・ImageBitmapの寿命管理とStep 1のフレームサンプリングは呼び出し側の責務。プレビュー接続とStep 3以降は未着手。
- `npm run build`（TypeScript／Vite）成功、既存チャンクサイズ警告のみ。`git diff --check` 問題なし。依頼に沿いテスト実行・ブラウザ／実機操作・実MP4の目視確認は未実施。

## Shared Canvas drawing primitives — v1.3 Step 2-A (2026-10-16)

- Step 1コミット `15e4764` を基準に、同じ `feature/video-editor-v13` ブランチで実装。`src/video/frameDrawing.ts` へ `drawDayMarker()` / `drawEndpointMarker()` / `isInVideoViewport()` と必要な `VideoDayMarker` 型を移動し、重複していた現在地描画を `drawCurrentPositionMarker()`、出典表示を `drawMapAttribution()` に集約。
- `renderer.ts` の `drawFrame()` / `drawFollowFrame()` は、既存の描画位置・順序でこれらを呼び出す。開始時ZoomのFollow描画経路にも共通反映。DAYのlayout／色・START/GOALの配置・マーカー寸法・出典文字列は既存処理を再利用し、save/restoreの境界とCanvas状態の引き継ぎも維持する。
- Step 2-Bへ：共通部品は1920×1080の画面座標を受け、投影・到達／表示条件・描画順序は呼び出し側が担当する。現在地と出典の関数はsave/restoreで状態を隔離しない。フレーム全体の構造、ルート描画、背景キャッシュ、時計／HUD計算とStep 1の計算は未変更。バルーン・距離HUDは既存の `annotationCanvas.ts` / `distanceHud.ts` を継続利用する。
- `npm run build`（TypeScript／Vite）成功、既存のチャンクサイズ警告のみ。`git diff --check` 問題なし。依頼に沿いテスト実行・ブラウザ／実機操作・実MP4確認は未実施。Step 2-B以降は未着手。

## Shared video frame timeline — v1.3 Step 1 (2026-10-16)

- 作業ブランチ `feature/video-editor-v13`、取得した最新 `origin/main` とHEADが `c1eac72` で一致する状態から実装。
- `src/video/frameTimeline.ts` に `FramePlan` / `FrameState` と `buildFramePlan()` / `sampleFrame()` / `getFrameIndexAtTime()` を追加。既存の停止時間・Overview/Follow PlaybackTimeline・カメラ計画・開始時Zoom関数を再利用する。渡されたFollowCameraPlanは再計算せず、その参照を保持する。rendererやエンコード専用型には依存しない。
- `renderer.ts` の全体表示（開始時Zoomを含む）と追従表示を共通サンプリングへ接続し、重複していたフレーム時刻計算を撤去。本編は従来どおり `animationFrame / (animationFrames - 1)`、前後停止は本編の始端／終端へ固定。提示時刻 `outputTimeSeconds = frameIndex / fps` と本編時刻 `playbackElapsedSeconds` を区別する。
- Step 2では `cameraMode` とOverviewの `renderPath` で分岐する。Overview開始時Zoomは専用の `playback` を使う既存Follow描画経路で、方位・傾きは0。Followの `playback` はパン／DAY切替・到達地点・真上／斜めの状態をそのまま保持する。時計は引き続きOverview開始時Zoomの地点0指定と `followClockPointIndex()` のDAY切替処理を尊重する。
- 計画作成にはrendererと同じ検証済みルート・動画設定を渡す。`sampleFrame()` は整数 `0..totalFrames-1` のみ受付。シーク用 `getFrameIndexAtTime()` は指定秒を含むフレームへ切り下げ、範囲外を先頭／末尾へ収める。元のpointsは変更しないため、編集後は計画を作り直す。
- Canvas描画・MapLibre準備／背景キャッシュ・エンコード／進捗／保存、ReactのpreviewProgress・UI・JSON形式は未変更。`outputTiming.ts` の既存連続プレビュー用 `sampleVideoOutputTime()` も維持。描画共通化と編集プレビュー接続はStep 2以降。
- `npm run build`（TypeScript／Vite）成功、既存のチャンクサイズ警告のみ。`git diff --check` 問題なし。依頼に沿いテスト実行、ブラウザ／Android実機操作、実MP4の目視確認は未実施。

## Mobile bottom sheet (2026-10-16)

- GitHubから取得したorigin/mainとHEAD（075bc8a）が一致した状態を基準に実装。760px以下のみ設定パネルを地図に重ねる。761px以上は既存asideのスクロールとPCレイアウトを維持する。
- `MobileBottomSheet` を3モードで共用。既存セクションをそのままchildrenで受け、初期は閉じる（約60px＋safe area）、半開き40%、全開80%を目安とし、低い画面では上部にツールバー分の約100pxを確保するよう展開高を制限。一時stateのみでモード切替時は閉じる。DOMを開閉で再マウントせず、閉じたモバイル設定欄はinertにする。
- Pointer Eventsはハンドルだけで処理し、入力・設定欄の縦スクロールと分離。タップは開閉、上下スワイプ／矢印は1段階ずつ、Home／Escapeは閉じる、Endは全開。固定ヘッダーのStepボタンはパネル内scrollToだけを実行する。説明は既存HelpTipと共有helpContentを使用。
- シートのResizeObserverが実測高をworkspaceのCSS変数へ渡し、編集ツールバー・スポットヒント・下部地図コントロール／出典を上へ配置。地図の寸法は開閉で変えず、RouteMap／SpotMapは未変更。端末寸法変更は既存の地図ResizeObserverを利用する。
- モバイルの固定min-heightを撤去し、100dvhとVisualViewportの高さでブラウザUI・ソフトウェアキーボードの表示領域に追従。ヘッダー・場所検索の構造／意味、編集処理・履歴・保存形式・カメラ・MP4／PNG処理は変更しない。
- 指示どおりテスト・ビルド・ブラウザ／実機操作・MP4／PNG生成確認は未実施。実機での表示・操作確認はユーザー側で実施する。

## Fixed video balloon positions and shared drawing (2026-10-09)

- 地点バルーンだけに `RoutePoint.annotation.framePosition?: { x: number; y: number }` を追加。1920×1080動画フレームに対する中心の正規化座標（0〜1の有限数）。旧 `placement: { offsetX, offsetY }` は地点相対オフセットの意味・名前・値を維持し、両方ある場合はframePositionを優先する。作業／計画JSONのformat・versionは1のまま、parserは任意フィールドとして検証・復元する。
- 旧JSON／新規ラベルの位置は `resolveBalloonFramePositions()` で一度だけ移行する。Overviewは既存の動画用Overviewカメラ、Followは既存 `buildFollowPlaybackTimeline()` の対象地点到達時刻と `sampleFollowPlayback()` のカメラを使う。現在の編集地図のZoom・パン・端末寸法は基準にしない。MapLibreの投影Transformをcloneして1920×1080へ設定する小さなadapter (`map/balloonProjection.ts`) だけで内部 `_camera.transform` に接する。MapLibre更新時はこのadapterの互換性を確認する。可視地図のカメラ変更や追加タイル取得は行わない。
- 読み込み後にframePositionを補完して表示し、その値を最初の保存へ含める。保存済み座標は移行対象外。historyの初期・過去・現在・未来に欠けている配置だけを同時補完し、移行自体をUndoの操作にしない。ドラッグの完了は既存commitを1回だけ使い、キャンセル／pointercapture喪失では保存値へ戻す。ラベル変更・地点移動・削除復元でも配置を保持する。Follow設定が無効な場合は構図編集開始時に既存の日本語エラーを表示し、有効な到達カメラを得るまでは旧配置を別カメラで移行しない。
- `route/annotationCanvas.ts` の既存寸法・文字計測・省略・影・色を共通利用。新しい `FrameAnnotationOverlay` は同じ1920×1080 Canvasを16:9枠へ縮小表示し、同じlayoutの矩形を透明なドラッグ／キーボード操作ボタンへ使う。左右上24px・下70px出典領域を維持し、ドラッグやサイズ変更で矩形全体を制限する。複数バルーンの自動配置・重なり解消は行わない。
- framePositionがあるバルーン本体はアンカー投影に依存しない。接続線だけを `nearestPointOnRect()` と現在カメラの投影座標から更新する。アンカーが動画枠外なら本体と接続線を隠し、枠内へ戻ると既存の到達条件で再表示する。保存位置、停止・表示開始判定、再生時刻は変えない。通常編集／表示でも地図内の中央16:9基準領域へ同じ正規化位置を表示する。
- Step 02にHelpTip付き「動画構図で配置」／「配置編集を終了」を追加。ルートの表示・編集・アニメ範囲とは別の一時stateで、JSONには保存しない。地点選択でOverview／到達時Follow構図を確認できる。地図のZoom・パンは一時確認だけで動画設定に反映しない。配置中はルート操作との競合を抑え、下部にUndo／Redo／終了を表示する。終了時は元の編集カメラを復元する。
- ブラウザの縦長／横長地図でも斜め視点の投影を動画枠と一致させるため、枠サイズに応じてMapLibreの垂直視野角を補正し、終了時は復元する。動画の中心・Zoom・方位・傾斜・パン／旋回計画や時間軸は変更しない。バルーン変更だけではFollowカメラ計画の重い区間サンプリングを作り直さない。
- rendererのOverview・Follow双方（開始時ズーム、真上／斜めを含む）がframePositionを渡して同じCanvasを描画する。rendererへ直接渡された旧配置も描画前に同じ基準で解決し、元のRoutePointを変更しない。
- スポット画像は従来の `AnnotationOverlay`、相対配置・範囲・Zoom調整・PNG描画／保存を維持する。DAY／START・GOALはframePositionを使わず既存配置と描画方式を維持。距離HUD・ルート編集・日時／DAY選択・アニメ範囲・停止・時計・FPS／解像度／コーデック・地図スタイル／タイル待機／保存処理は変更しない。
- 回帰テストは既存renderer／route／overviewCamera／workFile／planFileテストへ追加。固定矩形・接続線追従・枠外非表示／再表示・PC／Android縮小表示・余白制限・旧配置移行の冪等性・JSON検証／往復・Undo／Redo・ドラッグキャンセル・Overview／Follow MP4描画・スポットの従来layoutを確認する。ブラウザ操作・Android実機・実MP4／PNG目視確認は依頼どおり実施しない。
- 自動検証：`npm test` は18ファイル・253テスト成功、任意のprivate実データ用1ファイルはスキップ。`npm run build`（TypeScript／Vite）成功、既存チャンクサイズ警告のみ。`git diff --check` も成功。sandboxの一時ファイルをworkerが読めないテスト環境エラーは、通常環境で同じコマンドを実行して解消した。

## Hide vegetation and land-use map symbols (2026-10-09)

- 田（6311）、畑（6312）、茶畑（6313）、果樹園（6314）、広葉樹林（6321）、針葉樹林（6322）、竹林（6323）、ヤシ科樹林（6324）、ハイマツ地（6325）、笹地（6326）、荒地（6327）の11種類を標準非表示に統一。公式スタイルのZoom 13〜14／14〜17に分かれた計17レイヤーをすべて除外する。
- gsiStyle.tsのshouldKeepLayer()で一元管理。source-layerがsymbol、metadata.pathが対象記号名、既存filterのftCodeが対象コードに一致するレイヤーだけを、既存filterContainsValue()で選別する。公式スタイルJSON、sprite／glyph取得、既存の表示設定は変更しない。
- 共有GSI_STYLEを使う移動実績参照／計画／スポット画像の編集地図、アニメーションプレビュー、全体表示MP4、追従表示MP4（真上・斜め）、スポット画像PNGへ共通反映。各描画処理への個別ロジック追加なし。
- 道路番号、地名、道路・水域、墓地・神社・寺院・公共／観光施設等の対象外記号、地形・海陸描画の構成とレイヤー順序を維持する。直近のPMTiles補完・PNG待機／保存、出典、ユーザーの地点・バルーン・DAY／START／GOAL・HUD、UI／レイアウト、JSON形式、Undo／Redoは変更なし。新設定・依存追加なし。READMEの利用説明にも変更なし。
- 自動検証：既存renderer.test.tsへ11種類の全Zoom帯除外と対象外レイヤーの維持・順序確認を追加。npm testは18ファイル・212テスト成功、任意のprivate実データ用1ファイルはスキップ。npm run build（TypeScript／Vite）成功、既存チャンクサイズ警告のみ。変更前後の共有スタイルを比較し、対象17レイヤー以外の全レイヤー・順序・sources・sprite・glyph等が完全一致することも確認。ブラウザ操作・Android実機・MP4／PNG目視確認は指示どおり未実施。

## Spot PNG land/sea underlay and readiness fix (2026-10-08)

- 問題：同じ指定範囲でも編集画面（約Zoom 7.5）と1920×1080 PNG（約8.2）では取得するタイルが変わり、海域の一部が陸地色の矩形になる。既存背景はZoom 8で海色→陸地色へ切り替わり、PNGはloaded/areTilesLoadedだけで待機し、再試行がなかった。
- 根拠：公開PMTilesを直接解析。北海道北部の7/114/45にはAdmArea（本島・利尻・礼文）が存在するが、8/228/91、9/456/183、10/913/367、13/7309/2938にはAdmAreaがなく、海・島の穴を表すWA（vt_code=5101）がある。8/228/90の外洋はPMTilesにタイル自体がなく、Protocolは正常な空タイルを返す。Zoom 14ではAdmAreaが再登場するが、外洋の14/14627/5851も未収録。したがって、正常終了した空タイルや水域収録範囲外に陸地色背景が露出する問題と、通信エラーは別。Zoom境界の背景変更だけでは、AdmAreaのない8〜13で陸地を青くする。
- 修正：既存PMTilesを継続使用。海色背景をZoom 4以上で維持し、広域AdmAreaソースのmaxzoomを7へ制限して高Zoomでもオーバーズーム。別ソースで同じPMTilesの本来のZoomを取得し、Zoom 8〜13はWAの海ポリゴンの外周内の補集合と島の穴から精密な陸地面を補完する（gsiCoastalLand.ts）。海ポリゴンの包絡矩形内だけを補完し、タイル全体の反転はしない。例えば46°Nで海データが終わる範囲の北側へ偽の陸地を生成しない。湖・川は補集合の対象外。元のタイルのレイヤー・byte列は維持し、補完レイヤーだけを追記する。
- Zoom 14以上は本来のAdmAreaを上に重ねる。順序は海背景→広域陸地→8〜13の精密海岸陸地／14以上の詳細陸地→本来のWA→既存DEM→既存詳細Vector。広域陸地だけを拡大して海岸の精度を落とさず、WAの海岸と島の形状、詳細Vectorの道路・地名・水域・既存配色を維持する。低Zoomの背景仕様（4未満）も維持。
- main.tsxの既存PMTiles Protocolに局所的な補完ラッパーを追加。対象アーカイブの8〜13だけを処理し、空の海タイルは空のまま返す。他のPMTiles、TileJSON、AbortController、通信エラー、cacheControlはそのまま伝播。MapLibreのインストール済みload_tilejson.tsで、明示的source.maxzoomがPMTilesのTileJSONより優先することも確認。既存のMVT解析ライブラリ（@mapbox/vector-tile 3.0.0／pbf 5.1.2）を直接依存に明示したのみで、既存バージョンの更新なし。
- PNG：MP4のviewport待機をexportViewportReady.tsへ小さく抽出。style、必須の詳細Vector・広域補助・詳細補助ソースの存在とloaded、map.loaded/areTilesLoaded、最後のカメラ操作後のidle、非DEMエラーなしを確認する。DEMだけのエラー／10秒待機では既存fallbackでDEMを外す。
- PNGの必須データ失敗／30秒timeoutではMapとlistener/timerを破棄し、同じGSI_STYLEと最終カメラで1回だけ作り直す。初期読込とバルーン調整後を合わせて最大2 Mapインスタンス。再失敗時は日本語エラーを返し、Canvas取り込み／PNG Blob生成へ進まない。既存保存処理もBlob生成失敗時にファイルへ書かない。imageCamera、バルーンの探索・寸法・配置、スポット位置、出典、保存先・上書き・ファイル名・1920×1080は変更なし。
- 共有GSI_STYLEを使うTimeline／計画／スポット編集、動画プレビュー、Overview／Follow（真上・斜め）MP4、PNGへ下地修正が共通反映される。MP4の待機処理は同等の共有関数を呼ぶだけで、20秒timeout、再試行、既存カメラ・Zoom・フレーム数・時間軸・背景キャッシュは維持。UI、DOM属性、レスポンシブCSS、ポイント編集・Undo/Redo、DAY/START/GOAL、HUD、JSON形式、日時選択・rawSignalsは変更なし。READMEの利用仕様変更はないため未変更。
- 自動検証：npm testは18ファイル・200テスト成功、任意のprivate実データ用1ファイルはスキップ。Zoom 7.5/7.99/8.0/8.01/8.2/9/10と4〜16の下地条件・順序、公開タイルの元データ維持、MapLibreと同じearcutによる海岸・島の三角形化、低Zoomでは欠ける精密な陸地の復元、46°N以北への陸地生成防止、PNGの各必須ソース待機・初期失敗／timeout・最終画角での再試行・通算2試行後の出力中止・DEM error/timeout fallback・寸法／出典／バルーン／スポット維持、既存MP4とルート／日時等を検証。npm run build（TypeScript/Vite）は成功。既存チャンクサイズ警告のみ。git diff --check問題なし。
- 制約／未確認：公開タイルの収録形状を補完しており、測量データを新規推定するものではない。全国の全海岸や将来の配信データ変更を網羅した保証はしない。公開fixtureとモック・三角形化による自動検証であり、実ブラウザ・Android実機・編集画面／生成PNG／MP4の目視確認は指示どおり未実施。実際のZoom 7.5〜10の描画・PC/Android表示・PNG保存／MP4再生はユーザー側確認。
- 参照：国土地理院PMTiles仕様 https://github.com/gsi-cyberjapan/optimal_bvmap 、MapLibre source.maxzoom https://maplibre.org/maplibre-style-spec/sources/ 。公開地図fixtureの出典はtests/fixtures/gsi-coast/README.mdに記録。個人のTimelineや位置記録は使用・収録していない。

## OpenPOI place search (2026-10-03)

- 計画モード／スポット画像モード共通のCoordinateJumpControlに施設名・地名・カテゴリ・ブランド検索を追加。Timelineモードは変更なし。
- 入力補完は3文字以上・300ms debounceで `/v1/suggest`（limit=5、fields=minimal）、候補は最大5件。検索ボタン／IME変換中でないEnterは短い語でも `/v1/search`（limit=15）を実行し、有効な結果は最大15件すべて表示。本検索の見出しは「検索結果」、一覧部分のみ縦スクロール。
- 全国検索。APIへ送るのは検索語と固定の取得設定だけ。Timeline・計画・スポット・地図の位置情報、bbox／center／radiusは送らない。緯度経度直接入力と範囲外エラーは従来のローカル処理を維持。
- AbortControllerと世代番号で古い応答を無効化、約10秒で通信中断。入力変更・検索・選択・クリア・unmount等でキャンセルし、日本語IME確定用Enterを検索に使わない。エラーは検索UI内に表示。
- 施設選択は既存の紫の参考マーカーを再利用。placeのbboxはMapLibre用 `[[minLng, minLat], [maxLng, maxLat]]` でfitBounds、centerは `[lng, lat]`。bbox選択では参考マーカーを消す。category／brandはqueryを入力欄へセットして本検索。
- 地点・スポット・ラベルは自動追加しない。検索語・結果・vocabulary・参考座標は永続保存しない。Undo／Redo・計画／作業JSON・プレビュー・MP4・PNGへ影響なし。動画／PNG rendererは変更なし。
- 検索UIに「検索データ：OpenPOI API」と出典リンクを表示。既存HelpTipとREADMEを更新。依存追加なし。

## Configurable video start and end times (2026-10-02)

- Step 03で開始前の時間と到着後の停止を個別に0〜30秒・0.5秒刻みで設定可能。初期値は各3秒。移動時間と地点停止の意味は維持。
- 開始時ズームONでは開始前の時間全体でズームし、OFFでは開始地点を静止表示。0秒なら追加時間なし。
- preview／Overview MP4／Follow MP4は共通の前後時間と出力時間計算を使用。FollowCameraPlanの移動時間は変更しない。
- 前後時間は一時UI設定で、作業JSON・計画JSON・Undo／Redoには保存しない。

## MP4 map readiness and retry (2026-10-01)

- MP4では未完成の地図viewportをフレームへ採用しない。Overview／Follow／開始時Zoomとも、style準備・必須Vectorの存在とloaded・map.loaded／areTilesLoaded・カメラ変更後のidle・非DEMエラーなしを共通処理で確認してから背景を取り込む。
- 低Zoomの2.5秒強制成功とOverviewのFALLBACK_STYLE継続を廃止。必須Vector取得失敗・20秒の待機timeoutでは、失敗したMapを破棄し、同じGSI_STYLEと画角で新しいMapへ1回だけ再試行する。2attempt失敗時は欠けたMP4を生成せず、日本語エラーでAppへ返す。
- 正常時は同じMapと既存ImageBitmap背景キャッシュを再利用。Followの画角変更とOverviewの開始時Zoomも同じ失敗時再作成処理を使用し、カメラ・ルート速度・3秒intro・FPS・フレーム数は維持。途中失敗時は背景・Mapを破棄し、未完了のエンコードもcancelする。
- AdmArea／WAの下地・地図配色とDEMの既存optional fallbackは維持。DEMだけのエラー・timeoutは既存gsiTerrainTint.tsで除去してVector地図で続行し、通常編集地図・プレビュー・Spot PNG・UI・JSONには変更なし。
- 検証：npm testは15ファイル・116テスト成功、任意の実データ用1ファイルはスキップ。低／高Zoomの未完了timeout、初期取得と画角変更・introの再試行、2attempt失敗時の中止、DEMのみ失敗時の継続、正常時のMap／背景再利用を検証。npm run build成功（チャンクサイズ警告のみ）、git diff --check問題なし。実ブラウザ・実MP4の目視確認は未実施。

## Map underlay fallback (2026-10-01)

- 最下層背景はlowZoomLand有効時にZoom 4未満をcolors.background、Zoom 4以上〜8未満をcolors.water、Zoom 8以上をcolors.backgroundとする（無効時はcolors.background）。低ZoomではAdmArea外側の外洋を背景の海色で補完し、高Zoomでは陸地が青みがからないよう背景を陸地色へ戻す。既存optimal_bvmapのAdmArea／WAはZoom 4以上の全Zoomで詳細Vectorの下地fallbackとして維持。ソースのminzoom 4／maxzoom 16、既存URL・設定値は変更なし。
- 共有GSI_STYLEの順序はZoom別背景→AdmArea陸地色（colors.background）→WA水域色（colors.water）→既存DEM→既存詳細Vector。通常地図・プレビュー・全体／真上／斜め追従MP4・スポット画像へ共通反映。レイヤ順・DEM配色・optional error fallback・詳細レイヤのデザインは変更なし。
- MP4の共通waitForVideoViewportReadyは、補助ソース有効時にZoomによらずその準備を確認。直前の厳格な待機・Map再作成による1回再試行・2attempt失敗時の中止を維持し、renderer.tsは今回変更していない。
- 検証：npm testは15ファイル・116テスト成功、任意の実データ用1ファイルはスキップ。背景色をZoom 0／3.99／4／7.99／8／16で式評価し、全Zoomの下地とレイヤ順を確認。MP4 readiness／retryと真上／斜めFollowの既存テストも成功。npm run build成功（チャンクサイズ警告のみ）、git diff --check問題なし。実ブラウザ・実MP4の目視確認は未実施。

## Oblique follow view (2026-10-01)

- Step 03のルート追従に「追従視点：真上／斜め」と共通HelpTipを追加。初期値top、Timeline／計画共用、一時UI stateのみ。プレビュー／MP4生成中は変更不可。Spot・JSON形式／version・Undo/Redoは変更なし。
- followCamera.tsの既存center・Zoom・pan計画と時間軸を維持。obliqueだけinterpolateTripRoute(animationPoints, 0.5)で距離中間点を求め、START→中間・中間→GOALの地理方位を計画作成時に計算する。1m未満の方向なし区間は他方を共用、双方不明は0°。pitchは45°固定、topは従来の0°／0°。
- sampleFollowPlaybackがrouteProgress=0.5以降の移動時間から旋回を算出。2秒と残り移動時間の小さい方でeaseInOutCubic・最短角度補間。バルーン停止・DAY遷移・camera-panでは進捗と方位が共に停止し、動画時間を延長しない。
- RouteMapとrendererは共通のFollowPlaybackStateのbearing／pitchを使用。開始時ZoomもinitialPlaybackの方位・傾きを維持。プレビュー後の通常カメラ復元経路は維持。MP4背景キーに方位・傾きを追加し、固定画角は従来どおり再利用する。
- followCamera／rendererの回帰テストで真上の既存計画、距離50%・密集点・アニメ範囲、旋回時間・最短方向・停止・同一座標、開始時Zoom、方位変化時の背景再取得と固定時の再利用を確認する。実ブラウザ・Android実機・実MP4の目視確認は未実施。
- 検証：npm testは15ファイル・102テスト成功、任意の実データ用1ファイルはスキップ。npm run buildはTypeScript／Viteとも成功（チャンクサイズ警告のみ）。git diff --checkは問題なし。

## Timeline実績時計（2026-09-29）

- Timelineの実績timestampから現在地時計をHH:mmで表示。地点間・手動点間は同じDAY内のルート距離比で推定し、DAY境界は補間しない。不足・不正時刻の区間は非表示。
- 記録のtimezone offsetを尊重。offsetが変わる区間は左アンカーのoffsetを使い、右の実績地点でそのoffsetへ切り替える。
- バルーン停止・Followパン中はマーカー位置に対応する時計も停止。開始・到着後のホールドも同じ位置の時刻を維持する。
- Timeline作業JSON再開後も既存timestampを利用。計画・Spotでは使用しない。ON/OFFは初期OFFの一時UI stateでJSON非保存。
- プレビュー・Overview MP4・Follow MP4でrouteClock.tsの共通計算を使用。既存時間軸・カメラ・保存形式は変更しない。

## 地図設定の分離（2026-09-29）

- 色とDEM配色・不透明度は `gsiColorConfig.ts`、Zoomは `gsiZoomConfig.ts`、その他は `gsiVectorConfig.ts` に集約。既存値は維持。
- IC / Smart IC / JCT / SA / PAの名称レイヤはZoom 9.7から表示。タイルに名称データがある場合のみ表示でき、既存maxzoomは維持。
- 対象道路施設のアイコン専用レイヤは非表示。道の駅を含む汎用注記と道路番号記号は変更しない。
- 共有 `GSI_STYLE` を通じて通常地図・プレビュー・MP4・スポット画像PNGへ共通反映する。

Last updated: 2026-09-27

- 通常地図・overview/follow MP4・スポット画像PNGのクレジットは、gsiVectorConfig.tsのattributionを正として「出典：国土地理院　地理院タイルを加工して作成」を共通使用する。

## Spot image workspace (2026-09-27)

- 2026-09-28: 選択ツールでは画像矩形の位置だけドラッグ移動可能。開始時のpixel幅・高さを固定し、終了時にunproject→onBoundsで既存ImageBoundsを更新する。ドラッグ中のみカメラ操作を停止し、cancel/lost capture・resize・モード変更時は旧範囲へ戻して操作を復元。矩形をアンカー・バルーンより背面へ置き、新規範囲指定と分離。PNG／対象判定／fitは更新後のboundsをそのまま使う。

- 第3モードspotを追加。SpotWorkspace内に専用RouteHistory、選択ID、ツール、ImageBounds、AnnotationStyle、保存状態を保持。開始は0件・範囲なし。モードを離れるとアンマウントし、Timeline/Planへスポットを混入させない。既存JSON読込はTimelineへ戻り、計画モードは従来の初期化を使う。
- appendPlanPoint／movePoint／deletePoint／historyReducerを再利用。スポット追加・移動・削除・annotationラベルとplacementはUndo/Redo対象。範囲は独立stateでUndo対象外。初期状態はスポットと範囲を解除。作業JSON保存・再開は未実装、WORK_FILE_VERSION／PLAN_FILE_VERSIONは変更しない。
- 専用SpotMapはGSI_STYLEとoptional DEM fallback、既存AnnotationOverlay／bindPopupDrag／positionManualPopupを使用。ルートsource・ルート線・DAY・START/GOAL・距離HUDを作らない。通常のクリック／タップ追加、地点ドラッグ、バルーンドラッグをツールで分離する。
- 画像範囲はPointer Events＋pointer captureで開始点から四方向へ16:9矩形を作成し、unprojectした西・東・北・南で保持。回転・傾斜を無効にしてMercator上の比率を維持。範囲ツール中のみpan/zoom等を停止。move/resizeで枠を再投影し、fit操作ではboundsを書き換えない。
- PNGは専用1920×1080のMapLibreとCanvasで生成。元bounds内のスポットだけを最初に固定し、元boundsに一致するカメラから開始する。annotationCanvas.tsへ動画のバルーン描画を抽出し、動画は従来のclamp、静止画は未clampの同じサイズ・位置計算を使用する。
- 静止画はスポットアンカー／バルーン／影と下端70pxの出典予約領域を評価。はみ出す場合のみ最大48回のZoom Outと12回の二分探索で必要な余白を探す。manual placementのoffsetを変更しない。収まらない場合は配置・サイズの調整を案内して保存を止める。調整後に対象スポットを追加し直すことはない。
- glyph/sprite/Vector/DEMを含むloaded＋areTilesLoaded後のidleでcapture。DEMエラー・遅延は既存共有fallbackでDEMだけ除去、本体地図エラーは日本語で中断。通常のMapLibre画像取得／CORS経路を利用し、独自画像プロキシ等は追加しない。
- 国土地理院の文字はGSI_ATTRIBUTIONを参照し、MP4と同じ左下の白背景・22pxフォント位置で描画。UI・選択枠・編集ツールはPNGへ入れず、スポットアンカーとバルーンのみ追加する。
- saveBlobWithPickerへ.pngと非同期Blob factoryを追加。pickerをクリック内で開き、選択後にPNG生成、完了後にwritableを作成。キャンセル時は生成・downloadを開始しない。非対応時は既存download。既存JSON同期factory・MP4 Blob・上書き／abortの処理は維持。
- HelpTipにspot用途・範囲操作・PNG安全調整と未保存制約を追加。PC/Androidのtoolbarと上部3モード入口を既存デザインへ合わせる。
- 人間側確認: A/B/Cの追加・移動・削除・Undo/Redo、各バルーン設定と手動配置・connector、範囲外D除外、端のバルーンの最小Zoom Out、0件disabled、Zoom/resize後の地域維持、四方向の矩形とAndroidのpan競合、1920×1080 PNG・出典・UI非混入、保存キャンセル／上書き／非対応download、DEM失敗時、モード切替、既存Timeline/Plan保存・preview・overview/follow MP4。テスト・ブラウザ操作・実PNG生成は実行していない。

## DEM terrain tint (2026-09-27)

- GSI_VECTOR_CONFIG.terrainTintに配色10段階・opacity 0.7・URL・Zoom 1〜14・invalid閾値5000mを集約。DEM10B PNGを1つのcustom raster-dem sourceとして追加し、Zoom 15以上はoverscale。RGB係数655.36／2.56／0.01、baseShift 0で非負標高をmに変換する。
- MapLibre実インストール版6.7.0のColorReliefStyleLayerは直下のinterpolateから色表を作るため、caseは使用しない。4999mまで最終色を保ち、5000mで透明へ補間、それ以上も透明。NA（83886.08）・signed負値の巨大な正値を着色しない。負標高そのものの復号・計測は行わない。
- 共有GSI_STYLEの背景→lowZoom陸地→color-relief→既存Vector水域・道路・注記→アプリoverlayの順。通常地図／preview／overview・follow MP4に共通反映。既存配色・IC/JCT公式色・道路番号白文字・Zoom transition・公式JSONは維持。陰影・3D terrain・等高線・標高点・UIは追加しない。
- gsiTerrainTint.tsが通常地図と両MP4地図に共通のoptional処理を登録。MapLibre Style.addSourceのevented parentが付加するsourceIdでDEMエラーだけを識別し、イベント伝播後にDEMレイヤとsourceを除去。その地図インスタンスではVector背景で継続する。DEMの未完了が10秒続く場合も同様。地図破棄時に監視とタイマーを解除する。本体Vectorの既存エラー通知・動画中断条件は維持。
- overview初期・intro zoom各フレーム／最終画角はDEM source準備と描画を待ってからcapture。followの全source loaded／areTilesLoaded＋idle待ちはDEMも含み、camera移動ごとに適用。DEM除去時は待機を解除してVector表示で続行する。
- MapLibreの画像取得はfetch/XHRまたはcrossOrigin=anonymousを使用し、DEMは色変換を無効にして読む。CORS失敗時もDEMだけを除去する。既存と同じattributionHtmlを設定し、MapLibreの重複除去により二重表示を避ける。MP4出典も維持。
- 参考: https://maps.gsi.go.jp/development/demtile.html 、https://maps.gsi.go.jp/development/ichiran.html 、https://maplibre.org/maplibre-gl-js/docs/examples/add-a-color-relief-layer/
- 人間側で平野〜山地の色、海・湖・河川、道路・IC/JCT・番号・ルートの可読性、Zoom 4〜16、PC/Android、preview、overview/follow MP4（intro・camera移動含む）、DEM通信失敗時の継続を確認する。テスト実行・ブラウザ操作・実MP4生成は行っていない。

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
