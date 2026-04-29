@echo off
set BACKEND_PORT=3001
set SURF_API_KEY=dev-placeholder
set JWT_SECRET=devnet-local-jwt-secret-change-me
cd /d %~dp0
node server.js
