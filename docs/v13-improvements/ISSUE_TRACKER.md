# Journey Map Studio V1.3 — 不具合・改善管理表

> **管理方針の正本**：V1.3の不具合・改善・未確認リスクの優先度と対応順序を、この文書で管理する。各課題の詳細仕様・進捗・担当作業はリンク先のGitHub Issueを正本とする。

- 対象リポジトリ：[`rinsan1120/timeline-route-animator`](https://github.com/rinsan1120/timeline-route-animator)
- 管理表作成日：2026-10-16（日本時間）
- 参照状態：**2026-10-18（JST）時点でOpen 17件・Closed 10件（いずれもcompleted）、合計27件**。GitHub Issuesの最新状態と照合済み。V1.3は2026-10-17に`main`へ統合・Pages公開済み。以後の通常開発・仕様書管理は`main`を基準とする。
- 決定者：プロダクトオーナー。優先順位は対話で合意したもので、必要に応じて変更する。
- **過去のP0最優先5件（#13・#14・#1・#3・#17）**：2026-10-18に全件Closed（completed）。当時の優先順位と対応方針は下記履歴に保存する。現時点でOpenのP0は0件。

## 優先度の考え方

| 優先度 | 意味 | 判断基準 |
| --- | --- | --- |
| **P0：最優先** | V1.3を実際に編集・検証できる状態を整える | 操作不能・データ消失の防止、検証効率に直接効く表示領域の確保 |
| **P1：高** | 制作・検証体験の構造改善 | 主要な操作導線、画面情報設計、スマホ操作性、開発文書の整合 |
| **P2：中** | 局所的な問題と重要な懸念の整理 | 原因の絞られた不具合、編集・保存の未確認リスク、既存設定の改善 |
| **P3：低／後続** | 影響範囲が限定的・未計測・将来向け | 表示文言、性能・互換性の未確認リスク、追加機能候補 |

優先度は**ユーザー影響、発生確度、検証効率、データ保護、修正範囲・デグレリスク、関連Issueの依存関係**から決める。未確認リスクを、実機再現済みの不具合として扱わない。

## 未完了Issue優先順位（2026-10-18・UI/UX優先方針へ更新、Open 17件）

**プロダクトオーナー判断（2026-10-18）**：ユーザーが直接操作するUI/UXの改善を優先する。#12は最新mainの#12-A（`d31a23f26`：映像からSTEP 2でラベル編集）と#12-B（`2296f3089`：映像だけの1〜3倍ズーム・パン・リセット）まで実装反映済み。初見の使いやすさを含む元Issue全体の解決判定とCloseは未実施。**次の着手候補は#16（ボトムシート）、次いで#9（通常倍率のバルーンタッチ領域）**。#18（サイズ設定）、#8（イベントジャンプ）、#11／#27（案内文）もUI側の後続優先候補とする。優先度P1〜P3の定義自体は変更しない。

下表はオーナー方針を踏まえた対応順の目安で、Open一覧に「main反映済み・Close未判断」のIssueも含める。順位と実装済み／未実装／実機未確認は区別する。

| 順位 | 優先度 | Issue | 対応内容 | 根拠・状況 | 方針・判断理由 | 関連 |
| ---: | :---: | :--- | --- | --- | --- | --- |
| 01 | **P1** | [#12](https://github.com/rinsan1120/timeline-route-animator/issues/12) | スマホ映像画面の操作導線改善（#12-A/B main反映） | main実装反映／Issue Open | バルーンSTEP 2直接編集と1〜3倍の表示用ズーム・パンを追加。元Issue全体の完了判断は未実施 | #3・#15・#17 |
| 02 | **P1** | [#16](https://github.com/rinsan1120/timeline-route-animator/issues/16) | ボトムシートの指追従と自然な開閉 | 実機UX報告／Open | スワイプ操作のぎこちなさを改善 | #12・#14・#15 |
| 03 | **P1** | [#9](https://github.com/rinsan1120/timeline-route-animator/issues/9) | スマホでのバルーン編集タッチ領域拡張 | 静的レビュー／Open | 映像を縮小表示しても選択・ドラッグしやすいようにする | #12・#23 |
| 04 | **P2** | [#18](https://github.com/rinsan1120/timeline-route-animator/issues/18) | バルーンサイズ・文字サイズ設定の統合 | 機能改善／Open | 設定操作を簡素化。既存JSONの後方互換に注意 | #12 |
| 05 | **P2** | [#8](https://github.com/rinsan1120/timeline-route-animator/issues/8) | イベントジャンプの初回可視フレーム判定 | 未再現リスク／Open | 追従時のイベント移動位置の正確さを改善 | #26 |
| 06 | **P3** | [#11](https://github.com/rinsan1120/timeline-route-animator/issues/11) | プレビュー読込失敗時の案内文 | コード上の問題／Open | MP4生成向け文言をプレビュー向けに整理 | #27 |
| 07 | **P3** | [#27](https://github.com/rinsan1120/timeline-route-animator/issues/27) | MP4非対応環境への案内文 | コード上の問題／Open | Android Chrome限定の案内を環境非依存に修正 | #11 |
| 08 | **P1** | [#6](https://github.com/rinsan1120/timeline-route-animator/issues/6) | AGENTS.md・READMEの旧V1記述の整理 | 保守／Open | 実装済み機能を旧V1制約として誤認しないようにする | — |
| 09 | **P2** | [#19](https://github.com/rinsan1120/timeline-route-animator/issues/19) | 映像の空白タップで再生が停止する | 対策main反映／Issue Open | 空白タップの停止回避をコミット 2f6b5d3 で反映。Close判断は別途 | #9 |
| 10 | **P2** | [#25](https://github.com/rinsan1120/timeline-route-animator/issues/25) | バルーン編集中の画面・編集モード切替の競合 | 対策main反映／Issue Open | 画面・編集モード切替ガードをコミット f65f256 で反映。Close判断は別途 | #1・#20・#24 |
| 11 | **P2** | [#21](https://github.com/rinsan1120/timeline-route-animator/issues/21) | 地図・映像往復時のバルーン位置の整合性 | 未確認リスク／Open | 位置保持機構は存在。問題がある場合のみ修正 | #20・#24 |
| 12 | **P2** | [#20](https://github.com/rinsan1120/timeline-route-animator/issues/20) | ドラッグ中断時の確定・キャンセルとUndo整合性 | 未確認リスク／Open | 既存キャンセル処理を踏まえ境界条件を確認 | #21・#24・#25 |
| 13 | **P2** | [#22](https://github.com/rinsan1120/timeline-route-animator/issues/22) | MP4生成中止後のプレビュー状態復帰 | 未確認リスク／Open | 既存の復帰処理を精査し、実害があれば修正 | — |
| 14 | **P3** | [#23](https://github.com/rinsan1120/timeline-route-animator/issues/23) | モバイルのシークバーPointer Capture競合 | 未確認リスク／Open | 標準range操作との競合が未再現 | #9 |
| 15 | **P3** | [#10](https://github.com/rinsan1120/timeline-route-animator/issues/10) | 再生中のReact再描画負荷 | 未計測リスク／Open | 実測根拠のない大規模最適化を避ける | — |
| 16 | **P3** | [#26](https://github.com/rinsan1120/timeline-route-animator/issues/26) | イベント投影のMapLibre内部API依存 | 将来互換性リスク／Open | 現行障害なし。更新時の互換性を管理 | #8 |
| 17 | **P3** | [#7](https://github.com/rinsan1120/timeline-route-animator/issues/7) | 動画演出プリセットの追加 | 新機能候補／Open | 既存の主要編集体験が安定してから検討 | — |

**注意**：#12-A/Bはmainコード反映済みだが、Android・iPhone・PCでの独立した操作確認や元Issue全体の受入判断は行っていない。#19・#25も対策コミットのmain反映を確認したのみで、IssueはOpenのまま。#18は既存の設定変更があっても一元化というIssue要件との差分が残る。#20・#21・#22・#23・#26などの未確認リスクを実機再現済みの不具合として扱わない。IssueのCloseや優先度の最終決定はオーナーが行う。最新状態は[GitHub Issues](https://github.com/rinsan1120/timeline-route-animator/issues)を参照する。

## 完了Issue（2026-10-18にClosed / completed・10件）

2026-10-18のプロダクトオーナー承認に基づき、実装・main反映状況を確認して10件を`completed`でCloseした。各Issueのコメントに実装根拠と独立して残る課題を記録済み。**Closeは修正後の実機動作保証を意味しない。** 追加不具合が判明した場合は、原則として別Issueで扱う。

| Issue | 対応内容 | main反映の根拠 | Close時の扱い |
| --- | --- | --- | --- |
| [#1](https://github.com/rinsan1120/timeline-route-animator/issues/1) | モード切替・読込時の未保存編集保護 | `[8a87cf36f](https://github.com/rinsan1120/timeline-route-animator/commit/8a87cf36f)` | 確認処理・キャンセル経路を実装 |
| [#2](https://github.com/rinsan1120/timeline-route-animator/issues/2) | スマホ設定ボトムシート導入 | [V1.3 main統合](https://github.com/rinsan1120/timeline-route-animator/commit/b91055b487b389af21c9ec1813ecedf3758bd15d) | 閉／半開／全開を実装。滑らかな指追従は#16で継続 |
| [#3](https://github.com/rinsan1120/timeline-route-animator/issues/3) | スマホヘッダー省スペース化 | `[4c129cd11](https://github.com/rinsan1120/timeline-route-animator/commit/4c129cd11)` | 編集時のコンパクト表示・モードメニューを実装 |
| [#4](https://github.com/rinsan1120/timeline-route-animator/issues/4) | 動画制作設定のJSON保存・復元 | [V1.3 main統合](https://github.com/rinsan1120/timeline-route-animator/commit/b91055b487b389af21c9ec1813ecedf3758bd15d) | 作業・計画JSONにvideoSettingsを保存・復元 |
| [#5](https://github.com/rinsan1120/timeline-route-animator/issues/5) | 映像プレビューの再生・一時停止・シーク | [V1.3 main統合](https://github.com/rinsan1120/timeline-route-animator/commit/b91055b487b389af21c9ec1813ecedf3758bd15d) | 映像画面に再生・シーク操作を実装 |
| [#13](https://github.com/rinsan1120/timeline-route-animator/issues/13) | 映像画面への地図側DAY混入対策 | `[3d8401b11](https://github.com/rinsan1120/timeline-route-animator/commit/3d8401b11)` | 地図側オーバーレイの隠蔽対策を反映。修正後の実機解消は未確認 |
| [#14](https://github.com/rinsan1120/timeline-route-animator/issues/14) | Androidキーボード入力欄隠れ対策 | `[4ab7c7505](https://github.com/rinsan1120/timeline-route-animator/commit/4ab7c7505)` | VisualViewport／シート・スクロール追従を反映。修正後の実機解消は未確認 |
| [#15](https://github.com/rinsan1120/timeline-route-animator/issues/15) | STEP 1～3の独立表示・スクロール | `[644ff6348](https://github.com/rinsan1120/timeline-route-animator/commit/644ff6348)` | 直接切替・前後移動・個別スクロール位置の保持を実装 |
| [#17](https://github.com/rinsan1120/timeline-route-animator/issues/17) | スマホでの場所検索ボックス非表示 | `[eb14d9f7e](https://github.com/rinsan1120/timeline-route-animator/commit/eb14d9f7e)` | モバイル幅の検索UI非表示を実装 |
| [#24](https://github.com/rinsan1120/timeline-route-animator/issues/24) | 映像編集中のJSON保存・読込の競合対策 | `[8a87cf36f](https://github.com/rinsan1120/timeline-route-animator/commit/8a87cf36f)` | #1のcanReplaceSessionガードで対象操作を保護。#25の画面切替問題は継続 |

## 過去のP0：最優先5件の対応方針（決定・実装履歴）

この5件は**2026-10-18にすべてClosed / completed**。以下は当時の重要度順位・要求範囲を保存する履歴であり、未完了タスク一覧ではない。

| 順位 | Issue | AS-IS／問題 | TO-BE／対応範囲 | 保護する仕様 |
| ---: | --- | --- | --- | --- |
| 1 | [#13](https://github.com/rinsan1120/timeline-route-animator/issues/13) | 映像画面に編集地図側の巨大DAYマーカーが重なって表示される（Android実機報告）。 | 映像表示中は地図側オーバーレイを確実に遮断し、動画フレーム内の正規DAY表示だけ残す。 | 地図側DAY編集、地図／映像切替、MP4／PNG描画。 |
| 2 | [#14](https://github.com/rinsan1120/timeline-route-animator/issues/14) | Androidのソフトウェアキーボードが地点ラベル入力欄を覆う（実機報告）。 | 入力欄がキーボード表示中にも見えるよう、可視領域・シート高・フォーカスとスクロールを調整。 | 入力値、シートの操作、iPhone／PCレイアウト、Undo／Redo。 |
| 3 | [#1](https://github.com/rinsan1120/timeline-route-animator/issues/1) | 編集内容を未保存のままモード切替・別JSON読込すると、作業が意図せず破棄され得る。 | 実際に破棄される未保存変更がある場合だけ確認し、キャンセルなら状態を変えない。 | 既存の保存JSON・制作モード・ポイント編集・Undo／Redo・プライバシー。 |
| 4 | [#3](https://github.com/rinsan1120/timeline-route-animator/issues/3) | スマホの大きいヘッダーが地図／映像領域を圧迫（Android実機報告）。 | 編集中は現在モード名と切替導線を中心にコンパクト表示し、初期／モード選択時の情報は保つ。 | 3モード切替、重要な案内、PCヘッダー、地図／映像の操作。 |
| 5 | [#17](https://github.com/rinsan1120/timeline-route-animator/issues/17) | スマホの地図場所検索欄が作業領域を占有（実機UX報告）。 | モバイル幅では検索ボックスの常設表示をやめる。PCでは従来どおり維持。 | 検索ロジック、PCの検索操作、地点・保存データ。 |

**P0内の番号は重要度の順位**であり、実装着手順とは分けて管理する。2026-10-16の設計判断で、スマホ検証の作業領域を先に確保するため **#3を#14より先に着手**することとした。#14の入力不能問題の重要度は維持し、#3で修正済みと扱わない。詳細は[スマホヘッダー・キーボード連携設計](MOBILE_HEADER_KEYBOARD_DESIGN.md)。

## V1.3開発ブランチ時代の実装記録（履歴／2026-10-16）

重要度の順位と**実際の実装順**は分けて管理する。以下は当時 `feature/video-editor-v13` 上で確認したコミットの履歴であり、2026-10-17のPR #28によって **`main` へ統合済み**。この表は当時の実装・統合記録であり、それだけで実機解消を保証するものではない。2026-10-18に関連Issueは別途completedでCloseした。

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

## 関連Issueの取り扱い（Open／Closedを区別）

- **完了 #3・#17 → 継続 #12**：ヘッダー・検索欄の局所改善はmainに反映済み。スマホ映像UI全体の再設計では同じ変更を二重実装しない。
- **完了 #14 → 継続 #16**：キーボード時の可視領域・入力欄追従は対応済み。ボトムシートを指へ連続追従させる開閉アニメーションは別問題。
- **完了 #1・#24 → 継続 #20・#25**：未保存編集保護・JSON操作の編集中ガードを実装。ドラッグ中断・Undoと画面／編集モード切替の境界リスクは独立して残す。
- **完了 #15 → 継続 #12**：STEP別の表示・スクロール独立化を前提に、映像画面全体の導線を整理する。
- **継続 #8・#26**：イベント初回可視フレーム探索とMapLibre内部API依存は別課題。投影精度とプレビュー／MP4の整合を維持する。
- **完了 #2・#4・#5**：導入・保存・再生操作の基本機能は実装済み。ボトムシート操作感（#16）、イベント精度（#8）、画面全体UX（#12）を基本機能と混同しない。
- **継続 #9・#23**：スマホの編集ヒット領域とシーク操作のPointer Captureは別観点。実機未再現リスクを確定不具合とみなさない。

## 運用ルール

1. **Open Issueの順位・判断理由および完了履歴**はこのファイル、**個別の課題・実装詳細・進捗・現在のOpen/Closed状態**はGitHub Issuesに記録する。同一仕様の二重管理を避ける。
2. 優先順位が変わったら、ユーザーの決定に合わせてこの表を更新する。Issue番号やリンクは変えない。
3. 確認済み事実、ユーザーの実機報告、コード上の懸念、未確認事項を明確に分ける。未確認リスクに問題がない場合は根拠を残してCloseを検討する。
4. V1.3統合後は `main` の最新コードを実装・検討の正本とする。別の開発ブランチを明示的に使う場合は、その対象ブランチを確認する。既存コードと矛盾する古い文書だけを根拠に判断しない。
5. Codexへの個別実装指示は各Issueの着手時に作成する。**変更最小限、依頼外の網羅的テスト・実機確認を定型依頼しない、git commitまで／git push禁止**を維持する。Pushはユーザーが行う。
6. この管理表の更新先は **`main`** とする。GitHubに直接コミットした変更をローカルで使用する際はFetch／Pullし、Codexと同じファイルの並行編集を避ける。GitHub Pagesのデプロイ対象ブランチと公開への影響も更新前に確認する。

## メンテナンス記録

- 2026-10-18：プロダクトオーナーの指示で #1・#2・#3・#4・#5・#13・#14・#15・#17・#24 を`Closed / completed`へ変更。GitHubで**Open 17件・Closed 10件**を再照合。管理表を未完了17件の現行優先順位と完了10件の履歴に分割し、既存の相対順位は据え置き。旧P0最優先5件の決定内容とV1.3開発ブランチ実装記録は履歴として維持。#13・#14の実機解消は本棚卸しでは未検証。


- 2026-10-17：GitHub Issues #1〜#27がすべてOpenであることを確認。V1.3のPR #28によるmain統合とPages成功を踏まえ、過去のfeature基準・未統合表現を履歴として明確化。順位は変更せず、IssueのClose・再分類は行っていない。

- 2026-10-17：V1.3を `main` に統合し、以後の通常開発・文書管理・Pages自動デプロイの基準を `main` に統一。

- 2026-10-16：`main` にのみ存在した管理表・設計書を V1.3開発ブランチへコピー。#13・#3・#14・#1・#17・#15 の開発ブランチ上のコミットを反映し、未確認／Open／未統合を区別した。公開版の巻き戻り防止のため、開発中は`main`へ直接文書コミットしない。
- 2026-10-16：#13はユーザーがローカルコミット完了と報告（Push前）。#3と#14の設計を整合させ、#3先行・#14後続の**着手順序**を追加。重要度の順位は据え置き。関連設計メモを新規作成。
- 2026-10-16：オープンIssue 27件を採録。プロダクトオーナー決定により #13・#14・#1・#3・#17 をP0最優先に昇格。#3・#17は後続の実機検証効率に直接影響することを明記。その他は直前のレビュー順位を維持。
