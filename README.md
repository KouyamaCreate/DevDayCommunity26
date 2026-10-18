# DevDayCommunity26

DevDayCommunity26 のプロジェクトリポジトリです。

## Cloud環境の依存関係チェック

`picocolors` をローカルの依存関係として読み込めることを確認します。

```sh
npm ci
npm run check:cloud
```

## CITY LIGHT（渋谷の2.5Dマップ）

[apps/city-light](apps/city-light/README.md) は、渋谷駅から半径1kmの建物を施設評価の明るさで探索するWebアプリです。施設記録のない建物は警視庁の町丁目別犯罪統計で補完し、地域参考値として区別して表示します。保存済みデータを含み、表示・テスト・ビルドにAPIキーは不要です。

Node.js 22.22以上で、リポジトリのルートから実行します。

```sh
npm --prefix apps/city-light ci
npm --prefix apps/city-light run dev
```

ブラウザで <http://127.0.0.1:4317> を開きます。出典、補完方法、再評価、静的配信用ビルドの手順はアプリのREADMEを参照してください。
