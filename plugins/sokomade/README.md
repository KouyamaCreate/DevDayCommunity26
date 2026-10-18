# 地図・相談バックエンド

起動・利用例は[ルートREADME](../../README.md)を参照してください。Web版はOpenAI APIとGoogle Maps Platformを使い、会話と地図が同じメモリ上のworkspaceを参照します。

## 状態と処理

- `mapView`：表示中心・範囲・ズーム・カメラ命令IDとrevision。ユーザー操作を250msでまとめ、相談送信前に反映します。古いカメラ命令への応答は破棄します。
- `focus`：表示範囲、地図でクリックした点、取得済み地点。徒歩の`originId`や比較カードの`selectedPlaceId`とは別です。
- `comparisonIds`と`searchResultIds`：比較候補と一時検索結果を分けます。物件・明示追加・選択・経路端点を保持し、検索結果はprovider IDで重複排除。最大20地点です。
- `routePairs`：任意のfrom/toと比較カードID。最大5組、各組の往復を別々に取得し、向きごとに条件内の経路を最大2本返します。取得元が返す候補の最短であり、すべての道の探索はしません。
- `conditions`：遠回り上限、徒歩往復上限、報告種別、半径。`walkEvaluations`は選択中の往復の秒数から計算し、within/exceeds/unknownを返します。滞在時間は含みません。
- `reportLayer`：候補や経路がなくても初期表示・地図操作で取得します。カメラ・検索・経路・集計は世代を照合し、古い結果が新しい操作を上書きしないようにします。相談中の手動の注目変更は進行中AIを中止します。

HTTPの`/api/action`はopen/viewport/focus/move/resolve/search/select/conditions/plan/compare/analyze/layer/remove/clearを提供します。Zodで入力を検証します。AIには取得済みIDと地域名・検索語を渡すツールを公開し、workspace ID・座標は生成させません。地図由来の座標はブラウザから受け取ります。AI文脈には報告位置や経路形状の大量データを含めません。

`src/`にデータ接続・集計・状態・HTTP・AI・MCP、`ui/`に既存の地図と比較パネル、`tests/`に単体・競合・HTTP・STDIOの検証があります。UIは3枚の目標画像を基に、全面地図と左下の相談窓へ再構成しています。視覚QAの状態はルートの`design-qa.md`を参照してください。

## 公開報告

