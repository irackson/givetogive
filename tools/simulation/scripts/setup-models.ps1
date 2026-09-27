param([ValidateSet('qwen','gemma','all')][string]$Model = 'all')
$ErrorActionPreference = 'Stop'
$runtimeRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\.runtime'))
New-Item -ItemType Directory -Path $runtimeRoot -Force | Out-Null

function Get-VerifiedArchive([string]$Name, [string]$Hash) {
  $destination = Join-Path $runtimeRoot $Name
  if (!(Test-Path -LiteralPath $destination)) {
    & curl.exe --fail --location --retry 4 --output $destination "https://github.com/ggml-org/llama.cpp/releases/download/b11146/$Name"
    if ($LASTEXITCODE -ne 0) { throw "Download failed: $Name" }
  }
  if ((Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash.ToLowerInvariant() -ne $Hash) {
    throw "Checksum mismatch for $Name. Preserve and inspect the file; it will not be executed."
  }
  Expand-Archive -LiteralPath $destination -DestinationPath (Join-Path $runtimeRoot 'llama') -Force
}

# CUDA 12.4 works with the observed 566.07 driver. Do not upgrade drivers or install CUDA globally.
Get-VerifiedArchive 'llama-b11146-bin-win-cuda-12.4-x64.zip' '3c806a6ceccc3dae1c743ceb1a1fb2cce5b76f40bfbd4c6b7b8afb6ef45a5807'
Get-VerifiedArchive 'cudart-llama-bin-win-cuda-12.4-x64.zip' '8c79a9b226de4b3cacfd1f83d24f962d0773be79f1e7b75c6af4ded7e32ae1d6'

function Get-VerifiedModel([string]$Repo, [string]$Revision, [string]$Filename, [string]$Hash) {
  $modelsPath = Join-Path $runtimeRoot 'models'
  New-Item -ItemType Directory -Path $modelsPath -Force | Out-Null
  $destination = Join-Path $modelsPath $Filename
  if (!(Test-Path -LiteralPath $destination)) {
    # uv isolates the HF CLI from the system Python installation. No login or paid inference is used.
    & uvx --from 'huggingface_hub==1.7.2' hf download $Repo $Filename --revision $Revision --local-dir $modelsPath
    if ($LASTEXITCODE -ne 0) {
      Write-Warning 'The isolated HF CLI could not start. Falling back to the same pinned public Hub file, then verifying its SHA256.'
      & curl.exe --fail --location --retry 4 --output $destination "https://huggingface.co/$Repo/resolve/$Revision/$Filename"
      if ($LASTEXITCODE -ne 0) { throw "Hugging Face download failed: $Repo" }
    }
  }
  if ((Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash.ToLowerInvariant() -ne $Hash) {
    throw "Model checksum mismatch: $Filename"
  }
  Write-Host "Verified $Filename ($Revision)"
}
if ($Model -in @('qwen','all')) {
  Get-VerifiedModel 'unsloth/Qwen3.5-4B-GGUF' 'e87f176479d0855a907a41277aca2f8ee7a09523' 'Qwen3.5-4B-Q4_K_M.gguf' '00fe7986ff5f6b463e62455821146049db6f9313603938a70800d1fb69ef11a4'
}
if ($Model -in @('gemma','all')) {
  Get-VerifiedModel 'google/gemma-4-E2B-it-qat-q4_0-gguf' '675cff42a74c774d6cb76f76d8eacb49b48c9b93' 'gemma-4-E2B_q4_0-it.gguf' 'fa401b55b07ee70a54c6dae3903c783a6e65064312529ea57175cb5f8dec6634'
}
