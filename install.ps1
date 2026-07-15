param(
  [string]$Version = $env:ATH_VERSION,
  [string]$InstallDir = $env:ATH_INSTALL_DIR,
  [string]$Repository = $env:ATH_REPOSITORY
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

if (-not $Version) { $Version = "latest" }
if (-not $Repository) { $Repository = "selimozten/agent-trace-hub" }
if (-not $InstallDir) {
  $InstallDir = Join-Path $env:LOCALAPPDATA "AgentTraceHub\bin"
}

$runtime = [System.Runtime.InteropServices.RuntimeInformation]
if (-not $runtime::IsOSPlatform([System.Runtime.InteropServices.OSPlatform]::Windows)) {
  throw "This installer is for Windows. Use install.sh on macOS or Linux."
}
if ($runtime::OSArchitecture -ne [System.Runtime.InteropServices.Architecture]::X64) {
  throw "Agent Trace Hub currently provides a Windows x64 binary only."
}

$asset = "agent-trace-hub-windows-x64.zip"
if ($Version -eq "latest") {
  $releasePath = "latest/download"
} elseif ($Version.StartsWith("v")) {
  $releasePath = "download/$Version"
} else {
  $releasePath = "download/v$Version"
}

if ($env:ATH_DOWNLOAD_BASE_URL) {
  $baseUrl = $env:ATH_DOWNLOAD_BASE_URL.TrimEnd("/")
} else {
  $baseUrl = "https://github.com/$Repository/releases/$releasePath"
}

$temporaryDir = Join-Path ([System.IO.Path]::GetTempPath()) ("agent-trace-hub-" + [guid]::NewGuid())
$archive = Join-Path $temporaryDir $asset
$checksums = Join-Path $temporaryDir "checksums.txt"
$extractDir = Join-Path $temporaryDir "extract"

try {
  New-Item -ItemType Directory -Force -Path $temporaryDir, $extractDir, $InstallDir | Out-Null
  Invoke-WebRequest -UseBasicParsing -Uri "$baseUrl/$asset" -OutFile $archive
  Invoke-WebRequest -UseBasicParsing -Uri "$baseUrl/checksums.txt" -OutFile $checksums

  $checksumText = Get-Content -Raw $checksums
  $escapedAsset = [regex]::Escape($asset)
  $checksumMatch = [regex]::Match($checksumText, "(?m)^([0-9a-fA-F]{64})\s+\*?$escapedAsset\s*$")
  if (-not $checksumMatch.Success) {
    throw "No checksum was published for $asset."
  }

  $expectedChecksum = $checksumMatch.Groups[1].Value.ToLowerInvariant()
  $actualChecksum = (Get-FileHash -Algorithm SHA256 $archive).Hash.ToLowerInvariant()
  if ($actualChecksum -ne $expectedChecksum) {
    throw "Checksum verification failed for $asset."
  }

  Expand-Archive -Path $archive -DestinationPath $extractDir -Force
  Copy-Item -Force (Join-Path $extractDir "ath.exe") (Join-Path $InstallDir "ath.exe")

  $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
  $pathEntries = @($userPath -split ";" | Where-Object { $_ })
  if ($pathEntries -notcontains $InstallDir) {
    $newUserPath = (@($pathEntries) + $InstallDir) -join ";"
    [Environment]::SetEnvironmentVariable("Path", $newUserPath, "User")
  }
  if (($env:Path -split ";") -notcontains $InstallDir) {
    $env:Path = "$InstallDir;$env:Path"
  }

  Write-Host "Installed Agent Trace Hub to $InstallDir\ath.exe"
  Write-Host "Open a new terminal and run: ath --version"
} finally {
  Remove-Item -Recurse -Force -ErrorAction SilentlyContinue $temporaryDir
}
