@echo off
chcp 65001 >nul
setlocal EnableDelayedExpansion
set "PYTHONIOENCODING=utf-8"
title 空气质量大屏 - 一键启动

set "ROOT=%~dp0"
set "DASH_OUT=%ROOT%backend\data\model_outputs\dashboard_payload.json"
set "EXTREME_OUT=%ROOT%backend\data\model_outputs\weather_extreme_hourly_payload.json"

set "WEATHER_CSV_1=%ROOT%..\weather_air_14days_full.csv"
set "WEATHER_CSV_2=%ROOT%weather_air_14days_full.csv"
set "WEATHER_CSV="

if exist "%WEATHER_CSV_1%" (
    set "WEATHER_CSV=%WEATHER_CSV_1%"
) else if exist "%WEATHER_CSV_2%" (
    set "WEATHER_CSV=%WEATHER_CSV_2%"
) else (
    set "WEATHER_CSV=%WEATHER_CSV_1%"
)

echo.
echo 请选择是否启动“两个模型”（用于生成离线预测数据）：
echo [1] 两个模型都启动
echo [2] 仅启动 dashboard 模型
echo [3] 仅启动 天气极端预警 模型
echo [0] 都不启动（直接启动前后端）
echo.

set "MODEL_CHOICE=1"
set /p "MODEL_CHOICE=请选择（默认 1）："

set "DO_MODEL_DASH=0"
set "DO_MODEL_EXTREME=0"

if "%MODEL_CHOICE%"=="1" (
    set "DO_MODEL_DASH=1"
    set "DO_MODEL_EXTREME=1"
) else if "%MODEL_CHOICE%"=="2" (
    set "DO_MODEL_DASH=1"
) else if "%MODEL_CHOICE%"=="3" (
    set "DO_MODEL_EXTREME=1"
) else if "%MODEL_CHOICE%"=="0" (
    set "DO_MODEL_DASH=0"
    set "DO_MODEL_EXTREME=0"
) else (
    echo 输入无效，默认启动两个模型。
    set "DO_MODEL_DASH=1"
    set "DO_MODEL_EXTREME=1"
)

if "%DO_MODEL_DASH%%DO_MODEL_EXTREME%"=="00" (
    goto START_APP
)

where python >nul 2>nul
if errorlevel 1 (
    echo 未检测到 Python，请先安装 Python。
    pause
    endlocal & exit /b 1
)

set "GEN_DASH=0"
if "%DO_MODEL_DASH%"=="1" (
    if exist "%DASH_OUT%" (
        set "tmp=0"
        set /p "tmp=检测到离线数据已存在，是否重新生成？(0=不生成 1=生成)："
        if "!tmp!"=="1" set "GEN_DASH=1"
    ) else (
        set "GEN_DASH=1"
    )
)

set "GEN_EXTREME=0"
if "%DO_MODEL_EXTREME%"=="1" (
    if exist "%EXTREME_OUT%" (
        set "tmp=0"
        set /p "tmp=检测到极端天气数据已存在，是否重新生成？(0=不生成 1=生成)："
        if "!tmp!"=="1" set "GEN_EXTREME=1"
    ) else (
        set "GEN_EXTREME=1"
    )
)

if "%DO_MODEL_DASH%"=="1" if "%GEN_DASH%"=="1" (
    echo.
    echo 正在生成 dashboard 离线数据...
    python "%ROOT%model\train_dashboard_model.py" --csv "%WEATHER_CSV%"
    if errorlevel 1 (
        echo 模型生成失败，请检查数据文件。
        pause
        endlocal & exit /b 1
    )
)

if "%DO_MODEL_EXTREME%"=="1" if "%GEN_EXTREME%"=="1" (
    echo.
    echo 正在生成极端天气预警数据...
    if not exist "%WEATHER_CSV%" (
        echo 未找到气象数据 CSV 文件。
        pause
        endlocal & exit /b 1
    )
    python "%ROOT%model\weather_extreme_predict_payload.py" --csv "%WEATHER_CSV%" --output "%EXTREME_OUT%"
    if errorlevel 1 (
        echo 极端天气模型生成失败。
        pause
        endlocal & exit /b 1
    )
)

:START_APP
echo.
set "API_PORT="
for %%P in (3001 3002 3003 3004 3005 3006 3007 3008 3009 3010) do (
    netstat -ano | findstr ":%%P" | findstr "LISTENING" >nul 2>nul
    if errorlevel 1 if not defined API_PORT set "API_PORT=%%P"
)

if not defined API_PORT (
    echo 端口 3001~3010 都已被占用，请先关闭占用端口的程序后再启动。
    pause
    endlocal & exit /b 1
)

if not "%API_PORT%"=="3001" (
    echo 检测到端口 3001 已被占用，自动切换到 %API_PORT%。
)

echo 正在启动后端 API（端口%API_PORT%）...
start "AQ Backend API" cmd /k "cd /d ""%ROOT%backend"" && set API_PORT=%API_PORT% && npm run server"

echo 正在启动前端页面（端口5173）...
start "AQ Frontend Vite" cmd /k "cd /d ""%ROOT%frontend"" && set VITE_API_BASE=http://localhost:%API_PORT% && npm run dev -- --host 0.0.0.0 --port 5173"

echo 等待服务启动中...
timeout /t 6 /nobreak >nul

start "" "http://localhost:5173"

echo.
echo 启动完成！
echo 后端：http://localhost:%API_PORT%
echo 前端：http://localhost:5173
echo.

pause
endlocal