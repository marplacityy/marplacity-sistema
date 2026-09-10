$ErrorActionPreference = 'Stop'
$raizProyecto = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$carpetaEscritorio = [Environment]::GetFolderPath('Desktop')
$ejecutableNode = (Get-Command node.exe -ErrorAction Stop).Source
$ejecutablePowerShell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$shellAccesos = New-Object -ComObject WScript.Shell

foreach ($definicion in @(
  @{ Nombre = 'MarplaCity Node'; Script = 'iniciar.mjs'; Descripcion = 'Abrir MarplaCity en esta PC' },
  @{ Nombre = 'Detener MarplaCity Node'; Script = 'detener.mjs'; Descripcion = 'Cerrar el servidor local de MarplaCity' }
)) {
  $rutaScript = Join-Path $PSScriptRoot $definicion.Script
  $nodeSeguro = $ejecutableNode.Replace("'", "''")
  $scriptSeguro = $rutaScript.Replace("'", "''")
  $rutaAcceso = Join-Path $carpetaEscritorio ($definicion.Nombre + '.lnk')
  $acceso = $shellAccesos.CreateShortcut($rutaAcceso)
  $acceso.TargetPath = $ejecutablePowerShell
  $acceso.Arguments = "-NoProfile -WindowStyle Hidden -Command `"& '$nodeSeguro' '$scriptSeguro'`""
  $acceso.WorkingDirectory = $raizProyecto
  $acceso.Description = $definicion.Descripcion
  $acceso.IconLocation = $ejecutableNode + ',0'
  $acceso.Save()
  Write-Output ('Acceso creado: ' + $definicion.Nombre)
}
