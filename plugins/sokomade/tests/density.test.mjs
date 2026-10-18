import test from 'node:test';
import assert from 'node:assert/strict';
import { densityField,densityColor,pointInspection } from '../ui/report-density.mjs';
import { joinShibuyaAreas,shibuyaAreaAt,normalizeArea } from '../src/shibuya-boundaries.mjs';
import { Reports } from '../src/reports.mjs';
const options={width:1200,height:1200,pixelsPerMeter:1,radiusMeters:250,step:4};
const integral=f=>f.values.reduce((a,b)=>a+b,0)*16/1e6;
test('kernel conserves weighted reports and keeps support in metres when zoom or radius changes',()=>{
  for(const radiusMeters of [250,500]) {
    const f=densityField([{x:600,y:600,count:10}],{...options,radiusMeters});
    assert.ok(Math.abs(integral(f)-10)<.01);
    assert.equal(f.values[0],0);
    const zoomed=densityField([{x:300,y:300,count:10}],{...options,width:600,height:600,pixelsPerMeter:.5,radiusMeters});
    assert.ok(Math.abs(integral(zoomed)*4-10)<.02);
  }
});
test('density adds weights, ignores invalid values, and has no viewport maximum normalization',()=>{
  const a=densityField([{x:300,y:300,count:2}],options);
  const b=densityField([{x:300,y:300,count:1},{x:300,y:300,count:1},{x:1000,y:1000,count:1000},{x:0,y:0,count:-1}],options);
  assert.equal(a.values[75*a.columns+75],b.values[75*b.columns+75]);
  assert.deepEqual(densityColor(a.values[75*a.columns+75]),densityColor(b.values[75*b.columns+75]));
  assert.equal(densityColor(0)[3],0);
  assert.deepEqual(densityColor(1500),densityColor(999999));
});
test('only a report for the selected point, categories and actual point scope can supply counts',()=>{
 const p={lat:37.78,lng:-122.42},w={focus:{type:'point',point:p},conditions:{categories:['theft']},focusReport:{target:{type:'point',point:p},categories:['theft'],areaCounts:[{placeId:'focused-point',radiusMeters:500,count:0}]}};
 assert.match(pointInspection(w).label,/0件/);
 w.focusReport.target={type:'comparison'};assert.equal(pointInspection(w),null);
 w.focusReport.target={type:'point',point:{...p,lat:37.79}};assert.equal(pointInspection(w),null);
 w.focusReport.target={type:'point',point:p};w.conditions.categories=['robbery'];assert.equal(pointInspection(w),null);
});
test('real Shibuya geometry joins only normalized names, preserving counts and unmatched missingness',()=>{
 const a=joinShibuyaAreas([{area:'渋谷区渋谷2丁目',counts:{theft:77}},{area:'渋谷区架空町',counts:{theft:9}}]);
 assert.equal(a[0].geometry.type,'Polygon');assert.equal(a[0].counts.theft,77);assert.equal(a[1].geometry,null);
 assert.equal(normalizeArea('渋谷区渋谷二丁目'),'渋谷区渋谷2丁目');
 for(const [a,b] of [['渋谷区松濤1丁目','渋谷区松涛一丁目'],['渋谷区鶯谷町','渋谷区鴬谷町'],['渋谷区千駄ヶ谷1丁目','渋谷区千駄ケ谷一丁目']])assert.equal(normalizeArea(a),normalizeArea(b));
 assert.equal(shibuyaAreaAt({lat:35.661542,lng:139.703934}),'渋谷区渋谷1丁目');
 assert.equal(shibuyaAreaAt({lat:37.78,lng:-122.42}),null);
});
test('viewport halo includes nearby weights without adding them to visible counts',async()=>{
 const reports=new Reports();reports.sf=async()=>({incidents:[{id:'in',lat:37.78,lng:-122.42,categories:['theft']},{id:'halo',lat:37.7815,lng:-122.42,categories:['theft']},{id:'far',lat:37.8,lng:-122.42,categories:['theft']}],period:{label:'90 days'}});
 const layer=await reports.layer({south:37.779,north:37.781,west:-122.421,east:-122.419},{categories:['theft']});
 assert.equal(layer.incidents.reduce((n,p)=>n+p.count,0),2);assert.equal(layer.regions[0].visiblePublicReportCount,1);assert.equal(layer.smoothingHaloMeters,500);
});
