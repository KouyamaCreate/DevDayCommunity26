# 渋谷の参考境界

『国勢調査町丁・字等別境界データセット』（CODH作成）「令和2年国勢調査町丁・字等別境界データ」（e-Stat）を加工 doi:10.20676/00000450

- 出典：https://geoshape.ex.nii.ac.jp/ka/resource/13113.html
- 元データ：https://geoshape.ex.nii.ac.jp/ka/topojson/2020/13/r2ka13113.topojson
- ライセンス：CC BY 4.0 https://creativecommons.org/licenses/by/4.0/
- 元データ利用条件：https://www.e-stat.go.jp/terms-of-use
- 境界の注意事項：https://www.e-stat.go.jp/help/data-definition-information/download

元TopoJSONから80町丁目のポリゴンと地域コード・名称だけをGeoJSONへ変換しました。人口・世帯等の属性は使いません。座標の補間や架空の境界生成はしていません。取得日・元ファイルSHA-256はJSONのmetadataに記載しています。

2020年国勢調査の調査区を基にした参考境界であり、現在の住居表示や警視庁の認知件数の集計区域との完全一致は確認できていません。数字の丁目・ヶ/ケ・鶯/鴬・濤/涛を明示的に正規化し、名称が一致する集計だけを接続します。取得時点の警視庁データは79地域で、鉢山町に対応する報告行がありません。欠落を0件へ変換しません。

再生成：`node plugins/sokomade/scripts/update-shibuya-boundaries.mjs`（開発依存のtopojson-clientを使用）。
