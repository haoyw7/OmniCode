"""Rebuild the transparent vector assets (fonttools + brotli required)."""
from pathlib import Path
import shutil
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
FONT = ROOT / 'public/fonts/source-sans/SourceSans3VF-Upright.ttf.woff2'

# One shared contour for the approved mark and every assistant state.
OUTLINE = 'M 181 212 C 166 220 145 222 124 222 C 61 222 25 191 25 132 C 25 70 61 34 124 34 C 187 34 225 68 225 130 C 225 153 221 170 212 184'
FACE = 'M 84 109 L 109 127 L 84 145 M 153 127 H 179'
SMALL_OUTLINE = 'M 174 211 C 159 218 143 220 124 220 C 63 220 27 190 27 132 C 27 72 62 36 124 36 C 185 36 223 69 223 130 C 223 150 220 163 215 173'

def path(d, stroke=20):
    return f'<path d="{d}" fill="none" stroke-width="{stroke}" stroke-linecap="round" stroke-linejoin="round"/>'

def symbol(small=False, expression='default'):
    outline = path(SMALL_OUTLINE if small else OUTLINE, 32 if small else 30)
    face = path('M 79 131 Q 90 109 101 131 M 150 131 Q 161 109 172 131', 17) if expression == 'happy' else path(FACE, 21 if small else 20)
    if expression == 'thinking':
        face = f'<g transform="translate(0 -5)">{face}</g>'
    return outline + face

def svg(body, label, color='currentColor', width=256, height=256):
    return f'''<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}" role="img" aria-label="{label}">
  <g fill="{color}" stroke="{color}">{body}</g>
</svg>
'''

def write(name, data):
    (HERE / name).write_text(data, encoding='utf-8')

font = instantiateVariableFont(TTFont(FONT), {'wght': 600}, inplace=False)
glyphs = font.getGlyphSet()
cmap = font.getBestCmap()
scale = 142 / font['head'].unitsPerEm
cursor = 158.0
commands = []
for char in 'OmniCode':
    glyph_name = cmap[ord(char)]
    pen = SVGPathPen(glyphs)
    glyphs[glyph_name].draw(TransformPen(pen, (scale, 0, 0, -scale, cursor, 111)))
    commands.append(pen.getCommands())
    cursor += font['hmtx'][glyph_name][0] * scale - 1.1
wordmark = '<path stroke="none" d="' + ' '.join(commands) + '"/>'
lockup = '<g transform="translate(4 8) scale(.5)">' + symbol() + '</g>' + wordmark

for variant, color in [('black', '#151515'), ('white', '#ffffff'), ('current', 'currentColor')]:
    write(f'omnicode-mark-{variant}.svg', svg(symbol(), 'OmniCode', color))
    write(f'omnicode-mark-small-{variant}.svg', svg(symbol(small=True), 'OmniCode', color, 256, 256))
    write(f'omnicode-horizontal-{variant}.svg', svg(lockup, 'OmniCode', color, round(cursor + 12), 144))

for state, label in [('ready', '待命'), ('thinking', '思考'), ('running', '执行'), ('done', '完成'), ('approval', '等待确认'), ('connecting', '连接中')]:
    expression = 'happy' if state == 'done' else 'thinking' if state == 'thinking' else 'default'
    body = '<g transform="translate(32 32)">' + symbol(expression=expression) + '</g>'
    if state == 'thinking':
        body += '<g stroke="none"><circle cx="222" cy="23" r="5"/><circle cx="241" cy="23" r="5"/><circle cx="260" cy="23" r="5"/></g>'
    elif state == 'running':
        body += '<path d="M 76 291 H 244" stroke-width="9" opacity=".2" stroke-linecap="round"/><path d="M 76 291 H 139" stroke-width="9" stroke-linecap="round"/>'
    elif state == 'done':
        body += path('M 263 261 L 274 272 L 296 246', 10)
    elif state == 'approval':
        body += '<path d="M 237 12 H 285 Q 294 12 294 21 V 40 Q 294 49 285 49 H 263 L 251 60 V 49 H 237 Q 228 49 228 40 V 21 Q 228 12 237 12 Z" fill="none" stroke-width="4"/>'
        body += '<g stroke="none"><circle cx="244" cy="31" r="3.5"/><circle cx="261" cy="31" r="3.5"/><circle cx="278" cy="31" r="3.5"/></g>'
    elif state == 'connecting':
        body += '<g stroke="none"><circle cx="265" cy="22" r="5"/><circle cx="287" cy="44" r="5"/></g>'
    write(f'omi-{state}.svg', svg(body, f'Omi · {label}', width=320, height=320))

shutil.copyfile(ROOT / 'public/fonts/source-sans/OFL.txt', HERE / 'SourceSans3-OFL.txt')
print(f'Created {len(list(HERE.glob("*.svg")))} transparent SVG files in {HERE}')
