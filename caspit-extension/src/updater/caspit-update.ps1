# Large Pami - Caspit extension auto-update (0.1.7). Runs from Windows Task Scheduler (installed by install-auto-update.cmd).
# 1. Finds the newest release caspit-ext-v<x.y.z> of the public repo on GitHub.
# 2. Newer than the installed manifest.json? Downloads caspit-extension-<x.y.z>.zip, checks its SHA-256 against the
#    digest GitHub publishes for the asset, checks that the extension key (= extension id) is unchanged and the version matches.
# 3. Replaces the files of the extension folder (manifest.json last) and writes upd.json last:
#    { v, at, ok, ver (version on disk), err, fails (failures in a row) }.
# The extension reads upd.json, reloads itself when it is safe, and reports the status to the server (alerts to the manager).
# Never touches anything outside the extension folder and a temp folder. ASCII only (Windows PowerShell 5.1).
param([Parameter(Mandatory = $true)][string]$Target)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$Repo = 'nati59029-a11y/large-pami-android'
$Agent = 'large-pami-caspit-updater'
$UpdFile = Join-Path $Target 'upd.json'
$cur = $null

function Read-Json([string]$p) { return (Get-Content -LiteralPath $p -Raw -Encoding UTF8 | ConvertFrom-Json) }
function Write-Upd([bool]$ok, [string]$ver, [string]$err) {
  $fails = 0
  if (-not $ok) {
    try { $fails = [int](Read-Json $UpdFile).fails } catch { $fails = 0 }
    $fails = $fails + 1
  }
  $o = [ordered]@{ v = 1; at = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds(); ok = $ok; ver = $ver; err = $err; fails = $fails }
  $tmp = $UpdFile + '.tmp'
  [IO.File]::WriteAllText($tmp, ($o | ConvertTo-Json -Compress), (New-Object Text.UTF8Encoding $false))
  Move-Item -LiteralPath $tmp -Destination $UpdFile -Force
}

try {
  [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
  $mf = Join-Path $Target 'manifest.json'
  if (-not (Test-Path -LiteralPath $mf)) { throw 'no-manifest' }
  $cur = Read-Json $mf
  $rels = Invoke-RestMethod -Uri "https://api.github.com/repos/$Repo/releases?per_page=50" -Headers @{ 'User-Agent' = $Agent; 'Accept' = 'application/vnd.github+json' } -UseBasicParsing -TimeoutSec 60
  $best = $null; $bestV = $null
  foreach ($r in @($rels)) {
    if ($r.draft -or $r.prerelease) { continue }
    if ([string]$r.tag_name -match '^caspit-ext-v(\d{1,4})\.(\d{1,4})\.(\d{1,4})$') {
      $v = New-Object Version ([int]$Matches[1]), ([int]$Matches[2]), ([int]$Matches[3])
      if ($null -eq $bestV -or $v -gt $bestV) { $bestV = $v; $best = $r }
    }
  }
  if ($null -eq $best) { throw 'no-release' }
  if ([string]$cur.version -notmatch '^\d{1,4}\.\d{1,4}\.\d{1,4}$') { throw 'bad-local-version' }
  $curV = [Version][string]$cur.version
  if ($bestV -le $curV) { Write-Upd $true ([string]$cur.version) ''; exit 0 }
  $verS = '{0}.{1}.{2}' -f $bestV.Major, $bestV.Minor, $bestV.Build
  $asset = @($best.assets | Where-Object { $_.name -eq ('caspit-extension-' + $verS + '.zip') })[0]
  if ($null -eq $asset) { throw 'no-asset' }
  if ([string]$asset.digest -notmatch '^sha256:([0-9a-f]{64})$') { throw 'no-digest' }
  $want = $Matches[1]
  $url = [string]$asset.browser_download_url
  if ($url -notmatch '^https://github\.com/nati59029-a11y/large-pami-android/releases/download/') { throw 'bad-url' }
  $work = Join-Path ([IO.Path]::GetTempPath()) ('lp-caspit-' + [Guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Path $work | Out-Null
  try {
    $zip = Join-Path $work 'ext.zip'
    $x = Join-Path $work 'x'
    Invoke-WebRequest -Uri $url -OutFile $zip -Headers @{ 'User-Agent' = $Agent } -UseBasicParsing -TimeoutSec 300
    if ((Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash.ToLowerInvariant() -ne $want) { throw 'bad-hash' }
    Expand-Archive -LiteralPath $zip -DestinationPath $x
    $nm = Read-Json (Join-Path $x 'manifest.json')
    if ([string]$nm.key -ne [string]$cur.key -or [string]$nm.version -ne $verS) { throw 'bad-manifest' }
    # all files except manifest.json / upd.json (robocopy /MIR also removes files that are not in the new version);
    # robocopy exit code 0-7 = success, 8+ = failure
    $null = robocopy $x $Target /MIR /XF manifest.json upd.json upd.json.tmp /R:3 /W:5 /NFL /NDL /NJH /NJS /NP
    if ($LASTEXITCODE -ge 8) { throw ('copy-failed-' + $LASTEXITCODE) }
    Copy-Item -LiteralPath (Join-Path $x 'manifest.json') -Destination $mf -Force
  } finally {
    Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
  }
  Write-Upd $true $verS ''
  exit 0
} catch {
  $msg = ([string]$_.Exception.Message) -replace '[^\w .:/()-]', ''
  if ($msg.Length -gt 120) { $msg = $msg.Substring(0, 120) }
  $v = ''
  if ($null -ne $cur) { $v = [string]$cur.version }
  try { Write-Upd $false $v $msg } catch { }
  exit 1
}
