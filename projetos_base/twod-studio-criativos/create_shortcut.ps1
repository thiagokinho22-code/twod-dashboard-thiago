$wsh = New-Object -ComObject WScript.Shell
$sc = $wsh.CreateShortcut("C:\Users\thiag\OneDrive\Area de Trabalho\TWOD Criativos Studio.lnk")
$sc.TargetPath = "C:\Users\thiag\.gemini\antigravity-ide\scratch\twod-studio\Iniciar TWOD Studio.bat"
$sc.WorkingDirectory = "C:\Users\thiag\.gemini\antigravity-ide\scratch\twod-studio"
$sc.Save()
Write-Host "Atalho criado com sucesso!"
