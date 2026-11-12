#!/usr/bin/env python3
"""12.11.2026: סמל ההתראה (בשורת המצב של Android) מתוך הלוגו של האפליקציה/העסק.

  notif-icon.py <logo.png> <android-res-dir> [--preview out.png]

Android מציג את הסמל הקטן של התראה תמיד כצללית בצבע אחד (רק השקיפות נחשבת). לוגו עם רקע מלא היה יוצא ריבוע לבן.
לכן: מפרידים את צורת הלוגו מהרקע (שקיפות, או צבע הרקע לפי השוליים), חותכים, ושומרים צללית לבנה בחמישה גדלים
(drawable-*dpi/ic_stat_notify.png). צבע ההדגשה של ההתראה (values/notif_color.xml) = הצבע הבולט בלוגו.
לוגו שהצללית שלו לא ברורה (תמונה, רקע מעורב, פרטים קטנים מדי) – לא נכתבים קובצי PNG, ונשאר סמל הפעמון
(drawable/ic_stat_notify.xml שכותב patch-android.sh). יציאה 0 תמיד (גם בכשל) – הבנייה לא נעצרת בגלל הסמל.
"""
import os
import sys

SIZES = {'mdpi': 24, 'hdpi': 36, 'xhdpi': 48, 'xxhdpi': 72, 'xxxhdpi': 96}
WORK = 192


def dist(a, b):
    return sum((int(x) - int(y)) ** 2 for x, y in zip(a, b)) ** 0.5


