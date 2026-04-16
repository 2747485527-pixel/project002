/**
 * Open-Meteo 历史数据回填（独立脚本，不修改 air-quality-visualization 内代码）
 *
 * 说明：
 * - Open-Meteo 为按小时序列；本脚本每个整点写入 1 条，与后端同步任务「小时级历史表」一致。
 * - 仅写入 city_observation_minute，避免用历史时间覆盖 city_observation_latest。
 *
 * 用法（在 jishe 目录）：
 *   node backfill-openmeteo-month.mjs
 *   node backfill-openmeteo-month.mjs --dry-run
 *   node backfill-openmeteo-month.mjs --max-cities=5
 *   node backfill-openmeteo-month.mjs --past-days=31
 *
 * 依赖：使用 air-quality-visualization/backend 下已安装的 axios、mysql2、dotenv
 */

import { createRequire } from 'node:module'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import https from 'node:https'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const BACKEND_ROOT = path.join(__dirname, 'air-quality-visualization', 'backend')

const require = createRequire(path.join(BACKEND_ROOT, 'package.json'))
const axios = require('axios')
const mysql = require('mysql2/promise')
const dotenv = require('dotenv')

dotenv.config({ path: path.join(BACKEND_ROOT, '.env') })

function pad2(n) {
  return String(n).padStart(2, '0')
}

