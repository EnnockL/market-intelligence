$ErrorActionPreference = "Continue"
$workspacePath = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$pollSeconds = 60

Set-Location -LiteralPath $workspacePath
Write-Host "Continuous ingestion scheduler started. Press Ctrl+C to stop."
while ($true) {
  Write-Host "[$((Get-Date).ToString('s'))] Running due ingestion and research jobs..."
  npm run scheduler:once
  $exitCode = $LASTEXITCODE
  $status = if ($exitCode -eq 0) { "completed" } else { "failed (exit $exitCode)" }
  Write-Host "[$((Get-Date).ToString('s'))] Scheduler cycle $status. Next check in $pollSeconds seconds."
  Start-Sleep -Seconds $pollSeconds
}
