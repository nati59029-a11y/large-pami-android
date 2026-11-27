<#
  Large Pami - edible-ink print helper (edb-helper) for Windows PowerShell 5.1.
  No installs, no admin. Listens ONLY on 127.0.0.1 (loopback) and accepts requests ONLY from the app's own origins.
  The app (station mode on the labels PC) sends A4 page images (PNG, 300 DPI); the helper prints them silently to the
  printer whose name contains the configured text (default "L130"), at exact size (210x297 mm, no scaling, margins 0).

  Usage:
    edb-helper.ps1                 run the helper (single instance; normally started hidden by edb-helper.bat)
    edb-helper.ps1 -Setup          open the printer driver's own Preferences dialog; the chosen settings
                                   (high quality, paper type...) are saved to devmode.bin and used for every print
  Optional: -Port 17891 -Printer L130

  Endpoints:
    GET  /status[?p=<name part>]   -> {ok, v, printers[], chosen, saved, port}
    POST /print?p=<name part>&s=<size1,size2,...>&name=<job name>
         body = the PNG files one after another (Content-Type: application/octet-stream), sizes in "s"
         -> {ok, job, printer, pages} immediately (asynchronous), or {ok:false, err:'no-printer'|'bad-request'|'too-big'|'bad-png', msg}
         The pages are then spooled to the Windows print queue. The job is NEVER cancelled because of paper-out or a printer
         error: it stays in the Windows queue and continues by itself when the problem is fixed.
    GET  /job/<id>                 -> {ok, id, state, code, raw, printer, pages, age, wait, why}
         state: 'printing' | 'waiting' (printer problem - see code) | 'done' | 'err'
         code : spool, printing, paper-out, jam, door, ink, offline, paused, error, done, cancelled (in the Windows queue),
                canceled (POST /job/<id>/cancel), timeout, print-failed
         raw  : the Windows status text (job status + printer status numbers), for the 'error' message
         done = the job left the Windows print queue without an error (or is marked Printed/Complete).
         Timeout: waiting for a printer problem (paper-out...) for more than 2 hours, or 3 hours in total -> the job is
         removed from the queue and reported as err/timeout.
         why  : on timeout - the printer problem that was waiting (paper-out, jam...) or 'total' (3 hours in total).
    POST /job/<id>/cancel          (round 5) cancel the job: it is removed from the Windows print queue (Win32_PrintJob)
         and reported as err/canceled. Same origin check as /print, no body. -> {ok, ..., removed: true|false}
         A job that already finished (done / err) is not changed.
         The app translates code -> Hebrew text and instructions (this script stays ASCII only).
    OPTIONS *                      CORS / Private Network Access preflight
  Files next to this script: devmode.bin (saved printer settings), edb-helper.log (small log).
  This file is intentionally ASCII only (Windows PowerShell 5.1 reads BOM-less scripts in the ANSI code page).
#>
param(
  [switch]$Setup,
  [int]$Port = 17891,
  [string]$Printer = 'L130'
)
$ErrorActionPreference = 'Stop'
$Dir = Split-Path -Parent $MyInvocation.MyCommand.Path
$DevFile = Join-Path $Dir 'devmode.bin'
$LogFile = Join-Path $Dir 'edb-helper.log'
$MaxBody = 120MB
$MaxPages = 10
# The app's origins on the labels PC: the desktop site (Firebase Hosting) only. The phone app cannot reach this PC's
# 127.0.0.1 at all (phones send through the cloud queue), so no localhost / WebView origins are accepted.
$Allowed = @(
  'https://businessmanagement-app.web.app',
  'https://businessmanagement-app.firebaseapp.com'
)
$Jobs = @{}                                  # helper job id -> state (in memory only)
$WaitMax = [TimeSpan]::FromHours(2)          # max wait while the printer reports a problem (paper-out, jam...)
$JobMax = [TimeSpan]::FromHours(3)           # max total time of one job

