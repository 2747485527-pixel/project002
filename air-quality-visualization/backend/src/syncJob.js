import axios from 'axios'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import https from 'node:https'
import http from 'node:http'

let _seedAdcodeMap = null

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

function isRetryableOpenMeteoError(e) {
  const status = e?.response?.status
  return status === 429 || status === 503 || status === 502 || status === 504
}

async function openMeteoFetchNowWithRetry({ lon, lat }) {
  let lastErr = null
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      return await openMeteoFetchNow({ lon, lat })
    } catch (e) {
      lastErr = e
      if (!isRetryableOpenMeteoError(e)) throw e
      const base = 800 * Math.pow(2, attempt)
      const jitter = Math.floor(Math.random() * 250)
      await sleep(base + jitter)
    }
  }
  throw lastErr || new Error('Open-Meteo 请求失败')
}

async function openMeteoFetchNow({ lon, lat }) {
  const {
    OPEN_METEO_WEATHER_URL = 'https://api.open-meteo.com/v1/forecast',
    OPEN_METEO_AIR_URL = 'https://air-quality-api.open-meteo.com/v1/air-quality',
    OPEN_METEO_INSECURE_TLS,
  } = process.env

  const num = (x) => {
    const n = Number(x)
    return Number.isFinite(n) ? n : null
  }

  const insecureTls = String(OPEN_METEO_INSECURE_TLS || '').toLowerCase() === 'true'
  const httpsAgent = insecureTls ? new https.Agent({ rejectUnauthorized: false }) : undefined

  // 天气与空气质量分开拉取：空气质量失败时仍保留天气数据
  const wRes = await axios.get(OPEN_METEO_WEATHER_URL, {
    timeout: 25_000,
    httpsAgent,
    params: {
      latitude: lat,
      longitude: lon,
      current: 'temperature_2m,relative_humidity_2m,wind_speed_10m,weather_code',
      timezone: 'auto',
    },
  })

  let aRes = null
  try {
    aRes = await axios.get(OPEN_METEO_AIR_URL, {
      timeout: 25_000,
      httpsAgent,
      params: {
        latitude: lat,
        longitude: lon,
        current: 'us_aqi,pm2_5,pm10,nitrogen_dioxide,sulphur_dioxide,ozone,carbon_monoxide',
        timezone: 'auto',
      },
    })
  } catch {
    aRes = null
  }

  const curW = wRes?.data?.current || {}
  const curA = aRes?.data?.current || {}

  return {
    temp_c: num(curW.temperature_2m),
    humidity: num(curW.relative_humidity_2m),
    wind_speed: num(curW.wind_speed_10m),
    weather_code: curW.weather_code != null ? String(curW.weather_code) : null,

    aqi: curA.us_aqi != null ? Number(curA.us_aqi) : null,
    pm25: num(curA.pm2_5),
    pm10: num(curA.pm10),
    no2: num(curA.nitrogen_dioxide),
    so2: num(curA.sulphur_dioxide),
    o3: num(curA.ozone),
    co: num(curA.carbon_monoxide),
  }
}

