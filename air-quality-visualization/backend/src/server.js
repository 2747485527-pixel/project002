import 'dotenv/config'
import cors from 'cors'
import express from 'express'
import { createPoolFromEnv, withDbRetry } from './db.js'
import { spawn } from 'node:child_process'
import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'

const app = express()
app.use(cors())
app.use(express.json({ limit: '1mb' }))

const pool = createPoolFromEnv()

let _provinceByAdcode = null
async function loadProvinceByAdcode() {
  if (_provinceByAdcode) return _provinceByAdcode
  const seedPath = process.env.CITY_SEED_LIST_PATH || './data/prefecture_cities_seed.json'
  const abs = path.isAbsolute(seedPath) ? seedPath : path.resolve(process.cwd(), seedPath)
  try {
    const raw = await readFile(abs, 'utf8')
    const arr = JSON.parse(raw)
    const m = new Map()
    if (Array.isArray(arr)) {
      for (const x of arr) {
        const ad = x?.adcode != null ? String(x.adcode).trim() : ''
        const prov = x?.province != null ? String(x.province).replace(/\s+/g, '').trim() : ''
        if (!ad || !prov) continue
        m.set(ad, prov)
      }
    }
    _provinceByAdcode = m
    return m
  } catch {
    _provinceByAdcode = new Map()
    return _provinceByAdcode
  }
}

function asNonEmptyString(x) {
  const s = x == null ? '' : String(x).trim()
  return s.length > 0 ? s : null
}

function roundNum(x, digits = 0) {
  // MySQL 聚合（AVG/SUM）可能返回 NULL；这里不能把 NULL 当作 0
  if (x == null || x === '') return null
  const n = Number(x)
  if (!Number.isFinite(n)) return null
  const p = 10 ** Math.max(0, digits)
  return Math.round(n * p) / p
}

function asPositiveInt(x, fallback) {
  const n = Number(x)
  if (Number.isFinite(n) && n > 0) return Math.floor(n)
  return fallback
}