Add-Type -AssemblyName System.Drawing
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class EdbWin {
  [DllImport("winspool.drv", CharSet = CharSet.Unicode, SetLastError = true)]
  public static extern bool OpenPrinter(string pPrinterName, out IntPtr phPrinter, IntPtr pDefault);
  [DllImport("winspool.drv", SetLastError = true)]
  public static extern bool ClosePrinter(IntPtr hPrinter);
  [DllImport("winspool.drv", CharSet = CharSet.Unicode, SetLastError = true)]
  public static extern int DocumentProperties(IntPtr hWnd, IntPtr hPrinter, string pDeviceName, IntPtr pDevModeOutput, IntPtr pDevModeInput, int fMode);
  [DllImport("kernel32.dll")] public static extern IntPtr GlobalLock(IntPtr hMem);
  [DllImport("kernel32.dll")] public static extern bool GlobalUnlock(IntPtr hMem);
  [DllImport("kernel32.dll")] public static extern IntPtr GlobalFree(IntPtr hMem);
  [DllImport("kernel32.dll")] public static extern IntPtr GlobalAlloc(uint uFlags, UIntPtr dwBytes);
}
'@

function Log([string]$m) {
  try {
    if ((Test-Path $LogFile) -and ((Get-Item $LogFile).Length -gt 1MB)) { Remove-Item $LogFile -Force }
    Add-Content -Path $LogFile -Value ((Get-Date).ToString('yyyy-MM-dd HH:mm:ss') + '  ' + $m)
  } catch { }
}

function Get-Printers { @([System.Drawing.Printing.PrinterSettings]::InstalledPrinters | ForEach-Object { [string]$_ }) }

# First installed printer whose name contains $part (case-insensitive); empty part -> configured default.
function Find-Printer([string]$part) {
  if ([string]::IsNullOrWhiteSpace($part)) { $part = $Printer }
  foreach ($p in Get-Printers) { if ($p.IndexOf($part, [StringComparison]::OrdinalIgnoreCase) -ge 0) { return $p } }
  return $null
}

# Saved DEVMODE is valid only for the same printer (dmDeviceName, first 32 UTF-16 chars) and with a consistent size.
function Read-DevMode([string]$name) {
  if (-not (Test-Path $DevFile)) { return $null }
  $b = [System.IO.File]::ReadAllBytes($DevFile)
  if ($b.Length -lt 72) { return $null }
  $dev = [System.Text.Encoding]::Unicode.GetString($b, 0, 64).TrimEnd([char]0)
  $size = [BitConverter]::ToUInt16($b, 68) + [BitConverter]::ToUInt16($b, 70)
  if ($size -ne $b.Length) { Log "devmode.bin ignored: size $size <> $($b.Length)"; return $null }
  $want = if ($name.Length -gt 31) { $name.Substring(0, 31) } else { $name }
  if (-not $dev.StartsWith($want, [StringComparison]::OrdinalIgnoreCase) -and -not $want.StartsWith($dev, [StringComparison]::OrdinalIgnoreCase)) { Log "devmode.bin ignored: saved for '$dev'"; return $null }
  return ,$b
}

