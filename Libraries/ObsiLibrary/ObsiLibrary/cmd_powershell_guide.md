# Command Line & PowerShell Commands Guide

Reference list for CMD.exe and PowerShell commands.

## Process Control
- CMD start detached: `start "" target.exe`
- PowerShell run background: `Start-Process "target.exe" -NoNewWindow`
- Kill process by name: `taskkill /f /im target.exe` or PowerShell: `Stop-Process -Name target -Force`

## File Operations
- Copy directory: `xcopy /E /I /Y src dest` or `Copy-Item -Path src -Destination dest -Recurse -Force`
- Delete recursive safely: `Remove-Item -Path dir -Recurse -Force`
- Scan ports: `netstat -ano`
