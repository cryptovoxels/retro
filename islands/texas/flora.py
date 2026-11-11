"""Bake the Texas plant and campsite models with python3 -m islands.texas.flora."""
from math import cos, sin, pi
from pathlib import Path
from random import Random
from islands.vox import Vox

out = Path(__file__).resolve().parents[2] / "islands/texas/assets/models"


def stem(m, a, b, radius, color):
    steps = max(abs(i-j) for i, j in zip(a, b)) or 1
    for n in range(steps + 1):
        x, y, z = (round(i + (j-i)*n/steps) for i, j in zip(a, b))
        m.box((x-radius, y-radius, z), (x+radius+1, y+radius+1, z+1), color)


def crown(m, x, y, z, w, d, h, color):
    for k in range(-h, h + 1):
        for j in range(-d, d + 1):
            extent = 1 - (k/(h+0.5))**2 - (j/(d+0.5))**2
            if extent <= 0:
                continue
            r = int(w * extent**0.5)
            m.box((x-r, y+j, z+k), (x+r+1, y+j+1, z+k+1), color)


def plant(name, form, leaf, light, flower=None):
    rng = Random(name)
    m = Vox(32, 32, 32)
    if form in ("tree", "shrub"):
        tree = form == "tree"
        trunk = 12 if tree else 4
        stem(m, (16,16,0), (15,16,trunk+2), 1, "75563c")
        for i in range(7):
            a = i*2*pi/7 + rng.uniform(-0.3,0.3)
            x, y = 16+round(cos(a)*rng.randint(5,8)), 16+round(sin(a)*rng.randint(5,8))
            z = trunk + rng.randint(4,9)
            stem(m, (15,16,trunk//2), (x,y,z), 1 if tree else 0, "806243")
            crown(m,x,y,z,6,5,4,leaf)
            crown(m,x-1,y,z+2,4,4,3,light)
            if flower:
                crown(m,x+2,y-3,z+2,2,1,1,flower)
        if name == "bald-cypress":
            crown(m,15,16,24,5,5,7,leaf)
            for x,y in ((7,14),(23,18),(13,24)):
                stem(m,(x,y,0),(x,y,3),1,"806243")
    elif form == "pads":
        for x,y,z,w,h in ((16,16,6,4,6),(11,16,13,4,5),(21,16,12,4,5),(8,16,20,3,4),(23,15,19,3,5),(16,14,16,3,5)):
            crown(m,x,y,z,w,2,h,leaf)
            m.box((x,y-2,z),(x+1,y-1,z+1),light)
        crown(m,23,15,25,2,1,1,flower)
    elif form == "barrel":
        crown(m,16,16,7,8,8,7,leaf)
        for i in range(8):
            a = i*pi/4
            stem(m,(16+round(7*cos(a)),16+round(7*sin(a)),4),(16+round(6*cos(a)),16+round(6*sin(a)),11),0,light)
        crown(m,16,16,14,3,3,1,flower)
    else:
        for i in range(17):
            a = i*2.4
            reach = rng.randint(3,10)
            x,y = 16+round(reach*cos(a)),16+round(reach*sin(a))
            h = rng.randint(5,14) if form == "blade" else rng.randint(11,23)
            stem(m,(16,16,0),(x,y,h),1 if form == "blade" else 0,leaf if i%3 else light)
            if flower:
                crown(m,x,y,h,1,1,3,flower)
                m.box((x,y,h+3),(x+1,y+1,h+4),light)
        if name == "red-yucca":
            stem(m,(16,16,0),(17,16,28),0,"a75044")
            crown(m,17,16,26,2,2,3,flower)
    m.save(out / (name+".vox"))


for spec in (
    ("buttonbush","shrub","46795a","76a963","e6d9aa"),
    ("wax-myrtle","shrub","466f51","88a268"),
    ("river-willow","tree","517b4a","99b45f"),
    ("bald-cypress","tree","396b52","6b9153"),
    ("live-oak","tree","385c43","719353"),
    ("honey-mesquite","tree","69874e","acca68"),
    ("texas-redbud","tree","93547b","d784a0","ecadbd"),
    ("texas-sage","shrub","788c79","a6b6a2","b986ca"),
    ("prickly-pear","pads","598969","aac075","b84364"),
    ("horse-crippler","barrel","74905a","b4b07c","e2a0a0"),
    ("red-yucca","blade","597a69","98b097","e17562"),
    ("lechuguilla","blade","587d7b","aec6a4"),
    ("bluebonnet","spike","53724c","ede5cb","596cb0"),
    ("indian-paintbrush","spike","64874e","f3b16a","e46b42"),
    ("gulf-muhly","spike","698156","ccabb2","ba8f9c"),
):
    plant(*spec)

bulbs = Vox(32,4,28)
for x in (0,30):
    bulbs.box((x,1,0),(x+2,3,27),"925d40")
for x in range(32):
    z = 26 - round(4*sin(pi*x/31))
    bulbs.box((x,1,z),(x+1,3,z+1),"3b4641")
    if x%5 == 3:
        bulbs.box((x,1,z-1),(x+1,3,z),"625647")
        bulbs.box((x-1,1,z-3),(x+1,3,z-1),"ffe2a0")
bulbs.save(out / "festoon.vox")

fire = Vox(24,24,20)
for i in range(10):
    a = i*pi/5
    x,y = 12+round(8*cos(a)),12+round(8*sin(a))
    crown(fire,x,y,2,3,2,2,"a58c79" if i%2 else "7f7166")
for i in range(6):
    a=i*pi/3
    x,y=12+round(3*cos(a)),12+round(3*sin(a))
    stem(fire,(12+round(6*cos(a)),12+round(6*sin(a)),1),(12,12,7),1,"6b4935")
    crown(fire,x,y,8,2,2,4,"ed7739")
    stem(fire,(x,y,8),(x+1,y,13+i%3),0,"ffc34f")
crown(fire,12,12,9,2,2,6,"ffe194")
fire.save(out / "campfire.vox")

log=Vox(32,10,9)
for x in range(32):
    for y in range(10):
        for z in range(9):
            r=(y-4.5)**2+(z-4)**2
            if r<=21:
                color=("b18354" if r<11 else "d6a16a") if x in (0,31) else ("78513b" if (y+z)%3 else "936846")
                log.box((x,y,z),(x+1,y+1,z+1),color)
log.save(out / "seat-log.vox")