function Run-Setup {
  Add-Type -AssemblyName System.Windows.Forms
  $name = Find-Printer $Printer
  if (-not $name) {
    [System.Windows.Forms.MessageBox]::Show("Printer containing '$Printer' was not found.`r`nPrinters: " + ((Get-Printers) -join ', '), 'edb-helper') | Out-Null
    return
  }
  $ps = New-Object System.Drawing.Printing.PrinterSettings
  $ps.PrinterName = $name
  $saved = Read-DevMode $name
  if ($saved) {
    # start the dialog from the previously saved settings
    $h0 = [EdbWin]::GlobalAlloc(2, [UIntPtr]::new([uint64]$saved.Length)); $p0 = [EdbWin]::GlobalLock($h0)
    [System.Runtime.InteropServices.Marshal]::Copy($saved, 0, $p0, $saved.Length); [EdbWin]::GlobalUnlock($h0) | Out-Null
    $ps.SetHdevmode($h0); [EdbWin]::GlobalFree($h0) | Out-Null
  }
  $hIn = $ps.GetHdevmode()
  $pIn = [EdbWin]::GlobalLock($hIn)
  $hPr = [IntPtr]::Zero
  $out = [IntPtr]::Zero
  $form = New-Object System.Windows.Forms.Form
  $form.TopMost = $true; $form.ShowInTaskbar = $false; $form.StartPosition = 'CenterScreen'; $form.Size = New-Object System.Drawing.Size(1, 1)
  $form.Show(); $form.Activate()
  try {
    if (-not [EdbWin]::OpenPrinter($name, [ref]$hPr, [IntPtr]::Zero)) { throw "OpenPrinter failed for '$name'" }
    $need = [EdbWin]::DocumentProperties([IntPtr]::Zero, $hPr, $name, [IntPtr]::Zero, [IntPtr]::Zero, 0)
    if ($need -le 0) { throw 'DocumentProperties (size) failed' }
    $out = [System.Runtime.InteropServices.Marshal]::AllocHGlobal($need)
    # DM_IN_BUFFER (8) | DM_IN_PROMPT (4) | DM_OUT_BUFFER (2): show the driver's own Preferences dialog
    $r = [EdbWin]::DocumentProperties($form.Handle, $hPr, $name, $out, $pIn, 14)
    if ($r -eq 1) {
      $len = [BitConverter]::ToUInt16([byte[]]@([System.Runtime.InteropServices.Marshal]::ReadByte($out, 68), [System.Runtime.InteropServices.Marshal]::ReadByte($out, 69)), 0) +
             [BitConverter]::ToUInt16([byte[]]@([System.Runtime.InteropServices.Marshal]::ReadByte($out, 70), [System.Runtime.InteropServices.Marshal]::ReadByte($out, 71)), 0)
      if ($len -le 0 -or $len -gt $need) { $len = $need }
      $bytes = New-Object byte[] $len
      [System.Runtime.InteropServices.Marshal]::Copy($out, $bytes, 0, $len)
      [System.IO.File]::WriteAllBytes($DevFile, $bytes)
      Log "setup: saved settings for '$name' ($len bytes)"
      [System.Windows.Forms.MessageBox]::Show($form, "Saved. Printer: $name`r`nEvery edible print will use these settings.", 'edb-helper') | Out-Null
    } else {
      [System.Windows.Forms.MessageBox]::Show($form, 'Cancelled - nothing was changed.', 'edb-helper') | Out-Null
    }
  } finally {
    if ($out -ne [IntPtr]::Zero) { [System.Runtime.InteropServices.Marshal]::FreeHGlobal($out) }
    if ($hPr -ne [IntPtr]::Zero) { [EdbWin]::ClosePrinter($hPr) | Out-Null }
    [EdbWin]::GlobalUnlock($hIn) | Out-Null; [EdbWin]::GlobalFree($hIn) | Out-Null
    $form.Close()
  }
}

