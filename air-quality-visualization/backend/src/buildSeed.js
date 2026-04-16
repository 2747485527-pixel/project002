import 'dotenv/config'
import axios from 'axios'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

const GEO_BASE = 'https://geo.datav.aliyun.com/areas_v3/bound'

function uniqBy(arr, keyFn) {
  const seen = new Set()
  const out = []
  for (const x of arr) {
    const k = keyFn(x)
    if (seen.has(k)) continue
    seen.add(k)
    out.push(x)
  }
  return out
}

async function fetchJson(url) {
  const res = await axios.get(url, { timeout: 40_000 })
  return res.data
}

async function getProvinces() {
  const url = `${GEO_BASE}/100000_full.json`
  const gj = await fetchJson(url)
  const features = Array.isArray(gj?.features) ? gj.features : []
  return features
    .map((f) => f?.properties)
    .filter((p) => p && String(p.level) === 'province' && p.adcode && p.name)
    .map((p) => ({ adcode: String(p.adcode), name: String(p.name), center: p.center ?? null }))
}

function parseCenter(center) {
  const lon = Array.isArray(center) ? Number(center[0]) : center != null ? Number(String(center).split(',')[0]) : null
  const lat = Array.isArray(center) ? Number(center[1]) : center != null ? Number(String(center).split(',')[1]) : null
  return { lon: Number.isFinite(lon) ? lon : null, lat: Number.isFinite(lat) ? lat : null }
}

async function getCitiesForProvince(provinceAdcode, provinceName, provinceCenter) {
  const url = `${GEO_BASE}/${provinceAdcode}_full.json`
  const gj = await fetchJson(url)
  const features = Array.isArray(gj?.features) ? gj.features : []

  const cities = features
    .map((f) => f?.properties)
    .filter((p) => p && String(p.level) === 'city' && p.adcode && p.name)
    .map((p) => ({
      name: String(p.name),
      province: provinceName,
      adcode: String(p.adcode),
      // 给和风用经纬度（lon,lat），避免依赖 GeoAPI lookup（有些 key/套餐不支持）
      ...parseCenter(p.center),
    }))

  // 直辖市/港澳台：该省级 GeoJSON 可能没有 level=city（只有 district），这里做兜底，
  // 至少保证省级本身作为一个“城市点”进入种子，避免大屏固定缺失。
  if (cities.length === 0) {
    // 优先用 100000_full.json 里的省中心；否则从该文件里随便找一个带 center 的要素（通常 district 都有）
    const anyCenterProp = features.map((f) => f?.properties).find((p) => p?.center != null)?.center ?? null
    const center = provinceCenter ?? anyCenterProp
    const { lon, lat } = parseCenter(center)

    return [
      {
        name: provinceName,
        province: provinceName,
        adcode: String(provinceAdcode),
        lon,
        lat,
      },
    ]
  }

  return cities
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

async function main() {
  const outPath =
    process.env.CITY_SEED_LIST_PATH ||
    './data/prefecture_cities_seed.json'
  const absOut = path.isAbsolute(outPath) ? outPath : path.resolve(process.cwd(), outPath)

  const concurrency = process.env.SEED_BUILD_CONCURRENCY ? Math.max(1, Number(process.env.SEED_BUILD_CONCURRENCY)) : 6

  const provinces = await getProvinces()
  const perProvince = await mapLimit(provinces, concurrency, async (p) => {
    try {
      return await getCitiesForProvince(p.adcode, p.name, p.center)
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[seed] province failed', p.adcode, p.name, e?.message || e)
      // 有些地区（如台湾）可能没有单独的 bound 文件，至少给一个兜底点（用 provinceCenter）
      const { lon, lat } = parseCenter(p.center)
      return [
        {
          name: p.name,
          province: p.name,
          adcode: String(p.adcode),
          lon,
          lat,
        },
      ]
    }
  })

  const allCities = uniqBy(perProvince.flat(), (x) => x.adcode).sort((a, b) => a.adcode.localeCompare(b.adcode))

  await mkdir(path.dirname(absOut), { recursive: true })
  await writeFile(absOut, JSON.stringify(allCities, null, 2), 'utf8')

  // eslint-disable-next-line no-console
  console.log(`[seed] wrote ${allCities.length} cities to ${absOut}`)
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error('[seed] fatal', e?.message || e)
  process.exit(1)
})

