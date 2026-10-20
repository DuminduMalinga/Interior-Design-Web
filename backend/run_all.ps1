# Starts every backend service (wall detector + six layout engines) in one go.
# Usage (from repo root):  .\backend\run_all.ps1            # all services
#                          .\backend\run_all.ps1 -NoDetector # skip the heavy YOLO/OCR detector
# Stop everything with Ctrl+C in this window.
param([switch]$NoDetector)

$backend = $PSScriptRoot
$services = [ordered]@{
    "wall_detector"         = 8000
    "living_room_layout"    = 8100
    "bedroom_layout"        = 8200
    "kitchen_layout"        = 8300
    "bathroom_layout"       = 8400
    "dining_layout"         = 8500
    "master_bedroom_layout" = 8600
}

$procs = @()
foreach ($name in $services.Keys) {
    if ($NoDetector -and $name -eq "wall_detector") { continue }
    $port = $services[$name]
    $app = if ($name -eq "wall_detector") { "main:app" } else { "api:app" }
    Write-Host "Starting $name on http://localhost:$port"
    $procs += Start-Process -FilePath python -WorkingDirectory (Join-Path $backend $name) `
        -ArgumentList "-m", "uvicorn", $app, "--port", $port -NoNewWindow -PassThru
}

try { Wait-Process -Id ($procs | ForEach-Object Id) }
finally { $procs | Where-Object { -not $_.HasExited } | Stop-Process -Force }
