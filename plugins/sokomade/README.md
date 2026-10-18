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

`src/`にデータ接続・集計・状態・HTTP・AI・MCP、`ui/`に既存の地図と比較パネル、`tests/`に単体・競合・HTTP・STDIOの検証があります。今回の機能修正では既存のCSS・画面構成を変更していません。

## 公開報告

| 接続先 | 期間・精度 | 集計と限界 |
| --- | --- | --- |
| [SFPD公開報告](https://data.sfgov.org/Public-Safety/Police-Department-Incident-Reports-2018-to-Present/wg3w-h783) | SF現地日付の直近90完了日。匿名化された交差点 | 同じ報告番号は分類が複数でも1件。補足報告、位置欠損・対象範囲外・位置矛盾は除外。表示範囲内の公開位置、候補周囲の半径、経路両側100mを集計。実際の発生地点そのものではありません。 |
| [警視庁 町丁別認知件数](https://www.keishicho.metro.tokyo.lg.jp/about_mpd/jokyo_tokei/jokyo/ninchikensu.html) | ページで確認できた最新の年初累計CSV。町丁目単位 | 渋谷区の地域集計。住所で町丁目を特定できない場合はcount=null。事件点・沿道件数・町丁目ポリゴンを創作しません。地図上の点を調べるときだけ逆ジオコーディングで住所を確認します。 |

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

既存MCPは9ツールと同じ地図UIを保持しています。新しい汎用地図操作・任意端点比較の会話はWeb版が主対象です。プラグイン配布物を作る場合は`npm run package --prefix plugins/sokomade`で`build/sokomade-plugin/`へ生成します。生成物・ローカルインストール状態はPRに含めません。

検証コマンドと結果は[VALIDATION.md](./VALIDATION.md)を参照してください。
