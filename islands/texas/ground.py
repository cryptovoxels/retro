from PIL import Image,ImageOps,ImageEnhance,ImageDraw
im=Image.open('islands/texas/source/ground.png').convert('RGB').resize((512,512),Image.Resampling.LANCZOS)
n=128
sw=[im.crop((i%4*n,i//4*n,(i%4+1)*n,(i//4+1)*n)) for i in range(16)]
out=Image.new('RGB',(1024,1024))
for i in range(64):
 m=i%16
 if i<16:
  tile=sw[m%8].copy() if m<8 else ImageEnhance.Color(ImageOps.mirror(sw[m%8])).enhance(.80)
 elif i<48:
  dirt=i>=32
  tile=sw[12 if dirt else 8].copy()
  edge=sw[1 if dirt else 5]; e=16 if dirt else 11
  # Top of the atlas tile is -z. Matching neighbours keep a continuous surface.
  for bit,box in [(1,(0,0,n,e)),(2,(n-e,0,n,n)),(4,(0,n-e,n,n)),(8,(0,0,e,n))]:
   if not m&bit:tile.paste(edge.crop(box),box[:2])
  dr=ImageDraw.Draw(tile)
  if not dirt:
   for bit,xy in [(1,(0,e,n,e)),(2,(n-e-1,0,n-e-1,n)),(4,(0,n-e-1,n,n-e-1)),(8,(e,0,e,n))]:
    if not m&bit:dr.line(xy,fill=(88,72,62),width=2)
 else:
  tile=sw[[15,10,11,8][m%4]].rotate((m//4)*90)
  if m%4==3: ImageDraw.Draw(tile).line((28+m,75,77+m,68),fill=(54,52,60),width=3)
 out.paste(tile,(i%8*n,i//8*n))
out.quantize(240).save('islands/texas/assets/textures/texas-ground.png')
