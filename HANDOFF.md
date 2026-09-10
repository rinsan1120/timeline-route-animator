# HANDOFF

Last updated: 2026-09-11

## Current Status

GitHub mainとローカルHEADが `6f8b0a2bbf17d6d933f415497e45ab22e98301cb` で一致することを確認後、計画モードの概算距離HUDを追加。今回の変更は未コミット。計画JSON保存・再開とStep 02のDAY別概算距離は基準mainに実装済み。

## Completed

- `src/route/planDistanceProgress.ts`に計画全体の距離モデルと現在地点の距離算出を追加。既存planRouteDistancesのDAY境界・最終値、distanceMeters、interpolateTripRouteを再利用。
- `src/video/distanceHud.ts`にHUD設定・レイアウト・位置clamp・km書式・共通Canvas描画を追加。
- `src/map/DistanceHudOverlay.tsx`に動画フレーム基準のHUD表示とドラッグ配置を追加。編集時は最終値、プレビュー時は現在距離を表示。
- Appの計画モードStep 03にON/OFF（初期OFF）、50〜200%サイズ、位置リセットを追加。計画開始・JSON復元時は初期値へ戻す。JSON形式は未変更。
- 全体表示・導入ズーム・追従MP4へフレームごとのHUD描画を追加。バルーン等の後、attributionの前に描画。
- READMEにHUD操作説明を追加。

## In Progress

- 実装済み、ユーザーによる動作確認待ち。

## Known Issues

- 実行時の確認は未実施。新たな不具合・テスト失敗・ビルド警告の有無は未確認。
- READMEには今回と無関係な過去の仕様説明が残っている。今回、大規模な整理はしていない。

## Next Actions

1. HUD ONで編集時の値がStep 02と一致し、プレビュー・全体表示MP4・追従MP4で同一地点の距離が一致することを確認する。
2. DAY境界、途中開始/終了のアニメ範囲、導入ズーム、camera-pan、day-transition、POST ROLLで加算・停止が正しいことを確認する。
3. ドラッグ・画面リサイズ・サイズ変更時のclamp、DAY数が多い場合の全体縮小、出典表示を確認する。
4. TimelineモードとHUD OFFで非表示になること、計画作業再開でHUD設定のみ初期化されることを確認後、差分をレビューしてコミット・pushする。

## Verification

- GitHub main: `git ls-remote`でHEADとの一致を確認。
- コード差分: DAY境界・全計画ID対応・区間補間・描画順・初期化・プレビューと動画の共通モデル・変更範囲を確認。
- `git diff --check`: 問題なし。
- 単体テスト・ビルド・lint/typecheck・ブラウザ・Android/iPhone・Pages・実MP4生成: 未実施（実装とコード確認のみとのユーザー指定）。

## Important Context

- 未コミット変更: App.tsx、RouteMap.tsx、renderer.ts、styles.css、README.md、HANDOFF.md。新規: planDistanceProgress.ts、distanceHud.ts、DistanceHudOverlay.tsx。
- カメラ計算・タイル待機・既存planRouteDistances・計画JSON形式は変更していない。
- HUDの座標は動画左上基準。既存followViewportを全体表示/編集時にもHUD用フレームとして再利用し、地理座標とは独立している。
- HUDパネルはブラウザでもCanvas描画し、MP4と描画関数・寸法・等幅数字を共有する。
- `gsiVectorConfig.ts`の色はユーザーが調整するため、指示なく戻さない。
