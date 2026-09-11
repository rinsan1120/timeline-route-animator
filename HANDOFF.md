# HANDOFF

Last updated: 2026-09-11

## Current Status

GitHub `main`、`origin/main`、ローカルHEADが `6f930d3` で一致することを確認後、左側コントロールパネルのコンテキストヘルプを実装。今回の変更は未コミット。

## Completed

- クリック／タップとキーボードで開閉できる共通 `HelpTip` を `src/help/HelpTip.tsx` に追加。
- 17項目分の日本語ヘルプ文言と型安全な `HelpKey` を `src/help/helpContent.ts` に一元管理。
- Timelineの読み込み範囲、Step 02の表示・編集項目、Step 03の動画設定へ、概念単位の「?」ボタンを追加。
- ヘルプ本文を対象項目の直下へインライン表示し、親コンテナ内で自然に折り返すレスポンシブCSSを追加。
- `AGENTS.md` に、今後左側パネルへ設定・編集項目・操作概念を追加するときは、明示的な指示がなくても同時にコンテキストヘルプを追加する恒久ルールを追記。
- READMEへ左側パネルの「?」から説明を確認できることを追記。

## Preserved Behavior

- ヘルプの開閉状態は各 `HelpTip` 内の一時的なUI状態だけで、RoutePoint、計画JSON、localStorage、Undo / Redo履歴へ保存しない。
- Timeline／計画モード、ポイント編集、DAY設定・色分け、地点停止、地点バルーン、START / GOAL、距離HUD、アニメーション範囲、プレビュー、カメラ、Zoom、MP4生成の処理は変更していない。
- 既存のDOM ID、設定値、保存形式、`PLAN_FILE_VERSION` は変更していない。
- ヘルプボタンは既存の `label` の外へ配置し、入力コントロールとの関連付けを維持している。

## Verification

- TypeScriptの `HelpKey` により、存在しないヘルプキーを `HelpTip` へ指定できない構造。
- `npm test`: 11ファイル・37テスト成功。
- `npm run build`: TypeScript/Viteビルド成功（既存のチャンクサイズ警告のみ）。
- `git diff --check`: 問題なし。
- ブラウザ表示とAndroid実機の目視確認はユーザー側で実施予定。

## Important Context

- ヘルプ文言の変更・追加は `src/help/helpContent.ts`、表示挙動の変更は `src/help/HelpTip.tsx` を使用する。
- 新しい左パネル設定を追加する際は、ヘルプ定義、対象項目への `HelpTip` 配置、PC／Androidで収まるレイアウト確認までを同じ実装範囲に含める。
- 単純な削除、Undo、保存、リセット等へは機械的にヘルプを追加しない。
