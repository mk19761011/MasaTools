param(
  [string]$Source = "",
  [string]$Bucket = "masatools-private",
  [string]$Prefix = "",
  [string]$WranglerPath = "",
  [switch]$Force,
  [switch]$DryRun
)

# 非公開アプリを Cloudflare R2 にアップロードする。
#
#   private-uploads\ に置いたファイルが R2 バケットに入り、
#   /admin/ の「非公開アプリ」一覧に自動で並ぶ。
#
# 前提: wrangler がインストール済みで `wrangler login` 済みであること。
#   npm install -g wrangler@3.114.17
#   wrangler login
#
# 内容が変わっていないファイルは SHA-256 で判定してスキップする。
# 全部やり直したいときは -Force を付ける。

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = (Resolve-Path (Join-Path $scriptDir "..")).Path

if ([string]::IsNullOrWhiteSpace($Source)) {
  $Source = Join-Path $repoRoot "private-uploads"
}

$stateFile = Join-Path $repoRoot ".r2-upload-state.json"

$contentTypes = @{
  ".apk"  = "application/vnd.android.package-archive"
  ".exe"  = "application/octet-stream"
  ".msi"  = "application/octet-stream"
  ".aab"  = "application/octet-stream"
  ".zip"  = "application/zip"
  ".7z"   = "application/x-7z-compressed"
  ".csv"  = "text/csv; charset=utf-8"
  ".md"   = "text/markdown; charset=utf-8"
  ".pdf"  = "application/pdf"
  ".txt"  = "text/plain; charset=utf-8"
  ".json" = "application/json; charset=utf-8"
  ".png"  = "image/png"
  ".jpg"  = "image/jpeg"
  ".jpeg" = "image/jpeg"
  ".svg"  = "image/svg+xml"
}

function Resolve-Wrangler {
  if (-not [string]::IsNullOrWhiteSpace($WranglerPath)) {
    return $WranglerPath
  }
  $found = Get-Command wrangler -ErrorAction SilentlyContinue
  if ($found) {
    # npm のシムは .ps1 と .cmd の両方が作られる。終了コードが確実に伝わる .cmd を優先する。
    $cmdShim = [System.IO.Path]::ChangeExtension($found.Source, ".cmd")
    if (Test-Path $cmdShim) {
      return $cmdShim
    }
    return $found.Source
  }

  # npm のグローバル bin が PATH に反映されていない直後でも使えるよう、
  # npm の配置先にある Windows 用シムも確認する。
  $npm = Get-Command npm -ErrorAction SilentlyContinue
  if ($npm) {
    try {
      $npmCmd = [System.IO.Path]::ChangeExtension($npm.Source, ".cmd")
      if (-not (Test-Path $npmCmd)) {
        $npmCmd = $npm.Source
      }
      $npmPrefix = ((& $npmCmd prefix -g 2>$null) | Select-Object -First 1).Trim()
      if (-not [string]::IsNullOrWhiteSpace($npmPrefix)) {
        $npmWrangler = Join-Path $npmPrefix "wrangler.cmd"
        if (Test-Path $npmWrangler) {
          return $npmWrangler
        }
      }
    } catch {
      # 下の案内を表示するため、npm の照会失敗はここでは握りつぶす。
    }
  }

  Write-Host ""
  Write-Host "wrangler が見つかりません。次の 2 つを実行してから、もう一度このスクリプトを動かしてください。" -ForegroundColor Red
  Write-Host ""
  Write-Host "    npm install -g wrangler@3.114.17"
  Write-Host "    wrangler login"
  Write-Host ""
  Write-Host "wrangler login はブラウザが開き、Cloudflare アカウントでの承認を求められます。" -ForegroundColor Yellow
  Write-Host "（何が送信されるかだけ見たい場合は -DryRun を付ければ wrangler なしで確認できます）" -ForegroundColor Yellow
  exit 1
}

# wrangler 4 は `--remote` を要求するが、3 には存在せず既定でリモートに書き込む。
# どちらでも動くようにメジャーバージョンを見て切り替える。
function Get-WranglerMajor {
  param([string]$Wrangler)

  $output = & $Wrangler --version
  $text = ($output | Out-String)

  if ($LASTEXITCODE -ne 0 -or $text -notmatch "(\d+)\.\d+\.\d+") {
    Write-Host ""
    Write-Host "wrangler を実行できませんでした。" -ForegroundColor Red
    if (-not [string]::IsNullOrWhiteSpace($text)) {
      Write-Host $text.Trim()
    }
    $nodeVersion = ""
    if (Get-Command node -ErrorAction SilentlyContinue) {
      $nodeVersion = (& node --version)
    }
    Write-Host ""
    Write-Host "現在の Node: $nodeVersion" -ForegroundColor Yellow
    Write-Host "wrangler 4 系は Node 22 以上が必要です。Node を上げるか、wrangler 3 系を入れてください。" -ForegroundColor Yellow
    Write-Host "    npm install -g wrangler@3" -ForegroundColor Yellow
    exit 1
  }

  return [int]$Matches[1]
}

function Read-State {
  $state = @{}
  if (Test-Path $stateFile) {
    try {
      $loaded = Get-Content $stateFile -Raw -Encoding UTF8 | ConvertFrom-Json
      foreach ($property in $loaded.PSObject.Properties) {
        $state[$property.Name] = $property.Value
      }
    } catch {
      Write-Host "アップロード履歴を読めなかったため、全ファイルを対象にします。" -ForegroundColor Yellow
    }
  }
  return $state
}