# Prints all pages in one job: A4, margins 0, each image drawn at exactly 210x297 mm from the physical page corner.
function Print-Pages([string]$name, [object[]]$images, [string]$job) {
  $doc = New-Object System.Drawing.Printing.PrintDocument
  $doc.PrinterSettings.PrinterName = $name
  if (-not $doc.PrinterSettings.IsValid) { throw "printer not valid: $name" }
  $doc.DocumentName = $job
  $doc.PrintController = New-Object System.Drawing.Printing.StandardPrintController  # no "Printing..." window
  $dm = Read-DevMode $name
  if ($dm) {
    $h = [EdbWin]::GlobalAlloc(2, [UIntPtr]::new([uint64]$dm.Length)); $p = [EdbWin]::GlobalLock($h)
    [System.Runtime.InteropServices.Marshal]::Copy($dm, 0, $p, $dm.Length); [EdbWin]::GlobalUnlock($h) | Out-Null
    try { $doc.PrinterSettings.SetHdevmode($h); $doc.DefaultPageSettings.SetHdevmode($h) } finally { [EdbWin]::GlobalFree($h) | Out-Null }
  } else {
    $hi = $doc.PrinterSettings.PrinterResolutions | Where-Object { $_.Kind -eq [System.Drawing.Printing.PrinterResolutionKind]::High } | Select-Object -First 1
    if ($hi) { $doc.DefaultPageSettings.PrinterResolution = $hi }
  }
  $a4 = $doc.PrinterSettings.PaperSizes | Where-Object { $_.Kind -eq [System.Drawing.Printing.PaperKind]::A4 } | Select-Object -First 1
  if ($a4) { $doc.DefaultPageSettings.PaperSize = $a4 }
  $doc.DefaultPageSettings.Landscape = $false
  $doc.DefaultPageSettings.Margins = New-Object System.Drawing.Printing.Margins(0, 0, 0, 0)
  $doc.OriginAtMargins = $false
  $script:edbPages = $images
  $script:edbIdx = 0
  $doc.add_PrintPage({
    param($s, $e)
    $g = $e.Graphics
    $g.PageUnit = [System.Drawing.GraphicsUnit]::Millimeter
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    # origin is the printable-area corner: move back by the hard margins (1/100 inch) to the physical corner
    $g.TranslateTransform(-[single]($e.PageSettings.HardMarginX * 0.254), -[single]($e.PageSettings.HardMarginY * 0.254))
    $img = $script:edbPages[$script:edbIdx]
    $g.DrawImage($img, (New-Object System.Drawing.RectangleF(0, 0, 210, 297)))
    $script:edbIdx++
    $e.HasMorePages = ($script:edbIdx -lt $script:edbPages.Count)
  })
  try { $doc.Print() } finally { $doc.Dispose() }
}

# ---------------- job tracking (Windows print queue + printer state, via WMI / CIM) ----------------
function New-JobId {
  $b = New-Object byte[] 9
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create(); $rng.GetBytes($b); $rng.Dispose()
  return (($b | ForEach-Object { $_.ToString('x2') }) -join '')
}

function Set-JobEnd($j, [string]$state, [string]$code) { $j.state = $state; $j.code = $code; $j.end = Get-Date; Log "job $($j.id): $state/$code $($j.raw)" }

# Win32_PrintJob.StatusMask: 1 Paused, 2 Error, 4 Deleting, 8 Spooling, 16 Printing, 32 Offline, 64 PaperOut, 128 Printed,
#   256 Deleted, 512 BlockedDevQ, 1024 UserInterventionRequired, 2048 Restart, 4096 Complete.
# Win32_Printer: PrinterStatus (7 Offline), DetectedErrorState / ExtendedDetectedErrorState (4 No Paper, 6 No Toner/ink,
#   7 Door Open, 8 Jammed, 9 Offline/Service...), ExtendedPrinterStatus (7 Offline, 8 Paused, 9 Error), WorkOffline.
# What the Epson L130 driver really reports here is NOT verified (it may only report a generic error / user intervention).
function Get-Code($pj, $pr) {
  $m = 0; if ($pj) { $m = [int]$pj.StatusMask }
  $det = 0; $xe = 0; $ps = 0; $ext = 0; $off = $false; $pst = 0L
  if ($pr) { $det = [int]$pr.DetectedErrorState; $xe = [int]$pr.ExtendedDetectedErrorState; $ps = [int]$pr.PrinterStatus; $ext = [int]$pr.ExtendedPrinterStatus; $off = [bool]$pr.WorkOffline; $pst = [long]$pr.PrinterState }
  $js = ''; if ($pj -and $pj.JobStatus) { $js = [string]$pj.JobStatus }
  $raw = ("job: $js (mask $m); printer: status $ps, ext $ext, error $det/$xe, state $pst" + $(if ($off) { ', work offline' } else { '' })) -replace '[\x00-\x1f]', ' '
  if ($raw.Length -gt 160) { $raw = $raw.Substring(0, 160) }
  $code = 'printing'
  if (($m -band 64) -or $det -eq 4 -or $xe -eq 4) { $code = 'paper-out' }
  elseif ($det -eq 8 -or $xe -eq 8) { $code = 'jam' }
  elseif ($det -eq 7 -or $xe -eq 7) { $code = 'door' }
  elseif ($det -eq 6 -or $xe -eq 6) { $code = 'ink' }
  elseif (($m -band 32) -or $det -eq 9 -or $ps -eq 7 -or $ext -eq 7 -or $off) { $code = 'offline' }
  elseif (($m -band 1) -or $ext -eq 8) { $code = 'paused' }
  elseif (($m -band 1026) -or $det -eq 10 -or $det -eq 11 -or $ext -eq 9 -or ($xe -ge 9 -and $xe -le 14)) { $code = 'error' }
  return @{ code = $code; raw = $raw; mask = $m }
}