async function loadAndFetchFromOpenMeteo() {
  const { CITY_SEED_LIST_PATH, OPEN_METEO_CONCURRENCY, OPEN_METEO_MAX_CITIES } = process.env
  if (!CITY_SEED_LIST_PATH) throw new Error('缺少 CITY_SEED_LIST_PATH（Open-Meteo 需要 lon/lat）')

  const cities = await loadCitiesFromSeedListFile(CITY_SEED_LIST_PATH)
  const maxCitiesRaw = OPEN_METEO_MAX_CITIES != null && String(OPEN_METEO_MAX_CITIES).trim() !== '' ? Number(OPEN_METEO_MAX_CITIES) : null
  const maxCities = Number.isFinite(maxCitiesRaw) && maxCitiesRaw > 0 ? Math.floor(maxCitiesRaw) : null
  const sliced = maxCities ? cities.slice(0, maxCities) : cities

  // Open-Meteo 免费接口容易 429，默认把并发压低（环境变量可更低，但不建议更高）
  const requested = OPEN_METEO_CONCURRENCY ? Math.max(1, Number(OPEN_METEO_CONCURRENCY)) : 2
  const concurrency = Math.min(3, requested)

  const errors = []
  let skippedMissingLonLat = 0
  let skippedMissingAdcode = 0

  // 先用第一条可用城市做一次预检：如果网络/证书/域名解析有问题，快速失败并给出明确错误
  const firstEligible = sliced.find((c) => c?.lon != null && c?.lat != null && c?.adcode)
  if (!firstEligible) {
    // 后面会走统计报错，但这里提前给更直观的提示
    throw new Error(`Open-Meteo 无可用城市：seed=${sliced.length}（需要 lon/lat 且需要 adcode 写库）`)
  }
  try {
    await openMeteoFetchNowWithRetry({ lon: firstEligible.lon, lat: firstEligible.lat })
  } catch (e) {
    const status = e?.response?.status
    const code = e?.code ? String(e.code) : ''
    const url = e?.config?.url ? String(e.config.url) : ''
    const msg = status ? `status=${status} url=${url}` : `${code ? `code=${code} ` : ''}${e?.message || String(e)}`
    if (status === 429) {
      throw new Error(
        `Open-Meteo 预检失败：被限流（429）。${msg}。` +
          `建议把 OPEN_METEO_CONCURRENCY 调小（比如 1），或稍后重试/更换网络；调试可先设 OPEN_METEO_MAX_CITIES=3。`
      )
    }
    throw new Error(`Open-Meteo 预检失败（疑似网络/证书/被拦截）：${msg}（可尝试 OPEN_METEO_INSECURE_TLS=true）`)
  }

  const enriched = await mapLimit(sliced, concurrency, async (c) => {
    if (c.lon == null || c.lat == null) {
      skippedMissingLonLat += 1
      return null
    }
    if (!c.adcode) {
      skippedMissingAdcode += 1
      return null
    }
    try {
      const metrics = await openMeteoFetchNowWithRetry({ lon: c.lon, lat: c.lat })
      return {
        adcode: c.adcode,
        name: c.name,
        province: c.province,
        lon: c.lon,
        lat: c.lat,
        metrics,
      }
    } catch (e) {
      const status = e?.response?.status
      const code = e?.code ? String(e.code) : ''
      const url = e?.config?.url ? String(e.config.url) : ''
      const msg = status ? `status=${status} url=${url}` : `${code ? `code=${code} ` : ''}${e?.message || String(e)}`
      errors.push(`${c.name}(${c.adcode}) ${msg}`)
      return null
    }
  })

  const ok = enriched.filter(Boolean)
  if (ok.length === 0) {
    const eligible = sliced.length - skippedMissingLonLat - skippedMissingAdcode
    const sample = errors.slice(0, 6).join(' | ')
    throw new Error(
      `Open-Meteo 拉取结果为空（0 条）。seed=${sliced.length}${maxCities ? `(max=${maxCities})` : ''} eligible=${eligible} ` +
        `skip(noLonLat)=${skippedMissingLonLat} skip(noAdcode)=${skippedMissingAdcode} 并发=${concurrency}。` +
        (eligible === 0
          ? `seed 里没有可请求的城市（Open‑Meteo 必须有 lon/lat 且需要 adcode 写库）。`
          : `常见原因：网络无法访问 open-meteo 域名/被墙/证书拦截（可尝试 OPEN_METEO_INSECURE_TLS=true）。`) +
        (sample ? ` 示例错误：${sample}` : '')
    )
  }
  return ok
}

async function fetchJsonWithNode(urlString, { headers = {}, insecureTls = false, timeoutMs = 25_000, maxRedirects = 5 } = {}) {
  const url = new URL(urlString)
  const isHttps = url.protocol === 'https:'
  const mod = isHttps ? https : http

  const agent =
    isHttps && insecureTls
      ? new https.Agent({ rejectUnauthorized: false })
      : undefined

  const mergedHeaders = {
    Accept: 'application/json, text/plain, */*',
    'User-Agent': 'air-quality-backend/1.0 (+node)',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    'Cache-Control': 'no-cache',
    Pragma: 'no-cache',
    Connection: 'keep-alive',
    Referer: url.origin + '/',
    ...headers,
  }

  return await new Promise((resolve, reject) => {
    const req = mod.request(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port || (isHttps ? 443 : 80),
        method: 'GET',
        path: `${url.pathname}${url.search}`,
        headers: mergedHeaders,
        agent,
        timeout: timeoutMs,
      },
      async (res) => {
        // Follow redirects (some public APIs bounce http->https or through WAF)
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          if (maxRedirects <= 0) {
            reject(new Error(`API 重定向次数过多：last=${urlString}`))
            return
          }
          const next = new URL(res.headers.location, url).toString()
          try {
            const j = await fetchJsonWithNode(next, { headers, insecureTls, timeoutMs, maxRedirects: maxRedirects - 1 })
            resolve(j)
          } catch (e) {
            reject(e)
          }
          return
        }

        const chunks = []
        res.on('data', (c) => chunks.push(c))
        res.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf8')
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            // 很多“公开接口”会返回 HTML 验证页，这里给出更清晰的错误提示
            const trimmed = body.trimStart()
            if (trimmed.startsWith('<!DOCTYPE') || trimmed.startsWith('<html') || trimmed.startsWith('<!--')) {
              reject(new Error(`API 返回了 HTML（疑似被 WAF/反爬拦截）：status=${res.statusCode} content-type=${res.headers['content-type'] || ''} body=${body.slice(0, 240)}`))
              return
            }
            try {
              resolve(JSON.parse(body))
            } catch (e) {
              reject(new Error(`API 响应不是 JSON：status=${res.statusCode} content-type=${res.headers['content-type'] || ''} body=${body.slice(0, 240)}`))
            }
            return
          }
          reject(new Error(`API 请求失败：status=${res.statusCode} body=${body.slice(0, 240)}`))
        })
      }
    )

    req.on('error', reject)
    req.on('timeout', () => req.destroy(new Error(`API 请求超时：${timeoutMs}ms`)))
    req.end()
  })
}

