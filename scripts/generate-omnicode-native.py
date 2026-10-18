"""Native icon format conversion; requires Pillow. Run through generate-omnicode-icons.mjs."""
from pathlib import Path
from io import BytesIO
import struct
import sys
ROOT=Path(__file__).resolve().parent.parent
sys.path.insert(0,str(ROOT/'.tmp/omnicode-native-tools'))
from PIL import Image, ImageDraw
work=Path(sys.argv[1])
app=Image.open(work/'app.png').convert('RGBA')
resample=Image.Resampling.LANCZOS

def windows_icon(image, destination):
    encoded=BytesIO()
    image.save(encoded,format='ICO',sizes=[(n,n) for n in [16,20,24,32,40,48,64,128,256]])
    data=bytearray(encoded.getvalue())
    count=struct.unpack_from('<H',data,4)[0]
    entries=[data[6+i*16:6+(i+1)*16] for i in range(count)]
    # Pillow writes smallest first; Tauri 2 decodes only the first ICO entry
    # for the window icon. Lead with 256px to avoid upscaling the 16px layer.
    # Reorder directory entries only: their payload offsets remain valid.
    entries.sort(key=lambda entry:(entry[0] or 256)*(entry[1] or 256),reverse=True)
    data[6:6+count*16]=b''.join(entries)
    destination.write_bytes(data)

def size_of(file):
    with Image.open(file) as image:return image.size

icons=ROOT/'src-tauri/icons'
windows_icon(app,icons/'icon.ico')
if '--windows-only' in sys.argv[2:]:
    print('Updated Windows ICO with the highest-resolution layer first')
    sys.exit(0)

mark=Image.open(work/'mark.png').convert('RGBA')
square=Image.open(work/'square.png').convert('RGB')
for file in icons.glob('*.png'):
    app.resize(size_of(file),resample).save(file)
app.save(icons/'icon.icns')
Image.open(work/'sidebar.png').convert('RGB').save(icons/'installer-sidebar.bmp')
mark.save(ROOT/'src-tauri/macos/AppIcon.icon/Assets/icon.png')
android=ROOT/'mobile/android/app/src/main/res'
for folder in android.glob('mipmap-*dpi'):
    for file in folder.glob('*.png'):
        size=size_of(file)
        if file.name=='ic_launcher_foreground.png':
            result=Image.new('RGBA',size)
            side=round(min(size)*.62)
            glyph=mark.resize((side,side),resample)
            result.alpha_composite(glyph,((size[0]-side)//2,(size[1]-side)//2))
        else:
            result=square.resize(size,resample).convert('RGBA')
            if file.name=='ic_launcher_round.png':
                mask=Image.new('L',size);ImageDraw.Draw(mask).ellipse((0,0,size[0]-1,size[1]-1),fill=255)
                result.putalpha(mask)
        result.save(file)

def splash(file):
    size=size_of(file);result=Image.new('RGB',size,'#070707')
    side=round(min(size)*.22);glyph=mark.resize((side,side),resample)
    result.paste(glyph,((size[0]-side)//2,(size[1]-side)//2),glyph)
    result.save(file)

for file in android.glob('drawable*/splash.png'):splash(file)
ios=ROOT/'mobile/ios/App/App/Assets.xcassets'
for file in (ios/'Splash.imageset').glob('*.png'):splash(file)
for file in (ios/'AppIcon.appiconset').glob('*.png'):square.resize(size_of(file),resample).save(file)

import xml.etree.ElementTree as ET
svg=ET.parse(ROOT/'design/omnicode-brand-v10/svg/omnicode-mark-white.svg').getroot()
def vector(width,viewport,offset=0):
    paths=''.join(f'<path android:fillColor="#00000000" android:strokeColor="#FFFFFFFF" android:strokeWidth="{p.get("stroke-width")}" android:strokeLineCap="round" android:strokeLineJoin="round" android:pathData="{p.get("d")}"/>' for p in svg.iter() if p.tag.endswith('}path'))
    return f'''<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android" android:width="{width}dp" android:height="{width}dp" android:viewportWidth="{viewport}" android:viewportHeight="{viewport}">
<group android:translateX="{offset}" android:translateY="{offset}">{paths}</group>
</vector>
'''
(android/'drawable/ic_stat_omnicode.xml').write_text(vector(24,256),encoding='utf-8')
(android/'drawable-v24/ic_launcher_foreground.xml').write_text(vector(108,384,64),encoding='utf-8')
print('Replaced desktop PNG/ICO/ICNS, Android/iOS icons and splashes, notification vector and installer bitmap')
