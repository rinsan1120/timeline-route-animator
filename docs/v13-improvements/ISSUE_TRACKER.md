# Journey Map Studio V1.3 — 不具合・改善管理表

> **管理方針の正本**：V1.3の不具合・改善・未確認リスクの優先度と対応順序を、この文書で管理する。各課題の詳細仕様・進捗・担当作業はリンク先のGitHub Issueを正本とする。

- 対象リポジトリ：[`rinsan1120/timeline-route-animator`](https://github.com/rinsan1120/timeline-route-animator)
- 管理表作成日：2026-10-16（日本時間）
- 参照状態：2026-10-17にGitHubのOpen Issue **27件（#1〜#27）** を再照合。V1.3は同日 `main` に統合・Pages公開済み。以後の通常開発・仕様書管理は `main` を基準とする。最新状態はGitHubで再確認する。
- 決定者：プロダクトオーナー。優先順位は対話で合意したもので、必要に応じて変更する。
- **最優先5件（合意済み）**：[#13](https://github.com/rinsan1120/timeline-route-animator/issues/13) → [#14](https://github.com/rinsan1120/timeline-route-animator/issues/14) → [#1](https://github.com/rinsan1120/timeline-route-animator/issues/1) → [#3](https://github.com/rinsan1120/timeline-route-animator/issues/3) → [#17](https://github.com/rinsan1120/timeline-route-animator/issues/17)。

## 優先度の考え方

| 優先度 | 意味 | 判断基準 |
| --- | --- | --- |
| **P0：最優先** | V1.3を実際に編集・検証できる状態を整える | 操作不能・データ消失の防止、検証効率に直接効く表示領域の確保 |
| **P1：高** | 制作・検証体験の構造改善 | 主要な操作導線、画面情報設計、スマホ操作性、開発文書の整合 |
| **P2：中** | 局所的な問題と重要な懸念の整理 | 原因の絞られた不具合、編集・保存の未確認リスク、既存設定の改善 |
| **P3：低／後続** | 影響範囲が限定的・未計測・将来向け | 表示文言、性能・互換性の未確認リスク、追加機能候補 |
| **反映照合** | 実装済み候補の管理上の整理 | `main`への反映状況を確認して既存IssueをCloseするか決める。未完了の開発タスクと区別 |

優先度は**ユーザー影響、発生確度、検証効率、データ保護、修正範囲・デグレリスク、関連Issueの依存関係**から決める。未確認リスクを、実機再現済みの不具合として扱わない。

## 全Issue優先順位（作成時採録27件）

| 順位 | 優先度 | Issue | 対応内容 | 根拠・状況 | 方針・判断理由 | 関連 |
| ---: | :---: | :--- | --- | --- | --- | --- |
| 01 | **P0** | [#13](https://github.com/rinsan1120/timeline-route-animator/issues/13) | 映像画面への地図側DAYマーカー混入 | 実機報告／Open | 映像表示と操作を妨害。地図側と映像側の表示分離を修正 | #12 |
| 02 | **P0** | [#14](https://github.com/rinsan1120/timeline-route-animator/issues/14) | Androidの文字入力欄がキーボードで隠れる | 実機報告／Open | バルーン入力が困難。VisualViewport・シート・フォーカス領域を調整 | #12・#16 |
| 03 | **P0** | [#1](https://github.com/rinsan1120/timeline-route-animator/issues/1) | モード切替・別ファイル読込時の未保存編集保護 | 予防的改善／Open | 検証・編集成果の意図しない消失を防ぐ。破棄前確認を追加 | #20・#24・#25 |
| 04 | **P0** | [#3](https://github.com/rinsan1120/timeline-route-animator/issues/3) | スマホのヘッダー省スペース化 | 実機UX改善／Open | 地図・映像の表示領域を拡大し、以後の検証効率を上げる | #12・#17 |
| 05 | **P0** | [#17](https://github.com/rinsan1120/timeline-route-animator/issues/17) | スマホ編集時の地図場所検索欄の非表示 | 実機UX改善／Open | 不要な常設領域を取り除き、地図・映像の可視領域を確保 | #3・#12 |
| 06 | **P1** | [#6](https://github.com/rinsan1120/timeline-route-animator/issues/6) | AGENTS.md・READMEの旧V1記述の整理 | 保守／Open | 実装済み機能を旧V1制約として誤認しないようにする | — |
| 07 | **P1** | [#15](https://github.com/rinsan1120/timeline-route-animator/issues/15) | STEP 1〜3の表示・スクロールを独立化 | 実機UX課題／Open | 設定の誤認を減らし、作業手順を明確化 | #12 |
| 08 | **P1** | [#12](https://github.com/rinsan1120/timeline-route-animator/issues/12) | スマホ映像画面の全体レイアウト再設計 | 実機UX課題／Open | 映像が小さい・導線が分かりにくい問題を体系的に改善 | #3・#15・#17 |
| 09 | **P1** | [#9](https://github.com/rinsan1120/timeline-route-animator/issues/9) | スマホでのバルーン編集タッチ領域拡張 | 静的レビュー／Open | 映像を縮小表示しても選択・ドラッグしやすいようにする | #12・#23 |
| 10 | **P1** | [#16](https://github.com/rinsan1120/timeline-route-animator/issues/16) | ボトムシートの指追従と自然な開閉 | 実機UX報告／Open | スワイプ操作のぎこちなさを改善 | #12・#14・#15 |
| 11 | **P2** | [#19](https://github.com/rinsan1120/timeline-route-animator/issues/19) | 映像の空白タップで再生が停止する | コード上の問題／Open | ヒット判定前の一時停止副作用を修正 | #9 |
| 12 | **P2** | [#8](https://github.com/rinsan1120/timeline-route-animator/issues/8) | イベントジャンプの初回可視フレーム判定 | 未再現リスク／Open | 追従時のイベント移動位置の正確さを改善 | #26 |
| 13 | **P2** | [#24](https://github.com/rinsan1120/timeline-route-animator/issues/24) | バルーン編集中のJSON保存・読込の状態競合 | 未確認リスク／Open | 編集確定性とファイル操作のガード条件を統一するか判断 | #1・#20・#25 |
| 14 | **P2** | [#25](https://github.com/rinsan1120/timeline-route-animator/issues/25) | バルーン編集中の画面・編集モード切替の競合 | 未確認リスク／Open | 編集中断と画面遷移のガード条件を整理 | #1・#20・#24 |
| 15 | **P2** | [#18](https://github.com/rinsan1120/timeline-route-animator/issues/18) | バルーンサイズ・文字サイズ設定の統合 | 機能改善／Open | 設定操作を簡素化。既存JSONの後方互換に注意 | #12 |
| 16 | **P2** | [#21](https://github.com/rinsan1120/timeline-route-animator/issues/21) | 地図・映像往復時のバルーン位置の整合性 | 未確認リスク／Open | 位置保持機構は存在。問題がある場合のみ修正 | #20・#24 |
| 17 | **P2** | [#20](https://github.com/rinsan1120/timeline-route-animator/issues/20) | ドラッグ中断時の確定・キャンセルとUndo整合性 | 未確認リスク／Open | 既存キャンセル処理を踏まえ境界条件を確認 | #21・#24・#25 |
| 18 | **P2** | [#22](https://github.com/rinsan1120/timeline-route-animator/issues/22) | MP4生成中止後のプレビュー状態復帰 | 未確認リスク／Open | 既存の復帰処理を精査し、実害があれば修正 | — |
| 19 | **P3** | [#23](https://github.com/rinsan1120/timeline-route-animator/issues/23) | モバイルのシークバーPointer Capture競合 | 未確認リスク／Open | 標準range操作との競合が未再現 | #9 |
| 20 | **P3** | [#10](https://github.com/rinsan1120/timeline-route-animator/issues/10) | 再生中のReact再描画負荷 | 未計測リスク／Open | 実測根拠のない大規模最適化を避ける | — |
| 21 | **P3** | [#26](https://github.com/rinsan1120/timeline-route-animator/issues/26) | イベント投影のMapLibre内部API依存 | 将来互換性リスク／Open | 現行障害なし。更新時の互換性を管理 | #8 |
| 22 | **P3** | [#11](https://github.com/rinsan1120/timeline-route-animator/issues/11) | プレビュー読込失敗時の案内文 | コード上の問題／Open | MP4生成向け文言をプレビュー向けに整理 | #27 |
| 23 | **P3** | [#27](https://github.com/rinsan1120/timeline-route-animator/issues/27) | MP4非対応環境への案内文 | コード上の問題／Open | Android Chrome限定の案内を環境非依存に修正 | #11 |
| 24 | **P3** | [#7](https://github.com/rinsan1120/timeline-route-animator/issues/7) | 動画演出プリセットの追加 | 新機能候補／Open | 既存の主要編集体験が安定してから検討 | — |
| 25 | **反映照合** | [#2](https://github.com/rinsan1120/timeline-route-animator/issues/2) | スマホ設定ボトムシート導入 | mainに実装あり／Open | 解消判定は未確定。Closeはユーザー判断 | #12・#16 |
| 26 | **反映照合** | [#4](https://github.com/rinsan1120/timeline-route-animator/issues/4) | 動画制作設定のJSON保存・復元 | mainにV1.3実装が統合済み／Open | 解消判定は未確定。Closeはユーザー判断 | #1 |
| 27 | **反映照合** | [#5](https://github.com/rinsan1120/timeline-route-animator/issues/5) | 再生・一時停止・シークの追加 | mainにV1.3実装が統合済み／Open | 解消判定は未確定。Closeはユーザー判断 | #8・#12 |

**注意**：表中の「Open」は2026-10-17の再照合時点のGitHub Issue状態であり、リアルタイム自動同期ではない。実装コミットが `main` にあっても、実機での解消やIssueの完了を意味しない。着手・完了・Close状況は必ずGitHubの最新Issueを参照する。

## P0：最優先5件の対応方針（プロダクトオーナー決定）

| 順位 | Issue | AS-IS／問題 | TO-BE／対応範囲 | 保護する仕様 |
| ---: | --- | --- | --- | --- |
| 1 | [#13](https://github.com/rinsan1120/timeline-route-animator/issues/13) | 映像画面に編集地図側の巨大DAYマーカーが重なって表示される（Android実機報告）。 | 映像表示中は地図側オーバーレイを確実に遮断し、動画フレーム内の正規DAY表示だけ残す。 | 地図側DAY編集、地図／映像切替、MP4／PNG描画。 |
| 2 | [#14](https://github.com/rinsan1120/timeline-route-animator/issues/14) | Androidのソフトウェアキーボードが地点ラベル入力欄を覆う（実機報告）。 | 入力欄がキーボード表示中にも見えるよう、可視領域・シート高・フォーカスとスクロールを調整。 | 入力値、シートの操作、iPhone／PCレイアウト、Undo／Redo。 |
| 3 | [#1](https://github.com/rinsan1120/timeline-route-animator/issues/1) | 編集内容を未保存のままモード切替・別JSON読込すると、作業が意図せず破棄され得る。 | 実際に破棄される未保存変更がある場合だけ確認し、キャンセルなら状態を変えない。 | 既存の保存JSON・制作モード・ポイント編集・Undo／Redo・プライバシー。 |
| 4 | [#3](https://github.com/rinsan1120/timeline-route-animator/issues/3) | スマホの大きいヘッダーが地図／映像領域を圧迫（Android実機報告）。 | 編集中は現在モード名と切替導線を中心にコンパクト表示し、初期／モード選択時の情報は保つ。 | 3モード切替、重要な案内、PCヘッダー、地図／映像の操作。 |
| 5 | [#17](https://github.com/rinsan1120/timeline-route-animator/issues/17) | スマホの地図場所検索欄が作業領域を占有（実機UX報告）。 | モバイル幅では検索ボックスの常設表示をやめる。PCでは従来どおり維持。 | 検索ロジック、PCの検索操作、地点・保存データ。 |

**P0内の番号は重要度の順位**であり、実装着手順とは分けて管理する。2026-10-16の設計判断で、スマホ検証の作業領域を先に確保するため **#3を#14より先に着手**することとした。#14の入力不能問題の重要度は維持し、#3で修正済みと扱わない。詳細は[スマホヘッダー・キーボード連携設計](MOBILE_HEADER_KEYBOARD_DESIGN.md)。

## V1.3開発ブランチ時代の実装記録（履歴／2026-10-16）

重要度の順位と**実際の実装順**は分けて管理する。以下は当時 `feature/video-editor-v13` 上で確認したコミットの履歴であり、2026-10-17のPR #28によって **`main` へ統合済み**。ただし、**実機で問題が解消したことの確認やIssueのCloseを意味しない**。

| 実装順 | Issue | ブランチ上のコミット | 状況 |
| ---: | --- | --- | --- |
| 1 | [#13](https://github.com/rinsan1120/timeline-route-animator/issues/13) | `3d8401b11` | 映像画面への地図側オーバーレイ混入対策をコミット |
| 2 | [#3](https://github.com/rinsan1120/timeline-route-animator/issues/3) | `4c129cd11` | スマホヘッダーのコンパクト化をコミット |
| 3 | [#14](https://github.com/rinsan1120/timeline-route-animator/issues/14) | `4ab7c7505` | Android文字入力とボトムシートの追従処理をコミット |
| 4 | [#1](https://github.com/rinsan1120/timeline-route-animator/issues/1) | `8a87cf36f` | 未保存編集保護をコミット |
| 5 | [#17](https://github.com/rinsan1120/timeline-route-animator/issues/17) | `eb14d9f7e` | スマホ場所検索欄の非表示をコミット |
| 6 | [#15](https://github.com/rinsan1120/timeline-route-animator/issues/15) | `644ff6348` | STEP表示・スクロールの独立化をコミット |

- 今後の主要検討対象：[#12](https://github.com/rinsan1120/timeline-route-animator/issues/12) スマホ映像画面の全体UX再設計。#15の変更内容も踏まえて設計する。
- 関連設計：[V1.3スマホヘッダー・キーボード連携設計](MOBILE_HEADER_KEYBOARD_DESIGN.md)。#3・#14の実装方針と確定仕様を記録し、最終挙動は現在のソースコードを正とする。
- **現在の公開運用**：V1.3は `main` に統合済みで、`.github/workflows/deploy.yml` は `main` へのPushでPagesを自動デプロイする。以前のfeature公開とmain公開の競合は過去の教訓としてLessons第11章に記録されている。

## 関連Issueの取り扱い

- **#3・#17 と #12**：小さな表示領域改善を先に行い、#12のスマホ映像UI再設計で同じヘッダー／検索欄を二重実装しない。
- **#14 と #16**：キーボード時の高さ・フォーカス制御を優先。シートのスワイプアニメーションは別問題として扱い、同一箇所の手戻りを減らす。
- **#1 と #20・#24・#25**：保存前確認と、バルーン編集中のファイル読込／画面切替ガードを設計上突き合わせる。ただし未確認リスクの全部を不具合と断定して一括改修しない。
- **#15 と #12**：STEP別情報設計を整理してから映像画面の主要操作導線を調整する。
- **#8 と #26**：イベントの可視フレーム探索とMapLibre内部API依存は別課題。互換性維持を優先する。
- **#2・#4・#5**：実装コードは `main` に存在するが、IssueはOpenのまま。統合と解消確認を混同せず、Closeの判断はユーザーに委ねる。GitHubに直接コミットした変更に追加Pushは不要。

## 運用ルール

1. **全体の順位・判断理由**はこのファイル、**個別の課題・実装詳細・進捗**は各Issueに記録する。同一仕様の二重管理を避ける。
2. 優先順位が変わったら、ユーザーの決定に合わせてこの表を更新する。Issue番号やリンクは変えない。
3. 確認済み事実、ユーザーの実機報告、コード上の懸念、未確認事項を明確に分ける。未確認リスクに問題がない場合は根拠を残してCloseを検討する。
4. V1.3統合後は `main` の最新コードを実装・検討の正本とする。別の開発ブランチを明示的に使う場合は、その対象ブランチを確認する。既存コードと矛盾する古い文書だけを根拠に判断しない。
5. Codexへの個別実装指示は各Issueの着手時に作成する。**変更最小限、依頼外の網羅的テスト・実機確認を定型依頼しない、git commitまで／git push禁止**を維持する。Pushはユーザーが行う。
6. この管理表の更新先は **`main`** とする。GitHubに直接コミットした変更をローカルで使用する際はFetch／Pullし、Codexと同じファイルの並行編集を避ける。GitHub Pagesのデプロイ対象ブランチと公開への影響も更新前に確認する。

## メンテナンス記録

- 2026-10-17：GitHub Issues #1〜#27がすべてOpenであることを確認。V1.3のPR #28によるmain統合とPages成功を踏まえ、過去のfeature基準・未統合表現を履歴として明確化。順位は変更せず、IssueのClose・再分類は行っていない。

- 2026-10-17：V1.3を `main` に統合し、以後の通常開発・文書管理・Pages自動デプロイの基準を `main` に統一。

- 2026-10-16：`main` にのみ存在した管理表・設計書を V1.3開発ブランチへコピー。#13・#3・#14・#1・#17・#15 の開発ブランチ上のコミットを反映し、未確認／Open／未統合を区別した。公開版の巻き戻り防止のため、開発中は`main`へ直接文書コミットしない。
- 2026-10-16：#13はユーザーがローカルコミット完了と報告（Push前）。#3と#14の設計を整合させ、#3先行・#14後続の**着手順序**を追加。重要度の順位は据え置き。関連設計メモを新規作成。
- 2026-10-16：オープンIssue 27件を採録。プロダクトオーナー決定により #13・#14・#1・#3・#17 をP0最優先に昇格。#3・#17は後続の実機検証効率に直接影響することを明記。その他は直前のレビュー順位を維持。
