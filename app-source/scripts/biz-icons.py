#!/usr/bin/env python3
"""6ה: סמלי האפליקציה של עסק מתוך הלוגו שלו. שימוש: biz-icons.py <logo.png | --generic> <android res dir> <out-logo-192.png>
מקטין למרובע (רקע לבן אם הלוגו לא מרובע), וכותב ic_launcher / ic_launcher_round / ic_launcher_foreground בכל גודל,
כמו ש-patch-android.sh מעתיק את android-icons/. דורש Pillow (pip install pillow)."""
import os
import sys
from PIL import Image

SIZES = {'mipmap-mdpi': 48, 'mipmap-hdpi': 72, 'mipmap-xhdpi': 96, 'mipmap-xxhdpi': 144, 'mipmap-xxxhdpi': 192}


def square(im):
    im = im.convert('RGBA')
    s = max(im.size)
    if s < 192:
        raise SystemExit('logo is too small: %dx%d (need at least 192)' % im.size)
    bg = Image.new('RGBA', (s, s), (255, 255, 255, 255))
    bg.alpha_composite(im, ((s - im.size[0]) // 2, (s - im.size[1]) // 2))
    return bg


def generic():
    """סמל כללי לאפליקציה "ניהול עסק" (בלי לוגו של עסק): רקע כהה, שלושה עמודות זהב של גרף."""
    from PIL import ImageDraw
    s = 512
    im = Image.new('RGBA', (s, s), (24, 26, 32, 255))
    d = ImageDraw.Draw(im)
    for i, h in enumerate((150, 240, 330)):
        x = 116 + i * 100
        d.rounded_rectangle((x, 420 - h, x + 72, 420), radius=14, fill=(212, 175, 55, 255))
    d.rectangle((96, 432, 416, 446), fill=(212, 175, 55, 255))
    return im


def main(src, res, out):
    im = generic() if src == '--generic' else square(Image.open(src))
    for d, n in SIZES.items():
        os.makedirs(os.path.join(res, d), exist_ok=True)
        ic = im.resize((n, n), Image.LANCZOS)
        for name in ('ic_launcher.png', 'ic_launcher_round.png', 'ic_launcher_foreground.png'):
            ic.save(os.path.join(res, d, name), optimize=True)
    im.resize((192, 192), Image.LANCZOS).save(out, optimize=True)
    print('icons:', ', '.join('%s=%d' % x for x in SIZES.items()))


if __name__ == '__main__':
    if len(sys.argv) != 4:
        raise SystemExit(__doc__)
    main(*sys.argv[1:])
