# Windows x64. Run from any directory with PowerShell.
$ErrorActionPreference = 'Stop'
$env:PSModulePath = (Join-Path $PSHOME 'Modules') + ';' + $env:PSModulePath
$root = Split-Path $PSScriptRoot -Parent
$cache = Join-Path $env:LOCALAPPDATA 'DrugaStronaOceny\ai'
[void](New-Item -Type Directory -Force -Path $cache)

function Get-VerifiedFile($url, $file, $expectedHash) {
    if ((Test-Path -LiteralPath $file) -and (Get-FileHash -LiteralPath $file).Hash -eq $expectedHash) { return }
    $partial = "$file.$([guid]::NewGuid()).part"
    try {
        Write-Host "Pobieranie: $(Split-Path $file -Leaf)"
        & curl.exe --fail --location --retry 2 --output $partial $url
        if ($LASTEXITCODE -ne 0 -or (Get-FileHash -LiteralPath $partial).Hash -ne $expectedHash) {
            throw 'Nie udało się pobrać pliku o oczekiwanej sumie SHA-256.'
        }
        Move-Item -LiteralPath $partial -Destination $file -Force
    } finally {
        if (Test-Path -LiteralPath $partial) { Remove-Item -LiteralPath $partial }
    }
}

$zip = Join-Path $cache 'llama-b8180.zip'
$model = Join-Path $cache 'Qwen3-1.7B-Q4_K_M.gguf'
Get-VerifiedFile 'https://github.com/ggml-org/llama.cpp/releases/download/b8180/llama-b8180-bin-win-cpu-x64.zip' $zip 'E39C35B8E5E69E7BF2FAE9355D1435DDA68BB8BEE3A6CEBD77ECD0EF550B445B'
Get-VerifiedFile 'https://huggingface.co/ggml-org/Qwen3-1.7B-GGUF/resolve/daeb8e2d528a760970442092f6bf1e55c3b659eb/Qwen3-1.7B-Q4_K_M.gguf' $model 'D2387CA2DBFEE2FFABCE7120D3770DADCA0B293052BC2F0E138FDC940D9BC7B5'
$bin = Join-Path $cache 'b8180'
$exe = Join-Path $bin 'llama-server.exe'
if (!(Test-Path -LiteralPath $exe)) { Expand-Archive -LiteralPath $zip -DestinationPath $bin -Force }

$socket = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback,0)
$socket.Start()
$port = $socket.LocalEndpoint.Port
$socket.Stop()
$engine = Start-Process -FilePath $exe -ArgumentList @('-m', ('"' + $model + '"'), '--alias','local','--host','127.0.0.1','--port',$port,'-c','2048','-t','4','-np','1','--no-webui','--reasoning-budget','0') -PassThru -WindowStyle Hidden
try {
    $ready = $false
    for ($attempt=0; $attempt -lt 90; $attempt++) {
        if ($engine.HasExited) { throw 'Nie udało się uruchomić silnika llama.cpp.' }
        try {
            $ready = (Invoke-RestMethod "http://127.0.0.1:$port/health" -TimeoutSec 2).status -eq 'ok'
        } catch { $ready = $false }
        if ($ready) { break }
        Start-Sleep -Milliseconds 500
    }
    if (!$ready) { throw 'Model nie zgłosił gotowości.' }
    $env:DSO_AI_URL = "http://127.0.0.1:$port/v1/chat/completions"
    $env:DSO_JURY_DEMO = '1'
    if (!$env:DSO_PORT) { $env:DSO_PORT = '4177' }
    if (!$env:DSO_DATA_FILE) { $env:DSO_DATA_FILE = Join-Path $cache 'pokaz-ai.json' }
    & node (Join-Path $root 'server.mjs')
    exit $LASTEXITCODE
} finally {
    if (!$engine.HasExited) { $engine.Kill() }
}