# Called on every GET /job/<id> (the station polls every few seconds while it waits).
function Update-Job($j) {
  if ($j.state -eq 'done' -or $j.state -eq 'err' -or $j.code -eq 'spool') { return }
  $now = Get-Date
  $pj = $null
  try { $pj = @(Get-CimInstance -ClassName Win32_PrintJob -Filter "Document='$($j.doc)'" -ErrorAction Stop) | Select-Object -First 1 }
  catch { $j.raw = 'WMI: ' + $_.Exception.Message; return }   # cannot read the queue now: keep the last state, try again
  if (-not $pj) {
    if ($j.mask -band 260) { Set-JobEnd $j 'err' 'cancelled' } else { Set-JobEnd $j 'done' 'done' }   # 4 Deleting / 256 Deleted
    return
  }
  $m = [int]$pj.StatusMask
  if ($m -band 260) { $j.mask = $m; Set-JobEnd $j 'err' 'cancelled'; return }
  if ($m -band 4224) { $j.mask = $m; Set-JobEnd $j 'done' 'done'; return }   # 128 Printed / 4096 Complete (kept in the queue)
  $pr = $null
  try { $pr = Get-CimInstance -ClassName Win32_Printer -ErrorAction Stop | Where-Object { $_.Name -eq $j.printer } | Select-Object -First 1 } catch { }
  $c = Get-Code $pj $pr
  $j.mask = $m; $j.raw = $c.raw
  if ($c.code -ne $j.code) { Log "job $($j.id): $($c.code) $($c.raw)" }
  $j.code = $c.code
  if ($c.code -eq 'printing') { $j.state = 'printing'; $j.waitSince = $null }
  else { $j.state = 'waiting'; if (-not $j.waitSince) { $j.waitSince = $now } }
  if (($j.waitSince -and ($now - $j.waitSince) -gt $WaitMax) -or (($now - $j.t0) -gt $JobMax)) {
    $j.why = if ($j.waitSince) { $c.code } else { 'total' }
    try { Remove-CimInstance -InputObject $pj -ErrorAction Stop; $j.raw += '; removed from the queue' } catch { $j.raw += '; could not remove from the queue' }
    Set-JobEnd $j 'err' 'timeout'
  }
}

function Job-Json($j) {
  $age = [int]((Get-Date) - $j.t0).TotalSeconds
  $wait = 0; if ($j.waitSince) { $wait = [int]((Get-Date) - $j.waitSince).TotalSeconds }
  return @{ ok = $true; id = $j.id; state = $j.state; code = $j.code; raw = [string]$j.raw; printer = $j.printer; pages = $j.pages; age = $age; wait = $wait; why = [string]$j.why; removed = [bool]$j.removed }
}

# Round 5: cancel by the user (phone or station). Removes every queue entry of this job (the Document name is ours:
# "<name>-<hex id>", only [A-Za-z0-9_.-], so the WMI filter cannot be injected). A finished job is left as it is.
function Cancel-Job($j) {
  if ($j.state -eq 'done' -or $j.state -eq 'err') { return }
  $j.removed = $false
  try {
    foreach ($pj in @(Get-CimInstance -ClassName Win32_PrintJob -Filter "Document='$($j.doc)'" -ErrorAction Stop)) { Remove-CimInstance -InputObject $pj -ErrorAction Stop; $j.removed = $true }
    $j.raw = if ($j.removed) { 'cancelled by the user: removed from the queue' } else { 'cancelled by the user: not in the queue' }
  } catch { $j.raw = 'cancelled by the user: could not remove from the queue - ' + $_.Exception.Message }
  Set-JobEnd $j 'err' 'canceled'
}

