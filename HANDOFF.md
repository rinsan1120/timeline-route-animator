# HANDOFF

Last updated: 2026-09-11

## Current Status

GitHub mainとローカルHEADが `a5d506a309de64a1eada4a22ce1612898fad56aa` で一致することを確認後、DAYマーカーのDOM／MP4サイズ不一致を修正。今回の変更は未コミット。

## Completed

- 新規 `src/route/dayMarkerStyle.ts` に寸法・色・フォント・文字幅計測・4パターンの行レイアウト・接続線形状を集約。
- ブラウザの既存CSSサイズ（幅138px、DAY文字14px等）を実際の地図viewportから1920×1080へ換算。固定の想定画面サイズやMP4旧幅300pxを基準にしていない。
- DayMarkerOverlayは共通論理寸法をpopupDisplayScaleで表示実寸へ戻して適用。transform縮小を使わずoffsetWidth/offsetHeightとの整合性を維持。
- MP4の全体表示・導入ズーム・追従すべてで同じdrawDayMarkerへ、既存overviewReferenceViewportをサイズ換算用にも渡す。
- DAYの角丸・均一な枠・文字間隔・日付・補足・shadow・接続線・anchorをDOM基準に統一。MP4専用の厚い上部アクセントを削除。
- DAY専用CSSはendpoint-markerを除外。START/GOAL・地点バルーン・配置helper・カメラ・HUDは変更していない。
- READMEにサイズ換算の説明を追加。

## In Progress

- 実装済み、ユーザーによる見た目・配置の確認待ち。

## Known Issues

- DOM／実MP4での見た目は未検証。フォント描画の微差はあり得る。
- ユーザー報告の「MP4の地図Zoomがブラウザより若干低く見える」問題は今回対象外。
- 前回の共通トグルCSS修正はmainに含まれるが、スクロール位置の実機測定結果は未取得。

## Next Actions

1. 同じブラウザ画面から、DAYのみ／DAY+日付／DAY+補足／DAY+日付+補足を全体・追従MP4へ出力し、HUDとの占有範囲・文字サイズ・枠を比較する。
2. 保存済み配置・ドラッグ・位置リセット・画面リサイズ・通常表示とプレビューを確認する。
3. START/GOAL・地点バルーンが従来どおりであることを確認後、今回の差分をレビューしてコミット・pushする。Zoom問題は別作業とする。

## Verification

- GitHub main: git ls-remoteでHEADとの一致を確認。
- コード差分: 4種の行レイアウト、表示実寸、両renderer経路の参照viewport伝達、DAY限定CSS、既存配置座標系の維持を確認。
- git diff --check: 問題なし。
- テスト・ビルド・lint/typecheck・ブラウザ・実MP4生成・実機: 未実施（ユーザー指定）。

## Important Context

- 未コミット変更: src/map/DayMarkerOverlay.tsx、src/styles.css、src/video/renderer.ts、新規src/route/dayMarkerStyle.ts、README.md、HANDOFF.md。
- 変換は「論理寸法 = 現在のブラウザCSS寸法 ÷ popupDisplayScale」。DOMはこれに同じscaleを乗じるため、従来の見た目を拡大しない。MP4は論理寸法をそのまま描画する。
- overviewReferenceViewportはAppが既に全体／追従どちらの出力にも渡していた地図サイズ。今回はその値をDAY寸法にも利用するだけでカメラ計算は未変更。
- PopupPlacement・positionManualPopup・placedPopupRect・計画JSONは未変更。
- gsiVectorConfig.tsの色は指示なく戻さない。
