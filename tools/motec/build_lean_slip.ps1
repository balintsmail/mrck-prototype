# Builds a standalone HTML viewer (lean angle vs rear slip, coloured by mu_x) from a MoTeC .ld/.ldx pair.
# Usage: powershell -ExecutionPolicy Bypass -File build_lean_slip.ps1 -Ld "C:\MoTeC\Logged Data\...\file.ld" [-Out file.html]
param(
    [string]$Ld = "C:\MoTeC\Logged Data\EWC\2026\2026-09-15_BoldOr_Race\20260917-210720040.ld",
    [string]$Out
)
$ErrorActionPreference = 'Stop'
$here = $PSScriptRoot
if (-not $Out) { $Out = Join-Path $here ([IO.Path]::GetFileNameWithoutExtension($Ld) + "_lean_slip.html") }

Add-Type -Path "$here\LdReader.cs" -ReferencedAssemblies System.Core
$info = ""
$ch = [LdReader]::Read($Ld, [ref]$info)
function Get-Ch($name) {
    $c = $ch | Where-Object Name -eq $name | Select-Object -First 1
    if (-not $c) { throw "Channel '$name' not found in $Ld" }
    $c
}

$rate = 100
$lean = Get-Ch 'phi_lean'; $slip = Get-Ch 'slip'; $mu = Get-Ch 'mu_x_rear'
$gear = Get-Ch 'Gear'; $vref = Get-Ch 'v_ref'; $rlt = Get-Ch 'Running Lap Time'
$n = [int][Math]::Floor($lean.N * $rate / $lean.Freq)
$vrate = 10
$nv = [int][Math]::Floor($n * $vrate / $rate)

# Session details from the .ldx sidecar (optional)
$meta = [ordered]@{}
$ldx = [IO.Path]::ChangeExtension($Ld, '.ldx')
if (Test-Path $ldx) {
    [xml]$x = Get-Content $ldx -Raw
    foreach ($e in $x.LDXFile.Layers.Details.ChildNodes) { if ($e.Value) { $meta[$e.Id] = $e.Value } }
}
$meta['File'] = [IO.Path]::GetFileName($Ld)
$metaJson = $meta | ConvertTo-Json -Compress
$markers = [LdReader]::LapMarkers($rlt)
$markersJson = '[' + (($markers | ForEach-Object { $_.ToString([Globalization.CultureInfo]::InvariantCulture) }) -join ',') + ']'

$json = '{"meta":' + $metaJson +
    ',"rate":' + $rate + ',"vrate":' + $vrate +
    ',"markers":' + $markersJson +
    ',"lean":' + [LdReader]::Json([LdReader]::Resample($lean, $rate, $n), 2) +
    ',"slip":' + [LdReader]::Json([LdReader]::Resample($slip, $rate, $n), 2) +
    ',"mu":' + [LdReader]::Json([LdReader]::Resample($mu, $rate, $n), 3) +
    ',"gear":' + [LdReader]::Json([LdReader]::Resample($gear, $rate, $n), 0) +
    ',"vref":' + [LdReader]::Json([LdReader]::Resample($vref, $vrate, $nv), 1) + '}'

$tpl = [IO.File]::ReadAllText("$here\lean_slip_template.html")
$html = $tpl.Replace('/*__DATA__*/null', $json)
[IO.File]::WriteAllText($Out, $html, (New-Object Text.UTF8Encoding $false))
"Wrote $Out ($([Math]::Round((Get-Item $Out).Length / 1MB, 2)) MB, $n samples @ $rate Hz, lap markers: $($markers -join ', '))"
