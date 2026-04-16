# 空气质量可视化项目：使用说明

本项目是一个前后端分离的数据可视化系统，用于展示全国/省/市空气质量与气象数据，并支持模型联动看板。

## 1. 项目结构

- `frontend/`：Vue 3 + Vite 前端大屏
- `backend/`：Node.js + Express API 服务、数据同步与导入脚本
- `backend/data/`：后端运行时数据与模型产出文件目录
- `model/`：Python 模型训练与极端天气 payload 生成脚本
- `docs/`：项目文档（运行手册等）

## 2. 运行前准备

### 2.1 环境要求

- Node.js 18+（建议 20 LTS）
- npm 9+
- MySQL 8.0+
- Python 3.9+（仅训练模型时需要）

### 2.2 初始化数据库

1) 在 MySQL 中执行 `backend/schema.sql`。  
2) 确认数据库、表结构已创建成功（`city`、`city_observation_minute`、`city_observation_latest`）。

## 3. 后端启动

进入 `backend/` 后执行：

```bash
npm i
```

复制环境变量模板并填写：

```bash
cp .env.example .env
```

Windows 下可手动复制。重点配置：

- `MYSQL_HOST` / `MYSQL_PORT` / `MYSQL_USER` / `MYSQL_PASSWORD` / `MYSQL_DATABASE`
- 数据源模式（二选一或并存）：
  - Open-Meteo：`OPEN_METEO_ENABLED=true`（默认已开启）
  - QWeather：填写 `QWEATHER_KEY`

首次建议执行：

```bash
npm run build:seed
npm run once
```

常驻同步任务（每 5 分钟）：

```bash
npm start
```

启动 API 服务（前端调用）：

```bash
npm run server
```

默认 API 地址：`http://localhost:3001`

## 4. 前端启动

进入 `frontend/` 后执行：

```bash
npm i
```

前端接口地址在 `frontend/.env.local`：

```env
VITE_API_BASE=http://localhost:3001
```

开发模式启动：

```bash
npm run dev
```

构建与预览：

```bash
npm run build
npm run preview
```

## 5. 常用数据脚本

在 `backend/` 目录：

- 导入历史 CSV（先预检查）：
  ```bash
  npm run import:weather-csv -- ./data/weather_import_sample.csv --dry-run
  ```
- 正式导入：
  ```bash
  npm run import:weather-csv -- ./data/your_file.csv
  ```
- 导入后同步更新 `latest`（可选）：
  ```bash
  npm run import:weather-csv -- ./data/your_file.csv --update-latest
  ```

> 导入/同步逻辑为 upsert，不会执行整表删除。

## 6. 模型联动（可选）

模型脚本位于 `model/`：

- `train_dashboard_model.py`：训练并输出大屏联动文件（`dashboard_payload.json` 等）
- `weather_extreme_predict_payload.py`：生成极端天气逐小时 payload

示例（在项目根目录执行）：

```bash
python model/train_dashboard_model.py --csv ./weather_air_14days_full.csv
python model/weather_extreme_predict_payload.py --csv ./weather_air_14days_full.csv
```

常见 Python 依赖：

- `pandas`
- `numpy`
- `scikit-learn`
- `xgboost`（可选，不装则回退到 sklearn 模型）

## 7. 快速自检

后端启动后可访问：

- `GET /api/health`：数据库连通性
- `GET /api/debug/counts`：历史表/最新表数据量
- `GET /api/debug/ts`：历史表时间范围

例如：`http://localhost:3001/api/health`

## 8. 推荐启动顺序

1) 启动 MySQL 并完成 `schema.sql` 初始化  
2) 启动 `backend` 的同步任务：`npm start`  
3) 启动 `backend` 的 API 服务：`npm run server`  
4) 启动前端：`frontend` 下 `npm run dev`

---

更详细的部署与排障请查看 `docs/运行手册.md`。