function Prune-Jobs {
  $old = (Get-Date).AddHours(-6)
  foreach ($k in @($Jobs.Keys)) { $j = $Jobs[$k]; if ($j.end -and $j.end -lt $old) { $Jobs.Remove($k) } }
  if ($Jobs.Count -gt 50) { foreach ($k in @($Jobs.Keys | Sort-Object { $Jobs[$_].t0 } | Select-Object -First ($Jobs.Count - 50))) { $Jobs.Remove($k) } }
}

# ---------------- minimal HTTP over TcpListener (loopback only) ----------------
$CRLF = [byte[]](13, 10, 13, 10)
function Send-Resp($stream, [int]$code, $obj, [string]$origin, [bool]$pna) {
  $reason = @{ 200 = 'OK'; 204 = 'No Content'; 400 = 'Bad Request'; 403 = 'Forbidden'; 404 = 'Not Found'; 405 = 'Method Not Allowed'; 411 = 'Length Required'; 413 = 'Payload Too Large'; 500 = 'Internal Server Error' }[$code]
  $body = if ($null -ne $obj) { [System.Text.Encoding]::UTF8.GetBytes(($obj | ConvertTo-Json -Compress -Depth 4)) } else { New-Object byte[] 0 }
  $h = "HTTP/1.1 $code $reason`r`nContent-Length: $($body.Length)`r`nConnection: close`r`nCache-Control: no-store`r`nX-Content-Type-Options: nosniff`r`n"
  if ($null -ne $obj) { $h += "Content-Type: application/json; charset=utf-8`r`n" }
  if ($origin) {
    $h += "Access-Control-Allow-Origin: $origin`r`nVary: Origin`r`nAccess-Control-Allow-Methods: GET, POST, OPTIONS`r`nAccess-Control-Allow-Headers: Content-Type`r`nAccess-Control-Max-Age: 600`r`n"
    if ($pna) { $h += "Access-Control-Allow-Private-Network: true`r`n" }
  }
  $hb = [System.Text.Encoding]::ASCII.GetBytes($h + "`r`n")
  $stream.Write($hb, 0, $hb.Length)
  if ($body.Length) { $stream.Write($body, 0, $body.Length) }
  $stream.Flush()
}

function Read-Exact($stream, [byte[]]$buf, [int]$off, [int]$len) {
  while ($len -gt 0) { $n = $stream.Read($buf, $off, $len); if ($n -le 0) { throw 'connection closed' }; $off += $n; $len -= $n }
}

function Parse-Query([string]$q) {
  $r = @{}
  foreach ($kv in $q.Split('&')) { if (-not $kv) { continue }; $i = $kv.IndexOf('='); if ($i -lt 0) { $r[$kv] = '' } else { $r[[Uri]::UnescapeDataString($kv.Substring(0, $i))] = [Uri]::UnescapeDataString($kv.Substring($i + 1).Replace('+', ' ')) } }
  return $r
}

