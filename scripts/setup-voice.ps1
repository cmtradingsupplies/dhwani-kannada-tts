param([string]$Python = "python")

$ErrorActionPreference = "Stop"
Push-Location (Split-Path -Parent $PSScriptRoot)
try {
    if (-not (Test-Path -LiteralPath ".venv/Scripts/python.exe")) {
        & $Python -m venv .venv
        if ($LASTEXITCODE -ne 0) { throw "Could not create the Python environment." }
    }
    & ./.venv/Scripts/python.exe -m pip install -r requirements-voice.txt
    if ($LASTEXITCODE -ne 0) { throw "Could not install the voice dependencies." }

    New-Item -ItemType Directory -Force -Path models | Out-Null
    $base = "https://huggingface.co/micahchoo/piper-kn/resolve/c73546cb70012e28f6093a61c71162924398fee1"
    $files = @{
        "kn_IN-syspin_male-medium.onnx" = "BFF423259625C0C1182E5B417F68560B6A55F3C4D27557A6ABF2FBE51E7E00EE"
        "kn_IN-syspin_male-medium.onnx.json" = "FEAF88702F1F045FDF4BD23606267344AFB96141291DE8A8118CDEF125DAF302"
    }
    foreach ($name in $files.Keys) {
        $path = Join-Path models $name
        if ((Test-Path -LiteralPath $path) -and (Get-FileHash -LiteralPath $path).Hash -eq $files[$name]) {
            continue
        }
        $download = "$path.download"
        & curl.exe -fsSL --retry 2 --max-time 180 "$base/$name" -o $download
        if ($LASTEXITCODE -ne 0 -or (Get-FileHash -LiteralPath $download).Hash -ne $files[$name]) {
            throw "Could not download and verify $name."
        }
        Move-Item -Force -LiteralPath $download -Destination $path
    }
} finally {
    Pop-Location
}
