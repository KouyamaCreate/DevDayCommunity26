// Rebuild the checked-in public reference boundaries; no application/user data.
import { feature } from 'topojson-client';
import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
const sourceURL='https://geoshape.ex.nii.ac.jp/ka/topojson/2020/13/r2ka13113.topojson';
const response=await fetch(sourceURL);
if(!response.ok)throw Error(`Boundary download failed: ${response.status}`);
const text=await response.text(),topology=JSON.parse(text);
const collection=feature(topology,topology.objects.town);
if(collection.features.length!==80)throw Error('Unexpected Shibuya boundary count; review source before updating');
const data={type:'FeatureCollection',metadata:{year:2020,sourceURL,sourceName:'国勢調査町丁・字等別境界データセット（CODH / e-Stat）',sourcePage:'https://geoshape.ex.nii.ac.jp/ka/resource/13113.html',license:'CC BY 4.0',licenseURL:'https://creativecommons.org/licenses/by/4.0/',credit:'『国勢調査町丁・字等別境界データセット』（CODH作成）「令和2年国勢調査町丁・字等別境界データ」（e-Stat）を加工 doi:10.20676/00000450',sha256:createHash('sha256').update(text).digest('hex'),fetchedAt:new Date().toISOString(),limitation:'2020年国勢調査の参考境界です。現在の住所境界や警視庁集計区域との完全一致は未確認です。'},features:collection.features.map(f=>({type:'Feature',properties:{code:f.properties.KEY_CODE,name:f.properties.CITY_NAME+f.properties.S_NAME},geometry:f.geometry}))};
await writeFile(new URL('../data/shibuya-2020.json',import.meta.url),JSON.stringify(data)+'\n');
console.log(`Saved ${data.features.length} Shibuya reference boundaries`);