function toMinuteTs(date = new Date()) {
  const d = new Date(date)
  d.setSeconds(0, 0)
  return d
}

/** 历史序列写入用：对齐到整点（小时级一条） */
function toHourTs(date = new Date()) {
  const d = new Date(date)
  d.setMinutes(0, 0, 0)
  return d
}

function formatMysqlDatetime(d) {
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

// 适配你的 API：只要最终能产出 { adcode, name, province, metrics } 就行
export function normalizeApiPayload(payload, opts = {}) {
  const adcodeByNameProvince = opts.adcodeByNameProvince || null
  // 兼容常见结构：{ data: [...] } / { list: [...] } / 直接数组
  const list = Array.isArray(payload) ? payload : Array.isArray(payload?.data) ? payload.data : Array.isArray(payload?.list) ? payload.list : []
  if (!Array.isArray(list)) return []

  return list
    .map((x) => {
      // 公开接口常见字段兼容：city/name/province
      const nameRaw = x.name ?? x?.cityName ?? x?.city ?? x?.city?.name ?? x?.area?.name
      const provRaw = x.province ?? x?.provinceName ?? x?.prov ?? x?.city?.province ?? x?.province

      const name = nameRaw != null ? String(nameRaw).replace(/\s+/g, '').trim() : null
      const province = provRaw != null ? String(provRaw).replace(/\s+/g, '').trim() : null

      let adcode = x.adcode ?? x?.city?.adcode ?? x?.area?.adcode ?? x?.cityAdcode
      if (adcode == null && adcodeByNameProvince && name && province) {
        const key = `${province}#${name}`
        adcode = adcodeByNameProvince.get(key) || null
      }

      const weather = x.weather ?? x?.metrics?.weather ?? x
      const air = x.air ?? x?.metrics?.air ?? x

      const metrics = {
        temp_c: weather?.temp_c ?? weather?.temp ?? weather?.temperature,
        humidity: weather?.humidity,
        wind_speed: weather?.wind_speed ?? weather?.windSpeed,
        weather_code: weather?.weather_code ?? weather?.code ?? weather?.weather,

        aqi: air?.aqi ?? air?.AQI ?? air?.aqi_value,
        pm25: air?.pm25 ?? air?.pm2_5 ?? air?.pm2_5_value,
        pm10: air?.pm10,
        no2: air?.no2,
        so2: air?.so2,
        o3: air?.o3,
        co: air?.co,
      }

      return {
        adcode: adcode != null ? String(adcode) : null,
        name: name != null ? String(name) : null,
        province: province != null ? String(province) : null,
        metrics,
      }
    })
    .filter((x) => x.adcode && x.name && x.province)
}

async function loadAdcodeByNameProvince() {
  if (_seedAdcodeMap) return _seedAdcodeMap
  const seedPath = process.env.CITY_SEED_LIST_PATH
  if (!seedPath) {
    _seedAdcodeMap = new Map()
    return _seedAdcodeMap
  }
  const abs = path.isAbsolute(seedPath) ? seedPath : path.resolve(process.cwd(), seedPath)
  const raw = await readFile(abs, 'utf8')
  const arr = JSON.parse(raw)
  const map = new Map()
  if (Array.isArray(arr)) {
    for (const x of arr) {
      const name = x?.name != null ? String(x.name).replace(/\s+/g, '').trim() : ''
      const province = x?.province != null ? String(x.province).replace(/\s+/g, '').trim() : ''
      const adcode = x?.adcode != null ? String(x.adcode).trim() : ''
      if (!name || !province || !adcode) continue
      map.set(`${province}#${name}`, adcode)
    }
  }
  _seedAdcodeMap = map
  return map
}

async function loadCityIdMap(conn) {
  const [rows] = await conn.query('SELECT id, adcode FROM city')
  const map = new Map()
  for (const r of rows) map.set(String(r.adcode), Number(r.id))
  return map
}

async function upsertMissingCities(conn, normalized) {
  // 只插入还不存在的 city（避免频繁重复插入）
  const unique = new Map()
  for (const x of normalized) {
    if (!unique.has(x.adcode)) unique.set(x.adcode, x)
  }
  const values = Array.from(unique.values())
  if (values.length === 0) return

  const sql =
    'INSERT INTO city (adcode, name, province, qweather_location_id, lon, lat) VALUES ' +
    values.map(() => '(?, ?, ?, ?, ?, ?)').join(',') +
    ' ON DUPLICATE KEY UPDATE ' +
    [
      'name=VALUES(name)',
      'province=VALUES(province)',
      'qweather_location_id=COALESCE(VALUES(qweather_location_id), qweather_location_id)',
      'lon=COALESCE(VALUES(lon), lon)',
      'lat=COALESCE(VALUES(lat), lat)',
    ].join(',')

  const params = []
  for (const v of values) params.push(v.adcode, v.name, v.province, v.qweather_location_id ?? null, v.lon ?? null, v.lat ?? null)
  await conn.query(sql, params)
}

function chunk(arr, size) {
  const out = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

function buildMinuteUpsert(rows) {
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
      // 空气质量接口常失败或限流：新值为 NULL 时不要覆盖库里已有值（否则 latest 会被每轮同步刷成“全空”，大屏排行/地图无数据）
      'aqi=IF(VALUES(aqi) IS NOT NULL, VALUES(aqi), aqi)',
      'pm25=IF(VALUES(pm25) IS NOT NULL, VALUES(pm25), pm25)',
      'pm10=IF(VALUES(pm10) IS NOT NULL, VALUES(pm10), pm10)',
      'no2=IF(VALUES(no2) IS NOT NULL, VALUES(no2), no2)',
      'so2=IF(VALUES(so2) IS NOT NULL, VALUES(so2), so2)',
      'o3=IF(VALUES(o3) IS NOT NULL, VALUES(o3), o3)',
      'co=IF(VALUES(co) IS NOT NULL, VALUES(co), co)',
    ].join(',')

  return { sql, cols }
}

function buildLatestUpsert(rows) {
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
    `INSERT INTO city_observation_latest (${cols.join(',')}) VALUES ` +
    rows.map(() => placeholders).join(',') +
    ' ON DUPLICATE KEY UPDATE ' +
    [
      'ts=VALUES(ts)',
      'temp_c=VALUES(temp_c)',
      'humidity=VALUES(humidity)',
      'wind_speed=VALUES(wind_speed)',
      'weather_code=VALUES(weather_code)',
      'aqi=IF(VALUES(aqi) IS NOT NULL, VALUES(aqi), aqi)',
      'pm25=IF(VALUES(pm25) IS NOT NULL, VALUES(pm25), pm25)',
      'pm10=IF(VALUES(pm10) IS NOT NULL, VALUES(pm10), pm10)',
      'no2=IF(VALUES(no2) IS NOT NULL, VALUES(no2), no2)',
      'so2=IF(VALUES(so2) IS NOT NULL, VALUES(so2), so2)',
      'o3=IF(VALUES(o3) IS NOT NULL, VALUES(o3), o3)',
      'co=IF(VALUES(co) IS NOT NULL, VALUES(co), co)',
    ].join(',')

  return { sql, cols }
}

function rowToParams(r, cols) {
  const m = r.metrics ?? {}
  const get = (k) => (m[k] === '' || m[k] === undefined ? null : m[k])

  // 注意：这里假设写入前已经把 city_id 映射好了
  const obj = {
    city_id: r.city_id,
    ts: r.ts,
    temp_c: get('temp_c'),
    humidity: get('humidity'),
    wind_speed: get('wind_speed'),
    weather_code: get('weather_code'),
    aqi: get('aqi'),
    pm25: get('pm25'),
    pm10: get('pm10'),
    no2: get('no2'),
    so2: get('so2'),
    o3: get('o3'),
    co: get('co'),
  }

  return cols.map((c) => obj[c] ?? null)
}

export async function runSyncOnce(pool) {
  const {
    API_URL,
    API_AUTH_HEADER,
    API_AUTH_VALUE,
    API_INSECURE_TLS,
    OPEN_METEO_ENABLED,
    QWEATHER_KEY,
    CITY_GEOJSON_PATH,
    CITY_SEED_LIST_PATH,
  } = process.env
  if (!API_URL && !QWEATHER_KEY && String(OPEN_METEO_ENABLED || '').toLowerCase() !== 'true') {
    throw new Error('缺少数据源：请配置 API_URL / QWEATHER_KEY / 或 OPEN_METEO_ENABLED=true')
  }

  let normalized = []
  if (String(OPEN_METEO_ENABLED || '').toLowerCase() === 'true') {
    normalized = await loadAndFetchFromOpenMeteo()
  // 优先走公开接口（你已经选择放弃和风时只需配置 API_URL）
  } else if (API_URL) {
    const headers = {}
    if (API_AUTH_HEADER && API_AUTH_VALUE) headers[API_AUTH_HEADER] = API_AUTH_VALUE
    const insecureTls = String(API_INSECURE_TLS || '').toLowerCase() === 'true'
    const adcodeByNameProvince = await loadAdcodeByNameProvince()
    // 统一用原生请求：避免 axios adapter 差异 + 支持自定义 headers/redirect/WAF 处理
    const payload = await fetchJsonWithNode(API_URL, { headers, insecureTls, timeoutMs: 25_000 })
    normalized = normalizeApiPayload(payload, { adcodeByNameProvince })
  } else if (QWEATHER_KEY && (CITY_SEED_LIST_PATH || CITY_GEOJSON_PATH)) {
    normalized = await loadAndFetchFromQWeather()
  } else {
    throw new Error('已配置 QWEATHER_KEY 但缺少 CITY_SEED_LIST_PATH / CITY_GEOJSON_PATH（推荐先 npm run build:seed）')
  }

  // 最新表：保留到「分钟」，配合定时任务每 5 分钟拉取可看到更新时间变化
  const latestTs = formatMysqlDatetime(toMinuteTs(new Date()))
  // 历史表 city_observation_minute：按「整点」一条（小时级），同一小时内多次同步会覆盖该小时记录
  const historyTs = formatMysqlDatetime(toHourTs(new Date()))

  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()

    // 1) 补齐 city 维表（只会 upsert name/province，不会重复插）
    await upsertMissingCities(conn, normalized)

    // 2) 加载 adcode -> city_id 映射（每次跑一次，稳妥；想更快可做进程内缓存）
    const cityIdMap = await loadCityIdMap(conn)

    // 3) 准备写入行（历史序列用 historyTs）
    const ready = normalized
      .map((x) => {
        const cityId = cityIdMap.get(x.adcode)
        if (!cityId) return null
        return { ...x, city_id: cityId, ts: historyTs }
      })
      .filter(Boolean)

    const batchSize = process.env.BATCH_SIZE ? Number(process.env.BATCH_SIZE) : 500
    const batches = chunk(ready, Math.max(50, batchSize))

    // 仅 upsert：不执行 DELETE；历史表里其它 ts 的旧数据会原样保留
    for (const b of batches) {
      const minuteStmt = buildMinuteUpsert(b)
      const latestBatch = b.map((r) => ({ ...r, ts: latestTs }))
      const latestStmt = buildLatestUpsert(latestBatch)

      const minuteParams = []
      for (const r of b) minuteParams.push(...rowToParams(r, minuteStmt.cols))

      const latestParams = []
      for (const r of latestBatch) latestParams.push(...rowToParams(r, latestStmt.cols))

      await conn.query(minuteStmt.sql, minuteParams)
      await conn.query(latestStmt.sql, latestParams)
    }

    await conn.commit()
    return { ok: true, count: ready.length, ts: latestTs, historyTs }
  } catch (e) {
    await conn.rollback()
    throw e
  } finally {
    conn.release()
  }
}

