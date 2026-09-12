param(
  [Parameter(Mandatory = $true)]
  [string]$InstallDir,
  [string]$Msys2Url = "https://repo.msys2.org/distrib/x86_64/msys2-base-x86_64-20260611.sfx.exe",
  [string]$ExpectedSha256 = "C105946E64E08F099AC0E4647461CE762B95333AD211777666476A9A41451D65"
)

$ErrorActionPreference = "Stop"
$Msys2Name = "msys2-base-x86_64-20260611.sfx.exe"
$DownloadDir = Join-Path $env:TEMP "sync-gui-dependencies"
$Archive = Join-Path $DownloadDir $Msys2Name
$Partial = "$Archive.part"
$ParentDir = Split-Path -Path $InstallDir -Parent
$Bash = Join-Path $InstallDir "usr\bin\bash.exe"

function Download-Archive {
  New-Item -ItemType Directory -Path $DownloadDir -Force | Out-Null
  $curl = Get-Command curl.exe -ErrorAction SilentlyContinue
  if ($curl) {
    & $curl.Source -L --fail --connect-timeout 30 --retry 3 --retry-delay 5 --retry-connrefused --continue-at - -o $Partial $Msys2Url
    if ($LASTEXITCODE -eq 0) { Move-Item -LiteralPath $Partial -Destination $Archive -Force; return }
  }
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  Invoke-WebRequest -Uri $Msys2Url -OutFile $Partial -UseBasicParsing -TimeoutSec 900
  Move-Item -LiteralPath $Partial -Destination $Archive -Force
}

function Verify-Archive {
  $actual = (Get-FileHash -LiteralPath $Archive -Algorithm SHA256).Hash
  if ($actual -ine $ExpectedSha256) {
    throw "MSYS2 dependency checksum mismatch. Expected $ExpectedSha256 but received $actual."
  }
}

function Verify-Tools {
  foreach ($tool in @("bash.exe", "rsync.exe", "ssh.exe", "sshpass.exe")) {
    if (-not (Test-Path -LiteralPath (Join-Path $InstallDir "usr\bin\$tool"))) {
      throw "MSYS2 dependency installation is incomplete: $tool is missing."
    }
  }
}

if (Test-Path -LiteralPath $Bash) {
  Verify-Tools
  exit 0
}

Download-Archive
Verify-Archive
New-Item -ItemType Directory -Path $ParentDir -Force | Out-Null
$proc = Start-Process -FilePath $Archive -ArgumentList "-y -o$ParentDir" -Wait -NoNewWindow -PassThru
if ($proc.ExitCode -ne 0) { throw "MSYS2 extraction failed with exit code $($proc.ExitCode)." }

$Extracted = Join-Path $ParentDir "msys64"
if (-not (Test-Path -LiteralPath $Extracted)) { throw "MSYS2 extraction did not create the expected directory." }
if (Test-Path -LiteralPath $InstallDir) { Remove-Item -LiteralPath $InstallDir -Recurse -Force }
Move-Item -LiteralPath $Extracted -Destination $InstallDir

$env:Path = (Join-Path $InstallDir "usr\bin") + ";" + $env:Path
$Keyring = Join-Path $InstallDir "etc\pacman.d\gnupg"
if (-not (Test-Path -LiteralPath $Keyring)) {
  & $Bash -lc "pacman-key --init && pacman-key --populate msys2"
  if ($LASTEXITCODE -ne 0) { throw "MSYS2 package key initialization failed." }
}
& $Bash -lc "pacman -S --noconfirm --needed rsync openssh sshpass"
if ($LASTEXITCODE -ne 0) { throw "MSYS2 dependency package installation failed." }
Verify-Tools
Remove-Item -LiteralPath $Archive -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath $Partial -Force -ErrorAction SilentlyContinue
