REM USAGE: start_all.bat 5 = load with 5 workers. Default is 3, can change at line 7.
@echo off
setlocal enabledelayedexpansion

REM Set default worker count if not provided
if "%1"=="" (
    set "worker_count=3"
) else (
    set "worker_count=%1"
)

echo Starting ResumeAI with %worker_count% Celery workers...
echo.

REM Start Memurai/Redis server (if not already running)
echo Starting Memurai/Redis server...
start "Memurai Server" cmd /c "memurai-cli.exe --service-start" 2>nul || start "Redis Server" cmd /c "redis-server --port 6379"

REM Wait a moment for Redis to start
timeout /t 3 /nobreak > nul

REM Start Flask application
echo Starting Flask application...
start "Flask App" cmd /c "python app.py"

REM Wait a moment for Flask to start
timeout /t 2 /nobreak > nul

REM Start multiple Celery workers dynamically
echo Starting %worker_count% Celery workers...
for /l %%i in (1,1,%worker_count%) do (
    start /B celery -A app.celery worker --loglevel=info -P eventlet --concurrency=1 -n worker%%i@%h
)

echo.
echo All services started successfully!
echo - Flask app: http://127.0.0.1:5001
echo - Redis: localhost:6379
echo - Celery workers: %worker_count% workers running (background)
echo.
echo To stop all services, run: stop_workers.bat
echo.
echo Press any key to exit...
pause > nul
