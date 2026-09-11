# HANDOFF

Last updated: 2026-09-11

## Current Status

GitHub mainとローカルHEADが `a45451d41759d94862cc34626f0706f3476704d3` で一致することを確認後、計画モードの「途中追加」を実装。今回の変更は未コミット。

## Completed

- 計画モードの編集ツールを「選択／連続追加／途中追加／範囲削除」の順に表示。途中追加は2点未満で無効。
- `insertPlanPoint()` は既存の点・線分距離計算を利用し、次の点がplanDayStartsに含まれる区間を候補から除外。クリック座標のまま新しい手動点を挿入する。
- 候補がない場合はルート・履歴を変更せず日本語エラーを表示。
- 追加後も途中追加モードを維持し、historyReducerのcommitへ登録。既存ID、DAY情報、アニメ範囲IDは変更しない。
- 途中追加中は通常選択・既存ポイントへの重複追加・ポイント移動ハンドル・バルーン等のドラッグを抑止。
- 他ツールへの切替、編集終了、新規計画、計画復元、Timeline読込時に途中追加を解除。
- READMEへ操作説明を追加。

## In Progress

- 実装は完了。ユーザーによる操作確認待ち。

## Known Issues

- 今回の操作結果は未実機確認。
- 前回の動画カメラ／DAY寸法修正はmainに含まれるが、比較結果はこの作業では未確認。

## Next Actions

1. ユーザー側で途中追加を繰り返し、末尾追加との分離・DAY境界除外・既存ポイントhit時の抑止を確認する。
2. 全区間DAY境界の場合のエラー、2点未満、Undo／Redo、ツール切替、通常のpan／zoomを確認する。
3. DAY情報・概算距離・HUD・アニメ範囲・計画JSON再開との整合性を確認後、差分レビューしてコミット・pushする。

## Verification

- GitHub main: git ls-remoteでHEADとの一致を確認。
- コード確認: nearestSegmentIndexの既存呼出しはオプション省略時に従来の挙動を維持。追加対象の絞り込み、clickの分岐、ドラッグ抑止、初期化・解除箇所を確認。
- 差分: addPoint／appendPlanPoint本体、DAYデータ更新、距離計算、アニメ範囲slice、JSON形式、カメラ・renderer・タイル待機・CSSは変更なし。
- git diff --check: 問題なし。
- テスト・ビルド・lint/typecheck・ブラウザ・実機・MP4生成: 未実施（ユーザー指定）。

## Important Context

- 未コミット変更: src/App.tsx、src/map/RouteMap.tsx、src/route/editor.ts、src/route/geometry.ts、README.md、HANDOFF.md。
- geometryのnearestSegmentIndexに任意の区間predicateを追加。指定時のみ「候補なし」は-1となる。既存Timeline呼出しは未変更。
- insertModeは作業用UI状態のみで、計画JSONには追加していない。
- gsiVectorConfig.tsの色は指示なく戻さない。
