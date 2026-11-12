@echo off
set "PY_EXE=C:\Users\thiag\AppData\Local\Python\pythoncore-3.14-64\pythonw.exe"
if exist "%PY_EXE%" (
    start "" "%PY_EXE%" "%~dp0twod_studio.py"
) else (
    start "" pythonw "%~dp0twod_studio.py"
)
