/**
 * 将 CSV 天气/空气质量数据写入 city_observation_minute（upsert，不删除旧数据）。
 * 冲突行更新时：各指标用 COALESCE(新值, 旧值)，避免 NULL 覆盖已有数据。
 *
 * 用法（在 backend 目录）：
 *   node src/importWeatherCsv.js ./data/my_weather.csv
 *   node src/importWeatherCsv.js ./data/my_weather.csv --dry-run
 *   node src/importWeatherCsv.js ./data/my_weather.csv --update-latest
 *
 * 依赖：.env 中 MYSQL_*；city 表中需已有对应城市（adcode 或 城市名+省份 能匹配到）
 * 全字段 CSV（城市/省份/经纬度/体感/气压/风向/降水/小时维度等）需已执行 migrations/20250325_observation_csv_full_columns.sql 或新版 schema.sql
 */

import 'dotenv/config'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { createPoolFromEnv } from './db.js'

function parseArgs(argv) {
  const out = { dryRun: false, updateLatest: false, delimiter: ',', encoding: 'utf8' }
  const pos = []
  for (const a of argv) {
    if (a === '--dry-run') out.dryRun = true
    else if (a === '--update-latest') out.updateLatest = true
    else if (a.startsWith('--delimiter=')) out.delimiter = a.slice('--delimiter='.length) || ','
    else if (a.startsWith('--encoding=')) out.encoding = a.slice('--encoding='.length) || 'utf8'
    else if (!a.startsWith('-')) pos.push(a)
  }
  return { ...out, filePath: pos[0] || null }
}

/** 简单 CSV 行解析（支持双引号包裹、逗号分隔） */
export function parseCsvLine(line, delimiter = ',') {
  const result = []
  let cur = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (c === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"'
        i++
      } else {
        inQuotes = !inQuotes
      }
      continue
    }
    if (!inQuotes && c === delimiter) {
      result.push(cur.trim())
      cur = ''
      continue
    }
    cur += c
  }
  result.push(cur.trim())
  return result
}

