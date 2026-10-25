"""Ikona aplikace: tři kartičky přes sebe, na přední otazník a fajfka. Kreslí se ve 2048 px a zmenšuje.
Spuštění: py tools/make_icons.py   (potřebuje Pillow a písmo Georgia z Windows)"""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

S = 2048
BG = (16, 23, 22)
CARDS = [(31, 95, 139), (63, 154, 158), (251, 252, 251)]
INK = (20, 33, 31)
GOOD = (44, 122, 75)
OUT = Path(__file__).resolve().parent.parent / 'icons'
FONT = r'C:\Windows\Fonts\georgiab.ttf'


def card(d, box, fill, r=120):
    d.rounded_rectangle(box, radius=r, fill=fill)


def make():
    img = Image.new('RGB', (S, S), BG)
    d = ImageDraw.Draw(img)
    w, h = 1080, 1380
    for i, col in enumerate(CARDS):
        x = 380 + i * 150
        y = 240 + (2 - i) * 70 + i * 40
        card(d, (x, y, x + w, y + h), col)
    x0, y0 = 380 + 300, 240 + 80
    f = ImageFont.truetype(FONT, 820)
    d.text((x0 + w / 2, y0 + h * 0.42), '?', font=f, fill=INK, anchor='mm')
    cx, cy = x0 + w / 2, y0 + h * 0.83
    d.line([(cx - 190, cy - 10), (cx - 50, cy + 120), (cx + 220, cy - 160)], fill=GOOD, width=110, joint='curve')
    OUT.mkdir(exist_ok=True)
    for size, name in [(512, 'icon-512.png'), (192, 'icon-192.png'), (180, 'apple-touch-icon.png')]:
        img.resize((size, size), Image.LANCZOS).save(OUT / name)


if __name__ == '__main__':
    make()
