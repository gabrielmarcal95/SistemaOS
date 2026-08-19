Set objShell = WScript.CreateObject("WScript.Shell")
objShell.Run "cmd /c node server.js", 0, False
objShell.Run "http://localhost:8080"
