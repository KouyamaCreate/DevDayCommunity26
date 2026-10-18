"""Fetch public, aggregate annual statistics and census town boundaries. No incident points."""
import csv, io, json, hashlib, pathlib, datetime, urllib.request

root = pathlib.Path('data/open-data')
root.mkdir(parents=True, exist_ok=True)
sources = []
def download(url, filename, title, license, attribution):
    with urllib.request.urlopen(url, timeout=45) as response:
        data = response.read()
    (root / filename).write_bytes(data)
    sources.append(dict(url=url, file=filename, title=title, license=license, attribution=attribution,
                        sha256=hashlib.sha256(data).hexdigest(), sizeBytes=len(data)))
    return data

csv_data = download('https://www.keishicho.metro.tokyo.lg.jp/about_mpd/jokyo_tokei/jokyo/ninchikensu.files/R7.csv',
    'crime-2025.csv', '令和7年 区市町村の町丁別、罪種別及び手口別認知件数（年計）',
    'CC BY（東京都オープンデータカタログ）', '警視庁「区市町村の町丁別、罪種別及び手口別認知件数」令和7年を加工')
records = list(csv.DictReader(io.StringIO(csv_data.decode('cp932'))))
for row in records:
    for key in row:
        if key != '市区町丁':
            value = row[key].replace(',', '')
            row[key] = int(value) if value.isdigit() else None
(root / 'crime-2025.json').write_text(json.dumps(records, ensure_ascii=False), encoding='utf-8')
for code in ['13113', '13103', '13110']:
    download(f'https://geoshape.ex.nii.ac.jp/ka/topojson/2020/13/r2ka{code}.topojson', f'towns-{code}.topojson',
        '国勢調査町丁・字等別境界データセット（2020）', 'CC BY 4.0 / e-Stat利用規約',
        '『国勢調査町丁・字等別境界データセット』（CODH作成）「令和2年国勢調査町丁・字等別境界データ」（e-Stat）を加工 doi:10.20676/00000450')
manifest = dict(fetchedAt=datetime.datetime.now(datetime.timezone.utc).isoformat(), periodStart='2025-01-01', periodEnd='2025-12-31',
    crimePage='https://www.keishicho.metro.tokyo.lg.jp/about_mpd/jokyo_tokei/jokyo/ninchikensu.html',
    crimeCatalog='https://catalog.data.metro.tokyo.lg.jp/dataset/t000022d0000100001',
    boundaryPage='https://geoshape.ex.nii.ac.jp/ka/', boundaryTerms='https://www.e-stat.go.jp/terms-of-use',
    boundaryYear=2020, sources=sources)
(root / 'sources.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps(dict(rows=len(records), sources=len(sources)), ensure_ascii=False))