| 接続先 | 期間・精度 | 集計と限界 |
| --- | --- | --- |
| [SFPD公開報告](https://data.sfgov.org/Public-Safety/Police-Department-Incident-Reports-2018-to-Present/wg3w-h783) | SF現地日付の直近90完了日。匿名化された交差点 | 同じ報告番号は分類が複数でも1件。補足報告、位置欠損・対象範囲外・位置矛盾は除外。表示範囲内の公開位置、候補周囲の半径、経路両側100mを集計。実際の発生地点そのものではありません。 |
| [警視庁 町丁別認知件数](https://www.keishicho.metro.tokyo.lg.jp/about_mpd/jokyo_tokei/jokyo/ninchikensu.html) | ページで確認できた最新の年初累計CSV。町丁目単位 | 渋谷区の地域集計。住所で町丁目を特定できない場合はcount=null。事件点・沿道件数・町丁目ポリゴンを創作しません。2020年国勢調査の参考境界との対応を優先し、対応できない場合は住所情報を確認します。 |

対象種別は暴行・傷害、強盗、窃盗です。期間・種別・範囲・精度・出典・更新/取得日時を返します。市区境界と完全な網羅性は未検証で、接続判断の矩形は行政境界ではありません。地域・期間が混在する比較や情報範囲外を通る経路では共通件数を返しません。nullは0件ではありません。夜間推定や安全度への変換は行いません。

データ形式の変更・取得上限・空の応答は比較を停止します。一時的な障害で以前の公開キャッシュを使う場合はstaleを表示します。地域全体の公開データを12時間キャッシュし、相談の住所や個別検索範囲は書き込みません。

## 設定と外部サービス

Google Cloudで請求先を設定し、Maps JavaScript API、Places API (New)、Routes API、Geocoding APIを有効にします。キーは用途別に分離し、ブラウザ用はMaps JavaScriptとローカル参照元に、サーバー用はPlaces・Routes・Geocodingに制限してください。画面の設定から登録すると、既定では`~/Library/Application Support/Sokomade/settings.json`に権限600で保存します。`SOKOMADE_CONFIG_DIR`で保存先を変更できます。

Google Cloud設定済みの専用プロジェクトからキーを取得・用途制限を更新する補助スクリプトは`node plugins/sokomade/scripts/configure-gcloud.mjs <project-id>`です。実行すると対象プロジェクトのキーを作成または更新します。プロジェクト作成・請求先変更・API有効化は行いません。

OpenAI APIキーはルート`.env.local`または環境変数から読み込みます。ユーザーのキー・請求先・専用プロジェクトはこのリポジトリに含めません。Mapsの地図・Geocoding・Places・RoutesとAIに従量料金が発生します。現在の利用料金・上限は各提供者のコンソールで確認してください。アプリ内の予算通知・自動停止は未実装です。

公開物件URLはsuumo.jp、homes.co.jp、athome.co.jp、zillow.com、redfin.com、realtor.com、apartments.comのHTTPSに限定し、DNSの全応答・接続先・リダイレクトを検証します。JSON-LDで住宅の住所を確実に特定できない場合は住所入力を求めます。各サイトの自動読取を保証せず、企業や仲介会社の住所は採用しません。

Google Mapsへの案内は実際の向きの両端点を渡した再検索です。選択済みの道の形状は引き継がれません。鉄道の時刻表・終電・配車・予約・決済は扱いません。

## ローカル実行の境界

相談・履歴・条件はメモリだけに保持し、60分無操作・破棄・終了で削除します。受動的な状態ポーリングは期限を延長しません。127.0.0.1で待ち受け、プロセスごとのBearerトークン、Host/Origin検証、入力サイズ制限を使用します。公開サービス用のユーザー認証・マルチユーザー分離・配備は含みません。

MCPは既存9ツールに5ツール（discover_places / assess_locations / update_map_conditions / move_map / compare_walks）を追加し、同じ地図UIを保持しています。新しい汎用地図操作・任意端点比較の会話はWeb版が主対象です。プラグイン配布物を作る場合は`npm run package --prefix plugins/sokomade`で`build/sokomade-plugin/`へ生成します。生成物・ローカルインストール状態はPRに含めません。

検証コマンドと結果は[VALIDATION.md](./VALIDATION.md)を参照してください。

## 3場面のUI

閲覧・帰路比較・物件通勤比較を同じ相談窓で表示します。候補と操作はAIの文章ではなく最新のworkspaceから投影し、履歴の古いIDを操作しません。候補選択、経路、行き帰り、全物件の経路表示、地点の周辺分析、表示条件、分布の表示切替、履歴と相談窓の縮小に対応します。入力はEnterで送信、Shift+Enterで改行し、日本語IME変換中は送信しません。

SFの分布は、匿名化された公開位置の重みを半径250m（500mへ切替可能）のquartic kernelで平滑化します。色は参考密度（件/km²）、固定上限1500・平方根の色写像で、viewportごとの再正規化はしません。周辺500mのhaloを取得し、表示範囲内の件数にはhalo分を足しません。色の濃さは薄く/標準/濃くで調整できます。Google地図で対応し、未接続時は分布を描きません。

地図の地点を選ぶとサーバーの実集計を取得し、半径250/500/1000mを選べます。参考分布の平滑化半径や透明度を変えても、この実件数は変わりません。古い点・種別・比較対象の結果を選択地点の件数として表示しません。

渋谷は町丁目全体の認知件数を実際の参考ポリゴンで色分けし、300件以上は同じ色です。面積・人口で補正した値ではありません。2020年の参考境界と現在の住所/集計区域との完全一致は未確認です。出典とCC BY 4.0クレジットを表示条件に明記しています。未対応の名称や報告のない町丁目は着色しません。境界内に事件の点や滑らかな分布を作りません。

境界データは`data/shibuya-2020.json`。出典・取得日・元ファイルのSHA-256を含み、`node scripts/update-shibuya-boundaries.mjs`で再生成できます。クレジットと制約は同ディレクトリのREADMEを参照してください。

## 共通の根拠付き比較

`discover`は店舗検索から候補全件の`assess`までを実行し、`workspace.assessment`に結果を保持します。`assess`の対象は取得済み`placeIds`（店舗・物件・住所）、`routeIds`（向きを持つ徒歩経路）。結果は画面へ送る状態とエージェントが読む文脈の両方に含まれます。

- 各対象：期間・種別・範囲・精度・出典・更新/取得日時・状態・比較可否。未取得はnull、古い/範囲が欠ける情報は明示します。
- SF：同じ条件の公開報告と直線距離を比較。balancedは最寄り候補からの直線距離の追加がmaxExtraDistanceMeters（既定300m）以内の候補の中で公開報告が少ない候補（同数なら近さ）、fewer-reportsは公開報告件数が少ない候補（同数なら近さ）、nearbyは近さを優先します。危険度を推定する処理ではありません。
- 渋谷：同じ町丁目の候補は同じ集計値。町丁目間の面積・人口の違いを補正できないので件数で安全順位を付けず、取得できた地域情報を添えて近さから提案します。
- 情報不足・古いデータ・一部範囲外・営業時間外の候補は提案の選択対象から外し、取得結果には残します。営業時間不明は明示して残します。
- 経路は同じ根拠形式で返します。経路だけのassessは自動選択をせず、時間・向き・沿道情報をエージェントへ渡します。

UIは既存のままです。会話またはMCPから使い、参考候補は既存の選択・マーカーへ反映します。WebのHTTP操作は`POST /api/action`の`discover` / `assess`、MCPでは`discover_places` / `assess_locations`です。詳しい入力と状態は[仕様](../../docs/spec.md)を参照してください。

```sh
# 通常テストは外部APIを使いません
npm run check --prefix plugins/sokomade
# 以下は明示的な実API検証。従量料金が発生します
npm run test:cafes:agent --prefix plugins/sokomade # OpenAI実接続、店舗・報告は検証用サンプル
npm run test:cafes:live --prefix plugins/sokomade  # Google・OpenAI・公開報告を実接続
npm run test:consultations:live --prefix plugins/sokomade # SF・渋谷のカフェ/経路/物件、計6相談を実接続
```

`test:consultations:live`は自然言語の依頼から実エージェントを動かし、候補・向き付き徒歩経路・物件住所に対する共通評価と、回答中の件数・期間・出典を確認します。公開報告はディスクキャッシュを使わず取得し、物件ケースは公開施設の住所を仮の検討住所として使います。取得時点の全ケース成功を保証するものではありません。`-- --case=route-sf`のように1ケースだけ再実行できます。