function isCityLevelFeature(p) {
  const level = p?.level != null ? String(p.level) : ''
  // areas_v3: province / city / district / street
  return level === 'city'
}

function parseCenter(center) {
  if (!center) return { lon: null, lat: null }
  if (Array.isArray(center) && center.length >= 2) {
    const lon = Number(center[0])
    const lat = Number(center[1])
    return Number.isFinite(lon) && Number.isFinite(lat) ? { lon, lat } : { lon: null, lat: null }
  }
  if (typeof center === 'string') {
    const parts = center.split(',').map((x) => x.trim())
    if (parts.length >= 2) {
      const lon = Number(parts[0])
      const lat = Number(parts[1])
      return Number.isFinite(lon) && Number.isFinite(lat) ? { lon, lat } : { lon: null, lat: null }
    }
  }
  return { lon: null, lat: null }
}

async function loadCitiesFromGeoJsonFile(filePath) {
  const abs = path.isAbsolute(filePath) ? filePath : path.resolve(process.cwd(), filePath)
  const raw = await readFile(abs, 'utf8')
  const gj = JSON.parse(raw)
  const features = Array.isArray(gj?.features) ? gj.features : []

  // 统计 level，便于排查用错文件（比如只有 district 没有 city）
  const levelCounts = new Map()
  for (const f of features) {
    const lvl = f?.properties?.level != null ? String(f.properties.level) : 'unknown'
    levelCounts.set(lvl, (levelCounts.get(lvl) || 0) + 1)
  }

  // 省级名映射：省 adcode -> 省名
  const provinceNameByAdcode = new Map()
  for (const f of features) {
    const adcode = f?.properties?.adcode
    const level = f?.properties?.level
    const name = f?.properties?.name
    const s = adcode != null ? String(adcode) : ''
    if (/^\d{6}$/.test(s) && String(level) === 'province' && name) {
      provinceNameByAdcode.set(s, String(name))
    }
  }

  const out = []
  for (const f of features) {
    const p = f?.properties || {}
    if (!isCityLevelFeature(p)) continue
    const adcode = p.adcode
    const name = p.name != null ? String(p.name) : null
    if (!name) continue

    const s = adcode != null ? String(adcode) : null
    if (!s || !/^\d{6}$/.test(s)) continue

    const parentAdcode = p?.parent?.adcode != null ? String(p.parent.adcode) : null
    const province = (parentAdcode && provinceNameByAdcode.get(parentAdcode)) || '未知'
    const { lon, lat } = parseCenter(p.center)

    out.push({
      adcode: s,
      name,
      province,
      lon,
      lat,
    })
  }
  if (features.length > 0 && out.length === 0) {
    const summary = Array.from(levelCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([k, v]) => `${k}:${v}`)
      .join(', ')
    throw new Error(`CITY_GEOJSON_PATH 文件里没有 level=city 的要素，无法得到地级市列表。level 统计：${summary}`)
  }
  return out
}