function toMysqlDatetime(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`
}

function asNum(x) {
  const n = Number(x)
  return Number.isFinite(n) ? n : null
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

function parseArgs(argv) {
  const out = { dryRun: false, maxCities: null, pastDays: 31, batchSize: 400 }
  for (const a of argv) {
    if (a === '--dry-run') out.dryRun = true
    else if (a.startsWith('--max-cities=')) {
      const n = Number(a.split('=')[1])
      if (Number.isFinite(n) && n > 0) out.maxCities = Math.floor(n)
    } else if (a.startsWith('--past-days=')) {
      const n = Number(a.split('=')[1])
      if (Number.isFinite(n) && n > 0) out.pastDays = Math.min(366, Math.floor(n))
    } else if (a.startsWith('--batch-size=')) {
      const n = Number(a.split('=')[1])
      if (Number.isFinite(n) && n >= 50) out.batchSize = Math.floor(n)
    }
  }
  return out
}

async function loadSeedCities(seedPath) {
  const abs = path.isAbsolute(seedPath) ? seedPath : path.resolve(BACKEND_ROOT, seedPath)
  const raw = await readFile(abs, 'utf8')
  const data = JSON.parse(raw)
  if (!Array.isArray(data)) throw new Error('种子文件必须是 JSON 数组')
  const out = []
  for (const x of data) {
    const adcode = x?.adcode != null ? String(x.adcode).trim() : ''
    const name = x?.name != null ? String(x.name).replace(/\s+/g, '').trim() : ''
    const province = x?.province != null ? String(x.province).replace(/\s+/g, '').trim() : ''
    const lon = asNum(x?.lon)
    const lat = asNum(x?.lat)
    if (!adcode || !name || !province || lon == null || lat == null) continue
    out.push({ adcode, name, province, lon, lat })
  }
  if (out.length === 0) throw new Error('种子中没有有效城市（需要 adcode/name/province/lon/lat）')
  return out
}

function createPoolFromEnv() {
  const {
    MYSQL_HOST,
    MYSQL_PORT,
    MYSQL_USER,
    MYSQL_PASSWORD,
    MYSQL_DATABASE,
    MYSQL_CONNECT_TIMEOUT_MS,
  } = process.env
  const connectTimeout =
    MYSQL_CONNECT_TIMEOUT_MS != null && String(MYSQL_CONNECT_TIMEOUT_MS).trim() !== ''
      ? Number(MYSQL_CONNECT_TIMEOUT_MS)
      : 12_000
  return mysql.createPool({
    host: MYSQL_HOST || '127.0.0.1',
    port: MYSQL_PORT ? Number(MYSQL_PORT) : 3306,
    user: MYSQL_USER || 'root',
    password: MYSQL_PASSWORD || '123456',
    database: MYSQL_DATABASE || 'air_quality',
    waitForConnections: true,
    connectionLimit: 5,
    queueLimit: 0,
    charset: 'utf8mb4',
    connectTimeout: Number.isFinite(connectTimeout) ? Math.max(1000, connectTimeout) : 12_000,
  })
}

async function upsertCities(conn, cities) {
  const unique = new Map()
  for (const c of cities) {
    if (!unique.has(c.adcode)) unique.set(c.adcode, c)
  }
  const values = Array.from(unique.values())
  if (values.length === 0) return
  const sql =
    'INSERT INTO city (adcode, name, province, qweather_location_id, lon, lat) VALUES ' +
    values.map(() => '(?, ?, ?, NULL, ?, ?)').join(',') +
    ' ON DUPLICATE KEY UPDATE ' +
    ['name=VALUES(name)', 'province=VALUES(province)', 'lon=COALESCE(VALUES(lon), lon)', 'lat=COALESCE(VALUES(lat), lat)'].join(',')
  const params = []
  for (const v of values) params.push(v.adcode, v.name, v.province, v.lon, v.lat)
  await conn.query(sql, params)
}

async function loadCityIdMap(conn) {
  const [rows] = await conn.query('SELECT id, adcode FROM city')
  const map = new Map()
  for (const r of rows) map.set(String(r.adcode), Number(r.id))
  return map
}

function chunk(arr, size) {
  const out = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

function buildMinuteInsert(rows) {
  const cols = [
    'city_id',
    'ts',
    'temp_c',
    'humidity',
    'wind_speed',
    'weather_code',
    'aqi',
    'pm25',
    'pm10',
    'no2',
    'so2',
    'o3',
    'co',
  ]
  const placeholders = '(' + cols.map(() => '?').join(',') + ')'
  const sql =
    `INSERT INTO city_observation_minute (${cols.join(',')}) VALUES ` +
    rows.map(() => placeholders).join(',') +
    ' ON DUPLICATE KEY UPDATE ' +
    [
      'temp_c=VALUES(temp_c)',
      'humidity=VALUES(humidity)',
      'wind_speed=VALUES(wind_speed)',
      'weather_code=VALUES(weather_code)',
      'aqi=VALUES(aqi)',
      'pm25=VALUES(pm25)',
      'pm10=VALUES(pm10)',
      'no2=VALUES(no2)',
      'so2=VALUES(so2)',
      'o3=VALUES(o3)',
      'co=VALUES(co)',
    ].join(',')
  return { sql, cols }
}

function rowParams(r, cols) {
  const obj = {
    city_id: r.city_id,
    ts: r.ts,
    temp_c: r.temp_c,
    humidity: r.humidity,
    wind_speed: r.wind_speed,
    weather_code: r.weather_code,
    aqi: r.aqi,
    pm25: r.pm25,
    pm10: r.pm10,
    no2: r.no2,
    so2: r.so2,
    o3: r.o3,
    co: r.co,
  }
  return cols.map((c) => obj[c] ?? null)
}

/** 每个整点一条（与后端 sync 写入粒度一致） */
function rowForHour({ city_id, hourStart, metrics }) {
  const base = new Date(hourStart)
  if (!Number.isFinite(base.getTime())) return null
  base.setMinutes(0, 0, 0)
  base.setSeconds(0, 0)
  return {
    city_id,
    ts: toMysqlDatetime(base),
    temp_c: metrics.temp_c,
    humidity: metrics.humidity,
    wind_speed: metrics.wind_speed,
    weather_code: metrics.weather_code,
    aqi: metrics.aqi,
    pm25: metrics.pm25,
    pm10: metrics.pm10,
    no2: metrics.no2,
    so2: metrics.so2,
    o3: metrics.o3,
    co: metrics.co,
  }
}

async function fetchOpenMeteoHourly({ lon, lat, pastDays }) {
  const {
    OPEN_METEO_WEATHER_URL = 'https://api.open-meteo.com/v1/forecast',
    OPEN_METEO_AIR_URL = 'https://air-quality-api.open-meteo.com/v1/air-quality',
    OPEN_METEO_INSECURE_TLS,
  } = process.env

  const insecureTls = String(OPEN_METEO_INSECURE_TLS || '').toLowerCase() === 'true'
  const httpsAgent = insecureTls ? new https.Agent({ rejectUnauthorized: false }) : undefined
  const common = { timeout: 60_000, httpsAgent, params: { latitude: lat, longitude: lon, timezone: 'auto', past_days: pastDays } }

  const wRes = await axios.get(OPEN_METEO_WEATHER_URL, {
    ...common,
    params: {
      ...common.params,
      hourly: 'temperature_2m,relative_humidity_2m,wind_speed_10m,weather_code',
    },
  })

  let aRes = null
  try {
    aRes = await axios.get(OPEN_METEO_AIR_URL, {
      ...common,
      params: {
        ...common.params,
        hourly: 'us_aqi,pm2_5,pm10,nitrogen_dioxide,sulphur_dioxide,ozone,carbon_monoxide',
      },
    })
  } catch {
    aRes = null
  }

  const w = wRes?.data?.hourly || {}
  const a = aRes?.data?.hourly || {}
  const times = Array.isArray(w.time) ? w.time : []
  const byTime = new Map()

  for (let i = 0; i < times.length; i++) {
    const t = times[i]
    byTime.set(String(t), {
      temp_c: asNum(w.temperature_2m?.[i]),
      humidity: asNum(w.relative_humidity_2m?.[i]),
      wind_speed: asNum(w.wind_speed_10m?.[i]),
      weather_code: w.weather_code?.[i] != null ? String(w.weather_code[i]) : null,
      aqi: null,
      pm25: null,
      pm10: null,
      no2: null,
      so2: null,
      o3: null,
      co: null,
    })
  }

  if (a?.time && Array.isArray(a.time)) {
    const emptyMetrics = () => ({
      temp_c: null,
      humidity: null,
      wind_speed: null,
      weather_code: null,
      aqi: null,
      pm25: null,
      pm10: null,
      no2: null,
      so2: null,
      o3: null,
      co: null,
    })
    for (let i = 0; i < a.time.length; i++) {
      const t = String(a.time[i])
      const base = byTime.has(t) ? byTime.get(t) : emptyMetrics()
      base.aqi = a.us_aqi?.[i] != null ? Number(a.us_aqi[i]) : null
      base.pm25 = asNum(a.pm2_5?.[i])
      base.pm10 = asNum(a.pm10?.[i])
      base.no2 = asNum(a.nitrogen_dioxide?.[i])
      base.so2 = asNum(a.sulphur_dioxide?.[i])
      base.o3 = asNum(a.ozone?.[i])
      base.co = asNum(a.carbon_monoxide?.[i])
      byTime.set(t, base)
    }
  }

  return byTime
}

async function main() {
  const opts = parseArgs(process.argv.slice(2))
  const seedPath = process.env.CITY_SEED_LIST_PATH || './data/prefecture_cities_seed.json'
  if (!seedPath) throw new Error('请在 backend/.env 中配置 CITY_SEED_LIST_PATH')

  let cities = await loadSeedCities(seedPath)
  if (opts.maxCities) {
    cities = cities.slice(0, opts.maxCities)
  } else {
    const envMax = process.env.OPEN_METEO_MAX_CITIES
    const envN = envMax != null && String(envMax).trim() !== '' ? Number(envMax) : null
    if (Number.isFinite(envN) && envN > 0) cities = cities.slice(0, Math.floor(envN))
  }

  // eslint-disable-next-line no-console
  console.log(`[backfill] cities=${cities.length} past_days=${opts.pastDays} dryRun=${opts.dryRun}`)

  const pool = createPoolFromEnv()
  const conn = await pool.getConnection()
  let inserted = 0
  try {
    await conn.beginTransaction()
    await upsertCities(conn, cities)
    const cityIdMap = await loadCityIdMap(conn)

    for (let idx = 0; idx < cities.length; idx++) {
      const c = cities[idx]
      const cityId = cityIdMap.get(c.adcode)
      if (!cityId) {
        // eslint-disable-next-line no-console
        console.warn(`[backfill] skip no city_id adcode=${c.adcode}`)
        continue
      }

      // eslint-disable-next-line no-console
      console.log(`[backfill] (${idx + 1}/${cities.length}) ${c.province} ${c.name} ...`)

      let byTime
      try {
        byTime = await fetchOpenMeteoHourly({ lon: c.lon, lat: c.lat, pastDays: opts.pastDays })
      } catch (e) {
        const status = e?.response?.status
        // eslint-disable-next-line no-console
        console.error(`[backfill] fetch failed ${c.name}: ${status ?? ''} ${e?.message || e}`)
        await sleep(1500)
        continue
      }

      const allRows = []
      for (const [t, m] of byTime.entries()) {
        const hourStart = new Date(t.includes('T') ? t : `${t.replace(' ', 'T')}`)
        const row = rowForHour({ city_id: cityId, hourStart, metrics: m })
        if (row) allRows.push(row)
      }

      if (opts.dryRun) {
        // eslint-disable-next-line no-console
        console.log(`[backfill] dry-run would write ~${allRows.length} rows for ${c.name}`)
      } else {
        const batches = chunk(allRows, opts.batchSize)
        for (const b of batches) {
          if (b.length === 0) continue
          const stmt = buildMinuteInsert(b)
          const params = []
          for (const r of b) params.push(...rowParams(r, stmt.cols))
          await conn.query(stmt.sql, params)
          inserted += b.length
        }
      }

      await sleep(250)
    }

    await conn.commit()
    // eslint-disable-next-line no-console
    console.log(`[backfill] done. inserted_or_updated_rows≈${inserted}`)
  } catch (e) {
    await conn.rollback()
    throw e
  } finally {
    conn.release()
    await pool.end()
  }
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error('[backfill] fatal', e?.message || e)
  process.exit(1)
})
