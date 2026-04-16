import mysql from 'mysql2/promise'

export function createPoolFromEnv() {
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
    connectionLimit: 10,
    queueLimit: 0,
    charset: 'utf8mb4',
    connectTimeout: Number.isFinite(connectTimeout) ? Math.max(1000, connectTimeout) : 12_000,
  })
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function isRetryableDbError(err) {
  if (!err) return false
  const code = String(err.code || '')
  const retryableCodes = new Set([
    'PROTOCOL_CONNECTION_LOST',
    'ECONNRESET',
    'ECONNREFUSED',
    'ER_LOCK_DEADLOCK',
    'ER_LOCK_WAIT_TIMEOUT',
  ])
  return retryableCodes.has(code)
}

export async function withDbRetry(fn, opts = {}) {
  const retries = Number.isInteger(opts.retries) ? opts.retries : 2
  const delayMs = Number.isFinite(opts.delayMs) ? opts.delayMs : 300

  let lastErr = null
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await fn()
    } catch (err) {
      lastErr = err
      if (attempt >= retries || !isRetryableDbError(err)) break
      await sleep(delayMs * (attempt + 1))
    }
  }
  throw lastErr
}

export async function testDbReadWrite(pool, opts = {}) {
  const cityId = opts.cityId ? Number(opts.cityId) : 1
  if (!Number.isFinite(cityId) || cityId <= 0) {
    throw new Error('testDbReadWrite: cityId 必须是正整数')
  }

  const now = new Date()
  now.setSeconds(0, 0)
  const ts =
    `${now.getFullYear()}-` +
    `${String(now.getMonth() + 1).padStart(2, '0')}-` +
    `${String(now.getDate()).padStart(2, '0')} ` +
    `${String(now.getHours()).padStart(2, '0')}:` +
    `${String(now.getMinutes()).padStart(2, '0')}:00`

  const payload = {
    city_id: cityId,
    ts,
    temp_c: opts.temp_c ?? 25.1,
    humidity: opts.humidity ?? 55.0,
    wind_speed: opts.wind_speed ?? 2.8,
    weather_code: opts.weather_code ?? 'test',
    aqi: opts.aqi ?? 42,
    pm25: opts.pm25 ?? 18.5,
    pm10: opts.pm10 ?? 29.2,
    no2: opts.no2 ?? 21.0,
    so2: opts.so2 ?? 6.0,
    o3: opts.o3 ?? 73.0,
    co: opts.co ?? 0.6,
  }

  const writeSql = `
    INSERT INTO city_observation_latest
      (city_id, ts, temp_c, humidity, wind_speed, weather_code, aqi, pm25, pm10, no2, so2, o3, co)
    VALUES
      (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      ts=VALUES(ts),
      temp_c=VALUES(temp_c),
      humidity=VALUES(humidity),
      wind_speed=VALUES(wind_speed),
      weather_code=VALUES(weather_code),
      aqi=VALUES(aqi),
      pm25=VALUES(pm25),
      pm10=VALUES(pm10),
      no2=VALUES(no2),
      so2=VALUES(so2),
      o3=VALUES(o3),
      co=VALUES(co)
  `

  await withDbRetry(async () => {
    await pool.query(writeSql, [
      payload.city_id,
      payload.ts,
      payload.temp_c,
      payload.humidity,
      payload.wind_speed,
      payload.weather_code,
      payload.aqi,
      payload.pm25,
      payload.pm10,
      payload.no2,
      payload.so2,
      payload.o3,
      payload.co,
    ])
  })

  const [rows] = await withDbRetry(async () =>
    pool.query(
      `
        SELECT city_id, ts, temp_c, humidity, wind_speed, weather_code, aqi, pm25, pm10, no2, so2, o3, co
        FROM city_observation_latest
        WHERE city_id = ?
        ORDER BY ts DESC
        LIMIT 1
      `,
      [cityId]
    )
  )

  return rows?.[0] || null
}

