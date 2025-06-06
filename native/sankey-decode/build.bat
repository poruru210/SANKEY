@echo off
setlocal

echo ==== [1/6] Generate x86 (Win32) build ====
cmake -S . -B out/build-Win32 -G "Visual Studio 17 2022" -A Win32
if %errorlevel% neq 0 exit /b %errorlevel%

echo ==== [2/6] Build x86 (Win32) DLL ====
cmake --build out/build-Win32 --config Release
if %errorlevel% neq 0 exit /b %errorlevel%

echo ==== [3/6] Run x86 (Win32) unit tests ====
ctest --test-dir out/build-Win32 --output-on-failure
if %errorlevel% neq 0 exit /b %errorlevel%

echo ==== [4/6] Generate x64 build ====
cmake -S . -B out/build-x64 -G "Visual Studio 17 2022" -A x64
if %errorlevel% neq 0 exit /b %errorlevel%

echo ==== [5/6] Build x64 DLL ====
cmake --build out/build-x64 --config Release
if %errorlevel% neq 0 exit /b %errorlevel%

echo ==== [6/6] Run x64 unit tests ====
ctest --test-dir out/build-x64 --output-on-failure
if %errorlevel% neq 0 exit /b %errorlevel%

echo ==== ALL DONE SUCCESSFULLY ====
endlocal
