"""Fetch real OpenPOI facilities for a 1 km circle; subdivide saturated API cells."""
import json,math,time,urllib.parse,subprocess,concurrent.futures
from pathlib import Path
from datetime import datetime,timezone
ROOT=Path(__file__).resolve().parent.parent
LAT,LNG=35.658034,139.701636
calls=[]
def fetch_json(url):
 for attempt in range(3):
  try:
   p=subprocess.run(['curl','-fLsS','--max-time','90',url],capture_output=True,check=True)
   return json.loads(p.stdout)
  except Exception:
   if attempt==2:raise
   time.sleep(2+attempt)
def distance(p):
 r=math.pi/180;a=(p['lat']-LAT)*r;b=(p['lng']-LNG)*r
 return 12742000*math.asin(min(1,math.sqrt(math.sin(a/2)**2+math.cos(LAT*r)*math.cos(p['lat']*r)*math.sin(b/2)**2)))
def cell(box,depth=0):
 rows=fetch_json('https://api.openpoiapi.com/v1/search?'+urllib.parse.urlencode({'bbox':','.join(map(str,box)),'limit':200}))['results']
 terminal=len(rows)<200 or depth>=4
 calls.append({'bbox':box,'count':len(rows),'terminal':terminal,'saturated':len(rows)>=200})
 if not terminal:
  a,b,c,d=box;x=(a+c)/2;y=(b+d)/2
  return sum([cell(z,depth+1) for z in [(a,b,x,y),(x,b,c,y),(a,y,x,d),(x,y,c,d)]],[])
 return rows
a,b,c,d=LNG-.0111,LAT-.0091,LNG+.0111,LAT+.0091
boxes=[(a+(c-a)*i/4,b+(d-b)*j/4,a+(c-a)*(i+1)/4,b+(d-b)*(j+1)/4) for i in range(4) for j in range(4)]
with concurrent.futures.ThreadPoolExecutor(max_workers=3) as ex:rows=sum(ex.map(cell,boxes),[])
unique={}
for p in rows:
 if not all(isinstance(p.get(k),(int,float)) for k in ['lat','lng']) or distance(p)>1000:continue
 key=(p['name'].strip().lower(),round(p['lat'],6),round(p['lng'],6))
 if key in unique:
  for f in ['licenses','attributions']:unique[key][f]=sorted(set(unique[key].get(f,[])+p.get(f,[])))
 else:unique[key]=p
s={'fetchedAt':datetime.now(timezone.utc).isoformat(),'center':{'lat':LAT,'lng':LNG},'radius':1000,'requestCount':len(calls),'truncatedCells':sum(x['terminal'] and x['saturated'] for x in calls),'results':list(unique.values()),'method':'bbox subdivision depth 4, limit 200; haversine <=1000m; exact name+coordinate deduplication'}
(ROOT/'data/pois.json').write_text(json.dumps(s,ensure_ascii=False,separators=(',',':')))
print(json.dumps({k:v for k,v in s.items() if k!='results'}),flush=True);print('POIs',len(unique),flush=True)
