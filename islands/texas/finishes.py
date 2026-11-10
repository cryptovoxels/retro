from pathlib import Path
from PIL import Image,ImageOps,ImageDraw,ImageEnhance
import math,random,json,struct
p=Path('islands/texas/artpack.json');pack=json.loads(p.read_text())
base=Image.open('dist/textures/texas-ground.png').convert('RGB')
pages=[]
for page in range(4):
 color=Image.new('RGB',base.size); heights=Image.new('L',base.size)
 for i in range(64):
  x=i%8*128;y=i//8*128; tile=base.crop((x,y,x+128,y+128))
  # Leave edge connectivity in place. Interior texture variation follows the surface.
  r=random.Random(736+i+page*64)
  if page:
   shade=[(0,0,0),(235,183,129),(85,86,103),(215,120,77)][page]
   tile=Image.blend(tile,Image.new('RGB',tile.size,shade),[0,.14,.23,.19][page])
   draw=ImageDraw.Draw(tile)
   for n in range([0,38,25,47][page]):
    a=r.randint(18,107);b=r.randint(18,107);rgb=tile.getpixel((a,b))
    draw.line((a,b,a+r.randint(2,7),b+r.randint(-1,1)),fill=tuple(max(0,min(255,v+r.choice((-19,12)))) for v in rgb))
   if i>=48 and i%4==0:
    # Distinct pitted areas on each weathering page.
    r1=7+page*2; a=38+page*10;b=82-page*5;draw.ellipse((a-r1,b-r1//2,a+r1,b+r1//2),fill=(83,68,61))
  h=Image.new('L',(128,128),43); d=ImageDraw.Draw(h)
  if 16<=i<48:
   for bit,rect in [(1,(0,0,127,10)),(2,(117,0,127,127)),(4,(0,117,127,127)),(8,(0,0,10,127))]:
    if not i%16&bit:d.rectangle(rect,fill=255 if i<32 else 92)
  if i>=48 and i%4==0:
   d.ellipse((49,50,83,77),fill=0)
   if page:
    r1=7+page*2; a=38+page*10;b=82-page*5;d.ellipse((a-r1,b-r1//2,a+r1,b+r1//2),fill=0)
  if i<16 or i>=48 or page:
   for _ in range(15):
    a=r.randrange(16,110);b=r.randrange(16,110);d.rectangle((a,b,a+2,b+1),fill=r.choice([30,55,68]))
  if i>48:
   # Interior street corners. NW, NE, SE, SW correspond to missing diagonal neighbours.
   tile=base.crop((7*128,3*128,8*128,4*128)).copy()
   if page: tile=Image.blend(tile,Image.new('RGB',tile.size,[(0,0,0),(235,183,129),(85,86,103),(215,120,77)][page]),[0,.14,.23,.19][page])
   h=Image.new('L',(128,128),43);d=ImageDraw.Draw(h);c=ImageDraw.Draw(tile)
   for bit,(cx,cy) in enumerate([(0,0),(127,0),(127,127),(0,127)]):
    if (i-48)&(1<<bit):
     box=(cx-13,cy-13,cx+13,cy+13);d.ellipse(box,fill=255);c.ellipse(box,fill=(184+page*3,158+page*2,129))
  color.paste(tile,(x,y));heights.paste(h,(x,y))
 c='/textures/texas-ground'+('-'+str(page) if page else '')+'.png';h='/textures/texas-height-'+str(page)+'.png'
 color.quantize(240).save('dist'+c)
 heights.save('dist'+h,optimize=True);pages.append(dict(color=c,height=h))
pack['groundPages']=pages
def chunk(k,data,b=b''):return k+struct.pack('<II',len(data),len(b))+data+b
out=Path('dist/models/artpacks/texas');out.mkdir(parents=True,exist_ok=True)
frames={}
for kind in ['window','door','viga']:
 paths=[]
 for v,style in enumerate(['honey','turquoise','oxblood']):
  w,h,depth={'window':(14,19,4),'door':(24,28,5),'viga':(7,7,12)}[kind]
  vox=[]
  for x in range(w):
   for y in range(depth):
    for z in range(h):
     if kind=='viga':
      if (x-3)**2+(z-3)**2>12:continue
      col=1+int((x+z+v)%4==0) if y not in [0,depth-1] else 4-int((x-3)**2+(z-3)**2<4)
     else:
      head=z>=h-2-v%2;sides=x<2 or x>=w-2;sill=kind=='window' and z<2
      if not (head or sides or sill):continue
      if not head and not sill and y>=depth-1:continue
      col=3 if head else 1 if sides else 4
      if (x+z)%6==0 and y==0:col=2
     vox.append(bytes((x,y,z,col)))
  colors=[[(134,79,44),(89,53,42),(190,128,67),(220,174,102)],[(38,132,133),(57,71,62),(143,85,46),(231,182,119)],[(147,64,48),(87,53,50),(179,116,66),(220,172,107)]][v]
  rgba=b''.join(bytes((*c,255)) for c in colors)+bytes((256-len(colors))*4)
  data=chunk(b'SIZE',struct.pack('<III',w,depth,h))+chunk(b'XYZI',struct.pack('<I',len(vox))+b''.join(vox))+chunk(b'RGBA',rgba)
  file=out/(kind+'-'+style+'.vox');file.write_bytes(b'VOX '+struct.pack('<I',150)+chunk(b'MAIN',b'',data));paths.append('/'+str(file.relative_to('dist')))
 frames[kind]=paths
pack['adobe']=frames;p.write_text(json.dumps(pack,indent=2)+'\n')
