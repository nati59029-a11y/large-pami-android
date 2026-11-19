#!/usr/bin/env python3
# POS:M4 – מפיק את רשימת מפתחות ההגדרות מהאפיון הסופי (פרק 2 + 2.1) לקובץ הבדיקה tests/fixtures/pos-cfg-spec-keys.json.
# הרצה: python3 -I firebase/scripts/pos-cfg-spec-keys.py <נתיב ל-06-אפיון-סופי.md> firebase/tests/fixtures/pos-cfg-spec-keys.json
# כלל: עמודת "שם" בלי הסוגריים (ההחלפות "(במקום …)" / "(מתוך …)" נאספות לרשימת replaced), בלי מה שאחרי " – ", כל שם בין גרשיים הפוכים,
# {…} מוסר (wbc{prefix,mode} = wbc). "מי משנה": ע=sa, ב=own, מ=mgr (כמה ערכים מופרדים ב-"·" לפי סדר המפתחות). \* = רגישה.
import re, sys, json
t = open(sys.argv[1], encoding='utf8').read()
s = t.split('## 2. מודל הגדרות אחד')[1].split('### 2.1')[0]
s21 = t.split('### 2.1')[1].split('**מודול חדש')[0]
W = {'ע': 'sa', 'ב': 'own', 'מ': 'mgr'}
keys, repl = [], []
for line in s.splitlines():
    if not line.startswith('| `'):
        continue
    cells = [c.strip() for c in line.strip('|').split('|')]
    c0 = cells[0]
    for m in re.finditer(r'\(([^()]*)\)', c0):
        g = m.group(1)
        if 'במקום' in g: repl += re.findall(r'`([^`]+)`', g.split('במקום')[-1])
        elif 'מתוך' in g: repl += re.findall(r'`([^`]+)`', g.split('מתוך')[-1])
    c = re.sub(r'\([^()]*\)', '', c0).split(' – ')[0]
    toks = re.findall(r'`([^`]+)`(\\\*)?', c)
    ws = [W[x.strip()] for x in cells[3].split('·')]
    assert len(ws) in (1, len(toks)), line
    for i, (k, st) in enumerate(toks):
        keys.append([re.sub(r'\{.*', '', k), ws[i] if len(ws) > 1 else ws[0], bool(st)])
repl += re.findall(r'`([^`]+)`←', s21)
# מפתחות שנוספו בהחלטת בעל העסק אחרי פרק 2 (שם, מי משנה, רגישה, אחרי איזה מפתח)
EXTRA = [('rcptBizRc', 'mgr', False, 'rcptBizFmt')]  # קופה גל 3, 19.11.2026: קבלה ללקוח עסקי שמקבל רק חשבוניות
for k, w, sens, aft in EXTRA:
    keys.insert([x[0] for x in keys].index(aft) + 1, [k, w, sens])
out = {'source': 'my-agents: משימות/2026-11-17_תוכנית-קופה-לחנות/תוצרים/06-אפיון-סופי.md – פרק 2 (טבלה) ופרק 2.1. נוצר בסקריפט firebase/scripts/pos-cfg-spec-keys.py',
       'count': len(keys), 'keys': keys, 'replaced': sorted(set(repl))}
open(sys.argv[2], 'w', encoding='utf8').write(json.dumps(out, ensure_ascii=False, indent=0) + '\n')
print(len(keys), 'keys,', len(set(repl)), 'replaced')
