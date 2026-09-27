param([ValidateSet('qwen','gemma')][string]$Model = 'qwen', [int]$Port = 8089, [int]$Parallel = 2)
$ErrorActionPreference = 'Stop'
if ($Parallel -lt 1 -or $Parallel -gt 4) { throw 'Parallel must be 1-4.' }
if ($Port -lt 1024 -or $Port -gt 65535) { throw 'Port must be 1024-65535.' }
if (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue) { throw "Port $Port already has a listener. Inspect the existing process; this command will not start or terminate another model." }
$runtimeRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\.runtime'))
$memory = Get-CimInstance Win32_OperatingSystem
if (($memory.FreePhysicalMemory / 1MB) -lt 2) { throw 'Less than 2 GiB RAM free. Close optional apps yourself before loading the model.' }
$filename = if ($Model -eq 'qwen') { 'Qwen3.5-4B-Q4_K_M.gguf' } else { 'gemma-4-E2B_q4_0-it.gguf' }
$modelPath = Join-Path $runtimeRoot "models\$filename"
$server = Get-ChildItem -LiteralPath (Join-Path $runtimeRoot 'llama') -Filter 'llama-server.exe' -Recurse | Select-Object -First 1
if (!$server -or !(Test-Path -LiteralPath $modelPath)) { throw 'Run npm run setup:models first.' }
$logPath = Join-Path $runtimeRoot "server-$Model.log"
$errorPath = Join-Path $runtimeRoot "server-$Model.error.log"
$keyPath = Join-Path $runtimeRoot 'server-key.txt'
if (!(Test-Path -LiteralPath $keyPath)) { [IO.File]::WriteAllText($keyPath, [Guid]::NewGuid().ToString('N') + [Guid]::NewGuid().ToString('N')) }
$arguments = @('-m', ('"' + $modelPath + '"'), '--alias', $Model, '--host', '127.0.0.1', '--port', $Port, '-ngl', '99', '-c', (4096 * $Parallel), '-np', $Parallel, '-t', '6', '-b', '256', '-ub', '128', '--load-mode', 'none', '--jinja', '--metrics', '--no-ui', '--reasoning', 'off', '--reasoning-budget', '0', '--api-key-file', ('"' + $keyPath + '"'))
$process = Start-Process -FilePath $server.FullName -ArgumentList $arguments -WorkingDirectory $server.DirectoryName -WindowStyle Hidden -PassThru -RedirectStandardOutput $logPath -RedirectStandardError $errorPath
Write-Host "Loading local-only $Model server PID=$($process.Id); log=$errorPath"
$deadline = [DateTime]::UtcNow.AddSeconds(45)
while ([DateTime]::UtcNow -lt $deadline) {
  $process.Refresh()
  if ($process.HasExited) { throw "Model server exited with code $($process.ExitCode). Inspect $errorPath. No benchmark was run." }
  try {
    $health = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/health" -Headers @{ Authorization = 'Bearer ' + [IO.File]::ReadAllText($keyPath).Trim() } -TimeoutSec 1
    if ($health.StatusCode -eq 200) {
      Write-Host "Ready: PID=$($process.Id), model=$Model, slots=$Parallel, URL=http://127.0.0.1:$Port/v1"
      exit 0
    }
  } catch { }
  Start-Sleep -Milliseconds 250
}
throw "Model server PID=$($process.Id) is still loading after 45 seconds. It remains running; inspect its log/health before any benchmark or restart."
