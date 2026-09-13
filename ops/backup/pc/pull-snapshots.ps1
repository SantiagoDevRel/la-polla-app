# ops/backup/pc/pull-snapshots.ps1 - segunda copia de los backups cifrados en el PC.
#
# Trae por scp los snapshots .tar.zst.gpg nuevos del DGX, verifica su sha256
# contra index.tsv del DGX y avisa (msg.exe) si el mas nuevo tiene mas de
# MaxAgeHours o si la ultima corrida del DGX fallo. Solo maneja archivos
# CIFRADOS: la llave privada no se usa aqui. No borra nada.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File ops\backup\pc\pull-snapshots.ps1
#
# Requiere acceso SSH sin contrasena al DGX (alias "spark" en ~/.ssh/config).
param(
  [string]$SshHost = "spark",
  [string]$RemoteDir = "apps/la-polla-backup",
  [string]$Dest = "$env:USERPROFILE\Backups\la-polla",
  [int]$MaxAgeHours = 8,
  [switch]$NoPopup
)
$ErrorActionPreference = "Stop"
$ssh = "$env:WINDIR\System32\OpenSSH\ssh.exe"
$scp = "$env:WINDIR\System32\OpenSSH\scp.exe"
$snapDir = Join-Path $Dest "snapshots"
$logFile = Join-Path $Dest "pull.log"
New-Item -ItemType Directory -Force -Path $snapDir | Out-Null

function Write-Log([string]$msg) {
  $line = "{0} {1}" -f (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ"), $msg
  Add-Content -Path $logFile -Value $line -Encoding utf8
  Write-Output $line
}
$alerts = New-Object System.Collections.Generic.List[string]

try {
  $indexText = & $ssh -o BatchMode=yes -o ConnectTimeout=15 $SshHost "cat $RemoteDir/snapshots/index.tsv"
  if ($LASTEXITCODE -ne 0) { throw "no pude leer index.tsv del DGX (ssh rc=$LASTEXITCODE)" }
  $rows = @($indexText | Where-Object { $_ -and -not $_.StartsWith("#") } | ForEach-Object {
    $c = $_ -split "`t"
    if ($c.Length -ge 2 -and $c[0] -match '^[0-9a-f]{64}$' -and $c[1] -match '^\d{4}-\d{2}-\d{2}-\d{2}-\d{2}\.tar\.zst\.gpg$') {
      [pscustomobject]@{ Sha = $c[0]; File = $c[1] }
    }
  })
  if ($rows.Count -eq 0) { throw "index.tsv del DGX no lista snapshots" }
  Set-Content -Path (Join-Path $Dest "index.dgx.tsv") -Value $indexText -Encoding utf8

  $pulled = 0
  foreach ($r in $rows) {
    $local = Join-Path $snapDir $r.File
    if (Test-Path $local) { continue }
    $part = "$local.part"
    & $scp -q -o BatchMode=yes "${SshHost}:$RemoteDir/snapshots/$($r.File)" $part
    if ($LASTEXITCODE -ne 0) { throw "scp fallo para $($r.File) (rc=$LASTEXITCODE)" }
    $h = (Get-FileHash -Algorithm SHA256 -Path $part).Hash.ToLowerInvariant()
    if ($h -ne $r.Sha) {
      Remove-Item -LiteralPath $part -Force   # temporal creado por esta corrida
      throw "sha256 no coincide para $($r.File)"
    }
    Move-Item -LiteralPath $part -Destination $local
    $pulled++
    Write-Log "traido $($r.File) sha256 OK"
  }

  # Re-verificar todo lo local que el indice del DGX todavia lista.
  $bad = 0
  foreach ($r in $rows) {
    $local = Join-Path $snapDir $r.File
    if (-not (Test-Path $local)) { continue }
    $h = (Get-FileHash -Algorithm SHA256 -Path $local).Hash.ToLowerInvariant()
    if ($h -ne $r.Sha) { $bad++; Write-Log "ERROR sha256 local distinto: $($r.File)" }
  }
  if ($bad -gt 0) { $alerts.Add("$bad snapshot(s) locales con sha256 distinto") }
  $sums = foreach ($f in Get-ChildItem -Path $snapDir -Filter "*.tar.zst.gpg" | Sort-Object Name) {
    "{0}  {1}" -f (Get-FileHash -Algorithm SHA256 -Path $f.FullName).Hash.ToLowerInvariant(), $f.Name
  }
  Set-Content -Path (Join-Path $snapDir "SHA256SUMS") -Value $sums -Encoding ascii

  $newest = Get-ChildItem -Path $snapDir -Filter "*.tar.zst.gpg" | Sort-Object Name | Select-Object -Last 1
  if (-not $newest) { $alerts.Add("no hay snapshots en $snapDir") }
  else {
    $p = $newest.Name.Substring(0, 16) -split "-"
    $stampUtc = [datetime]::new([int]$p[0], [int]$p[1], [int]$p[2], [int]$p[3], [int]$p[4], 0, [DateTimeKind]::Utc)
    $age = ((Get-Date).ToUniversalTime() - $stampUtc).TotalHours
    Write-Log ("mas nuevo: {0} (hace {1:N1} h) - traidos {2} - locales {3}" -f $newest.Name, $age, $pulled, @(Get-ChildItem $snapDir -Filter "*.tar.zst.gpg").Count)
    if ($age -gt $MaxAgeHours) { $alerts.Add(("el backup mas nuevo tiene {0:N1} h (maximo {1} h)" -f $age, $MaxAgeHours)) }
  }

  $statusText = & $ssh -o BatchMode=yes -o ConnectTimeout=15 $SshHost "cat $RemoteDir/status/backup-last.json"
  if ($LASTEXITCODE -eq 0 -and $statusText) {
    $st = ($statusText -join "") | ConvertFrom-Json
    if (-not $st.ok) { $alerts.Add("la ultima corrida del DGX fallo: $($st.reason)") }
    if ($st.free_gb -ne $null -and [int]$st.free_gb -lt 50) { $alerts.Add("el DGX tiene $($st.free_gb) GB libres") }
  } else { $alerts.Add("no pude leer status/backup-last.json del DGX") }
}
catch {
  $alerts.Add("pull fallo: $($_.Exception.Message)")
}

if ($alerts.Count -gt 0) {
  $text = "La Polla backup: " + ($alerts -join " | ")
  Write-Log "ALERTA $text"
  if (-not $NoPopup) { & "$env:WINDIR\System32\msg.exe" $env:USERNAME /TIME:0 $text }
  exit 1
}
Write-Log "OK"
exit 0
