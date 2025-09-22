@echo off
echo Stopping ResumeAI Workers...
echo.

REM Method 1: Celery graceful shutdown
echo Attempting graceful shutdown...
celery -A app.celery control shutdown > nul 2>&1

REM Method 2: Kill by process name (more forceful)
echo Stopping any remaining workers...
for /f "tokens=2" %%i in ('tasklist ^| findstr celery') do (
    echo Stopping worker process %%i
    taskkill /PID %%i /F > nul 2>&1
)

REM Method 3: Kill by window title (if any visible)
taskkill /FI "WINDOWTITLE eq Celery Worker*" /F > nul 2>&1

echo.
echo Checking if workers are stopped...
celery -A app.celery inspect ping > nul 2>&1
if %errorlevel% neq 0 (
    echo ✅ All workers stopped successfully
) else (
    echo ⚠️  Some workers may still be running
    echo Try running this script again or use Task Manager
)

echo.
echo Press any key to exit...
pause > nul
