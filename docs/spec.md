# 根拠付きの場所・経路比較

## 対象と操作

2026-10-18。PR #2のローカルWeb/MCP基盤へ比較処理を追加。UIの変更は今回の対象外。既存の会話・地図・選択を利用する。

- 治安情報も使う店探し：エージェントが `discover` を実行。検索→検索候補全件の `assess` →提案理由の作成→既存地図へ選択・カメラ命令を反映。
- 既存の店舗・住所・物件：`assess` に取得済み `placeIds` を渡す。
- 経路：`assess` に取得済み `routeIds` を渡す。向きと所要時間を保持し、根拠を同じ形式で返す。経路だけの場合に店の提案や自動選択を行わない。
- 公開報告が取得不能でも、店舗結果は維持して状態を説明する。出発地・徒歩取得は店舗比較の前提にしない。

## HTTP / AIツール

`POST /api/action` の `{action,args}`。HTTPとAIは同じZod入力を使う。

### discover

- `workspaceId`: 相談ID（AIには渡させずサーバーが注入）
- `query`: 1〜300文字、既定「カフェ」
- `scope`: focus / viewport / origin、既定focus
- `radiusMeters`: 店舗検索半径100〜10000m、既定2000m
- `limit`: 1〜5、既定3
- `openNow`: 営業中フィルタ、既定false
- `priority`: balanced / fewer-reports / nearby、既定balanced
- `maxExtraDistanceMeters`: balancedで許容する最寄り候補からの直線距離の追加分。0〜2000m、既定300m

### assess

- `workspaceId`
- `placeIds`: この相談で取得済みの地点ID、最大20
- `routeIds`: この相談で取得済みの経路ID、最大20
- `priority` / `maxExtraDistanceMeters`: 同上
- placeIds省略かつrouteIds未指定なら、直近の検索候補、なければ選択地点が対象。両配列が空ならエラー。

`conditions` の `categories` / `radiusMeters` が公開報告の種別とSFの集計半径。店舗検索半径とは独立している。

## 結果

`workspace.assessment` はメモリだけに保持。

- `items[]`: targetId、kind（place/route）、name、role、placeId、検索中心からの直線距離または徒歩秒数、営業状態、価格帯、explanation、evidence。経路はfromId/toId/legも保持。
- `evidence`: count（不明はnull）、status、city、unit、scope/scopeLabel、categories/categoryLabels、period、sourceURL/sourceName、fetchedAt/updatedAt、precision、coverage、comparisonKey、canCompareCounts、limitations。
- `proposal`: comparable、priority、basis、recommendedPlaceId、shortlistIds、excludedIds、reason、limitations。
- conditions、center、検索条件・店舗取得日時、比較作成日時。

状態は available / unknown / unavailable / unsupported / stale / partial。欠損・形式不明・未対応を0件に変換しない。SFの円または経路両側の範囲が取得用矩形からはみ出す場合はpartialとして比較対象外。矩形内でも行政境界と完全な網羅性を保証しない。

## 提案方針

共通の根拠処理は `src/assessment.mjs`。データ取得やUIから独立した関数として、店舗・物件・経路を扱う。

SFで全候補の期間・種別・半径・出典が一致し、現在の情報を取得できる場合のみ、公開位置の件数を同条件で参考比較する。

- balanced：最も近い候補から直線距離がmaxExtraDistanceMeters（既定300m）余分以内の候補へ絞り、その中で公開報告件数が少ないものを提案。同数なら近さ。この距離条件を理由に明示し、徒歩時間には変換しない。
- fewer-reports：公開報告件数が少ない候補を優先。同数なら直線距離。
- nearby：直線距離で提案し、公開報告の根拠を添える。

この追加距離上限はcomparable=trueかつbalancedの場合のみ適用し、未適用時のproposal.maxExtraDistanceMetersはnull。渋谷の距離からの提案には追加距離の絞り込みを適用しない。

件数は被害確率や安全度ではない。人口・人通り・地域特性を補正した危険度を推定しない。

渋谷は町丁目全体の情報。同じ町丁目なら同じ値となる。異なる町丁目の面積・人口等を補正できないので件数で安全順位を付けず、取得できた地域情報を添えて距離から提案する。事件点・境界形状・沿道件数を生成しない。

unknown/unavailable/unsupported/stale/partialまたは営業時間外の候補は自動提案から除外するが、結果に残して理由を明示する。営業時間不明は明示して残す。同条件を満たさない候補が混ざった比較では件数による優先付けを停止する。参考候補は取得できた候補の中からの選択であり、未知の候補との優劣ではない。

## 状態・互換性

追加検索でも既存物件と経路を保持。選択済みprovider IDの店を再取得した場合は営業情報等を更新し、IDと地点の役割を維持する。

新しい検索・注目変更・条件変更・削除・経路再取得・相談破棄により古い非同期評価を反映しない。条件変更と対象変更では以前の評価をクリアする。地点数は既存の上限20。

`analyze`から種別・半径を変更した場合も`conditions`と同じ無効化と経路再集計を行う。実際の条件が変わらない再分析では完成済みの候補比較を保持する。`discover`は検索開始時の世代を評価開始前にも確認し、古い検索が新しい検索候補・提案条件・カメラを更新しないようにする。

地点と経路の評価は両端の地域の組で分ける。未対応地域への経路が混ざっていても、対応範囲の地点・地域内経路の根拠を失わせない。地域をまたぐ経路そのものは件数比較できない。

MCPは既存9ツールを保持し、discover_places、assess_locations、update_map_conditions、move_map、compare_walksの5ツールを追加。根拠は通常のstructuredContentと会話文脈へ渡す。大量の事件位置・経路形状は従来どおりモデル文脈から除外する。

会話・地点・評価は60分無操作、相談破棄、終了で消える。鍵の扱いと公開キャッシュの保持は既存仕様を維持する。
