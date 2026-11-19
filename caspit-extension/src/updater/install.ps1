# לארג' פעמי – התקנה חד-פעמית של העדכון האוטומטי לתוסף כספית (0.1.7). מופעל מ-install-auto-update.cmd שבתיקיית התוסף.
# יוצר משימה מתוזמנת של Windows למשתמש הנוכחי (בלי הרשאות מנהל): כל יום ב-02:30, וגם 2 דקות אחרי כניסה למחשב;
# אם המחשב היה כבוי בשעה הזו – רצה כשהוא נדלק (StartWhenAvailable). המשימה מריצה את caspit-update.ps1 על התיקייה הזו.
# הקובץ נשמר ב-UTF-8 עם BOM (בשביל ההודעות בעברית ב-Windows PowerShell 5.1).
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
function Say([string]$t, [bool]$bad) {
  $icon = if ($bad) { [System.Windows.Forms.MessageBoxIcon]::Error } else { [System.Windows.Forms.MessageBoxIcon]::Information }
  $opt = [System.Windows.Forms.MessageBoxOptions]::RtlReading -bor [System.Windows.Forms.MessageBoxOptions]::RightAlign
  [void][System.Windows.Forms.MessageBox]::Show($t, 'עדכון אוטומטי – תוסף כספית', [System.Windows.Forms.MessageBoxButtons]::OK, $icon, [System.Windows.Forms.MessageBoxDefaultButton]::Button1, $opt)
}
try {
  $ext = Split-Path -Parent $PSScriptRoot
  $script = Join-Path $PSScriptRoot 'caspit-update.ps1'
  if (-not (Test-Path -LiteralPath (Join-Path $ext 'manifest.json')) -or -not (Test-Path -LiteralPath $script)) {
    Say 'לא נמצאו קבצי התוסף ליד הקובץ הזה. יש לחלץ קודם את קובץ ה-zip של התוסף לתיקייה, ולהפעיל את install-auto-update.cmd מתוכה.' $true
    exit 1
  }
  $user = "$env:USERDOMAIN\$env:USERNAME"
  $arg = '-NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + $script + '" -Target "' + $ext + '"'
  $act = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $arg -WorkingDirectory $ext
  $t1 = New-ScheduledTaskTrigger -Daily -At '02:30'
  $t2 = New-ScheduledTaskTrigger -AtLogOn -User $user
  $t2.Delay = 'PT2M'
  $set = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Minutes 30) -MultipleInstances IgnoreNew
  $pri = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited
  Register-ScheduledTask -TaskName 'LargePami Caspit Update' -Action $act -Trigger @($t1, $t2) -Settings $set -Principal $pri -Force | Out-Null
  Start-ScheduledTask -TaskName 'LargePami Caspit Update'
  Say ("העדכון האוטומטי הותקן.`n`nכל לילה ב-02:30 (וגם אחרי הדלקת המחשב) המחשב בודק אם יש גרסה חדשה של התוסף, מתקין אותה, והתוסף נטען מחדש לבד.`nאם העדכון ייכשל – תגיע התראה למנהל באפליקציה.`n`nתיקיית התוסף: " + $ext) $false
  exit 0
} catch {
  Say ('ההתקנה נכשלה: ' + $_.Exception.Message + "`n`nאפשר לנסות שוב: קליק ימני על install-auto-update.cmd ← הפעל כמנהל.") $true
  exit 1
}