function normKey(s) {
  return String(s || '')
    .replace(/^\uFEFF/, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_')
}

/** 表头别名 -> 标准字段名 */
const HEADER_ALIASES = {
  adcode: 'adcode',
  行政区划代码: 'adcode',
  city_id: 'city_id',
  cityid: 'city_id',
  name: 'name',
  city: 'name',
  城市: 'name',
  city_name: 'name',
  province: 'province',
  省: 'province',
  省份: 'province',
  prov: 'province',
  ts: 'ts',
  time: 'ts',
  datetime: 'ts',
  时间: 'ts',
  date: 'ts',
  temp_c: 'temp_c',
  temp: 'temp_c',
  temperature: 'temp_c',
  温度: 'temp_c',
  humidity: 'humidity',
  湿度: 'humidity',
  wind_speed: 'wind_speed',
  wind: 'wind_speed',
  风速: 'wind_speed',
  weather_code: 'weather_code',
  weather: 'weather_code',
  天气: 'weather_code',
  天气代码: 'weather_code',
  天气类型: 'weather_code',
  aqi: 'aqi',
  pm25: 'pm25',
  pm2_5: 'pm25',
  'pm2.5': 'pm25',
  pm10: 'pm10',
  no2: 'no2',
  so2: 'so2',
  o3: 'o3',
  co: 'co',

  obs_lat: 'obs_lat',
  lat: 'obs_lat',
  纬度: 'obs_lat',
  latitude: 'obs_lat',
  obs_lon: 'obs_lon',
  lon: 'obs_lon',
  lng: 'obs_lon',
  经度: 'obs_lon',
  longitude: 'obs_lon',

  feels_like_c: 'feels_like_c',
  feels_like: 'feels_like_c',
  apparent_temp: 'feels_like_c',
  体感温度: 'feels_like_c',

  pressure_hpa: 'pressure_hpa',
  pressure: 'pressure_hpa',
  气压: 'pressure_hpa',

  wind_direction: 'wind_direction',
  wind_dir: 'wind_direction',
  风向: 'wind_direction',

  precip_mm: 'precip_mm',
  precipitation: 'precip_mm',
  降水量: 'precip_mm',

  obs_hour: 'obs_hour',
  hour: 'obs_hour',
  小时: 'obs_hour',

  calendar_month: 'calendar_month',
  obs_month: 'calendar_month',
  month: 'calendar_month',
  月份: 'calendar_month',

  weekday: 'weekday',
  week_day: 'weekday',
  星期: 'weekday',

  is_workday: 'is_workday',
  workday: 'is_workday',
  工作日: 'is_workday',
}

function mapHeader(h) {
  const k = normKey(h)
  return HEADER_ALIASES[k] || k
}

function asNum(x) {
  if (x == null || x === '') return null
  const n = Number(String(x).replace(/,/g, ''))
  return Number.isFinite(n) ? n : null
}

function asInt(x) {
  const n = asNum(x)
  return n == null ? null : Math.round(n)
}

function asStr(x) {
  if (x == null || x === '') return null
  const s = String(x).trim()
  return s === '' ? null : s
}

/** 解析常见日期时间字符串为 MySQL DATETIME 字符串 */
function parseTs(raw) {
  if (raw == null || raw === '') return null
  const s = String(raw).trim()
  // 2025-03-20 14:00:00 / 2025-03-20T14:00:00 / 2025/03/20 14:00
  const normalized = s.replace(/\//g, '-').replace('T', ' ')
  const d = new Date(normalized)
  if (!Number.isFinite(d.getTime())) return null
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

function coalesceUpdates(fields) {
  return fields.map((c) => `${c}=COALESCE(VALUES(${c}), ${c})`)
}

function buildUpsertSql(rowCount) {
  const cols = [
    'city_id',
    'ts',
    'source',
    'csv_city',
    'csv_province',
    'obs_lat',
    'obs_lon',
    'feels_like_c',
    'pressure_hpa',
    'wind_direction',
    'precip_mm',
    'obs_hour',
    'calendar_month',
    'weekday',
    'is_workday',
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
  const ph = '(' + cols.map(() => '?').join(',') + ')'
  const mergeCols = cols.filter((c) => c !== 'city_id' && c !== 'ts')
  const sql =
    `INSERT INTO city_observation_minute (${cols.join(',')}) VALUES ` +
    Array.from({ length: rowCount }, () => ph).join(',') +
    ' ON DUPLICATE KEY UPDATE ' +
    ['source=VALUES(source)', ...coalesceUpdates(mergeCols.filter((c) => c !== 'source'))].join(',')
  return { sql, cols }
}

function buildLatestUpsertSql(rowCount) {
  const cols = [
    'city_id',
    'ts',
    'csv_city',
    'csv_province',
    'obs_lat',
    'obs_lon',
    'feels_like_c',
    'pressure_hpa',
    'wind_direction',
    'precip_mm',
    'obs_hour',
    'calendar_month',
    'weekday',
    'is_workday',
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
  const ph = '(' + cols.map(() => '?').join(',') + ')'
  const tail = cols.filter((c) => c !== 'city_id' && c !== 'ts')
  const sql =
    `INSERT INTO city_observation_latest (${cols.join(',')}) VALUES ` +
    Array.from({ length: rowCount }, () => ph).join(',') +
    ' ON DUPLICATE KEY UPDATE ' +
    [
      'ts=IF(VALUES(ts) >= ts, VALUES(ts), ts)',
      ...tail.map(
        (c) =>
          `${c}=IF(VALUES(ts) >= ts, COALESCE(VALUES(${c}), ${c}), ${c})`
      ),
    ].join(',')
  return { sql, cols }
}

function rowToMinuteParams(r) {
  return [
    r.city_id,
    r.ts,
    'csv',
    r.csv_city,
    r.csv_province,
    r.obs_lat,
    r.obs_lon,
    r.feels_like_c,
    r.pressure_hpa,
    r.wind_direction,
    r.precip_mm,
    r.obs_hour,
    r.calendar_month,
    r.weekday,
    r.is_workday,
    r.temp_c,
    r.humidity,
    r.wind_speed,
    r.weather_code,
    r.aqi,
    r.pm25,
    r.pm10,
    r.no2,
    r.so2,
    r.o3,
    r.co,
  ]
}

function rowToLatestParams(r) {
  return [
    r.city_id,
    r.ts,
    r.csv_city,
    r.csv_province,
    r.obs_lat,
    r.obs_lon,
    r.feels_like_c,
    r.pressure_hpa,
    r.wind_direction,
    r.precip_mm,
    r.obs_hour,
    r.calendar_month,
    r.weekday,
    r.is_workday,
    r.temp_c,
    r.humidity,
    r.wind_speed,
    r.weather_code,
    r.aqi,
    r.pm25,
    r.pm10,
    r.no2,
    r.so2,
    r.o3,
    r.co,
  ]
}

function chunk(arr, size) {
  const out = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

async function loadCityMaps(conn) {
  const [rows] = await conn.query('SELECT id, adcode, name, province FROM city')
  const byAdcode = new Map()
  const byNameProv = new Map()
  for (const r of rows) {
    byAdcode.set(String(r.adcode).trim(), Number(r.id))
    const name = String(r.name || '').replace(/\s+/g, '').trim()
    const prov = String(r.province || '').replace(/\s+/g, '').trim()
    if (name && prov) {
      const id = Number(r.id)
      byNameProv.set(`${prov}#${name}`, id)
      // CSV 常用「北京」+「北京市」，库中为「北京市」+「北京市」
      if (name.endsWith('市') && name.length > 2) {
        const shortName = name.slice(0, -1)
        const k = `${prov}#${shortName}`
        if (!byNameProv.has(k)) byNameProv.set(k, id)
      }
    }
  }
  return { byAdcode, byNameProv }
}

function resolveCityId(rowObj, maps) {
  const cid = rowObj.city_id
  if (cid != null && cid !== '') {
    const n = Number(cid)
    if (Number.isFinite(n) && n > 0) return n
  }
  const ad = rowObj.adcode != null ? String(rowObj.adcode).trim() : ''
  if (ad) {
    const id = maps.byAdcode.get(ad)
    if (id) return id
  }
  const name = String(rowObj.name || '').replace(/\s+/g, '').trim()
  const prov = String(rowObj.province || '').replace(/\s+/g, '').trim()
  if (name && prov) {
    const id = maps.byNameProv.get(`${prov}#${name}`)
    if (id) return id
  }
  return null
}

function normalizeRow(cells, headerKeys) {
  const o = {}
  for (let i = 0; i < headerKeys.length; i++) {
    const key = headerKeys[i]
    if (!key) continue
    o[key] = cells[i] != null ? cells[i] : ''
  }
  return o
}

export async function importWeatherCsvFromString(csvText, pool, opts = {}) {
  const dryRun = Boolean(opts.dryRun)
  const updateLatest = Boolean(opts.updateLatest)
  const delimiter = opts.delimiter || ','
  const batchSize = Math.max(50, Number(opts.batchSize) || 300)

  const text = csvText.replace(/^\uFEFF/, '')
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0)
  if (lines.length < 2) throw new Error('CSV 至少需要表头 + 1 行数据')

  const headerCells = parseCsvLine(lines[0], delimiter)
  const headerKeys = headerCells.map((h) => mapHeader(h))

  if (!headerKeys.includes('ts')) {
    throw new Error('CSV 必须包含时间列：ts / time / datetime / 时间')
  }

  const conn = await pool.getConnection()
  const maps = await loadCityMaps(conn)

  const pending = []
  let skipped = 0
  const errors = []

  for (let li = 1; li < lines.length; li++) {
    const cells = parseCsvLine(lines[li], delimiter)
    const raw = normalizeRow(cells, headerKeys)
    const ts = parseTs(raw.ts)
    if (!ts) {
      skipped++
      errors.push(`第 ${li + 1} 行：无法解析时间 "${raw.ts}"`)
      continue
    }

    const city_id = resolveCityId(raw, maps)
    if (!city_id) {
      skipped++
      errors.push(`第 ${li + 1} 行：无法匹配城市（需要 adcode 或 city_id 或 name+province）`)
      continue
    }

    const weather_code = raw.weather_code != null && raw.weather_code !== '' ? String(raw.weather_code) : null

    pending.push({
      city_id,
      ts,
      csv_city: asStr(raw.name),
      csv_province: asStr(raw.province),
      obs_lat: asNum(raw.obs_lat),
      obs_lon: asNum(raw.obs_lon),
      feels_like_c: asNum(raw.feels_like_c),
      pressure_hpa: asNum(raw.pressure_hpa),
      wind_direction: asStr(raw.wind_direction),
      precip_mm: asNum(raw.precip_mm),
      obs_hour: asInt(raw.obs_hour),
      calendar_month: asInt(raw.calendar_month),
      weekday: asInt(raw.weekday),
      is_workday: asInt(raw.is_workday),
      temp_c: asNum(raw.temp_c),
      humidity: asNum(raw.humidity),
      wind_speed: asNum(raw.wind_speed),
      weather_code,
      aqi: asInt(raw.aqi),
      pm25: asNum(raw.pm25),
      pm10: asNum(raw.pm10),
      no2: asNum(raw.no2),
      so2: asNum(raw.so2),
      o3: asNum(raw.o3),
      co: asNum(raw.co),
    })
  }

  let written = 0
  try {
    if (!dryRun && pending.length) {
      await conn.beginTransaction()
      try {
        for (const batch of chunk(pending, batchSize)) {
          const stmt = buildUpsertSql(batch.length)
          const params = []
          for (const r of batch) params.push(...rowToMinuteParams(r))
          await conn.query(stmt.sql, params)
          written += batch.length
        }

        if (updateLatest) {
          const byCity = new Map()
          for (const r of pending) {
            const prev = byCity.get(r.city_id)
            if (!prev || String(r.ts) > String(prev.ts)) byCity.set(r.city_id, r)
          }
          const latestRows = Array.from(byCity.values())
          for (const batch of chunk(latestRows, batchSize)) {
            const stmt = buildLatestUpsertSql(batch.length)
            const params = []
            for (const r of batch) params.push(...rowToLatestParams(r))
            await conn.query(stmt.sql, params)
          }
        }

        await conn.commit()
      } catch (e) {
        await conn.rollback()
        throw e
      }
    }
  } finally {
    conn.release()
  }

  return {
    dryRun,
    totalLines: lines.length - 1,
    okRows: pending.length,
    skipped,
    written: dryRun ? 0 : written,
    updateLatest,
    sampleErrors: errors.slice(0, 15),
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2))
  if (!opts.filePath) {
    console.error('用法: node src/importWeatherCsv.js <文件.csv> [--dry-run] [--update-latest]')
    process.exit(1)
  }

  const abs = path.isAbsolute(opts.filePath) ? opts.filePath : path.resolve(process.cwd(), opts.filePath)
  const csvText = await readFile(abs, opts.encoding)
  const pool = createPoolFromEnv()

  try {
    const r = await importWeatherCsvFromString(csvText.toString(), pool, {
      dryRun: opts.dryRun,
      updateLatest: opts.updateLatest,
      delimiter: opts.delimiter,
    })
    console.log(JSON.stringify(r, null, 2))
  } finally {
    await pool.end()
  }
}

// Node 推荐：仅在本文件被直接 node 执行时跑 main（避免被 import 时产生副作用）
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((e) => {
    console.error('[importWeatherCsv]', e?.message || e)
    process.exit(1)
  })
}
