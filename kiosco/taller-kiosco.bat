@echo off
REM ===================================================================
REM  taller-kiosco.bat — abre la web del taller a pantalla completa
REM
REM  Pensado para el all-in-one del mostrador: se enciende y ya está
REM  la web puesta, sin tocar nada. Espera a que el servidor conteste
REM  antes de abrir, porque al arrancar los dos a la vez el PC suele
REM  llegar antes que el servidor.
REM
REM  1. Cambia la direccion de aqui abajo por la de tu servidor.
REM  2. Pulsa Windows+R, escribe   shell:startup   y pega aqui un
REM     acceso directo a este fichero.
REM  3. Para salir de pantalla completa: Alt+F4.
REM ===================================================================

set URL=http://192.168.1.50:8477/

REM — esperar al servidor (hasta 60 intentos, 2 segundos cada uno) —
echo Esperando al servidor del taller...
set /a intentos=0
:esperar
curl --silent --head --fail --max-time 3 %URL% >nul 2>&1
if not errorlevel 1 goto abrir
set /a intentos+=1
if %intentos% geq 60 goto sinservidor
timeout /t 2 /nobreak >nul
goto esperar

:sinservidor
echo No contesta el servidor. Abro igualmente por si acaso.

:abrir
REM — Chrome si esta instalado; si no, el Edge que trae Windows —
set CHROME=%ProgramFiles%\Google\Chrome\Application\chrome.exe
if not exist "%CHROME%" set CHROME=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe

if exist "%CHROME%" (
  start "" "%CHROME%" --kiosk --no-first-run --disable-session-crashed-bubble ^
    --disable-infobars --password-store=basic "%URL%"
) else (
  start "" msedge --kiosk "%URL%" --edge-kiosk-type=fullscreen --no-first-run
)
