@echo off
echo Starting local server for cloth simulation...
echo.
echo Server will run on http://localhost:8000
echo.
echo Open your browser and visit:
echo   - Main app: http://localhost:8000/index.html
echo   - Test page: http://localhost:8000/test-optimization.html
echo.
echo Press Ctrl+C to stop the server
echo.

python -m http.server 8000

pause