function Handle($client) {
  $client.ReceiveTimeout = 30000; $client.SendTimeout = 30000
  $stream = $client.GetStream()
  # headers: up to 16 KB, until CRLFCRLF
  $hdr = New-Object System.Collections.Generic.List[byte]
  $one = New-Object byte[] 1
  while ($true) {
    if ($stream.Read($one, 0, 1) -le 0) { return }
    $hdr.Add($one[0])
    $c = $hdr.Count
    if ($c -ge 4 -and $hdr[$c - 4] -eq 13 -and $hdr[$c - 3] -eq 10 -and $hdr[$c - 2] -eq 13 -and $hdr[$c - 1] -eq 10) { break }
    if ($c -gt 16384) { Send-Resp $stream 400 @{ ok = $false; err = 'bad-request' } $null $false; return }
  }
  $lines = [System.Text.Encoding]::ASCII.GetString($hdr.ToArray()).Split([string[]]@("`r`n"), [StringSplitOptions]::RemoveEmptyEntries)
  $parts = $lines[0].Split(' ')
  if ($parts.Count -lt 2) { Send-Resp $stream 400 @{ ok = $false; err = 'bad-request' } $null $false; return }
  $method = $parts[0].ToUpperInvariant(); $target = $parts[1]
  $H = @{}
  for ($i = 1; $i -lt $lines.Count; $i++) { $j = $lines[$i].IndexOf(':'); if ($j -gt 0) { $H[$lines[$i].Substring(0, $j).Trim().ToLowerInvariant()] = $lines[$i].Substring($j + 1).Trim() } }
  $path = $target; $query = ''
  $q = $target.IndexOf('?'); if ($q -ge 0) { $path = $target.Substring(0, $q); $query = $target.Substring($q + 1) }
  $Q = Parse-Query $query

  # DNS-rebinding guard: Host must be the loopback address or localhost on our port
  $hostH = [string]$H['host']
  if ($hostH -ne "127.0.0.1:$Port" -and $hostH -ne "localhost:$Port") { Send-Resp $stream 403 @{ ok = $false; err = 'origin' } $null $false; return }
  $origin = [string]$H['origin']
  $okOrigin = $origin -and ($Allowed -contains $origin)
  if ($origin -and -not $okOrigin) { Log "blocked origin: $origin"; Send-Resp $stream 403 @{ ok = $false; err = 'origin' } $null $false; return }
  $ao = if ($okOrigin) { $origin } else { $null }
  $pna = ([string]$H['access-control-request-private-network']) -eq 'true'

  if ($method -eq 'OPTIONS') { Send-Resp $stream 204 $null $ao $pna; return }

  if ($method -eq 'GET' -and $path -match '^/job/([0-9a-f]{18})$') {
    $j = $Jobs[$Matches[1]]
    if (-not $j) { Send-Resp $stream 404 @{ ok = $false; err = 'no-job' } $ao $false; return }
    Update-Job $j
    Send-Resp $stream 200 (Job-Json $j) $ao $false
    return
  }

  if ($method -eq 'POST' -and $path -match '^/job/([0-9a-f]{18})/cancel$') {
    $hid = $Matches[1]
    if (-not $okOrigin) { Send-Resp $stream 403 @{ ok = $false; err = 'origin' } $null $false; return }  # browsers always send Origin here
    $cl = [string]$H['content-length']
    if ($H.ContainsKey('transfer-encoding') -or ($cl -and $cl -ne '0')) { Send-Resp $stream 400 @{ ok = $false; err = 'bad-request' } $ao $false; return }  # no body
    $j = $Jobs[$hid]
    if (-not $j) { Send-Resp $stream 404 @{ ok = $false; err = 'no-job' } $ao $false; return }
    Cancel-Job $j
    Send-Resp $stream 200 (Job-Json $j) $ao $false
    return
  }

  if ($method -eq 'GET' -and $path -eq '/status') {
    $want = if ($Q.ContainsKey('p') -and $Q['p']) { $Q['p'] } else { $Printer }
    $ch = Find-Printer $want
    Send-Resp $stream 200 @{ ok = $true; v = 1; printers = @(Get-Printers); chosen = $ch; saved = [bool]($ch -and (Read-DevMode $ch)); port = $Port } $ao $false
    return
  }

  if ($method -eq 'POST' -and $path -eq '/print') {
    if (-not $okOrigin) { Send-Resp $stream 403 @{ ok = $false; err = 'origin' } $null $false; return }  # browsers always send Origin here
    if ($H.ContainsKey('transfer-encoding')) { Send-Resp $stream 411 @{ ok = $false; err = 'bad-request' } $ao $false; return }
    $len = 0L
    if (-not [long]::TryParse([string]$H['content-length'], [ref]$len) -or $len -le 0) { Send-Resp $stream 411 @{ ok = $false; err = 'bad-request' } $ao $false; return }
    if ($len -gt $MaxBody) { Send-Resp $stream 413 @{ ok = $false; err = 'too-big' } $ao $false; return }
    $sizes = @(); foreach ($s in ([string]$Q['s']).Split(',')) { $n = 0L; if ([long]::TryParse($s, [ref]$n) -and $n -gt 8) { $sizes += $n } else { $sizes = @(); break } }
    $sum = 0L; foreach ($n in $sizes) { $sum += $n }
    if ($sizes.Count -lt 1 -or $sizes.Count -gt $MaxPages -or $sum -ne $len) { Send-Resp $stream 400 @{ ok = $false; err = 'bad-request' } $ao $false; return }
    $client.ReceiveTimeout = 120000
    $body = New-Object byte[] $len
    Read-Exact $stream $body 0 ([int]$len)
    $name = Find-Printer ([string]$Q['p'])
    if (-not $name) { Send-Resp $stream 404 @{ ok = $false; err = 'no-printer'; msg = 'printer not found' } $ao $false; return }
    $sig = [byte[]](137, 80, 78, 71, 13, 10, 26, 10)
    $streams = @(); $images = @()
    try {
      $off = 0
      try {
        foreach ($n in $sizes) {
          for ($k = 0; $k -lt 8; $k++) { if ($body[$off + $k] -ne $sig[$k]) { Send-Resp $stream 400 @{ ok = $false; err = 'bad-png' } $ao $false; return } }
          $ms = [System.IO.MemoryStream]::new($body, $off, [int]$n, $false)
          $streams += $ms
          $images += [System.Drawing.Image]::FromStream($ms)
          $off += [int]$n
        }
      } catch { Send-Resp $stream 400 @{ ok = $false; err = 'bad-png' } $ao $false; return }
      $job = ([string]$Q['name']) -replace '[^A-Za-z0-9_.-]', ''
      if ($job.Length -gt 40) { $job = $job.Substring(0, 40) }
      if (-not $job) { $job = 'edible' }
      # asynchronous: answer with the job id now, then spool (the station polls GET /job/<id>)
      Prune-Jobs
      $hid = New-JobId
      $j = @{ id = $hid; state = 'printing'; code = 'spool'; raw = ''; printer = $name; pages = $images.Count; doc = "$job-$hid"; t0 = (Get-Date); waitSince = $null; end = $null; mask = 0; why = ''; removed = $false }
      $Jobs[$hid] = $j
      Send-Resp $stream 200 @{ ok = $true; job = $hid; printer = $name; pages = $images.Count } $ao $false
      try { $client.Close() } catch { }
      try {
        Print-Pages $name $images $j.doc
        $j.code = 'printing'
        Log "spooled $($images.Count) page(s) on '$name' ($($j.doc))"
      } catch {
        $j.raw = [string]$_.Exception.Message
        Set-JobEnd $j 'err' 'print-failed'
      }
    } finally {
      foreach ($im in $images) { try { $im.Dispose() } catch { } }
      foreach ($ms in $streams) { try { $ms.Dispose() } catch { } }
    }
    return
  }

  if ($path -eq '/status' -or $path -eq '/print' -or $path.StartsWith('/job/')) { Send-Resp $stream 405 @{ ok = $false; err = 'bad-request' } $ao $false; return }
  Send-Resp $stream 404 @{ ok = $false; err = 'bad-request' } $ao $false
}

# ---------------- main ----------------
if ($Setup) { Run-Setup; exit 0 }

$mutex = New-Object System.Threading.Mutex($false, 'Local\LargePamiEdbHelper')
$own = $false
try { $own = $mutex.WaitOne(0) } catch [System.Threading.AbandonedMutexException] { $own = $true }
if (-not $own) { exit 0 }  # already running

$listener = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Loopback, $Port)
try { $listener.Start() } catch { Log "cannot listen on 127.0.0.1:$Port - $($_.Exception.Message)"; exit 1 }
Log "started on http://127.0.0.1:$Port (printer contains '$Printer', saved settings: $([bool](Test-Path $DevFile)))"
try {
  while ($true) {
    $client = $listener.AcceptTcpClient()
    try { Handle $client } catch { Log "request error: $($_.Exception.Message)" } finally { try { $client.Close() } catch { } }
  }
} finally {
  $listener.Stop()
  $mutex.ReleaseMutex()
}
