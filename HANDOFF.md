# HANDOFF

Last updated: 2026-09-11

## Current Status

GitHub mainとローカルHEADが `6f8353a778bb19b7329e90b1fb9b0a64d87ce5a0` で一致することを確認後、走行距離表示トグルでページ位置がずれる問題に対して共通checkbox CSSを修正。今回の変更は未コミット。距離HUDは基準mainに実装済み。

## Completed

- 共通.toggle-rowを配置基準にし、checkboxをlabel内の1px領域へ固定。label操作・Tabフォーカス・Space操作を維持し、focus-visible時はスイッチに枠を表示するCSSを追加。
- `src/route/planDistanceProgress.ts`に計画全体の距離モデルと現在地点の距離算出を追加。既存planRouteDistancesのDAY境界・最終値、distanceMeters、interpolateTripRouteを再利用。
- `src/video/distanceHud.ts`にHUD設定・レイアウト・位置clamp・km書式・共通Canvas描画を追加。
- `src/map/DistanceHudOverlay.tsx`に動画フレーム基準のHUD表示とドラッグ配置を追加。編集時は最終値、プレビュー時は現在距離を表示。
- Appの計画モードStep 03にON/OFF（初期OFF）、50〜200%サイズ、位置リセットを追加。計画開始・JSON復元時は初期値へ戻す。JSON形式は未変更。
- 全体表示・導入ズーム・追従MP4へフレームごとのHUD描画を追加。バルーン等の後、attributionの前に描画。
- READMEにHUD操作説明を追加。

## In Progress

- トグルCSS修正済み、ユーザーによるレイアウト・フォーカス動作確認待ち。

## Known Issues

- ユーザー報告のトグルON後のページ位置ずれに対してCSSを修正したが、実際のscrollTop/scrollY変化と修正後の挙動は未測定。
- READMEには今回と無関係な過去の仕様説明が残っている。今回、大規模な整理はしていない。

## Next Actions

1. control-panelを下へスクロールして走行距離表示をON/OFFし、documentElement.scrollTop/body.scrollTop/window.scrollYとヘッダー・map-stageの位置が意図せず変化しないことを確認する。
2. 走行距離表示・開始時ズーム・測位データ表示でlabelクリックとTab/Space操作、フォーカス枠を確認する。
3. HUD OFF時にHUD用overlayが外れ、通常表示へ戻ることを確認後、今回の2ファイルをレビューしてコミット・pushする（追従プレビュー中の既存フレームは維持）。

## Verification

- GitHub main: `git ls-remote`でHEADとの一致を確認。
- コード差分: 3つの共通トグルのDOM、absolute checkboxの配置基準、HUDのabsolute overlayと条件付き描画、CSSの適用範囲を確認。
- `git diff --check`: 問題なし。
- 単体テスト・ビルド・lint/typecheck・ブラウザ・Android/iPhone・Pages・実MP4生成: 未実施（実装とコード確認のみとのユーザー指定）。

## Important Context

- 未コミット変更: `src/styles.css`、`HANDOFF.md`のみ。
- 修正前はcheckboxの配置基準になる祖先がcontrol-panel内になく、透明でもフォーカス可能な絶対配置inputがページ側のスクロール対象になり得た。label内へ位置・サイズを明示する修正であり、scrollTo等の強制復帰処理は追加していない。
- カメラ計算・タイル待機・既存planRouteDistances・計画JSON形式は変更していない。
- HUDの座標は動画左上基準。既存followViewportを全体表示/編集時にもHUD用フレームとして再利用し、地理座標とは独立している。
- HUDパネルはブラウザでもCanvas描画し、MP4と描画関数・寸法・等幅数字を共有する。
- `gsiVectorConfig.ts`の色はユーザーが調整するため、指示なく戻さない。
