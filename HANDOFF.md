# HANDOFF

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
