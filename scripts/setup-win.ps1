param(
  [string]$AppInstaller = "Sync-GUI-Setup-win32-x64.exe",
  [switch]$Auto
)

$AppName = "Sync GUI"
$Msys2Url = "https://repo.msys2.org/distrib/x86_64/msys2-base-x86_64-20260611.sfx.exe"
$Msys2Installer = "$env:TEMP\msys2-installer.exe"
$Msys2Dir = "C:\msys64"
$Msys2Parent = Split-Path -Path $Msys2Dir -Parent
$Msys2Bash = "$Msys2Dir\usr\bin\bash.exe"
$Pacman = "$Msys2Dir\usr\bin\pacman.exe"
$ArchWslUrl = "https://github.com/yuk7/ArchWSL/releases/latest/download/Arch.zip"
$RequiredPkgs = @("rsync", "sshpass", "openssh")

function Write-Step  { Write-Host "`n--- $args ---" -ForegroundColor Cyan }
function Pass  { Write-Host "  [OK] $args" -ForegroundColor Green }
function Warn  { Write-Host "  [WARN] $args" -ForegroundColor Yellow }
function Fail  { Write-Host "  [ERROR] $args" -ForegroundColor Red; exit 1 }

function Confirm-Action {
  param([string]$Label)
  if ($Auto) { return $true }
  $a = Read-Host "$Label [Y/n]"
  return ($a -ne "n" -and $a -ne "N")
}

function Download-File {
  param(
    [string]$Url,
    [string]$OutFile
  )

  $partFile = "$OutFile.part"
  if ((Test-Path $OutFile) -and -not (Test-Path $partFile)) {
    Move-Item $OutFile $partFile -Force
  }

  $curl = Get-Command curl.exe -ErrorAction SilentlyContinue
  if ($curl) {
    Write-Host "  Downloading with curl (resume and automatic retries enabled)..."
    for ($attempt = 1; $attempt -le 8; $attempt++) {
      & $curl.Source -L --fail --connect-timeout 30 --retry 2 --retry-delay 5 --retry-connrefused --continue-at - -o $partFile $Url
      if ($LASTEXITCODE -eq 0 -and (Test-Path $partFile) -and ((Get-Item $partFile).Length -gt 1000000)) {
        Move-Item $partFile $OutFile -Force
        return
      }
      if ($attempt -lt 8) {
        Warn "Download interrupted; resuming (attempt $($attempt + 1)/8)"
        Start-Sleep -Seconds 2
      }
    }
    Remove-Item $partFile -Force -ErrorAction SilentlyContinue
    Warn "curl download failed; trying Background Intelligent Transfer Service"
  }

  try {
    Remove-Item $partFile -Force -ErrorAction SilentlyContinue
    Start-BitsTransfer -Source $Url -Destination $partFile -DisplayName "Downloading Sync GUI dependencies" -RetryInterval 10 -RetryTimeout 600 -ErrorAction Stop
    if ((Test-Path $partFile) -and ((Get-Item $partFile).Length -gt 1000000)) {
      Move-Item $partFile $OutFile -Force
      return
    }
  } catch {
    Warn "BITS download failed; trying PowerShell web download"
  }

  try {
    Remove-Item $partFile -Force -ErrorAction SilentlyContinue
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    Invoke-WebRequest -Uri $Url -OutFile $partFile -UseBasicParsing -TimeoutSec 900
    if ((Test-Path $partFile) -and ((Get-Item $partFile).Length -gt 1000000)) {
      Move-Item $partFile $OutFile -Force
      return
    }
  } catch {
    Remove-Item $partFile -Force -ErrorAction SilentlyContinue
    Remove-Item $OutFile -Force -ErrorAction SilentlyContinue
    Fail "MSYS2 download failed after retries: $($_.Exception.Message)"
  }

  Remove-Item $partFile -Force -ErrorAction SilentlyContinue
  Fail "MSYS2 download did not produce an installer file."
}

Write-Host ""
Write-Host "+--------------------------------------------------+" -ForegroundColor Cyan
Write-Host "|        $AppName - Pre-Install Setup              |" -ForegroundColor Cyan
Write-Host "+--------------------------------------------------+" -ForegroundColor Cyan

# -- 1. Internet -------------------------------------
Write-Step "1/6 - Internet Connectivity"
$Online = $false
try { $null = Test-Connection 8.8.8.8 -Count 1 -Quiet -ErrorAction Stop; $Online = $true } catch {}
if (-not $Online) {
  try { $null = Invoke-WebRequest -Uri "https://google.com" -TimeoutSec 5 -UseBasicParsing; $Online = $true } catch {}
}
if ($Online) { Pass "Connected" } else { Fail "No internet. Connect and try again." }

