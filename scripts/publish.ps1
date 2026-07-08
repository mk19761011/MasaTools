param(
  [string]$Message = "",
  [switch]$DryRun
)

$ErrorActionPreference = "Stop"

function Run-Git {
  param(
    [Parameter(Mandatory = $true)]
    [string[]]$Args
  )

  Write-Host "> git $($Args -join ' ')" -ForegroundColor DarkCyan

  if (-not $DryRun) {
    & git @Args
    if ($LASTEXITCODE -ne 0) {
      throw "git command failed: git $($Args -join ' ')"
    }
  }
}

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Resolve-Path (Join-Path $scriptDir "..")
Set-Location $repoRoot

$branch = (& git branch --show-current).Trim()
if ($branch -ne "main") {
  throw "Current branch is '$branch'. Please switch to 'main' before publishing."
}

$remote = (& git remote get-url origin).Trim()
if ($remote -ne "https://github.com/mk19761011/MasaTools.git") {
  throw "Unexpected origin remote: $remote"
}

$status = (& git status --porcelain)
if ([string]::IsNullOrWhiteSpace($status)) {
  Write-Host "No local changes to publish." -ForegroundColor Yellow
  exit 0
}

Run-Git @("pull", "--rebase", "--autostash", "origin", "main")

$status = (& git status --porcelain)
if ([string]::IsNullOrWhiteSpace($status)) {
  Write-Host "No local changes to publish after syncing with origin/main." -ForegroundColor Yellow
  exit 0
}

Run-Git @("add", "-A")

if ([string]::IsNullOrWhiteSpace($Message)) {
  $Message = "Update site $(Get-Date -Format 'yyyy-MM-dd HH:mm')"
}

Run-Git @("commit", "-m", $Message)
Run-Git @("push", "origin", "main")

Write-Host ""
Write-Host "Published. Cloudflare Pages will deploy from GitHub main automatically." -ForegroundColor Green
Write-Host "Site: https://masatools.pages.dev/" -ForegroundColor Green