async function loadCitiesFromSeedListFile(filePath) {
  const abs = path.isAbsolute(filePath) ? filePath : path.resolve(process.cwd(), filePath)
  const raw = await readFile(abs, 'utf8')
  const data = JSON.parse(raw)
  if (!Array.isArray(data)) throw new Error('CITY_SEED_LIST_PATH 必须是 JSON 数组')

  const out = []
  for (const x of data) {
    // 清洗掉可能混入的空格/不可见字符（比如 "秦皇 岛市"）
    const name = x?.name != null ? String(x.name).replace(/\s+/g, '').trim() : ''
    const province = x?.province != null ? String(x.province).replace(/\s+/g, '').trim() : ''
    const adcode = x?.adcode != null ? String(x.adcode).trim() : null
    const lon = x?.lon != null ? Number(x.lon) : null
    const lat = x?.lat != null ? Number(x.lat) : null
    if (!name || !province) continue
    out.push({
      name,
      province,
      adcode,
      lon: Number.isFinite(lon) ? lon : null,
      lat: Number.isFinite(lat) ? lat : null,
    })
  }
  if (out.length === 0) throw new Error('CITY_SEED_LIST_PATH 没有有效城市项（至少需要 name + province）')
  return out
}

async function qweatherGeoLookupByName({ name, adm }) {
  const {
    QWEATHER_KEY,
    QWEATHER_GEO_BASE_URL = 'https://geoapi.qweather.com',
    QWEATHER_GEO_LOOKUP_PATH = '/v2/city/lookup',
    QWEATHER_LANG = 'zh',
  } = process.env

  const params = { key: QWEATHER_KEY, location: name, adm: adm || undefined, lang: QWEATHER_LANG }

  const candidates = []
  if (QWEATHER_GEO_BASE_URL) candidates.push(String(QWEATHER_GEO_BASE_URL))
  // 兼容不同 key/网络环境下的 Host 差异
  candidates.push('https://api.qweather.com')
  candidates.push('https://devapi.qweather.com')
  candidates.push('https://geoapi.qweather.com')
  candidates.push('https://api.heweather.net')
  candidates.push('https://devapi.heweather.net')

  const uniqCandidates = Array.from(new Set(candidates))

  let lastErr = null
  for (const base of uniqCandidates) {
    const url = `${base}${QWEATHER_GEO_LOOKUP_PATH}`
    try {
      const res = await axios.get(url, { params, timeout: 25_000 })
      const loc = res?.data?.location?.[0]
      const id = loc?.id ? String(loc.id) : null
      const lon = loc?.lon != null ? Number(loc.lon) : null
      const lat = loc?.lat != null ? Number(loc.lat) : null
      return {
        qweather_location_id: id,
        lon: Number.isFinite(lon) ? lon : null,
        lat: Number.isFinite(lat) ? lat : null,
      }
    } catch (e) {
      const status = e?.response?.status
      const body = e?.response?.data
      // 404/403(invalid host) 继续换 host 试下一个
      const title = e?.response?.data?.error?.title
      const invalidHost = status === 403 && String(title || '').toLowerCase().includes('invalid host')
      const retryable = status === 404 || invalidHost
      lastErr = new Error(
        `[geoLookup] url=${url} params=${JSON.stringify(params)} status=${status ?? 'unknown'} body=${body ? JSON.stringify(body) : 'empty'}`
      )
      if (!retryable) throw lastErr
      continue
    }
  }

  throw lastErr || new Error('[geoLookup] failed: no candidates')
}

