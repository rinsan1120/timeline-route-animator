# HANDOFF

Last updated: 2026-09-11

## Current Status

GitHub `main` とローカルHEADが `13d5a13` で一致することを確認後、DAYごとのルート色分けを実装。今回の変更は未コミット。

## Completed

- DAY 1〜10の固定ルート色と、DAY 11以降を循環させる `dayRouteColor()` を追加。
- 全ルートの既存DAYマーカーからポイントごとのDAY番号を派生し、色自体はポイント・計画JSONへ保存しない構造にした。
- 通常の表示／編集／アニメ範囲画面ではDAY色分けを常時有効化。
- Step 03に動画用「DAYごとにルートを色分け」トグルを追加（初期OFF、計画JSON保存対象外）。
- プレビューとMP4のoverview／followで、トグルON時のみ同じDAY色を使用。OFF時は従来のオレンジ一色を維持。
- 計画モードの距離HUDへDAYカラーバーを追加。通常編集時は常時表示し、プレビュー／MP4では動画色分け設定へ連動。
- アニメーション範囲が途中開始でも、全体ルート上のDAY番号を維持。
- READMEへDAY色分けの表示・10色循環・動画トグル・HUD連動を追記。

## Preserved Behavior

- DAY境界の既存の接続／分離形状、距離計算、route reveal、移動マーカー、DAYマーカー、地点バルーン、START／GOALの描画は変更していない。
- 地点停止時間、共通再生時間軸、PRE／POST roll、overview／followカメラ計画とMP4時間計算は変更していない。
- 計画JSON形式と `PLAN_FILE_VERSION` は変更していない。

## Verification

- DAY色循環と、アニメーション範囲でも元のDAY番号を維持するテストを追加。
- `npm test`: 11ファイル・37テスト成功。
- `npm run build`: TypeScript/Viteビルド成功（既存のチャンクサイズ警告のみ）。
- `git diff --check`: 問題なし。
- ブラウザ表示、Android実機、生成MP4の目視確認はユーザー側で実施予定。

## Important Context

- 共通パレット・DAY番号派生・色用セグメント分割は `src/route/dayRouteColor.ts` に集約。
- MapLibreは単一レイヤーのGeoJSON Feature `color` propertyを参照する。
- 距離HUDはブラウザとMP4で引き続き同じCanvas描画関数を利用する。
- `gsiVectorConfig.ts` を含む背景地図の配色は変更していない。