def mask_of(im):
    """מחזיר (mask L 0/255 בגודל WORK, סיבה) או (None, סיבה)."""
    from PIL import Image
    im = im.convert('RGBA').resize((WORK, WORK), Image.LANCZOS)
    px = im.load()
    alpha = [px[x, y][3] for y in range(WORK) for x in range(WORK)]
    if sum(1 for a in alpha if a < 32) > WORK * WORK * 0.05:
        m = Image.new('L', (WORK, WORK))
        m.putdata([255 if a >= 128 else 0 for a in alpha])
        return m, 'transparent', im
    # בלי שקיפות: צבע הרקע לפי השוליים – חייב להיות אחיד
    border = [px[x, y][:3] for x in range(WORK) for y in (0, 1, WORK - 2, WORK - 1)] + \
             [px[x, y][:3] for y in range(WORK) for x in (0, 1, WORK - 2, WORK - 1)]
    bg = tuple(sorted(c[i] for c in border)[len(border) // 2] for i in range(3))
    if sum(1 for c in border if dist(c, bg) > 40) > len(border) * 0.15:
        return None, 'רקע הלוגו לא אחיד', im
    m = Image.new('L', (WORK, WORK))
    m.putdata([255 if dist(px[x, y][:3], bg) > 60 else 0 for y in range(WORK) for x in range(WORK)])
    return m, 'background', im


def accent_of(im, m):
    """הצבע הבולט בתוך הצורה (רווי, לא קרוב ללבן/שחור). None אם אין."""
    import colorsys
    px, mp = im.load(), m.load()
    buckets = {}
    for y in range(0, WORK, 2):
        for x in range(0, WORK, 2):
            if not mp[x, y]:
                continue
            r, g, b = px[x, y][:3]
            h, l, s = colorsys.rgb_to_hls(r / 255, g / 255, b / 255)
            if s < 0.25 or l < 0.15 or l > 0.85:
                continue
            k = (r // 32, g // 32, b // 32)
            buckets.setdefault(k, []).append((r, g, b))
    if not buckets:
        return None
    best = max(buckets.values(), key=len)
    if len(best) < 20:
        return None
    return '#%02X%02X%02X' % tuple(sum(c[i] for c in best) // len(best) for i in range(3))


DEFAULT_ACC = '#1C5A49'  # צבע ההדגשה של לארג' פעמי (--acc)


def color_file(res, acc):
    os.makedirs(os.path.join(res, 'values'), exist_ok=True)
    with open(os.path.join(res, 'values', 'notif_color.xml'), 'w', encoding='utf-8') as f:
        f.write('<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="notif_accent">%s</color>\n</resources>\n' % acc)


def make(src, res, preview=None):
    # מתחילים נקי: צללית קודמת (למשל של לארג' פעמי לפני make-biz-app) לא נשארת באפליקציה של עסק אחר
    for d in SIZES:
        try:
            os.remove(os.path.join(res, 'drawable-' + d, 'ic_stat_notify.png'))
        except OSError:
            pass
    color_file(res, DEFAULT_ACC)
    try:
        from PIL import Image
    except ImportError:
        return 'Pillow חסר – נשאר סמל הפעמון'
    try:
        m, why, im = mask_of(Image.open(src))
    except Exception as e:  # noqa: BLE001
        return 'הלוגו לא נקרא (%s) – נשאר סמל הפעמון' % type(e).__name__
    if m is None:
        return why + ' – נשאר סמל הפעמון'
    bbox = m.getbbox()
    cover = sum(1 for v in m.tobytes() if v) / (WORK * WORK)
    if not bbox or cover < 0.04:
        return 'לא נמצאה צורה בלוגו – נשאר סמל הפעמון'
    crop = m.crop(bbox)
    w, h = crop.size
    side = int(max(w, h) * 1.12)
    sq = Image.new('L', (side, side))
    sq.paste(crop, ((side - w) // 2, (side - h) // 2))
    fill = sum(1 for v in sq.tobytes() if v) / (side * side)
    if fill > 0.85:
        return 'הצורה ממלאת כמעט את כל הריבוע (תצא כריבוע) – נשאר סמל הפעמון'
    # פרטים קטנים מדי: הצללית ב-24 פיקסלים שונה מאוד מהמקור
    big = sq.resize((96, 96), Image.LANCZOS).point(lambda v: 255 if v >= 128 else 0)
    small = sq.resize((24, 24), Image.LANCZOS).resize((96, 96), Image.NEAREST).point(lambda v: 255 if v >= 128 else 0)
    a, b = big.tobytes(), small.tobytes()
    inter = sum(1 for x, y in zip(a, b) if x and y)
    union = sum(1 for x, y in zip(a, b) if x or y) or 1
    if inter / union < 0.6:
        return 'הלוגו מפורט מדי לסמל קטן (%.2f) – נשאר סמל הפעמון' % (inter / union)
    for d, n in SIZES.items():
        os.makedirs(os.path.join(res, 'drawable-' + d), exist_ok=True)
        al = sq.resize((n, n), Image.LANCZOS)
        white = Image.new('RGBA', (n, n), (255, 255, 255, 255))
        white.putalpha(al)
        white.save(os.path.join(res, 'drawable-' + d, 'ic_stat_notify.png'))
    acc = accent_of(im, m)
    color_file(res, acc or DEFAULT_ACC)
    if preview:
        # תצוגה לבדיקה: הצללית על רקע כהה (כמו בשורת ההתראות) ובצבע ההדגשה
        p = Image.new('RGBA', (220, 110), (40, 40, 40, 255))
        ic = sq.resize((96, 96), Image.LANCZOS)
        p.paste(Image.new('RGBA', (96, 96), (255, 255, 255, 255)), (7, 7), ic)
        p.paste(Image.new('RGBA', (96, 96), acc or DEFAULT_ACC), (117, 7), ic)
        p.convert('RGB').save(preview)
    return 'צללית מהלוגו (%s, כיסוי %d%%), צבע %s' % ('שקיפות' if why == 'transparent' else 'רקע אחיד', round(fill * 100), acc or 'ברירת מחדל')


if __name__ == '__main__':
    if len(sys.argv) < 3:
        print('usage: notif-icon.py <logo.png> <res-dir> [--preview out.png]')
        sys.exit(0)
    pv = sys.argv[sys.argv.index('--preview') + 1] if '--preview' in sys.argv else None
    msg = make(sys.argv[1], sys.argv[2], pv)
    print('סמל ההתראה: ' + msg)
    s = os.environ.get('GITHUB_STEP_SUMMARY')
    if s:
        with open(s, 'a', encoding='utf-8') as f:
            f.write('סמל ההתראה: %s\n' % msg)
    sys.exit(0)