async function qweatherFetchNow({ location }) {
  const {
    QWEATHER_KEY,
    QWEATHER_BASE_URL = 'https://devapi.qweather.com',
    QWEATHER_WEATHER_NOW_PATH = '/v7/weather/now',
    QWEATHER_AIR_NOW_PATH = '/v7/air/now',
    QWEATHER_LANG = 'zh',
    QWEATHER_UNIT = 'm',
  } = process.env

  const weatherUrl = `${QWEATHER_BASE_URL}${QWEATHER_WEATHER_NOW_PATH}`
  const airUrl = `${QWEATHER_BASE_URL}${QWEATHER_AIR_NOW_PATH}`

  const isInvalidHost403 = (e) => {
    const status = e?.response?.status
    if (status !== 403) return false
    const title = e?.response?.data?.error?.title
    return String(title || '').toLowerCase().includes('invalid host')
  }

  const swapHost = (baseUrl) => {
    const s = String(baseUrl || '')
    if (s.includes('devapi.qweather.com')) return s.replace('devapi.qweather.com', 'api.qweather.com')
    if (s.includes('api.qweather.com')) return s.replace('api.qweather.com', 'devapi.qweather.com')
    if (s.includes('devapi.heweather.net')) return s.replace('devapi.heweather.net', 'api.heweather.net')
    if (s.includes('api.heweather.net')) return s.replace('api.heweather.net', 'devapi.heweather.net')
    return 'https://api.qweather.com'
  }

  const getOnce = async (url, params) => {
    try {
      return await axios.get(url, { params, timeout: 25_000 })
    } catch (e) {
      // devapi/api host 不匹配时自动切换重试一次
      if (isInvalidHost403(e)) {
        const altBase = swapHost(QWEATHER_BASE_URL)
        const altUrl = url.replace(QWEATHER_BASE_URL, altBase)
        try {
          return await axios.get(altUrl, { params, timeout: 25_000 })
        } catch (e2) {
          e2._qweatherTriedUrls = [url, altUrl]
          throw e2
        }
      }
      e._qweatherTriedUrls = [url]
      throw e
    }
  }

  let wRes
  try {
    wRes = await getOnce(weatherUrl, { key: QWEATHER_KEY, location, lang: QWEATHER_LANG, unit: QWEATHER_UNIT })
  } catch (e) {
    const status = e?.response?.status
    const body = e?.response?.data
    const tried = Array.isArray(e?._qweatherTriedUrls) ? e._qweatherTriedUrls.join(' -> ') : weatherUrl
    throw new Error(`[weather/now] url=${tried} status=${status ?? 'unknown'} body=${body ? JSON.stringify(body) : 'empty'}`)
  }

  let aRes = null
  try {
    aRes = await getOnce(airUrl, { key: QWEATHER_KEY, location, lang: QWEATHER_LANG })
  } catch (e) {
    // 很多 key/套餐可能没有空气质量权限；允许降级为仅天气
    const status = e?.response?.status
    if (status !== 403) {
      const body = e?.response?.data
      throw new Error(`[air/now] status=${status ?? 'unknown'} body=${body ? JSON.stringify(body) : 'empty'}`)
    }
    aRes = null
  }

  const nowW = wRes?.data?.now || {}
  const nowA = aRes?.data?.now || {}

  const num = (x) => {
    const n = Number(x)
    return Number.isFinite(n) ? n : null
  }

  return {
    temp_c: num(nowW.temp),
    humidity: num(nowW.humidity),
    wind_speed: num(nowW.windSpeed),
    weather_code: nowW.icon != null ? String(nowW.icon) : nowW.text != null ? String(nowW.text) : null,

    aqi: nowA.aqi != null ? Number(nowA.aqi) : null,
    pm25: num(nowA.pm2p5 ?? nowA.pm2_5 ?? nowA.pm25),
    pm10: num(nowA.pm10),
    no2: num(nowA.no2),
    so2: num(nowA.so2),
    o3: num(nowA.o3),
    co: num(nowA.co),
  }
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length)
  let i = 0
  const workers = Array.from({ length: Math.max(1, limit) }, async () => {
    while (true) {
      const idx = i++
      if (idx >= items.length) return
      out[idx] = await fn(items[idx], idx)
    }
  })
  await Promise.all(workers)
  return out
}