# -- 2. PowerShell version ----------------------------
Write-Step "2/6 - PowerShell"
if ($PSVersionTable.PSVersion.Major -ge 5) {
  Pass "PowerShell $($PSVersionTable.PSVersion)"
} else {
  Fail "PowerShell 5+ required (you have $($PSVersionTable.PSVersion))"
}

# -- 3. Execution Policy ------------------------------
Write-Step "3/6 - Execution Policy"
$policy = Get-ExecutionPolicy
if ($policy -eq "Restricted") {
  Warn "ExecutionPolicy is Restricted - scripts won't run"
  if (Confirm-Action "Set ExecutionPolicy to RemoteSigned?") {
    Set-ExecutionPolicy RemoteSigned -Scope CurrentUser -Force
    Pass "ExecutionPolicy set to RemoteSigned"
  } else {
    Fail "Cannot proceed with Restricted policy. Run: Set-ExecutionPolicy RemoteSigned -Scope CurrentUser"
  }
} else {
  Pass "ExecutionPolicy: $policy"
}

# -- 4. MSYS2 -----------------------------------------
Write-Step "4/6 - MSYS2 (provides bash, rsync, ssh)"
$Msys2Ok = $false
if (Test-Path $Msys2Bash) {
  Pass "MSYS2 found at $Msys2Dir"
  $Msys2Ok = $true
} else {
  Warn "MSYS2 not found"
  if (Confirm-Action "Download and install MSYS2 to $Msys2Dir?") {
    Write-Host "  Downloading MSYS2 (about 100 MB)..."
    Download-File -Url $Msys2Url -OutFile $Msys2Installer
    Write-Host "  Extracting..."
    # The archive contains a top-level msys64 directory, so extract into its
    # parent (C:\) rather than into C:\msys64 itself.
    $proc = Start-Process -FilePath $Msys2Installer -ArgumentList "-y -o$Msys2Parent" -Wait -NoNewWindow -PassThru
    if ($proc.ExitCode -ne 0) { Fail "MSYS2 extraction failed (exit $($proc.ExitCode))" }
    Remove-Item $Msys2Installer -Force -ErrorAction SilentlyContinue
    if (Test-Path $Msys2Bash) { Pass "MSYS2 installed"; $Msys2Ok = $true } else { Fail "MSYS2 installation incomplete" }
  } else {
    Fail "MSYS2 is required. Setup cancelled."
  }
}

# -- 5. Packages inside MSYS2 -------------------------
Write-Step "5/6 - MSYS2 Packages"
$Missing = @()
$env:Path = $Msys2Dir + '\usr\bin;' + $env:Path

$KeyringDir = "$Msys2Dir\etc\pacman.d\gnupg"
if (-not (Test-Path $KeyringDir)) {
  Write-Host "  Initializing MSYS2 package signing keys..."
  & $Msys2Bash -lc "pacman-key --init && pacman-key --populate msys2"
  if ($LASTEXITCODE -ne 0) { Fail "MSYS2 package keyring initialization failed" }
}

foreach ($pkg in $RequiredPkgs) {
  & $Pacman -Q $pkg 2>$null | Out-Null
  if ($LASTEXITCODE -eq 0) { Pass "$pkg" } else { Warn "$pkg missing"; $Missing += $pkg }
}

if ($Missing.Count -gt 0) {
  if (Confirm-Action "Install missing packages ($($Missing -join ', '))?") {
    & $Pacman -S --noconfirm --needed $Missing
    if ($LASTEXITCODE -ne 0) { Fail "Package install failed" }
    foreach ($pkg in $Missing) {
      & $Pacman -Q $pkg 2>$null | Out-Null
      if ($LASTEXITCODE -eq 0) { Pass "$pkg installed" } else { Warn "$pkg NOT installed - SSH sync may fail" }
    }
  } else {
    Warn "Skipped package install - SSH sync will not work"
  }
}

# -- 6. Verify + Launch installer ---------------------
Write-Step "6/6 - Final Verification"
$env:Path = $Msys2Dir + '\usr\bin;' + $env:Path
$AllOk = $true
foreach ($tool in @("bash", "rsync", "sshpass", "ssh")) {
  $ok = & $Msys2Bash -lc "command -v $tool" 2>$null
  if ($ok) { Pass "$tool" } else { Warn "$tool missing"; $AllOk = $false }
}

if ($AllOk) {
  Pass "All dependencies satisfied"
} else {
  Warn "Some tools missing - sync may not work"
}

if (Test-Path $AppInstaller) {
  if (Confirm-Action "Install $AppName now?") {
    Write-Host "  Running installer..."
    Start-Process -FilePath $AppInstaller -Wait
  }
} else {
  Pass "Dependencies ready - run $AppInstaller manually"
}
