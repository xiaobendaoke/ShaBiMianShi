param(
  [string]$ProjectRoot = (Split-Path -Parent $PSScriptRoot)
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

function Decode-Utf8([string]$Base64) {
  return [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String($Base64))
}

# Pure-ASCII UTF-8 payloads so Git CRLF/encoding filters never corrupt Chinese messages on Windows PowerShell 5.1
$MsgNotPacked   = Decode-Utf8 '5bCa5pyq5om+5Yiw54us56uL5bqT55So5YyF77yM6K+35YWI5Zyo6K+l55uu5b2V5omn6KGM77yaIG5wbSBydW4gcGFjazp3aW4='
$MsgStalePrefix = Decode-Utf8 '5o+Q56S677ya5qOA5rWL5Yiw5rqQ56CB5q+U5b2T5YmN5bqT55So5YyF5pu05paw77yI5L6L5aaC77ya'
$MsgStaleSuffix = Decode-Utf8 '77yJ77yM5aaC6ZyA5pyA5paw5pS55Yqo6K+35YWI6L+Q6KGMIG5wbSBydW4gcGFjay4='

$Root = [System.IO.Path]::GetFullPath($ProjectRoot.TrimEnd('\', '/'))

# Optional portable symlink / junction self-healing if personal\app-data is already configured as a symlink
$PersonalData = Join-Path $Root 'personal\app-data'
$LegacyAppDataName = [System.Text.Encoding]::UTF8.GetString([byte[]]@(0xE9,0x9D,0xA2,0xE8,0xAF,0x95,0xE7,0x8B,0x97,0x2D,0xE7,0x8B,0xAC,0xE7,0xAB,0x8B,0xE7,0x89,0x88))
$AppDataTarget = Join-Path $env:APPDATA $LegacyAppDataName
if ((Test-Path -LiteralPath $AppDataTarget) -and ((Get-Item -LiteralPath $AppDataTarget -Force).Attributes -band [System.IO.FileAttributes]::ReparsePoint)) {
  if (Test-Path -LiteralPath $PersonalData) {
    $currentTarget = (Get-Item -LiteralPath $AppDataTarget -Force).Target
    if ($currentTarget -and ($currentTarget -ne $PersonalData)) {
      Remove-Item -LiteralPath $AppDataTarget -Force
      New-Item -ItemType Junction -Path $AppDataTarget -Target $PersonalData | Out-Null
    }
  }
}

$ExePath = $null
$ManifestPath = Join-Path $Root 'release\latest-build-win.json'
if (Test-Path -LiteralPath $ManifestPath) {
  try {
    $Manifest = Get-Content -LiteralPath $ManifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($Manifest.path -and (Test-Path -LiteralPath $Manifest.path)) {
      $ExePath = $Manifest.path
    }
  } catch {}
}

if (-not $ExePath) {
  $AppExeName = [System.Text.Encoding]::UTF8.GetString([byte[]]@(0xE5,0x82,0xBB,0xE9,0x80,0xBC,0xE9,0x9D,0xA2,0xE8,0xAF,0x95,0x2E,0x65,0x78,0x65))
  $FallbackExe = Join-Path $Root (Join-Path 'release\win-unpacked' $AppExeName)
  if (Test-Path -LiteralPath $FallbackExe) {
    $ExePath = $FallbackExe
  }
}

if (-not $ExePath -or -not (Test-Path -LiteralPath $ExePath)) {
  Write-Host $MsgNotPacked -ForegroundColor Yellow
  exit 1
}

$ExeTime = (Get-Item -LiteralPath $ExePath).LastWriteTimeUtc
$WatchTargets = @('src', 'native', 'vite.config.ts', 'package.json')
$NewerFile = $null
foreach ($Rel in $WatchTargets) {
  $Full = Join-Path $Root $Rel
  if (-not (Test-Path -LiteralPath $Full)) { continue }
  $Item = Get-Item -LiteralPath $Full
  if ($Item.PSIsContainer) {
    $Found = Get-ChildItem -LiteralPath $Full -Recurse -File | Where-Object { $_.LastWriteTimeUtc -gt $ExeTime } | Select-Object -First 1
    if ($Found) { $NewerFile = $Found.FullName.Substring($Root.Length + 1); break }
  } elseif ($Item.LastWriteTimeUtc -gt $ExeTime) {
    $NewerFile = $Rel
    break
  }
}

if ($NewerFile) {
  Write-Host "$MsgStalePrefix$NewerFile$MsgStaleSuffix" -ForegroundColor Cyan
  Start-Sleep -Milliseconds 1200
}

Start-Process -FilePath $ExePath -WorkingDirectory (Split-Path -Parent $ExePath)
exit 0
