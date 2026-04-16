import dotenv from 'dotenv'
import { mkdir } from 'node:fs/promises'
import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createPoolFromEnv } from './db.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
dotenv.config({ path: path.resolve(__dirname, '..', '.env') })

function parseArgs(argv) {
  const out = {
    output: null,
    horizonHours: 168,
    lookbackDays: 30,
  }

  for (const a of argv) {
    if (a.startsWith('--output=')) out.output = a.slice('--output='.length)
    else if (a === '--output') {
      // skip, positional value handled below
    } else if (a.startsWith('--horizon-hours=')) out.horizonHours = Number(a.slice('--horizon-hours='.length))
    else if (a.startsWith('--lookback-days=')) out.lookbackDays = Number(a.slice('--lookback-days='.length))
    else if (!a.startsWith('-') && !out.output) out.output = a
  }

  if (!out.output) {
    throw new Error('用法: node exportWeatherCsvFromDb.js --output <out.csv> [--horizon-hours=168] [--lookback-days=30]')
  }

  const horizonHours = Number.isFinite(out.horizonHours) ? Math.floor(out.horizonHours) : 168
  const lookbackDays = Number.isFinite(out.lookbackDays) ? Math.floor(out.lookbackDays) : 30

  return {
    output: out.output,
    horizonHours: Math.max(24, Math.min(168, horizonHours)),
    lookbackDays: Math.max(1, Math.min(180, lookbackDays)),
  }
}

function pad2(n) {
  return String(n).padStart(2, '0')
}

function formatMysqlDatetime(d) {
  const dt = d instanceof Date ? d : new Date(d)
  return `${dt.getFullYear()}-${pad2(dt.getMonth() + 1)}-${pad2(dt.getDate())} ${pad2(dt.getHours())}:${pad2(dt.getMinutes())}:${pad2(dt.getSeconds())}`
}

function csvEscape(x) {
  if (x == null) return ''
  const s = String(x)
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

async function main() {
  const { output, horizonHours, lookbackDays } = parseArgs(process.argv.slice(2))
  const outputPath = path.isAbsolute(output) ? output : path.resolve(process.cwd(), output)
  await mkdir(path.dirname(outputPath), { recursive: true })

  const pool = createPoolFromEnv()
  try {
    const anchor = new Date()
    anchor.setMinutes(0, 0, 0)

    const start = new Date(anchor)
    start.setDate(start.getDate() - lookbackDays)

    // Python 预测未来点用的是 anchor + 1 .. anchor + horizonHours（共 horizonHours 个）
    // 所以 endExclusive 取 anchor + horizonHours + 1 小时
    const endExclusive = new Date(anchor)
    endExclusive.setHours(endExclusive.getHours() + horizonHours + 1)

    const sql = `
      SELECT
        c.name AS city_name,
        m.ts AS ts,
        m.temp_c AS temp_c,
        m.humidity AS humidity,
        m.wind_speed AS wind_speed,
        m.pressure_hpa AS pressure_hpa,
        m.precip_mm AS precip_mm
      FROM city_observation_minute m
      JOIN city c ON c.id = m.city_id
      WHERE m.ts >= ? AND m.ts < ?
      ORDER BY c.name ASC, m.ts ASC
    `

    const [rows] = await pool.query(sql, [start, endExclusive])

    const header = ['城市', '时间', '温度', '湿度', '风速', '气压', '降水量'].join(',')
    const lines = [header]

    for (const r of rows || []) {
      const tsStr = r?.ts ? formatMysqlDatetime(r.ts) : ''
      lines.push(
        [
          csvEscape(r?.city_name),
          csvEscape(tsStr),
          csvEscape(r?.temp_c ?? null),
          csvEscape(r?.humidity ?? null),
          csvEscape(r?.wind_speed ?? null),
          csvEscape(r?.pressure_hpa ?? null),
          csvEscape(r?.precip_mm ?? null),
        ].join(',')
      )
    }

    // utf-8-sig：让 pandas 在 Windows 下更稳地识别中文列名
    const bom = '\uFEFF'
    await writeFile(outputPath, bom + lines.join('\n'), 'utf8')

    console.log(
      `[exportWeatherCsvFromDb] wrote -> ${outputPath} rows=${(rows || []).length} lookbackDays=${lookbackDays} horizonHours=${horizonHours}`,
    )
  } finally {
    await pool.end()
  }
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error('[exportWeatherCsvFromDb]', e?.message || String(e))
  process.exit(1)
})