async function loadAndFetchFromQWeather() {
  const {
    CITY_SEED_LIST_PATH,
    CITY_GEOJSON_PATH,
    QWEATHER_CONCURRENCY,
    QWEATHER_GEO_LOOKUP_ENABLED,
  } = process.env

  let cities = []
  if (CITY_SEED_LIST_PATH) {
    cities = await loadCitiesFromSeedListFile(CITY_SEED_LIST_PATH)
  } else if (CITY_GEOJSON_PATH) {
    cities = await loadCitiesFromGeoJsonFile(CITY_GEOJSON_PATH)
  } else {
    throw new Error('缺少 CITY_SEED_LIST_PATH 或 CITY_GEOJSON_PATH（方案 B 推荐用 CITY_SEED_LIST_PATH）')
  }

  const concurrency = QWEATHER_CONCURRENCY ? Math.max(1, Number(QWEATHER_CONCURRENCY)) : 10
  const geoLookupEnabled = String(QWEATHER_GEO_LOOKUP_ENABLED || '').toLowerCase() === 'true'

  const stats = {
    inputCities: cities.length,
    geoLookupOk: 0,
    geoLookupFail: 0,
    nowOk: 0,
    nowFail: 0,
  }
  const errors = []

  // 逐城拿 location（优先用经纬度；如果没经纬度且启用 lookup，尝试 GeoAPI）
  const enriched = await mapLimit(cities, concurrency, async (c) => {
    let qweather_location_id = null
    let lon = c.lon ?? null
    let lat = c.lat ?? null
    let triedLookup = false
    let lookupFailed = false

    // seed list 默认没有经纬度，需要 lookup 才能拿到 location_id/经纬度
    const mustLookup = Boolean(CITY_SEED_LIST_PATH) && !(lon != null && lat != null) && !qweather_location_id
    if ((!lon || !lat || !qweather_location_id) && (mustLookup || geoLookupEnabled)) {
      try {
        triedLookup = true
        const looked = await qweatherGeoLookupByName({ name: c.name, adm: c.province })
        qweather_location_id = looked.qweather_location_id
        lon = lon ?? looked.lon
        lat = lat ?? looked.lat
        if (qweather_location_id || (lon != null && lat != null)) stats.geoLookupOk += 1
      } catch (e) {
        // lookup 失败不阻断整体；后续会因为 location 不足而跳过该城
        triedLookup = true
        lookupFailed = true
        stats.geoLookupFail += 1
        errors.push(`[geoLookup] ${c.province}-${c.name}: ${e?.code || ''} ${e?.message || e}`)
      }
    }

    const location = qweather_location_id || (lon != null && lat != null ? `${lon},${lat}` : null)
    if (!location) {
      if (!lookupFailed) {
        // 没有请求 lookup 或 lookup 没报错但返回空
        stats.geoLookupFail += 1
      }
      errors.push(`[geoLookup] ${c.province}-${c.name}: no location_id or lon/lat (triedLookup=${triedLookup})`)
      return null
    }

    try {
      const metrics = await qweatherFetchNow({ location })
      stats.nowOk += 1
      return {
        adcode: c.adcode,
        name: c.name,
        province: c.province,
        lon,
        lat,
        qweather_location_id,
        metrics,
      }
    } catch (e) {
      stats.nowFail += 1
      errors.push(`[now] ${c.province}-${c.name}: ${e?.code || ''} ${e?.message || e}`)
      return null
    }
  })

  const ok = enriched.filter(Boolean)
  if (ok.length === 0) {
    const sample = errors.slice(0, 6).join(' | ')
    throw new Error(
      `QWeather 拉取结果为空（0/${stats.inputCities}）。geoLookup ok=${stats.geoLookupOk} fail=${stats.geoLookupFail}; now ok=${stats.nowOk} fail=${stats.nowFail}. ` +
        `示例错误：${sample || '无'}`
    )
  }
  return ok
}

