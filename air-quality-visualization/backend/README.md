# backend（每 5 分钟同步全国地级市天气/空气到 MySQL；历史序列表为小时粒度）

**数据删除说明**：同步任务**不会**对 `city_observation_minute` / `city_observation_latest` 做 `DELETE` 或 `TRUNCATE`。只会 `INSERT … ON DUPLICATE KEY UPDATE`：仅当 `(city_id, ts)` 已存在时**更新该行**，其它时间点的旧记录会一直保留，除非你**手动**在库里清理。

## 1) 初始化数据库

把 `schema.sql` 执行到你的 MySQL（建库+建表）。

## 2) 配置环境变量

复制一份环境变量文件：

- `cp .env.example .env`（Windows 也可以手动复制）

然后填好：

- `MYSQL_*`：你的 MySQL 连接信息
- 二选一：
  - **模式 A（你自己的聚合 API）**：填 `API_URL`（可选再填 `API_AUTH_*`）
  - **模式 B（和风天气 QWeather）**：
    - 把 `QWEATHER_KEY` 填到 `.env`
    - **方案 B（推荐）**：准备一个“地级市种子列表”JSON 文件，填 `CITY_SEED_LIST_PATH`
      - 每项至少：`{ "name": "成都市", "province": "四川省" }`
      - 脚本会用 GeoAPI 自动查到 `location_id/经纬度` 并缓存到 MySQL 的 `city` 表
    - **方案 A（不推荐）**：从某个 GeoJSON 里直接筛 `level=city`（要求该 GeoJSON 确实包含 `level:"city"`），填 `CITY_GEOJSON_PATH`

## 3) 安装依赖并运行

在 `backend/` 目录：

```bash
npm i
npm run build:seed # 生成全国地级市种子列表（推荐先跑一次）
npm run once     # 只同步一次（建议先用这个验证）
npm start        # 常驻：每 5 分钟同步一次（见 src/index.js 定时任务）
```

## 4) 从 CSV 导入历史天气数据

将 UTF-8（可带 BOM）的 `.csv` 写入表 `city_observation_minute`：**upsert**，不删除已有数据；`source` 字段记为 `csv`。

**前提**：`city` 表里已有对应城市（与同步任务跑过一次即可）。每行需能匹配到城市，任选其一：

- 列 `adcode`（或 `city_id`）
- 或列 `name`（城市）+ `province`（省），且与库里 `city.name` / `city.province` 一致（会自动去掉空格）

**必填列**：`ts`（或 `time` / `datetime` / `时间`），格式如 `2025-03-20 10:00:00` 或 ISO。

**可选列**：`temp_c`、`humidity`、`wind_speed`、`weather_code`、`aqi`、`pm25`、`pm10`、`no2`、`so2`、`o3`、`co`（及常见中英文表头别名，见 `src/importWeatherCsv.js` 内 `HEADER_ALIASES`）。

```bash
# 先看解析结果（不写库）
npm run import:weather-csv -- ./data/weather_import_sample.csv --dry-run

# 正式导入
npm run import:weather-csv -- ./data/your_file.csv

# 同时用 CSV 里「每个 city 时间最新的一行」更新 city_observation_latest（仅当 ts 不早于当前 latest 才覆盖各字段）
npm run import:weather-csv -- ./data/your_file.csv --update-latest
```

示例见 `data/weather_import_sample.csv`（请把 `adcode` 换成你库里真实存在的行政区划代码）。

## 5) API 返回格式

脚本会尽量兼容常见字段，只要能拿到：

- `adcode`
- `name`
- `province`
- 天气/空气指标（temp/humidity/aqi/pm25...）

如果你的字段名不一样，改 `src/syncJob.js` 里的 `normalizeApiPayload()` 映射即可。

