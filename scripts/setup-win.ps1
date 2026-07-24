param(
  [string]$AppInstaller = "Sync-GUI-Setup-win32-x64.exe",
  [switch]$Auto
)

$AppName = "Sync GUI"
$Msys2Url = "https://github.com/msys2/msys2-installer/releases/download/2025-02-28/msys2-base-x86_64-20250228.sfx.exe"
$Msys2Installer = "$env:TEMP\msys2-installer.exe"
$Msys2Dir = "C:\msys64"
$Msys2Bash = "$Msys2Dir\usr\bin\bash.exe"
$Pacman = "$Msys2Dir\usr\bin\pacman.exe"
$ArchWslUrl = "https://github.com/yuk7/ArchWSL/releases/latest/download/Arch.zip"
$RequiredPkgs = @("rsync", "sshpass", "openssh")

function Write-Step  { Write-Host "`n━━━ $args ━━━" -ForegroundColor Cyan }
function Pass  { Write-Host "  ✓ $args" -ForegroundColor Green }
function Warn  { Write-Host "  ⚠ $args" -ForegroundColor Yellow }
function Fail  { Write-Host "  ✗ $args" -ForegroundColor Red; exit 1 }

function Confirm-Action {
  param([string]$Label)
  if ($Auto) { return $true }
  $a = Read-Host "$Label [Y/n]"
  return ($a -ne "n" -and $a -ne "N")
}

Write-Host ""
Write-Host "╔══════════════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "║        $AppName — Pre-Install Setup        ║" -ForegroundColor Cyan
Write-Host "╚══════════════════════════════════════════════════╝" -ForegroundColor Cyan

# ── 1. Internet ──────────────────────────────────────
Write-Step "1/6 — Internet Connectivity"
$Online = $false
try { $null = Test-Connection 8.8.8.8 -Count 1 -Quiet -ErrorAction Stop; $Online = $true } catch {}
if (-not $Online) {
  try { $null = Invoke-WebRequest -Uri "https://google.com" -TimeoutSec 5 -UseBasicParsing; $Online = $true } catch {}
}
if ($Online) { Pass "Connected" } else { Fail "No internet. Connect and try again." }

# ── 2. PowerShell version ────────────────────────────
Write-Step "2/6 — PowerShell"
if ($PSVersionTable.PSVersion.Major -ge 5) {
  Pass "PowerShell $($PSVersionTable.PSVersion)"
} else {
  Fail "PowerShell 5+ required (you have $($PSVersionTable.PSVersion))"
}

# ── 3. Execution Policy ──────────────────────────────
Write-Step "3/6 — Execution Policy"
$policy = Get-ExecutionPolicy
if ($policy -eq "Restricted") {
  Warn "ExecutionPolicy is Restricted — scripts won't run"
  if (Confirm-Action "Set ExecutionPolicy to RemoteSigned?") {
    Set-ExecutionPolicy RemoteSigned -Scope CurrentUser -Force
    Pass "ExecutionPolicy set to RemoteSigned"
  } else {
    Fail "Cannot proceed with Restricted policy. Run: Set-ExecutionPolicy RemoteSigned -Scope CurrentUser"
  }
} else {
  Pass "ExecutionPolicy: $policy"
}

# ── 4. MSYS2 ─────────────────────────────────────────
Write-Step "4/6 — MSYS2 (provides bash, rsync, ssh)"
$Msys2Ok = $false
if (Test-Path $Msys2Bash) {
  Pass "MSYS2 found at $Msys2Dir"
  $Msys2Ok = $true
} else {
  Warn "MSYS2 not found"
  if (Confirm-Action "Download and install MSYS2 to $Msys2Dir?") {
    Write-Host "  Downloading MSYS2 (≈100 MB)..."
    try { Invoke-WebRequest -Uri $Msys2Url -OutFile $Msys2Installer -UseBasicParsing } catch { Fail "MSYS2 download failed: $_" }
    Write-Host "  Extracting..."
    $proc = Start-Process -FilePath $Msys2Installer -ArgumentList "-y -o$Msys2Dir" -Wait -NoNewWindow -PassThru
    if ($proc.ExitCode -ne 0) { Fail "MSYS2 extraction failed (exit $($proc.ExitCode))" }
    Remove-Item $Msys2Installer -Force -ErrorAction SilentlyContinue
    if (Test-Path $Msys2Bash) { Pass "MSYS2 installed"; $Msys2Ok = $true } else { Fail "MSYS2 installation incomplete" }
  } else {
    Fail "MSYS2 is required. Setup cancelled."
  }
}

# ── 5. Packages inside MSYS2 ─────────────────────────
Write-Step "5/6 — MSYS2 Packages"
$Missing = @()
$env:Path = "$Msys2Dir\usr\bin;$env:Path"
foreach ($pkg in $RequiredPkgs) {
  & $Pacman -Q $pkg 2>$null | Out-Null
  if ($LASTEXITCODE -eq 0) { Pass "$pkg" } else { Warn "$pkg missing"; $Missing += $pkg }
}

if ($Missing.Count -gt 0) {
  if (Confirm-Action "Install missing packages ($($Missing -join ', '))?") {
    & $Pacman -S --noconfirm --needed @Missing
    if ($LASTEXITCODE -ne 0) { Fail "Package install failed" }
    foreach ($pkg in $Missing) {
      & $Pacman -Q $pkg 2>$null | Out-Null
      if ($LASTEXITCODE -eq 0) { Pass "$pkg installed" } else { Warn "$pkg NOT installed — SSH sync may fail" }
    }
  } else {
    Warn "Skipped package install — SSH sync will not work"
  }
}

# ── 6. Verify + Launch installer ─────────────────────
Write-Step "6/6 — Final Verification"
$env:Path = "$Msys2Dir\usr\bin;$env:Path"
$AllOk = $true
foreach ($tool in @("bash", "rsync", "sshpass", "ssh")) {
  $ok = & $Msys2Bash -lc "command -v $tool" 2>$null
  if ($ok) { Pass "$tool" } else { Warn "$tool missing"; $AllOk = $false }
}

if ($AllOk) {
  Pass "All dependencies satisfied"
} else {
  Warn "Some tools missing — sync may not work"
}

if (Test-Path $AppInstaller) {
  if (Confirm-Action "Install $AppName now?") {
    Write-Host "  Running installer..."
    Start-Process -FilePath $AppInstaller -Wait
  }
} else {
  Pass "Dependencies ready — run $AppInstaller manually"
}
