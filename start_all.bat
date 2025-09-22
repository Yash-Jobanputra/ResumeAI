@echo off
echo Starting ResumeAI with multiple Celery workers...
echo.

REM Start Memurai/Redis server (if not already running)
echo Starting Memurai/Redis server...
start "Memurai Server" cmd /c "memurai-cli.exe --service-start" 2>nul
REM Wait a moment for Redis to start
timeout /t 3 /nobreak > nul

REM Start Flask application
echo Starting Flask application...
start "Flask App" cmd /c "python app.py"

REM Wait a moment for Flask to start
timeout /t 2 /nobreak > nul

REM Start multiple Celery workers
echo Starting Celery workers...
start /B celery -A app.celery worker --loglevel=info -P eventlet --concurrency=1 -n worker1@%h
start /B celery -A app.celery worker --loglevel=info -P eventlet --concurrency=1 -n worker2@%h
start /B celery -A app.celery worker --loglevel=info -P eventlet --concurrency=1 -n worker3@%h

echo.
echo All services started successfully!
echo - Flask app: http://127.0.0.1:5001
echo - Redis: localhost:6379
echo - Celery workers: 3 workers running (background)
echo.
echo To stop all services, run: stop_workers.bat
echo.
echo Press any key to exit...
pause > nul
