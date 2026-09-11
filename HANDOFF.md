# HANDOFF

Last updated: 2026-09-11

## Current Status

GitHub mainとローカルHEADが `0d562b987a5acee125e9a1a5e332bbc4a7460845` で一致することを確認後、動画プレビュー／MP4のカメラ不一致を修正。今回の変更は未コミット。

## Completed

- `overviewCamera.ts` に1920×1080基準のVideoCamera生成と中央16:9枠、Zoom縮小変換を集約。上下非対称paddingによるcenter位置も動画座標で決定。
- Appの同一overviewCameraをRouteMap／rendererへ渡す。全体表示MP4での独立fitBounds・ブラウザ全体サイズからの逆換算を廃止。
- 全体表示・追従プレビューで16:9枠を表示。リサイズ時も共通変換を適用し、終了時は編集カメラと通常のMapLibre制約を復元。
- 開始時ズームは論理video zoomで補間し、プレビューの導入カメラ進行をMP4の0〜89フレームに合わせた。ルート進行・MP4フレーム数は未変更。
- FOLLOW_VIEWPORTはVIDEO_VIEWPORTを参照。追従プランの生成・pan・DAY transitionは変更していない。
- 既存テスト2ファイルのimport・カメラmock・期待値のみ新しい呼び出し方式へ追従。実行はしていない。
- READMEにプレビュー枠の説明を追加。

## In Progress

- 実装修正は完了。ユーザーによるプレビュー／MP4比較確認待ち。

## Known Issues

- 今回のカメラ修正と前回のDAY寸法修正の実機結果は未確認。実際の画角・配置一致を確認済みとはしていない。

## Next Actions

1. ユーザー側で全体表示の自動／カスタム、開始時ズームON/OFFの16:9枠とMP4を比較する（横長・縦長のブラウザ領域）。
2. 追従のpan／DAY transition、プレビュー中リサイズ、終了・中止時の編集カメラ復元を確認する。
3. DAY・HUD等の配置関係を確認し、差分レビュー後にコミット・pushする。

## Verification

- GitHub main: git ls-remoteでHEADとの一致を確認。
- コード差分: 共通カメラの伝達、paddingのcenter補正、16:9縮小率、リサイズと復元、参照の置換を確認。MapLibreの既存Mercator実装と型定義を参照。
- git diff --check: 問題なし。
- テスト・ビルド・lint/typecheck・ブラウザ・実MP4生成・実機: 未実施（ユーザー指定）。

## Important Context

- 未コミット変更: src/App.tsx、src/map/RouteMap.tsx、src/video/{overviewCamera.ts,followCamera.ts,renderer.ts,overviewCamera.test.ts,renderer.test.ts}、README.md、HANDOFF.md。
- 不一致の原因はブラウザ全体でのfitBoundsと動画側での別fitBounds／viewport換算。今は動画カメラを算出し、ブラウザのみzoom + log2(16:9枠scale)へ変換。
- ブラウザの枠外余剰領域でMapLibreが勝手に緯度・Zoomを制約しないよう、プレビュー中だけ動画viewport基準の制約を適用する。通常編集のfitRouteは変更していない。
- `overviewReferenceViewport` はカメラには不要になったがDAY寸法には必要なため、`dayMarkerReferenceViewport`へ改名して同じ値を引き続き全renderer経路へ渡す。DAY・HUD・その他バルーンのデザイン／サイズ、タイル待機、計画JSONは未変更。
- gsiVectorConfig.tsの色は指示なく戻さない。
