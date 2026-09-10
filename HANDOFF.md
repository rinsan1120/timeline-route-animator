# HANDOFF

Last updated: 2026-09-11

## Current Status

GitHub mainとローカルHEADが `d3b9419783762629306cb4abf2364f7122149732` で一致することを確認後、計画モードのDAY別概算距離・合計表示を追加。今回の変更は未コミット。前回の計画JSON保存・再開はmainに含まれている。

## Completed

- `src/plan/planFile.ts`に専用JSON（format/version付き）の生成・ダウンロード・全体検証を実装。
- `src/App.tsx`の計画モードStep 01に「作業を保存」「作業を再開」と独立したファイル入力を追加。
- points（地点バルーンを含む）、planDayStarts、planDayNotes、dayMarkerPlacementsを保存・復元。ポイントIDは維持。
- 復元時はhistoryReducerのloadを使用し、選択・アニメ範囲・プレビュー・生成済み動画等をリセットして編集モードへ戻す。
- `src/route/tripRoute.ts`に計画用距離関数を追加。既存DAYマーカーと同じ境界判定を利用し、DAY間の接続距離を除外する。
- 計画モードのStep 02にDAY別概算距離と合計を表示し、見出しも同じ合計を使用。points・planDayStartsから導出し、編集・Undo/Redo・DAY変更・JSON復元に追随する構成。
- READMEに概算距離の説明を追加。Timeline側の距離計算・動画設定・地図描画・計画JSON処理は今回変更していない。

## In Progress

- 実装済み、ユーザーによる動作確認待ち。

## Known Issues

- 今回の実装について実行時の確認は未実施。新たな不具合・テスト失敗・ビルド警告の有無は未確認。
- READMEには今回の距離表示・保存機能以外に過去の仕様説明が残っている。今回、無関係なドキュメント整理は行っていない。

## Next Actions

1. 複数DAYの計画ルートでDAY間の接続距離が除外され、DAY別合計とStep 02見出しが一致することを確認する。
2. ポイント編集・範囲削除・Undo/Redo・DAY追加/解除・計画JSON復元で距離が更新されること、単一点DAYが0 mになることを確認する。
3. ユーザー確認後、今回の4ファイルをレビューしてコミット・pushする。

## Verification

- GitHub main: `git ls-remote`でHEADとの一致を確認。
- コード差分: 既存distanceMetersの再利用、DAY境界との一致、空ルート・単一点・連続DAY開始点の扱い、useMemo依存配列、Timeline計算の維持を確認。
- 単体テスト・ビルド・lint/typecheck・ブラウザ・Android/iPhone・Pages・実MP4生成: 未実施（実装とコード確認のみとのユーザー指定）。

## Important Context

- 未コミット変更: `src/App.tsx`、`src/route/tripRoute.ts`、`README.md`、`HANDOFF.md`。
- 既存編集処理が削除済み地点のDAY情報を保持するため、計画JSONでも未参照のDAYキーを削除せず保存・復元する。
- `gsiVectorConfig.ts`の色はユーザーが調整するため、指示なく戻さない。
- 古い引継ぎ記録にあった未デプロイ状態や過去の検証結果は、現在の状態の証拠として扱わない。
