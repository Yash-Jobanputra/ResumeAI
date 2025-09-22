REM honestly kinda broken and can't be arsed to fix, start_all displays status of each worker but its very wonky so be careful

@echo off
echo ResumeAI Worker Monitor
echo =======================
echo.

:loop
echo Checking worker status at %date% %time%
echo.

REM Check if Memurai/Redis is running
memurai-cli.exe ping > nul 2>&1
if %errorlevel% neq 0 (
    redis-cli ping > nul 2>&1
    if %errorlevel% neq 0 (
        echo ❌ Memurai/Redis server is not running!
    ) else (
        echo ✅ Redis server is running
    )
) else (
    echo ✅ Memurai server is running
)

echo.

REM Check Celery workers
echo Checking Celery workers...
celery -A app.celery inspect ping > nul 2>&1
if %errorlevel% neq 0 (
    echo ❌ No Celery workers are running!
) else (
    echo ✅ Celery workers are responding
    echo.
    echo Active workers:
    celery -A app.celery inspect active
    echo.
    echo Worker statistics:
    celery -A app.celery inspect stats
)

echo.
echo Registered tasks:
celery -A app.celery inspect registered

echo.
echo Press Ctrl+C to stop monitoring...
echo.

REM Wait 10 seconds before next check
timeout /t 10 /nobreak > nul
goto loop