function Write-State {
  param([hashtable]$State)
  $State | ConvertTo-Json -Depth 5 | Out-File -FilePath $stateFile -Encoding utf8
}

function Get-ContentType {
  param([string]$Extension)
  $key = $Extension.ToLowerInvariant()
  if ($contentTypes.ContainsKey($key)) {
    return $contentTypes[$key]
  }
  return "application/octet-stream"
}

function Format-Size {
  param([long]$Bytes)
  if ($Bytes -lt 1024) { return "$Bytes B" }
  $units = @("KB", "MB", "GB")
  $value = [double]$Bytes
  $unit = -1
  while ($value -ge 1024 -and $unit -lt ($units.Count - 1)) {
    $value = $value / 1024
    $unit = $unit + 1
  }
  return ("{0:N1} {1}" -f $value, $units[$unit])
}

# --- 準備 -------------------------------------------------------------

if (-not (Test-Path $Source)) {
  New-Item -ItemType Directory -Path $Source -Force | Out-Null
  Write-Host "アップロード用フォルダを作成しました: $Source" -ForegroundColor Yellow
  Write-Host "ここにアプリ本体を置いてから、もう一度実行してください。" -ForegroundColor Yellow
  exit 0
}

$sourceRoot = (Resolve-Path $Source).Path

# ドット・アンダースコアで始まるものは説明書きや作業ファイルとみなして送らない
$files = Get-ChildItem -Path $sourceRoot -File -Recurse |
  Where-Object { $_.Name -notmatch '^[._]' -and $_.Name -ne "Thumbs.db" -and $_.Name -ne "desktop.ini" }

if ($files.Count -eq 0) {
  Write-Host "アップロード対象がありません: $sourceRoot" -ForegroundColor Yellow
  exit 0
}

$wrangler = ""
$wranglerMajor = 0
if (-not $DryRun) {
  $wrangler = Resolve-Wrangler
  $wranglerMajor = Get-WranglerMajor -Wrangler $wrangler
}

Write-Host "バケット : $Bucket"
Write-Host "元フォルダ: $sourceRoot"
if ($DryRun) {
  Write-Host "（DryRun: 実際には送信しません）" -ForegroundColor Yellow
}
Write-Host ""

# このフォルダは .gitignore 済みだが、取り違えて公開リポジトリに入れないよう毎回確かめる。
# git は 1 回だけ呼ぶ（ネイティブコマンドの stderr を握りつぶすと 5.1 では別の問題が出るため）。
$tracked = @()
if ($sourceRoot.ToLowerInvariant().StartsWith($repoRoot.ToLowerInvariant())) {
  $relativeRoot = $sourceRoot.Substring($repoRoot.Length).Trim("\", "/") -replace "\\", "/"
  if ([string]::IsNullOrWhiteSpace($relativeRoot)) {
    $relativeRoot = "."
  }
  try {
    $tracked = @(& git -C $repoRoot ls-files -- $relativeRoot)
  } catch {
    $tracked = @()
  }

  foreach ($file in $files) {
    $repoRelative = $file.FullName.Substring($repoRoot.Length).TrimStart("\", "/") -replace "\\", "/"
    if ($tracked -contains $repoRelative) {
      Write-Host "  警告  $repoRelative は Git の管理下にあります。公開リポジトリに含まれていないか確認してください。" -ForegroundColor Red
    }
  }
}

$state = Read-State
$uploaded = 0
$skipped = 0
$failed = 0

foreach ($file in $files) {
  $relative = $file.FullName.Substring($sourceRoot.Length).TrimStart("\", "/")
  $key = $relative -replace "\\", "/"
  if (-not [string]::IsNullOrWhiteSpace($Prefix)) {
    $key = ($Prefix.Trim("/") + "/" + $key)
  }

  $hash = (Get-FileHash -Path $file.FullName -Algorithm SHA256).Hash
  $stateKey = "$Bucket/$key"
  $known = $null
  if ($state.ContainsKey($stateKey)) {
    $known = $state[$stateKey]
  }

  if (-not $Force -and $known -and $known.sha256 -eq $hash) {
    Write-Host "  スキップ  $key （変更なし）" -ForegroundColor DarkGray
    $skipped = $skipped + 1
    continue
  }

  $size = Format-Size $file.Length
  $contentType = Get-ContentType $file.Extension

  if ($DryRun) {
    Write-Host "  送信予定  $key  ($size, $contentType)" -ForegroundColor Cyan
    $uploaded = $uploaded + 1
    continue
  }

  Write-Host "  送信中    $key  ($size)" -ForegroundColor Cyan

  $putArgs = @("r2", "object", "put", "$Bucket/$key", "--file", $file.FullName, "--content-type", $contentType)
  if ($wranglerMajor -ge 4) {
    $putArgs += "--remote"
  }
  & $wrangler @putArgs

  if ($LASTEXITCODE -ne 0) {
    Write-Host "  失敗      $key" -ForegroundColor Red
    $failed = $failed + 1
    continue
  }

  $state[$stateKey] = [pscustomobject]@{
    sha256     = $hash
    size       = $file.Length
    uploadedAt = (Get-Date).ToString("s")
  }
  $uploaded = $uploaded + 1
}

if (-not $DryRun) {
  Write-State -State $state
}

Write-Host ""
Write-Host ("完了: 送信 {0} 件 / スキップ {1} 件 / 失敗 {2} 件" -f $uploaded, $skipped, $failed) -ForegroundColor Green
Write-Host "確認: https://masatools.pages.dev/admin/" -ForegroundColor Green

if ($failed -gt 0) {
  exit 1
}