function toYmd(date) {
  const d = new Date(date)
  const pad2 = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

function toHms(ts) {
  const d = new Date(ts)
  const pad2 = (n) => String(n).padStart(2, '0')
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`
}

function toHmMinute(ts) {
  const d = new Date(ts)
  const pad2 = (n) => String(n).padStart(2, '0')
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}

/** 用于小时级序列横轴（可跨日） */
function toYmdHm(ts) {
  const d = new Date(ts)
  const pad2 = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}

function toHm(ts) {
  const d = new Date(ts)
  const pad2 = (n) => String(n).padStart(2, '0')
  return `${pad2(d.getHours())}:00`
}

function toMd(ts) {
  const d = new Date(ts)
  const pad2 = (n) => String(n).padStart(2, '0')
  return `${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

function toYm(ts) {
  const d = new Date(ts)
  const pad2 = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`
}

function floorToHour(d) {
  const x = new Date(d)
  x.setMinutes(0, 0, 0)
  return x
}

function addHours(d, n) {
  const x = new Date(d)
  x.setHours(x.getHours() + n)
  return x
}

function floorToDay(d) {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  return x
}

function addDays(d, n) {
  const x = new Date(d)
  x.setDate(x.getDate() + n)
  return x
}

function floorToMonth(d) {
  const x = new Date(d)
  x.setDate(1)
  x.setHours(0, 0, 0, 0)
  return x
}

function addMonths(d, n) {
  const x = new Date(d)
  x.setMonth(x.getMonth() + n)
  return x
}

function daysInMonth(d) {
  const x = new Date(d)
  const y = x.getFullYear()
  const m = x.getMonth()
  return new Date(y, m + 1, 0).getDate()
}

function classifyAir(aqi, pm25) {
  const v = Number.isFinite(Number(aqi)) ? Number(aqi) : Number.isFinite(Number(pm25)) ? Number(pm25) : null
  if (v == null) return '未知'
  if (v <= 50) return '优'
  if (v <= 100) return '良'
  if (v <= 150) return '轻度污染'
  if (v <= 200) return '中度污染'
  if (v <= 300) return '重度污染'
  return '严重污染'
}

function weatherTextFromCode(code) {
  const c = code == null ? '' : String(code).trim()
  if (!c) return '—'
  const n = Number.parseInt(c, 10)
  // 若数据源直接给了文本（例如 “多云/晴/小雨”），直接用文本展示
  if (Number.isNaN(n)) return c.slice(0, 16)

  // 常见天气现象编码（如和风天气/QWeather）
  if (n === 100) return '晴'
  if (n >= 101 && n <= 104) return '多云'
  if (n >= 300 && n <= 399) return '下雨'
  if (n >= 400 && n <= 499) return '下雪'
  if (n >= 500 && n <= 515) return '雾霾'
  if (n >= 200 && n <= 213) return '有风'

  // Open-Meteo / WMO 代码（current.weather_code）
  if (n === 0) return '晴'
  if (n >= 1 && n <= 3) return '多云'
  if (n === 45 || n === 48) return '有雾'
  if ((n >= 51 && n <= 57) || (n >= 61 && n <= 67) || (n >= 80 && n <= 82)) return '下雨'
  if ((n >= 71 && n <= 77) || (n >= 85 && n <= 86)) return '下雪'
  if (n === 95 || n === 96 || n === 99) return '雷暴'
  return '其他'
}

function normalizeAreaName(s) {
  const name = asNonEmptyString(s)
  if (!name) return null
  return name.replace(/\s+/g, '').trim()
}

function areaNameVariants(input) {
  const name = normalizeAreaName(input)
  if (!name) return []

  const variants = new Set([name])
  const stripSuffixes = [
    '特别行政区',
    '维吾尔自治区',
    '壮族自治区',
    '回族自治区',
    '自治区',
    '省',
    '市',
  ]

  for (const suf of stripSuffixes) {
    if (name.endsWith(suf) && name.length > suf.length) {
      variants.add(name.slice(0, -suf.length))
    }
  }

  // 兼容“深圳” vs “深圳市”这类命名差异：
  // 如果输入不是以“市”结尾，额外加入“{name}市”作为候选。
  // 避免对已经明确为“自治区/地区/盟/县/区/省”等后缀的名字做强行补全，减少误匹配。
  const suffixBlockForCity = ['特别行政区', '维吾尔自治区', '壮族自治区', '回族自治区', '自治区', '地区', '盟', '省', '市', '县', '区']
  const isAlreadyCity = name.endsWith('市')
  const isBlocked = suffixBlockForCity.some((s) => name.endsWith(s))
  if (!isAlreadyCity && !isBlocked && name.length > 1) {
    variants.add(`${name}市`)
  }

  // 直辖市常见互转：北京 <-> 北京市
  const municipalities = new Set(['北京', '上海', '天津', '重庆'])
  if (municipalities.has(name)) variants.add(`${name}市`)
  if (name.endsWith('市') && municipalities.has(name.slice(0, -1))) variants.add(name.slice(0, -1))

  // 台湾常见互转：台湾 <-> 台湾省
  if (name === '台湾') variants.add('台湾省')
  if (name === '台湾省') variants.add('台湾')

  return Array.from(variants)
}

function toGeoProvinceName(input) {
  const name = normalizeAreaName(input)
  if (!name) return null

  const direct = new Map([
    ['北京', '北京市'],
    ['上海', '上海市'],
    ['天津', '天津市'],
    ['重庆', '重庆市'],
    ['台湾', '台湾省'],
    ['香港', '香港特别行政区'],
    ['澳门', '澳门特别行政区'],
  ])
  if (direct.has(name)) return direct.get(name)

  // 已经是 GeoJSON 常见形式就不动
  const keepSuffixes = [
    '特别行政区',
    '维吾尔自治区',
    '壮族自治区',
    '回族自治区',
    '自治区',
    '省',
    '市',
  ]
  for (const suf of keepSuffixes) {
    if (name.endsWith(suf)) return name
  }

  return `${name}省`
}

async function resolveScope(conn, name, provinceHint = null) {
  const nRaw = asNonEmptyString(name) || '全国'
  if (nRaw === '全国') return { scope: 'nation', name: '全国' }

  const variants = areaNameVariants(nRaw)
  const provinceVariants = areaNameVariants(provinceHint || '')
  const preferredProvinces = provinceVariants.filter(Boolean)

  if (preferredProvinces.length > 0) {
    for (const v of variants) {
      const [cRows] = await conn.query(
        'SELECT id, name, province FROM city WHERE name = ? AND province IN (' +
          preferredProvinces.map(() => '?').join(',') +
          ') ORDER BY id ASC LIMIT 1',
        [v, ...preferredProvinces]
      )
      if (Array.isArray(cRows) && cRows.length > 0) {
        return { scope: 'city', name: cRows[0].name, cityId: Number(cRows[0].id), province: cRows[0].province }
      }
    }
  }

  // 优先按“城市名”匹配：避免北京/上海等直辖市被误判为省级聚合
  for (const v of variants) {
    const [cRows] = await conn.query('SELECT id, name, province FROM city WHERE name = ? ORDER BY id ASC LIMIT 1', [v])
    if (Array.isArray(cRows) && cRows.length > 0) {
      return { scope: 'city', name: cRows[0].name, cityId: Number(cRows[0].id), province: cRows[0].province }
    }
  }

  for (const v of variants) {
    const [pRows] = await conn.query('SELECT 1 FROM city WHERE province = ? LIMIT 1', [v])
    if (Array.isArray(pRows) && pRows.length > 0) return { scope: 'province', name: v }
  }

  return { scope: 'nation', name: '全国', fallbackFrom: nRaw }
}

app.get('/api/health', async (_req, res) => {
  try {
    const r = await withDbRetry(async () => {
      const [rows] = await pool.query('SELECT 1 AS ok')
      return rows?.[0]?.ok === 1
    })
    res.json({ ok: Boolean(r) })
  } catch (e) {
    res.status(500).json({ ok: false, error: e?.message || String(e) })
  }
})

app.get('/api/debug/ts', async (_req, res) => {
  try {
    const [rows] = await withDbRetry(async () =>
      pool.query(
        `
          SELECT
            MIN(ts) AS min_ts,
            MAX(ts) AS max_ts,
            COUNT(*) AS cnt
          FROM city_observation_minute
        `
      )
    )
    res.json({ ok: true, data: rows?.[0] || null })
  } catch (e) {
    res.status(500).json({ ok: false, error: e?.message || String(e) })
  }
})

app.get('/api/debug/counts', async (_req, res) => {
  try {
    const data = await withDbRetry(async () => {
      const [minuteRows] = await pool.query(
        `
          SELECT
            COUNT(*) AS minute_cnt,
            MAX(ts) AS minute_max_ts
          FROM city_observation_minute
        `
      )
      const [latestRows] = await pool.query(
        `
          SELECT
            COUNT(*) AS latest_cnt,
            MAX(ts) AS latest_max_ts
          FROM city_observation_latest
        `
      )
      return {
        minute: minuteRows?.[0] || null,
        latest: latestRows?.[0] || null,
      }
    })
    res.json({ ok: true, data })
  } catch (e) {
    res.status(500).json({ ok: false, error: e?.message || String(e) })
  }
})

app.get('/api/debug/provinces', async (_req, res) => {
  try {
    const [rows] = await withDbRetry(async () =>
      pool.query(
        `
          SELECT province, COUNT(*) AS city_cnt
          FROM city
          GROUP BY province
          ORDER BY city_cnt DESC, province ASC
        `
      )
    )
    res.json({ ok: true, data: rows || [] })
  } catch (e) {
    res.status(500).json({ ok: false, error: e?.message || String(e) })
  }
})

app.get('/api/debug/resolve', async (req, res) => {
  const name = asNonEmptyString(req.query.name)
  if (!name) {
    res.status(400).json({ ok: false, error: '缺少 name' })
    return
  }

  try {
    const data = await withDbRetry(async () => {
      const conn = await pool.getConnection()
      try {
        const variants = areaNameVariants(name)
        const checks = []

        for (const v of variants) {
          const [pRows] = await conn.query('SELECT COUNT(*) AS cnt FROM city WHERE province = ?', [v])
          const [cRows] = await conn.query('SELECT COUNT(*) AS cnt FROM city WHERE name = ?', [v])
          checks.push({ v, provinceCnt: Number(pRows?.[0]?.cnt || 0), cityNameCnt: Number(cRows?.[0]?.cnt || 0) })
        }

        const resolved = await resolveScope(conn, name)
        return { input: name, variants, checks, resolved }
      } finally {
        conn.release()
      }
    })

    res.json({ ok: true, data })
  } catch (e) {
    res.status(500).json({ ok: false, error: e?.message || String(e) })
  }
})

// 供前端联动用：把名称解析成 nation/province/city，并在 city 时返回 province/cityId
app.get('/api/city/resolve', async (req, res) => {
  const name = asNonEmptyString(req.query.name)
  const province = asNonEmptyString(req.query.province)
  if (!name) {
    res.status(400).json({ ok: false, error: '缺少 name' })
    return
  }

  try {
    const data = await withDbRetry(async () => {
      const conn = await pool.getConnection()
      try {
        return await resolveScope(conn, name, province)
      } finally {
        conn.release()
      }
    })
    res.json({ ok: true, data })
  } catch (e) {
    res.status(500).json({ ok: false, error: e?.message || String(e) })
  }
})

// 排查缺数：哪些城市没有 latest / latest 为 NULL / 或者超过 N 分钟没更新
app.get('/api/debug/missing', async (req, res) => {
  const limit = asPositiveInt(req.query.limit, 50)
  const staleMinutes = Number.isFinite(Number(req.query.staleMinutes)) ? Number(req.query.staleMinutes) : 15

  try {
    const data = await withDbRetry(async () => {
      const [summaryRows] = await pool.query(
        `
          SELECT
            (SELECT COUNT(*) FROM city) AS city_cnt,
            (SELECT COUNT(*) FROM city_observation_latest) AS latest_cnt,
            (SELECT COUNT(*) FROM city c LEFT JOIN city_observation_latest l ON l.city_id=c.id WHERE l.city_id IS NULL) AS no_latest_cnt,
            (SELECT COUNT(*) FROM city c JOIN city_observation_latest l ON l.city_id=c.id WHERE l.pm25 IS NULL AND l.aqi IS NULL AND l.temp_c IS NULL AND l.humidity IS NULL) AS all_null_cnt,
            (SELECT COUNT(*) FROM city_observation_latest WHERE ts < (NOW() - INTERVAL ? MINUTE)) AS stale_cnt
        `,
        [staleMinutes]
      )

      const [noLatest] = await pool.query(
        `
          SELECT c.id, c.name, c.province, c.adcode
          FROM city c
          LEFT JOIN city_observation_latest l ON l.city_id = c.id
          WHERE l.city_id IS NULL
          ORDER BY c.province, c.name
          LIMIT ?
        `,
        [limit]
      )

      const [allNull] = await pool.query(
        `
          SELECT c.id, c.name, c.province, c.adcode, l.ts
          FROM city c
          JOIN city_observation_latest l ON l.city_id = c.id
          WHERE l.pm25 IS NULL AND l.aqi IS NULL AND l.temp_c IS NULL AND l.humidity IS NULL
          ORDER BY l.ts DESC
          LIMIT ?
        `,
        [limit]
      )

      const [stale] = await pool.query(
        `
          SELECT c.id, c.name, c.province, c.adcode, l.ts
          FROM city c
          JOIN city_observation_latest l ON l.city_id = c.id
          WHERE l.ts < (NOW() - INTERVAL ? MINUTE)
          ORDER BY l.ts ASC
          LIMIT ?
        `,
        [staleMinutes, limit]
      )

      return {
        staleMinutes,
        summary: summaryRows?.[0] || null,
        samples: {
          noLatest: noLatest || [],
          allNull: allNull || [],
          stale: stale || [],
        },
      }
    })

    res.json({ ok: true, data })
  } catch (e) {
    res.status(500).json({ ok: false, error: e?.message || String(e) })
  }
})

// 全国：按省聚合（最新）
app.get('/api/map/nation', async (_req, res) => {
  try {
    const [rows] = await withDbRetry(async () =>
      pool.query(
        `
          SELECT
            c.province AS name,
            COUNT(*) AS n,
            AVG(COALESCE(l.pm25, l.aqi)) AS pm25,
            AVG(l.temp_c) AS temp_c,
            AVG(l.humidity) AS humidity
          FROM city_observation_latest l
          JOIN city c ON c.id = l.city_id
          GROUP BY c.province
          ORDER BY c.province ASC
        `
      )
    )
    // 兼容 DB 里省名可能不带 “省/市” 的情况：转成 GeoJSON 常见命名并做加权合并
    const merged = new Map()
    for (const r of rows || []) {
      const display = toGeoProvinceName(r.name) || r.name
      const n = Number(r.n || 0) || 0
      if (!merged.has(display)) {
        merged.set(display, { name: display, n: 0, pm25Sum: 0, tempSum: 0, humSum: 0, pm25Cnt: 0, tempCnt: 0, humCnt: 0 })
      }
      const m = merged.get(display)
      m.n += n

      // 注意：Number(null)===0，会把 SQL 的 NULL 均值误当成 0 参与加权
      const pm25N = r.pm25 != null && r.pm25 !== '' ? Number(r.pm25) : NaN
      if (Number.isFinite(pm25N)) {
        m.pm25Sum += pm25N * n
        m.pm25Cnt += n
      }
      const tempN = r.temp_c != null && r.temp_c !== '' ? Number(r.temp_c) : NaN
      if (Number.isFinite(tempN)) {
        m.tempSum += tempN * n
        m.tempCnt += n
      }
      const humN = r.humidity != null && r.humidity !== '' ? Number(r.humidity) : NaN
      if (Number.isFinite(humN)) {
        m.humSum += humN * n
        m.humCnt += n
      }
    }

    const data = Array.from(merged.values())
      .map((m) => ({
        name: m.name,
        pm25: m.pm25Cnt > 0 ? roundNum(m.pm25Sum / m.pm25Cnt, 1) : null,
        temp_c: m.tempCnt > 0 ? roundNum(m.tempSum / m.tempCnt, 1) : null,
        humidity: m.humCnt > 0 ? roundNum(m.humSum / m.humCnt, 1) : null,
      }))
      .sort((a, b) => String(a.name).localeCompare(String(b.name), 'zh-CN'))

    res.json({ ok: true, data })
  } catch (e) {
    res.status(500).json({ ok: false, error: e?.message || String(e) })
  }
})

// 省：列出该省城市（最新）
app.get('/api/map/province', async (req, res) => {
  const province = asNonEmptyString(req.query.province)
  if (!province) {
    res.status(400).json({ ok: false, error: '缺少 province' })
    return
  }

  try {
    const variants = areaNameVariants(province)
    const [rows] = await withDbRetry(async () =>
      pool.query(
        `
          SELECT
            c.name AS name,
            COALESCE(l.pm25, l.aqi) AS pm25,
            l.temp_c AS temp_c,
            l.humidity AS humidity
          FROM city c
          LEFT JOIN city_observation_latest l ON l.city_id = c.id
          WHERE c.province IN (${variants.map(() => '?').join(',')})
          ORDER BY c.name ASC
        `,
        variants.length > 0 ? variants : [province]
      )
    )
    res.json({
      ok: true,
      data: (rows || []).map((r) => ({
        name: r.name,
        pm25: roundNum(r.pm25, 1),
        temp_c: roundNum(r.temp_c, 1),
        humidity: roundNum(r.humidity, 1),
      })),
    })
  } catch (e) {
    res.status(500).json({ ok: false, error: e?.message || String(e) })
  }
})

// 当前（全国/省/市）概览
app.get('/api/metrics/latest', async (req, res) => {
  // 兼容：部分旧前端可能把 city 当作 name 传参
  const name = asNonEmptyString(req.query.name) || asNonEmptyString(req.query.city) || '全国'

  try {
    const result = await withDbRetry(async () => {
      const conn = await pool.getConnection()
      try {
        const scope = await resolveScope(conn, name)

        if (scope.scope === 'city') {
          const [rows] = await conn.query(
            `
              SELECT l.ts, l.temp_c, l.humidity, l.wind_speed, l.weather_code, l.aqi, l.pm25
              FROM city_observation_latest l
              WHERE l.city_id = ?
              LIMIT 1
            `,
            [scope.cityId]
          )
          const r = rows?.[0] || null
          return {
            scope: 'city',
            name: scope.name,
            ts: r?.ts || null,
            temp_c: r?.temp_c ?? null,
            humidity: r?.humidity ?? null,
            wind_speed: r?.wind_speed ?? null,
            weather_code: r?.weather_code ?? null,
            aqi: r?.aqi ?? null,
            pm25: r?.pm25 ?? null,
          }
        }

        if (scope.scope === 'province') {
          const [codeRows] = await conn.query(
            `
              SELECT l.weather_code AS weather_code, COUNT(*) AS cnt
              FROM city_observation_latest l
              JOIN city c ON c.id = l.city_id
              WHERE c.province = ? AND l.weather_code IS NOT NULL
              GROUP BY l.weather_code
              ORDER BY cnt DESC
              LIMIT 1
            `,
            [scope.name]
          )
          const topCode = codeRows?.[0]?.weather_code ?? null
          const [rows] = await conn.query(
            `
              SELECT
                MAX(l.ts) AS ts,
                AVG(l.temp_c) AS temp_c,
                AVG(l.humidity) AS humidity,
                AVG(l.wind_speed) AS wind_speed,
                AVG(l.aqi) AS aqi,
                AVG(l.pm25) AS pm25
              FROM city_observation_latest l
              JOIN city c ON c.id = l.city_id
              WHERE c.province = ?
            `,
            [scope.name]
          )
          const r = rows?.[0] || {}
          return { scope: 'province', name: scope.name, ...r, weather_code: topCode }
        }

        const [codeRows] = await conn.query(
          `
            SELECT weather_code, COUNT(*) AS cnt
            FROM city_observation_latest
            WHERE weather_code IS NOT NULL
            GROUP BY weather_code
            ORDER BY cnt DESC
            LIMIT 1
          `
        )
        const topCode = codeRows?.[0]?.weather_code ?? null
        const [rows] = await conn.query(
          `
            SELECT
              MAX(ts) AS ts,
              AVG(temp_c) AS temp_c,
              AVG(humidity) AS humidity,
              AVG(wind_speed) AS wind_speed,
              AVG(aqi) AS aqi,
              AVG(pm25) AS pm25
            FROM city_observation_latest
          `
        )
        const r = rows?.[0] || {}
        return { scope: 'nation', name: '全国', ...r, weather_code: topCode }
      } finally {
        conn.release()
      }
    })

    const airLevel = classifyAir(result?.aqi, result?.pm25)
    res.json({
      ok: true,
      data: {
        ...result,
        temp_c: roundNum(result?.temp_c, 1),
        humidity: roundNum(result?.humidity, 1),
        wind_speed: roundNum(result?.wind_speed, 1),
        aqi: roundNum(result?.aqi, 1),
        pm25: roundNum(result?.pm25, 1),
        air_text: `空气质量：${airLevel}`,
        weather_text: weatherTextFromCode(result?.weather_code),
      },
    })
  } catch (e) {
    res.status(500).json({ ok: false, error: e?.message || String(e) })
  }
})

// PM2.5 趋势（最近 N 条：历史库为小时粒度；最新值见 city_observation_latest）
app.get('/api/series/pm25', async (req, res) => {
  // 兼容：部分旧前端可能把 city 当作 name 传参
  const name = asNonEmptyString(req.query.name) || asNonEmptyString(req.query.city) || '全国'
  const range = asNonEmptyString(req.query.range) // day | month | year | null(legacy)
  const limit = asPositiveInt(req.query.limit, 20)

  try {
    const payload = await withDbRetry(async () => {
      const conn = await pool.getConnection()
      try {
        const scope = await resolveScope(conn, name)
        const isDay = range === 'day'
        const isMonth = range === 'month'
        const isYear = range === 'year'
        const getScopeLatestTs = async () => {
          if (scope.scope === 'city') {
            const [rows] = await conn.query(
              `
                SELECT MAX(ts) AS max_ts
                FROM city_observation_minute
                WHERE city_id = ?
              `,
              [scope.cityId]
            )
            return rows?.[0]?.max_ts ?? null
          }
          if (scope.scope === 'province') {
            const [rows] = await conn.query(
              `
                SELECT MAX(m.ts) AS max_ts
                FROM city_observation_minute m
                JOIN city c ON c.id = m.city_id
                WHERE c.province = ?
              `,
              [scope.name]
            )
            return rows?.[0]?.max_ts ?? null
          }
          const [rows] = await conn.query(
            `
              SELECT MAX(ts) AS max_ts
              FROM city_observation_minute
            `
          )
          return rows?.[0]?.max_ts ?? null
        }
        const latestTs = await getScopeLatestTs()
        const anchor = Number.isFinite(new Date(latestTs).getTime()) ? new Date(latestTs) : new Date()
        const dbSeriesMeta = {
          maxTs: latestTs,
          dataSource: 'city_observation_minute',
        }

        // legacy：按小时取最近 N 条（ts 为整点）
        if (!isDay && !isMonth && !isYear) {
          if (scope.scope === 'city') {
            const [rows] = await conn.query(
              `
                SELECT ts, COALESCE(pm25, aqi) AS pm25
                FROM city_observation_minute
                WHERE city_id = ?
                ORDER BY ts DESC
                LIMIT ?
              `,
              [scope.cityId, limit]
            )
            return { scope, kind: 'legacyHour', stepSec: 3600, rows: rows || [], ...dbSeriesMeta }
          }

          if (scope.scope === 'province') {
            const [rows] = await conn.query(
              `
                SELECT m.ts AS ts, AVG(COALESCE(m.pm25, m.aqi)) AS pm25
                FROM city_observation_minute m
                JOIN city c ON c.id = m.city_id
                WHERE c.province = ?
                GROUP BY m.ts
                ORDER BY m.ts DESC
                LIMIT ?
              `,
              [scope.name, limit]
            )
            return { scope, kind: 'legacyHour', stepSec: 3600, rows: rows || [], ...dbSeriesMeta }
          }

          const [rows] = await conn.query(
            `
              SELECT ts, AVG(COALESCE(pm25, aqi)) AS pm25
              FROM city_observation_minute
              GROUP BY ts
              ORDER BY ts DESC
              LIMIT ?
            `,
            [limit]
          )
          return { scope, kind: 'legacyHour', stepSec: 3600, rows: rows || [], ...dbSeriesMeta }
        }

        // day：库内「最新一条所在日历日」按小时聚合（边界用 SQL DATE，避免 Node 时区与 DATETIME 墙钟错位导致整天无数据）
        if (isDay) {
          if (scope.scope === 'city') {
            const [rows] = await conn.query(
              `
                SELECT
                  DATE_FORMAT(m.ts, '%Y-%m-%d %H:00:00') AS bucket_ts,
                  AVG(COALESCE(m.pm25, m.aqi)) AS pm25
                FROM city_observation_minute m
                WHERE m.city_id = ?
                  AND DATE(m.ts) = (
                    SELECT DATE(MAX(m2.ts))
                    FROM city_observation_minute m2
                    WHERE m2.city_id = ?
                      AND (m2.pm25 IS NOT NULL OR m2.aqi IS NOT NULL)
                  )
                GROUP BY bucket_ts
                ORDER BY bucket_ts ASC
                LIMIT 24
              `,
              [scope.cityId, scope.cityId]
            )
            return { scope, kind: 'hour', stepSec: 3600, rows: rows || [], ...dbSeriesMeta }
          }

          if (scope.scope === 'province') {
            const [rows] = await conn.query(
              `
                SELECT
                  DATE_FORMAT(m.ts, '%Y-%m-%d %H:00:00') AS bucket_ts,
                  AVG(COALESCE(m.pm25, m.aqi)) AS pm25
                FROM city_observation_minute m
                JOIN city c ON c.id = m.city_id
                WHERE c.province = ?
                  AND DATE(m.ts) = (
                    SELECT DATE(MAX(m2.ts))
                    FROM city_observation_minute m2
                    JOIN city c2 ON c2.id = m2.city_id
                    WHERE c2.province = ?
                      AND (m2.pm25 IS NOT NULL OR m2.aqi IS NOT NULL)
                  )
                GROUP BY bucket_ts
                ORDER BY bucket_ts ASC
                LIMIT 24
              `,
              [scope.name, scope.name]
            )
            return { scope, kind: 'hour', stepSec: 3600, rows: rows || [], ...dbSeriesMeta }
          }

          const [rows] = await conn.query(
            `
              SELECT
                DATE_FORMAT(ts, '%Y-%m-%d %H:00:00') AS bucket_ts,
                AVG(COALESCE(pm25, aqi)) AS pm25
              FROM city_observation_minute
              WHERE DATE(ts) = (
                SELECT DATE(MAX(ts))
                FROM city_observation_minute
                WHERE (pm25 IS NOT NULL OR aqi IS NOT NULL)
              )
              GROUP BY bucket_ts
              ORDER BY bucket_ts ASC
              LIMIT 24
            `
          )
          return { scope, kind: 'hour', stepSec: 3600, rows: rows || [], ...dbSeriesMeta }
        }

        // month：最近 30 天，单位 1 天
        if (isMonth) {
          const start = floorToMonth(anchor)
          const end = addMonths(start, 1)
          if (scope.scope === 'city') {
            const [rows] = await conn.query(
              `
                SELECT
                  DATE(ts) AS bucket_ts,
                  AVG(COALESCE(pm25, aqi)) AS pm25
                FROM city_observation_minute
                WHERE city_id = ? AND ts >= ? AND ts < ?
                GROUP BY bucket_ts
                ORDER BY bucket_ts DESC
                LIMIT 32
              `,
              [scope.cityId, start, end]
            )
            return { scope, kind: 'day', stepSec: 86400, rows: rows || [], ...dbSeriesMeta }
          }

          if (scope.scope === 'province') {
            const [rows] = await conn.query(
              `
                SELECT
                  DATE(m.ts) AS bucket_ts,
                  AVG(COALESCE(m.pm25, m.aqi)) AS pm25
                FROM city_observation_minute m
                JOIN city c ON c.id = m.city_id
                WHERE c.province = ? AND m.ts >= ? AND m.ts < ?
                GROUP BY bucket_ts
                ORDER BY bucket_ts DESC
                LIMIT 32
              `,
              [scope.name, start, end]
            )
            return { scope, kind: 'day', stepSec: 86400, rows: rows || [], ...dbSeriesMeta }
          }

          const [rows] = await conn.query(
            `
              SELECT
                DATE(ts) AS bucket_ts,
                AVG(COALESCE(pm25, aqi)) AS pm25
              FROM city_observation_minute
              WHERE ts >= ? AND ts < ?
              GROUP BY bucket_ts
              ORDER BY bucket_ts DESC
              LIMIT 32
            `,
            [start, end]
          )
          return { scope, kind: 'day', stepSec: 86400, rows: rows || [], ...dbSeriesMeta }
        }

        // year：最近 12 个月，单位 1 月
        const yearStart = new Date(anchor.getFullYear(), 0, 1, 0, 0, 0, 0)
        const yearEnd = new Date(anchor.getFullYear() + 1, 0, 1, 0, 0, 0, 0)
        if (scope.scope === 'city') {
          const [rows] = await conn.query(
            `
              SELECT
                DATE_FORMAT(ts, '%Y-%m-01') AS bucket_ts,
                AVG(COALESCE(pm25, aqi)) AS pm25
              FROM city_observation_minute
              WHERE city_id = ? AND ts >= ? AND ts < ?
              GROUP BY bucket_ts
              ORDER BY bucket_ts DESC
              LIMIT 12
            `,
            [scope.cityId, yearStart, yearEnd]
          )
          return { scope, kind: 'month', stepSec: 2592000, rows: rows || [], ...dbSeriesMeta }
        }

        if (scope.scope === 'province') {
          const [rows] = await conn.query(
            `
              SELECT
                DATE_FORMAT(m.ts, '%Y-%m-01') AS bucket_ts,
                AVG(COALESCE(m.pm25, m.aqi)) AS pm25
              FROM city_observation_minute m
              JOIN city c ON c.id = m.city_id
              WHERE c.province = ? AND m.ts >= ? AND m.ts < ?
              GROUP BY bucket_ts
              ORDER BY bucket_ts DESC
              LIMIT 12
            `,
            [scope.name, yearStart, yearEnd]
          )
          return { scope, kind: 'month', stepSec: 2592000, rows: rows || [], ...dbSeriesMeta }
        }

        const [rows] = await conn.query(
          `
            SELECT
              DATE_FORMAT(ts, '%Y-%m-01') AS bucket_ts,
              AVG(COALESCE(pm25, aqi)) AS pm25
            FROM city_observation_minute
            WHERE ts >= ? AND ts < ?
            GROUP BY bucket_ts
            ORDER BY bucket_ts DESC
            LIMIT 12
          `,
          [yearStart, yearEnd]
        )
        return { scope, kind: 'month', stepSec: 2592000, rows: rows || [], ...dbSeriesMeta }
      } finally {
        conn.release()
      }
    })

    const rows = payload.rows || []

    // 月/年趋势仍按整段日历补齐；日趋势（小时）仅用库里有数据的小时点；legacy 仍为原始序列
    let times = []
    let values = []

    if (payload.kind === 'hour') {
      // 日趋势：横轴仅展示有数据的小时桶，不再固定铺满 24 个整点
      const sorted = rows.slice().sort((a, b) => {
        const ta = new Date(a.bucket_ts ?? a.ts).getTime()
        const tb = new Date(b.bucket_ts ?? b.ts).getTime()
        return ta - tb
      })
      times = sorted.map((r) => toHm(r.bucket_ts ?? r.ts))
      values = sorted.map((r) => roundNum(r.pm25, 1))
    } else if (payload.kind === 'day') {
      const byKey = new Map()
      for (const r of rows) {
        const ts = r.bucket_ts ?? r.ts
        byKey.set(toYmd(ts), r.pm25)
      }

      const anchorDate = rows.length ? new Date(rows[0].bucket_ts ?? rows[0].ts) : new Date()
      const start = floorToMonth(anchorDate)
      const nDays = daysInMonth(start)
      const buckets = []
      for (let i = 0; i < nDays; i++) buckets.push(addDays(start, i))

      times = buckets.map((b) => toMd(b))
      values = buckets.map((b) => roundNum(byKey.get(toYmd(b)), 1))
    } else if (payload.kind === 'month') {
      const byKey = new Map()
      for (const r of rows) {
        const ts = r.bucket_ts ?? r.ts
        byKey.set(toYm(ts), r.pm25)
      }

      const anchorDate = rows.length ? new Date(rows[0].bucket_ts ?? rows[0].ts) : new Date()
      const start = new Date(anchorDate.getFullYear(), 0, 1, 0, 0, 0, 0)
      const buckets = []
      for (let i = 0; i < 12; i++) buckets.push(addMonths(start, i))

      times = buckets.map((b) => toYm(b))
      values = buckets.map((b) => roundNum(byKey.get(toYm(b)), 1))
    } else if (payload.kind === 'legacyHour') {
      const sorted = rows.slice().reverse()
      times = sorted.map((r) => toYmdHm(r.ts ?? r.bucket_ts))
      values = sorted.map((r) => roundNum(r.pm25, 1))
    } else {
      const sorted = rows.slice().reverse()
      times = sorted.map((r) => {
        const ts = r.ts ?? r.bucket_ts
        return toHms(ts)
      })
      values = sorted.map((r) => roundNum(r.pm25, 1))
    }

    const maxTsRaw = payload.maxTs
    const maxTsIso =
      maxTsRaw && Number.isFinite(new Date(maxTsRaw).getTime()) ? new Date(maxTsRaw).toISOString() : null

    let seriesDate = null
    if (payload.kind === 'hour' && rows.length > 0) {
      const rs = rows.slice().sort((a, b) => {
        const ta = new Date(a.bucket_ts ?? a.ts).getTime()
        const tb = new Date(b.bucket_ts ?? b.ts).getTime()
        return ta - tb
      })
      const head = String(rs[0]?.bucket_ts ?? rs[0]?.ts ?? '')
      if (head.length >= 10) seriesDate = head.slice(0, 10)
    }

    const valueNonNullCount = values.reduce((n, v) => n + (v != null ? 1 : 0), 0)
    const tableName = payload.dataSource || 'city_observation_minute'

    res.setHeader('Cache-Control', 'no-store, must-revalidate')
    res.json({
      ok: true,
      data: {
        name: payload.scope?.name || name,
        range: range || null,
        stepSec: payload.stepSec || 3600,
        times,
        values,
        maxTs: maxTsIso,
        dataSource: tableName,
        fromDatabase: true,
        table: tableName,
        pointCount: times.length,
        valueNonNullCount,
        seriesDate,
      },
    })
  } catch (e) {
    res.status(500).json({ ok: false, error: e?.message || String(e) })
  }
})

// 热力（温度/湿度/PM2.5）最近 N 条（与历史表一致：小时粒度）
app.get('/api/heatmap', async (req, res) => {
  const name = asNonEmptyString(req.query.name) || '全国'
  const limit = asPositiveInt(req.query.limit, 20)

  try {
    const payload = await withDbRetry(async () => {
      const conn = await pool.getConnection()
      try {
        const scope = await resolveScope(conn, name)
        if (scope.scope === 'city') {
          const [rows] = await conn.query(
            `
              SELECT ts, temp_c, humidity, pm25
              FROM city_observation_minute
              WHERE city_id = ?
              ORDER BY ts DESC
              LIMIT ?
            `,
            [scope.cityId, limit]
          )
          return { scope, rows: rows || [] }
        }

        if (scope.scope === 'province') {
          const [rows] = await conn.query(
            `
              SELECT
                m.ts AS ts,
                AVG(m.temp_c) AS temp_c,
                AVG(m.humidity) AS humidity,
                AVG(m.pm25) AS pm25
              FROM city_observation_minute m
              JOIN city c ON c.id = m.city_id
              WHERE c.province = ?
              GROUP BY m.ts
              ORDER BY m.ts DESC
              LIMIT ?
            `,
            [scope.name, limit]
          )
          return { scope, rows: rows || [] }
        }

        const [rows] = await conn.query(
          `
            SELECT
              ts,
              AVG(temp_c) AS temp_c,
              AVG(humidity) AS humidity,
              AVG(pm25) AS pm25
            FROM city_observation_minute
            GROUP BY ts
            ORDER BY ts DESC
            LIMIT ?
          `,
          [limit]
        )
        return { scope, rows: rows || [] }
      } finally {
        conn.release()
      }
    })

    const sorted = (payload.rows || []).slice().reverse()
    res.json({
      ok: true,
      data: {
        name: payload.scope?.name || name,
        stepSec: 3600,
        times: sorted.map((r) => toYmdHm(r.ts)),
        rows: [
          sorted.map((r) => roundNum(r.temp_c, 1)),
          sorted.map((r) => roundNum(r.humidity, 1)),
          sorted.map((r) => roundNum(r.pm25, 1)),
        ],
      },
    })
  } catch (e) {
    res.status(500).json({ ok: false, error: e?.message || String(e) })
  }
})

// 城市排行（按 pm25 / aqi）
app.get('/api/rank', async (req, res) => {
  const metric = asNonEmptyString(req.query.metric) || 'pm25'
  const limit = asPositiveInt(req.query.limit, 10)
  const groupRaw = (asNonEmptyString(req.query.group) || 'city').toLowerCase()
  const group = groupRaw === 'province' || groupRaw === 'prov' || groupRaw === 'p' ? 'province' : 'city' // city | province
  const field = metric === 'aqi' ? 'aqi' : 'pm25'

  try {
    if (group === 'province') {
      // 省份排行：优先用 seed(adcode->province) 修正脏数据（有些数据源会把 province 写成地级市名）
      const provinceByAdcode = await loadProvinceByAdcode()
      const [rows] = await withDbRetry(async () =>
        pool.query(
          `
            SELECT c.adcode AS adcode, c.province AS province, l.${field} AS value
            FROM city_observation_latest l
            JOIN city c ON c.id = l.city_id
            WHERE l.${field} IS NOT NULL
          `
        )
      )

      const agg = new Map() // province -> {sum, cnt}
      for (const r of rows || []) {
        const ad = r?.adcode != null ? String(r.adcode).trim() : ''
        const provSeed = ad ? provinceByAdcode.get(ad) : null
        const provDb = r?.province != null ? String(r.province).replace(/\s+/g, '').trim() : ''
        const prov = provSeed || provDb
        if (!prov) continue
        const v = Number(r?.value)
        if (!Number.isFinite(v)) continue
        if (!agg.has(prov)) agg.set(prov, { sum: 0, cnt: 0 })
        const a = agg.get(prov)
        a.sum += v
        a.cnt += 1
      }

      const data = Array.from(agg.entries())
        .map(([name, a]) => ({ name, value: a.cnt > 0 ? a.sum / a.cnt : null }))
        .filter((x) => x.value != null)
        .sort((a, b) => b.value - a.value)
        .slice(0, limit)
        .map((x) => ({ name: x.name, value: roundNum(x.value, 1) }))

      res.json({ ok: true, data })
      return
    }

    const [rows] = await withDbRetry(async () =>
      pool.query(
        `
          SELECT c.name AS name, c.province AS province, l.${field} AS value
          FROM city_observation_latest l
          JOIN city c ON c.id = l.city_id
          WHERE l.${field} IS NOT NULL
          ORDER BY l.${field} DESC
          LIMIT ?
        `,
        [limit]
      )
    )
    res.json({
      ok: true,
      data: (rows || []).map((r) => ({
        name: r.name,
        province: r.province || '',
        value: roundNum(r.value, 1),
      })),
    })
  } catch (e) {
    res.status(500).json({ ok: false, error: e?.message || String(e) })
  }
})

// 短期差异城市 Top：空气(pm25/aqi) 或 天气(temp/humidity)
// kind: air | weather
// windowMin: 统计窗口（默认 30 分钟），会对比“最近 windowMin”与“再往前 windowMin”
app.get('/api/contrast/top', async (req, res) => {
  const kindRaw = (asNonEmptyString(req.query.kind) || 'air').toLowerCase()
  const kind = kindRaw === 'weather' || kindRaw === 'w' ? 'weather' : 'air'
  const limit = asPositiveInt(req.query.limit, 10)
  const windowMin = Math.min(24 * 60, Math.max(5, asPositiveInt(req.query.windowMin, 12 * 60)))

  try {
    // 基准时间使用“数据库最近已有数据”（而不是 NOW），避免同步滞后导致列表为空
    const anchorTs = await withDbRetry(async () => {
      const [rows] = await pool.query('SELECT MAX(ts) AS max_ts FROM city_observation_minute')
      return rows?.[0]?.max_ts ?? null
    })
    if (!anchorTs) {
      res.json({ ok: true, data: [] })
      return
    }

    // MySQL 不支持把 INTERVAL 的数字部分用 ? 参数化，这里使用已 clamp 的整数安全拼接。
    const w = Math.floor(windowMin)
    const w2 = w * 2
    const sql =
      kind === 'air'
        ? `
          SELECT
            c.name AS name,
            c.province AS province,
            AVG(CASE WHEN m.ts >= (? - INTERVAL ${w} MINUTE) THEN m.pm25 END) AS now_v,
            AVG(CASE WHEN m.ts <  (? - INTERVAL ${w} MINUTE) AND m.ts >= (? - INTERVAL ${w2} MINUTE) THEN m.pm25 END) AS prev_v,
            COUNT(CASE WHEN m.ts >= (? - INTERVAL ${w} MINUTE) AND m.pm25 IS NOT NULL THEN 1 END) AS now_cnt,
            COUNT(CASE WHEN m.ts <  (? - INTERVAL ${w} MINUTE) AND m.ts >= (? - INTERVAL ${w2} MINUTE) AND m.pm25 IS NOT NULL THEN 1 END) AS prev_cnt
          FROM city_observation_minute m
          JOIN city c ON c.id = m.city_id
          WHERE m.ts >= (? - INTERVAL ${w2} MINUTE)
          GROUP BY c.id
          HAVING now_cnt >= 1 AND prev_cnt >= 1 AND now_v IS NOT NULL AND prev_v IS NOT NULL
          ORDER BY ABS(now_v - prev_v) DESC
          LIMIT ?
        `
        : `
          SELECT
            c.name AS name,
            c.province AS province,
            AVG(CASE WHEN m.ts >= (? - INTERVAL ${w} MINUTE) THEN m.temp_c END) AS now_temp,
            AVG(CASE WHEN m.ts <  (? - INTERVAL ${w} MINUTE) AND m.ts >= (? - INTERVAL ${w2} MINUTE) THEN m.temp_c END) AS prev_temp,
            AVG(CASE WHEN m.ts >= (? - INTERVAL ${w} MINUTE) THEN m.humidity END) AS now_hum,
            AVG(CASE WHEN m.ts <  (? - INTERVAL ${w} MINUTE) AND m.ts >= (? - INTERVAL ${w2} MINUTE) THEN m.humidity END) AS prev_hum,
            COUNT(CASE WHEN m.ts >= (? - INTERVAL ${w} MINUTE) AND (m.temp_c IS NOT NULL OR m.humidity IS NOT NULL) THEN 1 END) AS now_cnt,
            COUNT(CASE WHEN m.ts <  (? - INTERVAL ${w} MINUTE) AND m.ts >= (? - INTERVAL ${w2} MINUTE) AND (m.temp_c IS NOT NULL OR m.humidity IS NOT NULL) THEN 1 END) AS prev_cnt
          FROM city_observation_minute m
          JOIN city c ON c.id = m.city_id
          WHERE m.ts >= (? - INTERVAL ${w2} MINUTE)
          GROUP BY c.id
          HAVING now_cnt >= 1 AND prev_cnt >= 1
          ORDER BY (ABS(now_temp - prev_temp) + 0.35 * ABS(now_hum - prev_hum)) DESC
          LIMIT ?
        `

    const params =
      kind === 'air'
        ? [anchorTs, anchorTs, anchorTs, anchorTs, anchorTs, anchorTs, anchorTs, limit]
        : [
            anchorTs,
            anchorTs,
            anchorTs,
            anchorTs,
            anchorTs,
            anchorTs,
            anchorTs,
            anchorTs,
            anchorTs,
            anchorTs,
            limit,
          ]

    const [rows] = await withDbRetry(async () => pool.query(sql, params))

    if (kind === 'air') {
      res.json({
        ok: true,
        data: (rows || []).map((r) => ({
          name: r.name,
          province: r.province,
          metric: 'pm25',
          now: roundNum(r.now_v, 1),
          prev: roundNum(r.prev_v, 1),
          delta: roundNum(Number(r.now_v) - Number(r.prev_v), 1),
          windowMin,
        })),
      })
      return
    }

    res.json({
      ok: true,
      data: (rows || []).map((r) => ({
        name: r.name,
        province: r.province,
        metric: 'weather',
        now_temp: roundNum(r.now_temp, 1),
        prev_temp: roundNum(r.prev_temp, 1),
        delta_temp: roundNum(Number(r.now_temp) - Number(r.prev_temp), 1),
        now_hum: roundNum(r.now_hum, 1),
        prev_hum: roundNum(r.prev_hum, 1),
        delta_hum: roundNum(Number(r.now_hum) - Number(r.prev_hum), 1),
        windowMin,
      })),
    })
  } catch (e) {
    res.status(500).json({ ok: false, error: e?.message || String(e) })
  }
})

// 点击城市后的“差异详情”（先给基础统计 + 最近 2*windowMin 的时间序列，模型分析占位）
app.get('/api/contrast/detail', async (req, res) => {
  const city = asNonEmptyString(req.query.city)
  const kindRaw = (asNonEmptyString(req.query.kind) || 'air').toLowerCase()
  const kind = kindRaw === 'weather' || kindRaw === 'w' ? 'weather' : 'air'
  const windowMin = Math.min(24 * 60, Math.max(5, asPositiveInt(req.query.windowMin, 12 * 60)))

  if (!city) {
    res.status(400).json({ ok: false, error: '缺少 city' })
    return
  }

  try {
    const w2 = Math.floor(windowMin) * 2
    const payload = await withDbRetry(async () => {
      const conn = await pool.getConnection()
      try {
        const scope = await resolveScope(conn, city)
        if (scope.scope !== 'city') return { scope, rows: [] }

        const [anchorRows] = await conn.query('SELECT MAX(ts) AS max_ts FROM city_observation_minute WHERE city_id = ?', [
          scope.cityId,
        ])
        const anchorTs = anchorRows?.[0]?.max_ts ?? null
        if (!anchorTs) return { scope, rows: [], anchorTs: null }

        const [rows] = await conn.query(
          `
            SELECT ts, pm25, aqi, temp_c, humidity
            FROM city_observation_minute
            WHERE city_id = ? AND ts >= (? - INTERVAL ${w2} MINUTE)
            ORDER BY ts ASC
          `,
          [scope.cityId, anchorTs]
        )
        return { scope, rows: rows || [], anchorTs }
      } finally {
        conn.release()
      }
    })

    const rows = Array.isArray(payload.rows) ? payload.rows : []
    const anchorMs = payload.anchorTs && Number.isFinite(new Date(payload.anchorTs).getTime()) ? new Date(payload.anchorTs).getTime() : Date.now()
    const splitTs = new Date(anchorMs - windowMin * 60 * 1000)
    let nowSum = 0
    let nowCnt = 0
    let prevSum = 0
    let prevCnt = 0

    const series = rows.map((r) => {
      const ts = r.ts
      const v = kind === 'air' ? (r.pm25 ?? null) : (r.temp_c ?? null)
      const n = Number(v)
      const isNow = ts && new Date(ts) >= splitTs
      if (Number.isFinite(n)) {
        if (isNow) {
          nowSum += n
          nowCnt += 1
        } else {
          prevSum += n
          prevCnt += 1
        }
      }
      return {
        ts,
        pm25: roundNum(r.pm25, 1),
        aqi: roundNum(r.aqi, 0),
        temp_c: roundNum(r.temp_c, 1),
        humidity: roundNum(r.humidity, 1),
      }
    })

    const now = nowCnt ? nowSum / nowCnt : null
    const prev = prevCnt ? prevSum / prevCnt : null

    res.json({
      ok: true,
      data: {
        scope: payload.scope,
        kind,
        windowMin,
        summary: {
          now: roundNum(now, 1),
          prev: roundNum(prev, 1),
          delta: now != null && prev != null ? roundNum(now - prev, 1) : null,
          nowCnt,
          prevCnt,
        },
        series,
        analysis_placeholder: '分析模型待接入：当前仅展示短期变化的基础统计与时间序列。',
      },
    })
  } catch (e) {
    res.status(500).json({ ok: false, error: e?.message || String(e) })
  }
})

// 历史天气记录（按选定日期取该日若干条）
app.get('/api/weather/records', async (req, res) => {
  // 兼容：部分旧前端可能把 city 当作 name 传参
  const city = asNonEmptyString(req.query.city) || asNonEmptyString(req.query.name)
  const date = asNonEmptyString(req.query.date) || toYmd(new Date())
  const limit = Math.max(5, asPositiveInt(req.query.limit, 20))

  if (!city) {
    res.status(400).json({ ok: false, error: '缺少 city（或 name）' })
    return
  }

  try {
    const out = await withDbRetry(async () => {
      const conn = await pool.getConnection()
      try {
        const scope = await resolveScope(conn, city)

        if (scope.scope === 'city') {
          const [rows] = await conn.query(
            `
              SELECT ts, temp_c, humidity, wind_speed, weather_code, aqi, pm25
              FROM city_observation_minute
              WHERE city_id = ? AND DATE(ts) = ?
              ORDER BY ts DESC
              LIMIT ?
            `,
            [scope.cityId, date, limit]
          )
          const base = rows || []
          if (base.length >= 5) return base

          // 若当天数据不足 5 条，则补齐最近记录，保证前端至少展示 5 条
          const need = 5 - base.length
          const [moreRows] = await conn.query(
            `
              SELECT ts, temp_c, humidity, wind_speed, weather_code, aqi, pm25
              FROM city_observation_minute
              WHERE city_id = ?
              ORDER BY ts DESC
              LIMIT ?
            `,
            [scope.cityId, need + 10]
          )
          const seen = new Set(base.map((r) => String(r.ts)))
          for (const r of moreRows || []) {
            const k = String(r.ts)
            if (seen.has(k)) continue
            base.push(r)
            seen.add(k)
            if (base.length >= 5) break
          }
          return base
        }

        if (scope.scope === 'province') {
          const [rows] = await conn.query(
            `
              SELECT
                m.ts AS ts,
                AVG(m.temp_c) AS temp_c,
                AVG(m.humidity) AS humidity,
                AVG(m.wind_speed) AS wind_speed,
                AVG(m.aqi) AS aqi,
                AVG(m.pm25) AS pm25
              FROM city_observation_minute m
              JOIN city c ON c.id = m.city_id
              WHERE c.province = ? AND DATE(m.ts) = ?
              GROUP BY m.ts
              ORDER BY m.ts DESC
              LIMIT ?
            `,
            [scope.name, date, limit]
          )
          const base = rows || []
          if (base.length >= 5) return base

          const need = 5 - base.length
          const [moreRows] = await conn.query(
            `
              SELECT
                m.ts AS ts,
                AVG(m.temp_c) AS temp_c,
                AVG(m.humidity) AS humidity,
                AVG(m.wind_speed) AS wind_speed,
                AVG(m.aqi) AS aqi,
                AVG(m.pm25) AS pm25
              FROM city_observation_minute m
              JOIN city c ON c.id = m.city_id
              WHERE c.province = ?
              GROUP BY m.ts
              ORDER BY m.ts DESC
              LIMIT ?
            `,
            [scope.name, need + 10]
          )
          const seen = new Set(base.map((r) => String(r.ts)))
          for (const r of moreRows || []) {
            const k = String(r.ts)
            if (seen.has(k)) continue
            base.push(r)
            seen.add(k)
            if (base.length >= 5) break
          }
          return base
        }

        const [rows] = await conn.query(
          `
            SELECT
              ts,
              AVG(temp_c) AS temp_c,
              AVG(humidity) AS humidity,
              AVG(wind_speed) AS wind_speed,
              AVG(aqi) AS aqi,
              AVG(pm25) AS pm25
            FROM city_observation_minute
            WHERE DATE(ts) = ?
            GROUP BY ts
            ORDER BY ts DESC
            LIMIT ?
          `,
          [date, limit]
        )
        const base = rows || []
        if (base.length >= 5) return base

        const need = 5 - base.length
        const [moreRows] = await conn.query(
          `
            SELECT
              ts,
              AVG(temp_c) AS temp_c,
              AVG(humidity) AS humidity,
              AVG(wind_speed) AS wind_speed,
              AVG(aqi) AS aqi,
              AVG(pm25) AS pm25
            FROM city_observation_minute
            GROUP BY ts
            ORDER BY ts DESC
            LIMIT ?
          `,
          [need + 10]
        )
        const seen = new Set(base.map((r) => String(r.ts)))
        for (const r of moreRows || []) {
          const k = String(r.ts)
          if (seen.has(k)) continue
          base.push(r)
          seen.add(k)
          if (base.length >= 5) break
        }
        return base
      } finally {
        conn.release()
      }
    })

    res.json({
      ok: true,
      data: out.map((r) => ({
        id: String(r.ts),
        ts: r.ts,
        time: toHms(r.ts),
        temp: roundNum(r.temp_c, 1),
        humidity: roundNum(r.humidity, 1),
        wind: roundNum(r.wind_speed, 1),
        aqi: roundNum(r.aqi, 0),
        pm25: roundNum(r.pm25, 1),
        air_text: `空气质量：${classifyAir(r.aqi, r.pm25)}`,
        weather_text: weatherTextFromCode(r.weather_code),
      })),
    })
  } catch (e) {
    res.status(500).json({ ok: false, error: e?.message || String(e) })
  }
})

// 当前城市温湿度趋势（近 24 小时，小时粒度，与历史表一致）
app.get('/api/weather/trend', async (req, res) => {
  // 兼容：部分旧前端可能把 city 当作 name 传参
  const city = asNonEmptyString(req.query.city) || asNonEmptyString(req.query.name)
  if (!city) {
    res.status(400).json({ ok: false, error: '缺少 city（或 name）' })
    return
  }

  try {
    const out = await withDbRetry(async () => {
      const conn = await pool.getConnection()
      try {
        const scope = await resolveScope(conn, city)
        const intervalSec = 60 * 60
        let rows = []

        // 以“数据库最近已有数据”作为锚点，避免数据同步滞后导致近 24h 全空
        const getAnchorTs = async () => {
          if (scope.scope === 'city') {
            const [a] = await conn.query('SELECT MAX(ts) AS max_ts FROM city_observation_minute WHERE city_id = ?', [
              scope.cityId,
            ])
            return a?.[0]?.max_ts ?? null
          }
          if (scope.scope === 'province') {
            const [a] = await conn.query(
              `
                SELECT MAX(m.ts) AS max_ts
                FROM city_observation_minute m
                JOIN city c ON c.id = m.city_id
                WHERE c.province = ?
              `,
              [scope.name]
            )
            return a?.[0]?.max_ts ?? null
          }
          const [a] = await conn.query('SELECT MAX(ts) AS max_ts FROM city_observation_minute')
          return a?.[0]?.max_ts ?? null
        }

        const anchorTs = await getAnchorTs()
        if (!anchorTs) return []

        // 取 [anchor - 24h, anchor]（含锚点所在小时），并按小时 bucket
        const rangeStartExpr = '(? - INTERVAL 1 DAY)'
        const rangeEndExpr = '(? + INTERVAL 1 HOUR)'

        if (scope.scope === 'city') {
          const [r] = await conn.query(
            `
              SELECT
                FROM_UNIXTIME(FLOOR(UNIX_TIMESTAMP(ts) / ?) * ?) AS bucket_ts,
                AVG(temp_c) AS temp_c,
                AVG(humidity) AS humidity
              FROM city_observation_minute
              WHERE city_id = ? AND ts >= ${rangeStartExpr} AND ts < ${rangeEndExpr}
              GROUP BY bucket_ts
              ORDER BY bucket_ts ASC
            `,
            [intervalSec, intervalSec, scope.cityId, anchorTs, anchorTs]
          )
          rows = r || []
        } else if (scope.scope === 'province') {
          const [r] = await conn.query(
            `
              SELECT
                FROM_UNIXTIME(FLOOR(UNIX_TIMESTAMP(m.ts) / ?) * ?) AS bucket_ts,
                AVG(m.temp_c) AS temp_c,
                AVG(m.humidity) AS humidity
              FROM city_observation_minute m
              JOIN city c ON c.id = m.city_id
              WHERE c.province = ? AND m.ts >= ${rangeStartExpr} AND m.ts < ${rangeEndExpr}
              GROUP BY bucket_ts
              ORDER BY bucket_ts ASC
            `,
            [intervalSec, intervalSec, scope.name, anchorTs, anchorTs]
          )
          rows = r || []
        } else {
          const [r] = await conn.query(
            `
              SELECT
                FROM_UNIXTIME(FLOOR(UNIX_TIMESTAMP(ts) / ?) * ?) AS bucket_ts,
                AVG(temp_c) AS temp_c,
                AVG(humidity) AS humidity
              FROM city_observation_minute
              WHERE ts >= ${rangeStartExpr} AND ts < ${rangeEndExpr}
              GROUP BY bucket_ts
              ORDER BY bucket_ts ASC
            `,
            [intervalSec, intervalSec, anchorTs, anchorTs]
          )
          rows = r || []
        }

        const byBucket = new Map()
        for (const r of rows) {
          const k = Number(new Date(r.bucket_ts).getTime())
          if (!Number.isFinite(k)) continue
          byBucket.set(k, {
            temp: roundNum(r.temp_c, 1),
            humidity: roundNum(r.humidity, 1),
          })
        }

        const anchorFloor = floorToHour(new Date(anchorTs))
        const endMs = anchorFloor.getTime()
        const stepMs = intervalSec * 1000
        const startMs = endMs - 23 * stepMs

        const points = []
        for (let t = startMs; t <= endMs; t += stepMs) {
          const got = byBucket.get(t)
          points.push({
            ts: new Date(t).toISOString(),
            time: `${String(new Date(t).getHours()).padStart(2, '0')}:00`,
            temp: got?.temp ?? null,
            humidity: got?.humidity ?? null,
          })
        }
        return points
      } finally {
        conn.release()
      }
    })

    res.json({ ok: true, data: out })
  } catch (e) {
    res.status(500).json({ ok: false, error: e?.message || String(e) })
  }
})

// 极端天气预警：逐小时气象因子（用于前端计算强度/等级）
// 说明：
// - horizonHours 默认 168（7天），可支持 24~168
// - 尝试读取 “未来” 数据；若未来数据覆盖不足，则自动回退到 “过去” 最近 horizonHours
app.get('/api/weather/extreme/hourly', async (req, res) => {
  const name = asNonEmptyString(req.query.city) || asNonEmptyString(req.query.name) || '全国'
  const horizonHours = Math.min(168, Math.max(24, asPositiveInt(req.query.horizonHours, 168)))

  const stepMs = 60 * 60 * 1000
  const stepSec = 60 * 60

  // 优先读取离线产出的极端天气逐小时数据（由 Python 模型脚本生成）
  // 有文件则直接返回，避免依赖数据库中是否已包含“未来时段”的气象数据。
  const payloadPath =
    process.env.EXTREME_WEATHER_PAYLOAD_PATH || './data/model_outputs/weather_extreme_hourly_payload.json'
  const absPayloadPath = path.isAbsolute(payloadPath) ? payloadPath : path.resolve(process.cwd(), payloadPath)
  try {
    const raw = await readFile(absPayloadPath, 'utf8')
    const parsed = JSON.parse(raw)
    const cities = parsed?.cities
    if (parsed?.ok === true && cities && typeof cities === 'object') {
      const variants = areaNameVariants(name)
      const foundKey = variants.find((v) => cities[v]?.points) || (cities[name]?.points ? name : null)
      if (foundKey) {
        const cityPayload = cities[foundKey]
        const allPoints = Array.isArray(cityPayload?.points) ? cityPayload.points : []
        const sliced = allPoints.slice(0, horizonHours)
        res.json({
          ok: true,
          data: {
            name: foundKey,
            horizonHours,
            source: 'model',
            points: sliced,
          },
        })
        return
      }
    }
  } catch {
    // 忽略离线文件读取失败，回退到数据库逻辑
  }
  const endFloor = floorToHour(new Date())
  const endMs = endFloor.getTime()
  const endExclusive = new Date(endMs + stepMs)

  // 未来窗口：[endMs, endMs + horizonHours * stepMs)
  const futureStart = new Date(endMs)
  const futureEndExclusive = new Date(endMs + horizonHours * stepMs)

  // 过去窗口：[endMs - (horizonHours-1)*stepMs, endMs + stepMs)
  const pastStart = new Date(endMs - (horizonHours - 1) * stepMs)

  async function queryHourlyRange(conn, scope, startTs, endTsExclusive) {
    // bucket_ts = 整点（对 ts 做向下取整）
    if (scope.scope === 'city') {
      const [rows] = await conn.query(
        `
          SELECT
            (FLOOR(UNIX_TIMESTAMP(ts) / ?) * ?) AS bucket_sec,
            AVG(temp_c) AS temp_c,
            AVG(humidity) AS humidity,
            AVG(wind_speed) AS wind_speed,
            AVG(pressure_hpa) AS pressure_hpa,
            AVG(precip_mm) AS precip_mm
          FROM city_observation_minute
          WHERE city_id = ? AND ts >= ? AND ts < ?
          GROUP BY bucket_sec
          ORDER BY bucket_sec ASC
        `,
        [stepSec, stepSec, scope.cityId, startTs, endTsExclusive]
      )
      return rows || []
    }

    if (scope.scope === 'province') {
      const [rows] = await conn.query(
        `
          SELECT
            (FLOOR(UNIX_TIMESTAMP(m.ts) / ?) * ?) AS bucket_sec,
            AVG(m.temp_c) AS temp_c,
            AVG(m.humidity) AS humidity,
            AVG(m.wind_speed) AS wind_speed,
            AVG(m.pressure_hpa) AS pressure_hpa,
            AVG(m.precip_mm) AS precip_mm
          FROM city_observation_minute m
          JOIN city c ON c.id = m.city_id
          WHERE c.province = ? AND m.ts >= ? AND m.ts < ?
          GROUP BY bucket_sec
          ORDER BY bucket_sec ASC
        `,
        [stepSec, stepSec, scope.name, startTs, endTsExclusive]
      )
      return rows || []
    }

    const [rows] = await conn.query(
      `
        SELECT
          (FLOOR(UNIX_TIMESTAMP(ts) / ?) * ?) AS bucket_sec,
          AVG(temp_c) AS temp_c,
          AVG(humidity) AS humidity,
          AVG(wind_speed) AS wind_speed,
          AVG(pressure_hpa) AS pressure_hpa,
          AVG(precip_mm) AS precip_mm
        FROM city_observation_minute
        WHERE ts >= ? AND ts < ?
        GROUP BY bucket_sec
        ORDER BY bucket_sec ASC
      `,
      [stepSec, stepSec, startTs, endTsExclusive]
    )
    return rows || []
  }

  function buildPointsFromRows(rows, startMsX) {
    const byBucket = new Map()
    for (const r of rows || []) {
      const sec = Number(r.bucket_sec)
      if (!Number.isFinite(sec)) continue
      const t = sec * 1000
      if (!Number.isFinite(t)) continue
      byBucket.set(t, {
        temp_c: roundNum(r.temp_c, 1),
        humidity: roundNum(r.humidity, 1),
        wind_speed: roundNum(r.wind_speed, 2),
        pressure_hpa: roundNum(r.pressure_hpa, 1),
        precip_mm: roundNum(r.precip_mm, 1),
      })
    }

    const out = []
    const startSec = Math.floor(startMsX / 1000)
    for (let i = 0; i < horizonHours; i += 1) {
      const t = (startSec + i * stepSec) * 1000
      const got = byBucket.get(t) || null
      out.push({
        ts: new Date(t).toISOString(),
        time: toHm(t),
        temp_c: got?.temp_c ?? null,
        humidity: got?.humidity ?? null,
        wind_speed: got?.wind_speed ?? null,
        pressure_hpa: got?.pressure_hpa ?? null,
        precip_mm: got?.precip_mm ?? null,
      })
    }
    return out
  }

  function coverageScore(points) {
    let cnt = 0
    for (const p of points || []) {
      if (
        p?.temp_c != null ||
        p?.humidity != null ||
        p?.wind_speed != null ||
        p?.pressure_hpa != null ||
        p?.precip_mm != null
      ) {
        cnt += 1
      }
    }
    return cnt
  }

  try {
    const payload = await withDbRetry(async () => {
      const conn = await pool.getConnection()
      try {
        const scope = await resolveScope(conn, name)

        const futureRows = await queryHourlyRange(conn, scope, futureStart, futureEndExclusive)
        const futurePoints = buildPointsFromRows(futureRows, endMs)

        const minCoverage = Math.max(6, Math.floor(horizonHours * 0.25))
        const futureCoverage = coverageScore(futurePoints)

        if (futureCoverage < minCoverage) {
          const pastRows = await queryHourlyRange(conn, scope, pastStart, endExclusive)
          const pastPoints = buildPointsFromRows(pastRows, pastStart.getTime())
          return { scope, points: pastPoints, source: 'past' }
        }

        return { scope, points: futurePoints, source: 'future' }
      } finally {
        conn.release()
      }
    })

    res.json({
      ok: true,
      data: {
        name: payload.scope?.name || name,
        horizonHours,
        source: payload.source,
        points: payload.points || [],
      },
    })
  } catch (e) {
    res.status(500).json({ ok: false, error: e?.message || String(e) })
  }
})

function modelOutputsDir() {
  const d = process.env.MODEL_OUTPUTS_DIR
  if (d) return path.resolve(d)
  return path.resolve(process.cwd(), 'data', 'model_outputs')
}

async function fileExistsAbs(abs) {
  try {
    await stat(abs)
    return true
  } catch {
    return false
  }
}

async function treePayloadPath(dir) {
  const p1 = path.join(dir, 'dashboard_tree_payload.json')
  if (await fileExistsAbs(p1)) return p1
  const p2 = path.join(dir, 'dashboard_payload.json')
  if (await fileExistsAbs(p2)) return p2
  return null
}

function resolvedVariantFromAbs(abs) {
  const b = path.basename(abs)
  if (b === 'dashboard_lstm_payload.json') return 'lstm'
  if (b === 'dashboard_transformer_payload.json') return 'transformer'
  if (b === 'dashboard_tree_payload.json' || b === 'dashboard_payload.json') return 'tree'
  return 'unknown'
}

function modelRootDir() {
  // repoRoot/air-quality-visualization/model
  return path.resolve(process.cwd(), '..', 'model')
}

function sanitizeCityParam(x) {
  const s = asNonEmptyString(x)
  if (!s) return null
  const out = s.replace(/\s+/g, ' ').trim()
  if (out.length > 40) return out.slice(0, 40)
  return out
}

const _predictJobs = new Map() // id -> { id, variant, city, status, startedAt, endedAt, error, exitCode, logs[] }
const _predictChildren = new Map() // id -> ChildProcess
let _jobSeq = 0

function newJobId() {
  _jobSeq += 1
  return `${Date.now()}-${_jobSeq}`
}

function scriptForVariant(variant) {
  if (variant === 'tree') return 'train_dashboard_model.py'
  if (variant === 'lstm') return 'train_dashboard_lstm_model.py'
  if (variant === 'transformer') return 'train_dashboard_transformer_model.py'
  return null
}

async function spawnPredictJob({ variant, city }) {
  const id = newJobId()
  const job = {
    id,
    variant,
    city,
    status: 'running',
    startedAt: new Date().toISOString(),
    endedAt: null,
    error: null,
    exitCode: null,
    logs: [],
  }
  _predictJobs.set(id, job)

  const python = process.env.PYTHON_BIN || process.env.PYTHON || 'python'
  const scriptName = scriptForVariant(variant)
  const scriptAbs = path.join(modelRootDir(), scriptName)

  // 让脚本输出到 backend 的 model_outputs（与 server.js 读取一致：cwd=backend）
  const outDir = modelOutputsDir()

  const args = [scriptAbs, '--output-dir', outDir]
  if (city) args.push('--target-city', city)

  const child = spawn(python, args, {
    cwd: process.cwd(),
    windowsHide: true,
    env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
  })
  _predictChildren.set(id, child)

  function pushLog(kind, buf) {
    const s = String(buf || '')
    if (!s) return
    const lines = s.split(/\r?\n/g)
    for (const line of lines) {
      const t = String(line || '').trimEnd()
      if (!t) continue
      job.logs.push({
        t: new Date().toISOString(),
        kind,
        line: t.slice(0, 2000),
      })
    }
    // keep last ~400 lines
    if (job.logs.length > 400) job.logs.splice(0, job.logs.length - 400)
  }

  child.stdout?.on('data', (buf) => pushLog('stdout', buf))
  child.stderr?.on('data', (buf) => pushLog('stderr', buf))
  child.on('error', (e) => {
    job.status = 'error'
    job.endedAt = new Date().toISOString()
    job.error = e?.message || String(e)
    pushLog('error', job.error)
    _predictChildren.delete(id)
  })
  child.on('close', (code) => {
    _predictChildren.delete(id)
    job.exitCode = Number.isFinite(Number(code)) ? Number(code) : null
    job.endedAt = new Date().toISOString()
    if (job.status !== 'error' && job.status !== 'stopped') {
      if (code === 0) {
        job.status = 'done'
        pushLog('info', `DONE (exit ${code})`)
      } else {
        job.status = 'error'
        const tail = job.logs
          .slice(-60)
          .filter((x) => x.kind === 'stderr' || x.kind === 'stdout')
          .map((x) => x.line)
          .join('\n')
          .trim()
        job.error = tail.slice(0, 1200) || `Python 退出码 ${code}`
        pushLog('error', `ERROR (exit ${code})`)
      }
    }
  })

  return job
}

/** 按 variant 解析大屏 JSON。显式 variant 时不得静默换用其它模型文件。 */
async function resolveDashboardPayloadAbs(req) {
  const dir = modelOutputsDir()
  const variantRaw = asNonEmptyString(req.query.variant) || asNonEmptyString(req.query.model)
  const v = variantRaw ? String(variantRaw).trim().toLowerCase() : ''
  const map = {
    tree: 'dashboard_tree_payload.json',
    lstm: 'dashboard_lstm_payload.json',
    transformer: 'dashboard_transformer_payload.json',
    default: 'dashboard_payload.json',
  }

  if (v && map[v]) {
    if (v === 'tree') {
      const abs = await treePayloadPath(dir)
      if (abs) return abs
      const err = new Error(
        '未找到树模型产物：请运行 model/train_dashboard_model.py，或保留 backend/data/model_outputs/dashboard_payload.json'
      )
      err.code = 'MODEL_NOT_FOUND'
      throw err
    }
    if (v === 'lstm') {
      const abs = path.join(dir, map.lstm)
      if (await fileExistsAbs(abs)) return abs
      const err = new Error(
        '未找到 LSTM 产物 dashboard_lstm_payload.json：请运行 model/train_dashboard_lstm_model.py 生成后再切换'
      )
      err.code = 'MODEL_NOT_FOUND'
      throw err
    }
    if (v === 'transformer') {
      const abs = path.join(dir, map.transformer)
      if (await fileExistsAbs(abs)) return abs
      const err = new Error(
        '未找到 Transformer 产物 dashboard_transformer_payload.json：请运行 model/train_dashboard_transformer_model.py 生成后再切换'
      )
      err.code = 'MODEL_NOT_FOUND'
      throw err
    }
    if (v === 'default') {
      const abs = path.join(dir, map.default)
      if (await fileExistsAbs(abs)) return abs
    }
    const err = new Error(`未找到模型文件：${map[v]}`)
    err.code = 'MODEL_NOT_FOUND'
    throw err
  }

  const order = [
    'dashboard_tree_payload.json',
    'dashboard_payload.json',
    'dashboard_lstm_payload.json',
    'dashboard_transformer_payload.json',
  ]
  for (const name of order) {
    const abs = path.join(dir, name)
    if (await fileExistsAbs(abs)) return abs
  }
  const fallback = process.env.MODEL_DASHBOARD_PAYLOAD_PATH || './data/model_outputs/dashboard_payload.json'
  return path.isAbsolute(fallback) ? fallback : path.resolve(process.cwd(), fallback)
}

// 启动模型推理/训练任务：生成对应 variant 的 dashboard_*_payload.json
app.post('/api/model/predict', async (req, res) => {
  const variantRaw = asNonEmptyString(req.body?.variant) || asNonEmptyString(req.query.variant) || 'tree'
  const variant = String(variantRaw).trim().toLowerCase()
  const city = sanitizeCityParam(req.body?.city) || null

  const allowed = new Set(['tree', 'lstm', 'transformer'])
  if (!allowed.has(variant)) {
    res.status(400).json({ ok: false, error: 'variant 仅支持 tree/lstm/transformer' })
    return
  }

  try {
    const job = await spawnPredictJob({ variant, city })
    res.setHeader('Cache-Control', 'no-store, must-revalidate')
    res.status(202).json({ ok: true, data: { jobId: job.id } })
  } catch (e) {
    res.status(500).json({ ok: false, error: e?.message || String(e) })
  }
})

// 查询推理任务状态
app.get('/api/model/predict/status', async (req, res) => {
  const id = asNonEmptyString(req.query.jobId) || asNonEmptyString(req.query.id)
  if (!id) {
    res.status(400).json({ ok: false, error: '缺少 jobId' })
    return
  }
  const job = _predictJobs.get(id)
  if (!job) {
    res.status(404).json({ ok: false, error: '任务不存在或已过期' })
    return
  }
  res.setHeader('Cache-Control', 'no-store, must-revalidate')
  const tailN = Math.min(200, Math.max(0, Number(req.query.tail) || 80))
  const logs = Array.isArray(job.logs) ? job.logs.slice(-tailN) : []
  res.json({
    ok: true,
    data: {
      jobId: job.id,
      variant: job.variant,
      city: job.city,
      status: job.status, // running | done | error | stopped
      startedAt: job.startedAt,
      endedAt: job.endedAt,
      exitCode: job.exitCode,
      error: job.error,
      logs,
    },
  })
})

// 查询最近任务（优先返回 running），用于前端在非本页面发起任务时也能看到日志
app.get('/api/model/predict/latest', async (req, res) => {
  const jobs = Array.from(_predictJobs.values())
  if (!jobs.length) {
    res.json({ ok: true, data: null })
    return
  }

  const byStartedDesc = (a, b) => {
    const ta = Number(new Date(a?.startedAt).getTime()) || 0
    const tb = Number(new Date(b?.startedAt).getTime()) || 0
    return tb - ta
  }
  const running = jobs.filter((j) => j?.status === 'running').sort(byStartedDesc)
  const target = (running[0] || jobs.sort(byStartedDesc)[0]) ?? null
  if (!target) {
    res.json({ ok: true, data: null })
    return
  }

  const tailN = Math.min(200, Math.max(0, Number(req.query.tail) || 80))
  const logs = Array.isArray(target.logs) ? target.logs.slice(-tailN) : []
  res.setHeader('Cache-Control', 'no-store, must-revalidate')
  res.json({
    ok: true,
    data: {
      jobId: target.id,
      variant: target.variant,
      city: target.city,
      status: target.status, // running | done | error | stopped
      startedAt: target.startedAt,
      endedAt: target.endedAt,
      exitCode: target.exitCode,
      error: target.error,
      logs,
    },
  })
})

// 停止推理任务（终止 Python 子进程）
app.post('/api/model/predict/stop', async (req, res) => {
  const id = asNonEmptyString(req.body?.jobId) || asNonEmptyString(req.query.jobId) || asNonEmptyString(req.query.id)
  if (!id) {
    res.status(400).json({ ok: false, error: '缺少 jobId' })
    return
  }
  const job = _predictJobs.get(id)
  if (!job) {
    res.status(404).json({ ok: false, error: '任务不存在或已过期' })
    return
  }
  if (job.status !== 'running') {
    res.json({ ok: true, data: { jobId: id, status: job.status, stopped: false } })
    return
  }

  const child = _predictChildren.get(id)
  if (!child) {
    job.status = 'stopped'
    job.endedAt = new Date().toISOString()
    job.error = '任务已停止'
    res.json({ ok: true, data: { jobId: id, status: job.status, stopped: true } })
    return
  }

  try {
    child.kill('SIGTERM')
  } catch {
    // no-op
  }
  job.status = 'stopped'
  job.endedAt = new Date().toISOString()
  job.error = '任务已停止'
  job.logs.push({ t: new Date().toISOString(), kind: 'info', line: 'STOPPED by user' })
  if (job.logs.length > 400) job.logs.splice(0, job.logs.length - 400)
  res.json({ ok: true, data: { jobId: id, status: job.status, stopped: true } })
})

// 已训练模型版本列表（供前端切换：tree / lstm / transformer）
app.get('/api/model/versions', async (_req, res) => {
  const dir = modelOutputsDir()
  const treeAbs = await treePayloadPath(dir)
  const lstmAbs = path.join(dir, 'dashboard_lstm_payload.json')
  const lstmOk = await fileExistsAbs(lstmAbs)
  const tfAbs = path.join(dir, 'dashboard_transformer_payload.json')
  const tfOk = await fileExistsAbs(tfAbs)

  const versions = []

  if (treeAbs) {
    try {
      const st = await stat(treeAbs)
      const raw = await readFile(treeAbs, 'utf8')
      const data = JSON.parse(raw)
      versions.push({
        id: 'tree',
        label: data.variantLabel || '梯度提升树',
        file: path.basename(treeAbs),
        available: true,
        updatedAt: data.updatedAt || null,
        mtime: st.mtime.toISOString(),
        model: data.metrics?.model ?? null,
      })
    } catch {
      versions.push({
        id: 'tree',
        label: '梯度提升树',
        file: 'dashboard_tree_payload.json',
        available: false,
        updatedAt: null,
        mtime: null,
        model: null,
      })
    }
  } else {
    versions.push({
      id: 'tree',
      label: '梯度提升树',
      file: 'dashboard_tree_payload.json',
      available: false,
      updatedAt: null,
      mtime: null,
      model: null,
    })
  }

  if (lstmOk) {
    try {
      const st = await stat(lstmAbs)
      const raw = await readFile(lstmAbs, 'utf8')
      const data = JSON.parse(raw)
      versions.push({
        id: 'lstm',
        label: data.variantLabel || 'LSTM 多目标',
        file: 'dashboard_lstm_payload.json',
        available: true,
        updatedAt: data.updatedAt || null,
        mtime: st.mtime.toISOString(),
        model: data.metrics?.model ?? null,
      })
    } catch {
      versions.push({
        id: 'lstm',
        label: 'LSTM 多目标',
        file: 'dashboard_lstm_payload.json',
        available: false,
        updatedAt: null,
        mtime: null,
        model: null,
      })
    }
  } else {
    versions.push({
      id: 'lstm',
      label: 'LSTM 多目标',
      file: 'dashboard_lstm_payload.json',
      available: false,
      updatedAt: null,
      mtime: null,
      model: null,
    })
  }

  if (tfOk) {
    try {
      const st = await stat(tfAbs)
      const raw = await readFile(tfAbs, 'utf8')
      const data = JSON.parse(raw)
      versions.push({
        id: 'transformer',
        label: data.variantLabel || 'Transformer 多目标',
        file: 'dashboard_transformer_payload.json',
        available: true,
        updatedAt: data.updatedAt || null,
        mtime: st.mtime.toISOString(),
        model: data.metrics?.model ?? null,
      })
    } catch {
      versions.push({
        id: 'transformer',
        label: 'Transformer 多目标',
        file: 'dashboard_transformer_payload.json',
        available: false,
        updatedAt: null,
        mtime: null,
        model: null,
      })
    }
  } else {
    versions.push({
      id: 'transformer',
      label: 'Transformer 多目标',
      file: 'dashboard_transformer_payload.json',
      available: false,
      updatedAt: null,
      mtime: null,
      model: null,
    })
  }

  const defaultVariant = versions.find((x) => x.id === 'tree' && x.available)?.id
    ? 'tree'
    : versions.find((x) => x.available)?.id || 'tree'
  res.setHeader('Cache-Control', 'no-store, must-revalidate')
  res.json({ ok: true, data: { versions, defaultVariant } })
})

// 模型联动大屏：读取模型离线产出的 JSON 文件
app.get('/api/model/dashboard', async (_req, res) => {
  const cityRaw = asNonEmptyString(_req.query.city)
  let abs
  try {
    abs = await resolveDashboardPayloadAbs(_req)
  } catch (e) {
    const msg =
      e?.code === 'MODEL_NOT_FOUND' ? e.message : e?.message || String(e)
    res.status(404).json({ ok: false, error: msg })
    return
  }
  try {
    const raw = await readFile(abs, 'utf8')
    const data = JSON.parse(raw)
    if (!data || data.ok === false) {
      res.status(500).json({ ok: false, error: '模型结果文件内容无效，请先重新训练模型。' })
      return
    }
    if (cityRaw) {
      const normalizeModelCityQuery = (input) => {
        const s0 = String(input || '').trim()
        if (!s0) return ''
        // 1) 兼容“省 市”拼接（如 "广东 深圳" / "广东省 深圳市"）：取最后一个片段
        const lastToken = s0.split(/\s+/g).filter(Boolean).slice(-1)[0] || s0
        let s = lastToken.trim()

        // 2) 兼容“XX省深圳市 / XX自治区乌鲁木齐市 / 香港特别行政区”等：去掉前缀省级名，仅保留后面的城市名
        const m = s.match(/^(.*?)(特别行政区|维吾尔自治区|壮族自治区|回族自治区|自治区|省|市)\s*(.+)$/)
        if (m && m[3]) s = String(m[3]).trim()

        // 3) 兜底：把常见“省/市”后缀去掉，提升匹配成功率
        s = s.replace(/省$/g, '').replace(/市$/g, '').trim()
        return s
      }

      const cityQ = normalizeModelCityQuery(cityRaw) || String(cityRaw).trim()
      const normalizeCity = (x) => String(x || '').replace(/\s+/g, '').trim()
      const baseVariants = areaNameVariants(cityQ)

      const rawForecast24h = Array.isArray(data.forecast24h) ? data.forecast24h : []
      const rawForecast7dDaily = Array.isArray(data.forecast7dDaily) ? data.forecast7dDaily : []
      const rawTopFeatures = Array.isArray(data.topFeatures) ? data.topFeatures : []

      // 先确保“曲线”至少有数据：优先匹配 forecast24h 里有的城市；
      // 若完全匹配不到：不要回退到“其他城市”，而是返回空数据并保持 targetCity=所选城市，避免前端展示错城市的结果。
      const matchedForecastCity =
        rawForecast24h.find((r) => baseVariants.includes(normalizeCity(r?.城市)))?.城市 ||
        rawForecast7dDaily.find((r) => baseVariants.includes(normalizeCity(r?.城市)))?.城市

      const targetKey = matchedForecastCity || cityQ

      const targetVariants = areaNameVariants(targetKey)
      const sameTarget = (x) => targetVariants.includes(normalizeCity(x))

      const pickByCity = (arr, key = '城市') => (Array.isArray(arr) ? arr.filter((r) => sameTarget(r?.[key])) : [])
      const pickObjByCity = (obj) => {
        if (!obj || typeof obj !== 'object') return obj
        const out = {}
        for (const [k, v] of Object.entries(obj)) {
          if (sameTarget(k)) out[k] = v
        }
        return out
      }

      data.targetCity = targetKey
      data.forecast24h = pickByCity(rawForecast24h)
      data.forecast7dDaily = pickByCity(rawForecast7dDaily)
      data.topFeatures = pickByCity(rawTopFeatures)

      data.topFeaturesByCity = pickObjByCity(data.topFeaturesByCity)
      data.featureAssociationByCity = pickObjByCity(data.featureAssociationByCity)
      data.reasonGroupedByCity = pickObjByCity(data.reasonGroupedByCity)
      data.riskByCity = pickObjByCity(data.riskByCity)

      if (data.cityRiskTop10) data.cityRiskTop10 = pickByCity(data.cityRiskTop10)
      if (data.cityRankTop10) data.cityRankTop10 = pickByCity(data.cityRankTop10)

      const hasAnyCityData =
        (Array.isArray(data.forecast24h) && data.forecast24h.length > 0) ||
        (Array.isArray(data.forecast7dDaily) && data.forecast7dDaily.length > 0) ||
        (Array.isArray(data.topFeatures) && data.topFeatures.length > 0) ||
        (data.riskByCity && typeof data.riskByCity === 'object' && Object.keys(data.riskByCity).length > 0)

      if (!hasAnyCityData) {
        data.forecast24h = rawForecast24h
        data.forecast7dDaily = rawForecast7dDaily
        data.topFeatures = rawTopFeatures
        // 还原按城市分组的对象/Top10 列表，避免前端看到全空
        data.topFeaturesByCity = data.topFeaturesByCity
        data.featureAssociationByCity = data.featureAssociationByCity
        data.reasonGroupedByCity = data.reasonGroupedByCity
        data.riskByCity = data.riskByCity
        data.cityRiskTop10 = Array.isArray(data.cityRiskTop10) ? data.cityRiskTop10 : null
        data.cityRankTop10 = Array.isArray(data.cityRankTop10) ? data.cityRankTop10 : null
      }
    }
    data.resolvedVariant = resolvedVariantFromAbs(abs)
    res.setHeader('Cache-Control', 'no-store, must-revalidate')
    res.json({ ok: true, data })
  } catch (e) {
    const msg = e?.code === 'ENOENT' ? '未找到模型结果文件，请先运行训练脚本。' : e?.message || String(e)
    res.status(500).json({ ok: false, error: msg })
  }
})

const port = process.env.PORT || 10000
app.listen(port, "0.0.0.0", () => {
  // eslint-disable-next-line no-console
  console.log(`[api] listening on http://localhost:${port}`)
})

