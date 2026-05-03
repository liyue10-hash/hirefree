@echo off
cd /d "%~dp0"
echo Starting HireFree...
echo.
if not exist node_modules (
  echo Installing dependencies. This may take a few minutes...
  npm install
)
npm start
pause
