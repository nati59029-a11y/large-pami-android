#!/usr/bin/env python3
"""6ה: סמלי האפליקציה של עסק מתוך הלוגו שלו. שימוש: biz-icons.py <logo.png> <android res dir> <out-logo-192.png>
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


def main(src, res, out):
    im = square(Image.open(src))
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
