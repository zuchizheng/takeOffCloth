#!/bin/bash

echo "Starting local server for cloth simulation..."
echo ""
echo "Server will run on http://localhost:8000"
echo ""
echo "Open your browser and visit:"
echo "  - Main app: http://localhost:8000/index.html"
echo "  - Test page: http://localhost:8000/test-optimization.html"
echo ""
echo "Press Ctrl+C to stop the server"
echo ""

python3 -m http.server 8000
