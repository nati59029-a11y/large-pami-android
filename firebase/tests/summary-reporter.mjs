// מדפיס בסוף שורת סיכום פשוטה: כמה בדיקות עברו וכמה נכשלו.
export default async function* summary(source) {
  let pass = 0, fail = 0;
  for await (const ev of source) {
    if (ev.type === 'test:pass' && ev.data.details?.type !== 'suite') pass++;
    if (ev.type === 'test:fail' && ev.data.details?.type !== 'suite') fail++;
  }
  yield `\n==== סיכום: ${pass} בדיקות עברו, ${fail} נכשלו ====\n`;
}
