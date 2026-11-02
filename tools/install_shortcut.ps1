<#
    Puts Glass Ribbons on the Desktop.

        powershell -ExecutionPolicy Bypass -File tools\install_shortcut.ps1

    Targets pythonw.exe so the shortcut does not open a console.
    GetFolderPath('Desktop') follows the OneDrive desktop redirect.
#>

$ErrorActionPreference = 'Stop'

$repo = Split-Path -Parent $PSScriptRoot
$launcher = Join-Path $repo 'tools\launcher.py'
$icon = Join-Path $repo 'assets\glass-ribbons.ico'

if (-not (Test-Path $launcher)) { throw "Missing launcher: $launcher" }
if (-not (Test-Path $icon)) { throw "Missing icon: $icon. Run: python tools\make_icon.py" }

$python = (Get-Command python -ErrorAction SilentlyContinue).Source
if (-not $python) { throw 'python.exe is not on PATH.' }
$pythonw = Join-Path (Split-Path -Parent $python) 'pythonw.exe'
if (-not (Test-Path $pythonw)) { $pythonw = $python }

$desktop = [Environment]::GetFolderPath('Desktop')
$linkPath = Join-Path $desktop 'Glass Ribbons.lnk'

$shell = New-Object -ComObject WScript.Shell
$lnk = $shell.CreateShortcut($linkPath)
$lnk.TargetPath = $pythonw
$lnk.Arguments = '"{0}"' -f $launcher
$lnk.WorkingDirectory = $repo
$lnk.IconLocation = "$icon,0"
$lnk.Description = 'Iridescent glass ribbons follow your hand.'
$lnk.WindowStyle = 1
$lnk.Save()

[Runtime.InteropServices.Marshal]::ReleaseComObject($shell) | Out-Null

Write-Output "Shortcut : $linkPath"
Write-Output "Runs     : $pythonw"
Write-Output "Launcher : $launcher"
Write-Output "Icon     : $icon"
