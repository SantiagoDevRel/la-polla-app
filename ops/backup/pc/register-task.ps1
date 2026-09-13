# ops/backup/pc/register-task.ps1 - crea (o actualiza) la tarea "La Polla backup pull".
# Diaria a las 08:30 hora local, "ejecutar lo antes posible si se perdio",
# solo con la sesion del usuario iniciada (msg.exe necesita escritorio).
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File ops\backup\pc\register-task.ps1 -ScriptPath C:\ruta\pull-snapshots.ps1
param(
  [Parameter(Mandatory = $true)][string]$ScriptPath,
  [string]$TaskName = "La Polla backup pull",
  [string]$At = "08:30"
)
$ErrorActionPreference = "Stop"
if (-not (Test-Path $ScriptPath)) { throw "no existe $ScriptPath" }
$action = New-ScheduledTaskAction -Execute "powershell.exe" `
  -Argument ("-NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"{0}`"" -f $ScriptPath)
$trigger = New-ScheduledTaskTrigger -Daily -At $At
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -ExecutionTimeLimit (New-TimeSpan -Hours 1) -MultipleInstances IgnoreNew
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal `
  -Description "Trae los snapshots cifrados de La Polla desde el DGX, verifica sha256 y avisa si el mas nuevo tiene mas de 8 h." -Force | Out-Null
Get-ScheduledTask -TaskName $TaskName | Select-Object TaskName, State
