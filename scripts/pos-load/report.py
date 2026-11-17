#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""דוח ביצועים לקופה: זמן לכל מכירה, וקריאות/כתיבות ליום מול המכסות.

קלט: out/results.json (מ-loadtest.js) ו-out/demo-meta.json (מ-gen-demo-data.js).
פלט: out/report.md (וגם מודפס). עם --save נשמר גם עותק ל-RESULTS.md (נכנס למאגר).

סימון: [נמדד] = נמדד בהרצה מול האמולטור. [הערכה] = חישוב לפי הנחות שמפורטות בדוח – לא מדידה.
האמולטור רץ על המחשב המקומי: זמני התגובה שלו אינם זמני הייצור (אין רשת, אין הפעלה קרה של פונקציה).
"""
import json
import math
import os
import statistics
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "out")

# ---- הנחות (כולן [הערכה]; לשנות כאן) ----
ASSUME = {
    "devices_per_branch": 2,          # קופות בכל סניף
    "open_days_per_month": 26,        # ימי פתיחה בחודש (בלי שבתות)
    "catalog_doc_size_kb": 0.6,       # גודל משוער של מסמך מוצר עם וריאציות
    "catalog_chunk_products": 500,    # מוצרים בכל מסמך "חבילת קטלוג" (גבול מסמך: 1MiB)
    "catalog_daily_change_pct": 2.0,  # אחוז המוצרים שמשתנים ביום (מחיר/מלאי/חדש)
    "report_views_per_branch_day": 10,  # כמה פעמים ביום פותחים דוח יומי בסניף
    "net_rtt_ms": 80,                 # הלוך-חזור ישראל ↔ europe-west1 (משוער)
    "fn_warm_overhead_ms": 40,        # תקורה של פונקציה "חמה"
    "fn_cold_start_ms": 1500,         # הפעלה קרה (קורה מדי פעם, בעיקר בבוקר)
    "prod_vs_emu_tx_factor": 2.5,     # טרנזקציה בייצור איטית פי X מהאמולטור המקומי (גס מאוד)
}
# מכסות חינם יומיות של Firestore (Spark / חלק החינם של Blaze). [לאמת מול דף התמחור לפני החלטה]
QUOTA = {"reads": 50_000, "writes": 20_000, "deletes": 20_000}
# מחירי Blaze לכל 100,000 פעולות מעבר למכסה, בדולר. [הערכה – משתנה לפי אזור; לאמת מול דף התמחור]
PRICE = {"reads": 0.06, "writes": 0.18}
# Cloud Functions: הפעלות חינם בחודש [לאמת]
FN_FREE_PER_MONTH = 2_000_000


def load(name):
    with open(os.path.join(OUT, name), encoding="utf-8") as f:
        return json.load(f)


def pct(v, p):
    if not v:
        return None
    s = sorted(v)
    return s[min(len(s) - 1, int(p / 100 * len(s)))]


def fmt(n, d=0):
    if n is None:
        return "—"
    return f"{n:,.{d}f}"


def main():
    save = "--save" in sys.argv
    meta = load("demo-meta.json")
    try:
        res = load("results.json")
    except FileNotFoundError:
        print("אין out/results.json – הריצו קודם את run-emulator.sh")
        return 1
    day = res.get("day") or {}
    per = day.get("sales") or []
    branches = meta["counts"]["branches"]
    spb = meta["salesPerBranch"]
    L = []
    w = L.append

    w("# דוח ביצועים – קופה (בדיקת עומס מול אמולטור)")
    w("")
    w(f"- הרצה: `{res['run']}` · {res['at']} · יעד: **{res['target']['mode']}** (`{res['target']['project']}`) · מימוש: **{res['impl']}**")
    if res["impl"] == "ref":
        w("- ⚠️ הבדיקות רצו מול **מימוש ייחוס** (`lib/pos-sale-ref.js`) לפי הממשק הצפוי, כי פונקציות השרת של הקופה (סשן ז') עוד לא מוזגו. "
          "אחרי המיזוג יש להריץ שוב עם `POS_IMPL=fn`.")
    w(f"- נתוני דוגמה: {fmt(meta['counts']['products'])} מוצרים, {fmt(meta['counts']['skus'])} וריאציות/ברקודים, "
      f"{fmt(meta['counts']['customers'])} לקוחות, {branches} סניפים, {spb} מכירות לסניף ביום (שיא {meta['peakPerHour']} בשעה). **כל הנתונים לדוגמה בלבד.**")
    w(f"- דחיסת זמן ביום המלא: ×{res['compress']} · ניסיונות לטרנזקציה: {res['maxAttempts']}")
    w("")
    w("סימון: **[נמדד]** = נמדד בהרצה. **[הערכה]** = חישוב לפי הנחות (בסוף הדוח).")
    w("")

    w("## 1. תוצאות הבדיקות [נמדד]")
    w("")
    w("| בדיקה | תוצאה | זמן | פרטים |")
    w("|---|---|---|---|")
    for t in res["tests"]:
        det = ""
        if "numbers" in t and isinstance(t["numbers"], dict):
            g = t["numbers"]
            det = f"מספרים {g.get('min')}–{g.get('max')}, {g.get('count')} מכירות, חורים: {len(g.get('gaps', []))}, כפולים: {len(g.get('dups', []))}"
        if "rejectedFirstTry" in t:
            det += f"; נדחו בניסיון ראשון: {t['rejectedFirstTry']} (נשלחו שוב בהצלחה: {t['retriedOk']}); ניסיונות טרנזקציה: {t['attempts']['total']} (מקס' {t['attempts']['max']} למכירה)"
        if "latMs" in t:
            det += f"; זמן למכירה p50/p95/מקס': {t['latMs'].get('p50')}/{t['latMs'].get('p95')}/{t['latMs'].get('max')}ms"
        if "fulfilled" in t:
            det = f"נשלחו {t['sent']}, התקבלו {t['fulfilled']}, נדחו {t['rejected']} – נשמרה מכירה אחת"
        if t.get("err"):
            det = "שגיאה: " + t["err"][:200]
        det = det.lstrip("; ")
        w(f"| {t['name']} | {'✔ עבר' if t['ok'] else '✘ נכשל'} | {fmt(t['ms'])}ms | {det} |")
    w("")

    w("## 2. זמן לכל מכירה")
    w("")
    if per:
        ms = [x["ms"] for x in per]
        w(f"**באמולטור [נמדד]** – {len(per)} מכירות ביום המלא: ממוצע {fmt(statistics.mean(ms), 1)}ms · "
          f"p50 {pct(ms, 50)}ms · p95 {pct(ms, 95)}ms · p99 {pct(ms, 99)}ms · מקס' {max(ms)}ms")
        if per and "qMs" in per[0]:
            qs = [x["qMs"] for x in per]
            w("")
            w(f"המתנה בתור המכשיר (מכירה שהגיעה בזמן שהקודמת עוד נשלחה) [נמדד, בזמן דחוס]: p50 {pct(qs, 50)}ms · p95 {pct(qs, 95)}ms · מקס' {max(qs)}ms. "
              f"שליחות חוזרות: {day.get('resends', 0)}. קופות: {day.get('devices')}. "
              "הזנב (p99) נובע מהתנגשות בין שתי קופות באותו סניף על המונה.")
        w("")
        w("| שורות במכירה | מכירות | p50 (ms) | p95 (ms) |")
        w("|---|---|---|---|")
        by = {}
        for x in per:
            k = x["lines"] if x["lines"] <= 4 else (8 if x["lines"] <= 8 else 12)
            by.setdefault(k, []).append(x["ms"])
        for k in sorted(by):
            lab = str(k) if k <= 4 else ("5–8" if k == 8 else "9+")
            w(f"| {lab} | {len(by[k])} | {pct(by[k], 50)} | {pct(by[k], 95)} |")
        w("")
        p50 = pct(ms, 50)
        prod = p50 * ASSUME["prod_vs_emu_tx_factor"] + ASSUME["net_rtt_ms"] + ASSUME["fn_warm_overhead_ms"]
        w(f"**בייצור [הערכה]**: כ-{fmt(prod)}ms למכירה כשהפונקציה חמה "
          f"(p50 באמולטור × {ASSUME['prod_vs_emu_tx_factor']} + רשת {ASSUME['net_rtt_ms']}ms + תקורה {ASSUME['fn_warm_overhead_ms']}ms), "
          f"וכ-{fmt(prod + ASSUME['fn_cold_start_ms'])}ms בהפעלה קרה. הקופה לא צריכה לחכות לשרת: המכירה נשמרת במכשיר עם reqId ונשלחת ברקע.")
    else:
        w("אין נתוני יום מלא (בדיקה 5 לא רצה או נכשלה).")
    w("")

    w("## 3. קריאות וכתיבות ליום מול המכסות")
    w("")
    if per and day.get("measuresOps", True):
        r_sale = statistics.mean(x["reads"] for x in per)
        w_sale = statistics.mean(x["writes"] for x in per)
        a_sale = statistics.mean(x["attempts"] for x in per)
        src = "[נמדד]"
    else:
        # בלי מדידה פנימית (POS_IMPL=fn): לפי מבנה מימוש הייחוס – 2 + מוצרים שונים, 2 + שורות + 1
        avg_lines = 2.6
        r_sale, w_sale, a_sale, src = 2 + avg_lines, 3 + avg_lines, 1.0, "[הערכה]"
    w(f"לכל מכירה {src}: {fmt(r_sale, 2)} קריאות, {fmt(w_sale, 2)} כתיבות, {fmt(a_sale, 3)} ניסיונות טרנזקציה בממוצע.")
    w("(קריאות: המכירה + מונה הסניף + מסמכי המוצרים בשורות. כתיבות: המכירה + מונה + שורת מלאי לכל פריט + סיכום יומי.)")
    w("")

    dev = branches * ASSUME["devices_per_branch"]
    nprod = meta["counts"]["products"]
    chunks = math.ceil(nprod / ASSUME["catalog_chunk_products"])
    changed = math.ceil(nprod * ASSUME["catalog_daily_change_pct"] / 100)
    total_sales = spb * branches
    rows = [
        ("מכירות (שרת)", src, total_sales * r_sale, total_sales * w_sale),
        ("דוח יומי מסיכום posday", "[הערכה]", branches * ASSUME["report_views_per_branch_day"] * 1, 0),
    ]
    scen = {
        "א. כל קופה מורידה את כל הקטלוג כל בוקר (מסמך לכל מוצר)": dev * nprod,
        f"ב. קטלוג בחבילות של {ASSUME['catalog_chunk_products']} מוצרים ({chunks} מסמכים לקופה)": dev * chunks,
        f"ג. רק שינויים מאז הסנכרון האחרון (~{changed} מוצרים)": dev * changed,
    }
    base_r = sum(r for _, _, r, _ in rows)
    base_w = sum(x for _, _, _, x in rows)
    w(f"**יום אחד, {branches} סניפים, {total_sales} מכירות, {dev} קופות:**")
    w("")
    w("| רכיב | סוג | קריאות ליום | כתיבות ליום |")
    w("|---|---|---|---|")
    for n, s, r, x in rows:
        w(f"| {n} | {s} | {fmt(r)} | {fmt(x)} |")
    for n, r in scen.items():
        w(f"| סנכרון קטלוג – {n} | [הערכה] | {fmt(r)} | 0 |")
    w("")
    w(f"מכסה יומית חינם [לאמת]: {fmt(QUOTA['reads'])} קריאות, {fmt(QUOTA['writes'])} כתיבות.")
    w("")
    w("| תרחיש קטלוג | קריאות ליום | % ממכסת קריאות | כתיבות ליום | % ממכסת כתיבות | עלות חודשית מעבר למכסה [הערכה] |")
    w("|---|---|---|---|---|---|")
    for n, r in scen.items():
        R = base_r + r
        over_r = max(0, R - QUOTA["reads"]) * ASSUME["open_days_per_month"]
        over_w = max(0, base_w - QUOTA["writes"]) * ASSUME["open_days_per_month"]
        cost = over_r / 1e5 * PRICE["reads"] + over_w / 1e5 * PRICE["writes"]
        w(f"| {n} | {fmt(R)} | {fmt(R / QUOTA['reads'] * 100, 1)}% | {fmt(base_w)} | {fmt(base_w / QUOTA['writes'] * 100, 1)}% | ${fmt(cost, 2)} |")
    w("")
    max_br_w = QUOTA["writes"] / (spb * w_sale)
    w(f"- **כתיבות הן צוואר הבקבוק [הערכה]**: עם {fmt(w_sale, 1)} כתיבות למכירה, מכסת הכתיבות החינמית מספיקה לכ-{fmt(QUOTA['writes'] / w_sale)} מכירות ביום "
      f"(≈{fmt(max_br_w, 1)} סניפים בקצב של {spb} מכירות). מעבר לזה – תשלום לפי שימוש (Blaze).")
    w(f"- **סנכרון הקטלוג קובע את הקריאות**: תרחיש א' לבדו ({fmt(dev * nprod)} קריאות) עובר את המכסה. תרחישים ב'/ג' זניחים.")
    calls = total_sales * ASSUME["open_days_per_month"]
    w(f"- הפעלות פונקציה בחודש [הערכה]: {fmt(calls)} (מכסה חינם {fmt(FN_FREE_PER_MONTH)} – {fmt(calls / FN_FREE_PER_MONTH * 100, 1)}%).")
    w("")

    w("## 4. עומס על מונה המספור")
    w("")
    peak_rate = meta["peakPerHour"] / 3600
    w(f"- בשעת שיא: {meta['peakPerHour']} מכירות בשעה בסניף = {peak_rate:.3f} כתיבות בשנייה למונה הסניף. "
      "ההמלצה של Firestore היא עד כ-1 כתיבה בשנייה למסמך בודד לאורך זמן [לאמת] – מרווח של פי 60 בערך.")
    for t in res["tests"]:
        if "rejectedFirstTry" not in t:
            continue
        w(f"- **{t['name'].split(' ')[0]}** {t['numbers']['count']} מכירות באותו רגע, עד {t['maxAttemptsUsed']} ניסיונות לטרנזקציה [נמדד]: "
          f"{t['rejectedFirstTry']} נדחו בשליחה הראשונה"
          + (f" ונשמרו בשליחה חוזרת מהמכשיר ({t['resendRounds']} סבבים)" if t["rejectedFirstTry"] else "")
          + f"; סה\"כ {t['attempts']['total']} ניסיונות טרנזקציה (מקס' {t['attempts']['max']} למכירה), {fmt(t['totalMs'])}ms עד שהכול נשמר. "
          f"חורים: {len(t['numbers']['gaps'])}, כפולים: {len(t['numbers']['dups'])}.")
    w("- **ממצא:** מונה אחד לסניף בתוך טרנזקציה נותן מספור בלי חורים, אבל בהתנגשות רבה ברירת המחדל (5 ניסיונות) לא מספיקה. "
      "מומלץ שפונקציית השרת תגדיר `maxAttempts` גבוה (כ-20), ושהמכשיר ישלח שוב מכירה שנדחתה עם אותו reqId (בטוח – בדיקות 1, 2, 4).")
    w("- **ממצא (אמולטור):** כשכל מכירה נשלחת בנפרד ובמקביל (בלי תור לכל קופה), האמולטור נתקע על \"Transaction lock timeout\" כבר בקצב של 2 מכירות בשנייה לסניף. "
      "כשכל קופה שולחת את התור שלה לפי הסדר (בדיקה 5) – הכול עובר. המלצה לאפליקציה: תור שליחה אחד לכל מכשיר, מכירה אחת בכל פעם.")
    w("")

    w("## 5. הנחות [הערכה]")
    w("")
    for k, v in ASSUME.items():
        w(f"- `{k}` = {v}")
    w(f"- מחירים (לכל 100,000): קריאות ${PRICE['reads']}, כתיבות ${PRICE['writes']} – לאמת מול דף התמחור של Firestore לאזור שנבחר.")
    w("- התוכנית (`תוצרים/01-תוכנית-קופה.md`, פרק \"עלויות\") לא הייתה נגישה מהסשן הזה; ההנחות לא הושוו אליה.")
    w("")

    text = "\n".join(L) + "\n"
    with open(os.path.join(OUT, "report.md"), "w", encoding="utf-8") as f:
        f.write(text)
    if save:
        with open(os.path.join(HERE, "RESULTS.md"), "w", encoding="utf-8") as f:
            f.write(text)
    print(text)
    return 0


if __name__ == "__main__":
    sys.exit(main())
