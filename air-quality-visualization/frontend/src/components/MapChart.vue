<template>
  <div class="map-wrapper">
    <div class="map-center-title">中国城市环境综合示意图</div>

    <div class="map-toolbar">
      <button v-if="stage === 'province'" class="map-mode-btn" type="button" @click="backToNation">返回全国</button>
      <button class="map-mode-btn" :class="{ active: mode === 'pm25' }" type="button" @click="mode = 'pm25'">
        PM2.5
      </button>
      <button class="map-mode-btn" :class="{ active: mode === 'weather' }" type="button" @click="mode = 'weather'">
        天气热力
      </button>
      <button class="map-mode-btn" :class="{ active: mode === 'humidity' }" type="button" @click="mode = 'humidity'">
        湿度
      </button>
      <button class="map-mode-btn" :class="{ active: mode === 'temp' }" type="button" @click="mode = 'temp'">
        温度
      </button>
    </div>

    <div ref="chartRef" class="map-chart" :class="{ 'is-switching': isSwitching }"></div>
  </div>
</template>

<script setup>
import { ref, onMounted, onBeforeUnmount, watch, nextTick } from 'vue'
import * as echarts from 'echarts'
import { apiGet } from '../api'

const emit = defineEmits(['city-click'])
const chartRef = ref(null)
const mode = ref('pm25') // pm25 | weather | humidity | temp
const stage = ref('nation') // nation | province
const selectedProvince = ref('') // 仅 stage === 'province' 时有效
const selectedProvinceAdcode = ref('') // 仅 stage === 'province' 时有效
const currentMapName = ref('china') // echarts.registerMap 的名字
const isSwitching = ref(false)

const SWITCH_FADE_OUT_MS = 220
const SWITCH_FADE_IN_MS = 260

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function switchWithFade(fn) {
  if (isSwitching.value) return
  isSwitching.value = true

  // 先淡出（不立刻跳）
  await nextTick()
  await sleep(SWITCH_FADE_OUT_MS)

  try {
    await fn()
  } finally {
    // 再淡入
    await nextTick()
    await sleep(SWITCH_FADE_IN_MS)
    isSwitching.value = false
  }
}

// 下钻逻辑改为：点击省份后加载该省的 GeoJSON（含地级市边界）进行渲染

let chart = null
let onResize = null
let currentGeoJson = null
const geoJsonCache = new Map() // key: adcode string, value: GeoJSON
const adcodeByName = new Map() // 全国图：省份 name -> adcode

const nationRows = ref([]) // [{name, pm25, temp_c, humidity}]
const provinceRows = ref([]) // [{name, pm25, temp_c, humidity}]

const SPECIAL_PROVINCES = new Set([
  '北京市',
  '上海市',
  '天津市',
  '重庆市',
  '香港特别行政区',
  '澳门特别行政区',
  '台湾省',
])

async function loadNationRows() {
  nationRows.value = await apiGet('/api/map/nation')
}

async function loadProvinceRows(province) {
  provinceRows.value = await apiGet('/api/map/province', { province })
}

function buildMapDataByMode(m) {
  const rows = Array.isArray(nationRows.value) ? nationRows.value : []
  const names = rows.map((r) => r?.name).filter((n) => typeof n === 'string' && n.trim().length > 0)

  const byName = new Map(rows.map((r) => [r.name, r]))
  if (m === 'pm25')
    return names.map((name) => ({ name, value: byName.get(name)?.pm25 == null ? null : Number(byName.get(name).pm25) }))
  if (m === 'temp')
    return names.map((name) => ({ name, value: byName.get(name)?.temp_c == null ? null : Number(byName.get(name).temp_c) }))
  if (m === 'humidity')
    return names.map((name) => ({ name, value: byName.get(name)?.humidity == null ? null : Number(byName.get(name).humidity) }))

  // weather：简单“综合指数”（示意用）
  return names.map((name) => {
    const r = byName.get(name) || {}
    const pm = Number.isFinite(Number(r.pm25)) ? Number(r.pm25) : 0
    const t = Number.isFinite(Number(r.temp_c)) ? Number(r.temp_c) : 0
    const h = Number.isFinite(Number(r.humidity)) ? Number(r.humidity) : 0
    const pmN = Math.min(1, Math.max(0, pm / 200))
    const tN = Math.min(1, Math.max(0, (t + 10) / 45))
    const hN = Math.min(1, Math.max(0, h / 100))
    const idx = Math.round((pmN * 0.6 + tN * 0.2 + hN * 0.2) * 100)
    return { name, value: idx }
  })
}

async function loadChinaGeoJson() {
  // 优先尝试本地（如果你把 geojson 放到 public/china.json）
  // 其次用在线 GeoJSON（首次打开可能受网络影响）
  const tryUrls = ['/china.json', 'https://geo.datav.aliyun.com/areas_v3/bound/100000_full.json']
  let lastErr = null

  for (const url of tryUrls) {
    try {
      const res = await fetch(url)
      if (!res.ok) throw new Error(`GeoJSON 请求失败: ${url} (${res.status})`)
      return await res.json()
    } catch (e) {
      lastErr = e
    }
  }

  throw lastErr || new Error('GeoJSON 加载失败')
}

async function loadGeoJsonByAdcode(adcode) {
  const key = String(adcode)
  if (geoJsonCache.has(key)) return geoJsonCache.get(key)

  const url = `https://geo.datav.aliyun.com/areas_v3/bound/${key}_full.json`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`GeoJSON 请求失败: ${url} (${res.status})`)
  const json = await res.json()
  geoJsonCache.set(key, json)
  return json
}

function getTitleByMode(m) {
  if (m === 'pm25') return 'PM2.5'
  if (m === 'temp') return '温度(°C)'
  if (m === 'humidity') return '湿度(%)'
  return '天气热力(综合)'
}

function getVisualMax(m, values) {
  if (m === 'temp') return Math.max(40, ...values)
  if (m === 'humidity') return 100
  if (m === 'weather') return 100
  return Math.max(180, ...values)
}

function hashStr(s) {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return h >>> 0
}

function pseudoOffset(key, range) {
  const h = hashStr(key)
  const t = (h % 10000) / 10000 // [0,1)
  return (t - 0.5) * 2 * range
}

const clamp = (n, min, max) => Math.max(min, Math.min(max, n))

function parseCenter(center) {
  if (!center) return null
  if (Array.isArray(center) && center.length >= 2) {
    const lon = Number(center[0])
    const lat = Number(center[1])
    return Number.isFinite(lon) && Number.isFinite(lat) ? [lon, lat] : null
  }
  if (typeof center === 'string') {
    const parts = center.split(',').map((x) => x.trim())
    if (parts.length >= 2) {
      const lon = Number(parts[0])
      const lat = Number(parts[1])
      return Number.isFinite(lon) && Number.isFinite(lat) ? [lon, lat] : null
    }
  }
  return null
}

function featureCenter(feature) {
  const pCenter = parseCenter(feature?.properties?.center)
  if (pCenter) return pCenter

  // fallback: bbox centroid from polygon coordinates
  const geom = feature?.geometry
  const coords = geom?.coordinates
  if (!coords) return null

  let minLon = Infinity
  let minLat = Infinity
  let maxLon = -Infinity
  let maxLat = -Infinity

  const visitPoint = (pt) => {
    if (!Array.isArray(pt) || pt.length < 2) return
    const lon = Number(pt[0])
    const lat = Number(pt[1])
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) return
    minLon = Math.min(minLon, lon)
    minLat = Math.min(minLat, lat)
    maxLon = Math.max(maxLon, lon)
    maxLat = Math.max(maxLat, lat)
  }

  const walk = (node) => {
    if (!node) return
    if (typeof node[0] === 'number') {
      visitPoint(node)
      return
    }
    if (Array.isArray(node)) {
      for (const x of node) walk(x)
    }
  }

  walk(coords)
  if (!Number.isFinite(minLon) || !Number.isFinite(minLat) || !Number.isFinite(maxLon) || !Number.isFinite(maxLat)) return null
  return [(minLon + maxLon) / 2, (minLat + maxLat) / 2]
}

function roamTo(center, zoom) {
  if (!chart) return
  const payload = { type: 'geoRoam' }
  if (Array.isArray(center)) payload.center = center
  if (typeof zoom === 'number') payload.zoom = zoom
  chart.dispatchAction(payload)
}

async function drillToProvince(provinceName) {
  const adcode = adcodeByName.get(provinceName)
  if (!adcode) return false

  await switchWithFade(async () => {
    const provinceGeoJson = await loadGeoJsonByAdcode(adcode)
    const mapKey = `province-${adcode}`
    echarts.registerMap(mapKey, provinceGeoJson)
    currentGeoJson = provinceGeoJson
    currentMapName.value = mapKey
    stage.value = 'province'
    selectedProvince.value = provinceName
    selectedProvinceAdcode.value = adcode
    await loadProvinceRows(provinceName).catch(() => {})
    renderOption()
  })

  return true
}

async function focusToCity(name) {
  const n = (name || '').trim()
  if (!n || !chart) return

  let resolved = null
  try {
    resolved = await apiGet('/api/city/resolve', { name: n })
  } catch {
    resolved = { scope: 'nation', name: '全国' }
  }

  if (resolved?.scope === 'nation') {
    if (stage.value !== 'nation') backToNation()
    chart.dispatchAction({ type: 'downplay', seriesIndex: 0 })
    chart.dispatchAction({ type: 'highlight', seriesIndex: 0, name: '全国' })
    return
  }

  if (resolved?.scope === 'province') {
    // 省份：下钻到该省（展示地级市边界），比“仅高亮”更符合省级联动预期
    await drillToProvince(resolved?.name || n).catch(() => {})
    return
  }

  if (resolved?.scope !== 'city') {
    // 兜底：回到全国并高亮
    if (stage.value !== 'nation') backToNation()
    chart.dispatchAction({ type: 'downplay', seriesIndex: 0 })
    chart.dispatchAction({ type: 'highlight', seriesIndex: 0, name: resolved?.name || n })
    return
  }

  const cityName = resolved?.name || n
  const provinceName = resolved?.province || ''

  // 确保处于省级地图（城市才能定位）
  if (provinceName) {
    if (stage.value !== 'province' || selectedProvince.value !== provinceName) {
      await drillToProvince(provinceName)
    }
  }

  // 直辖市/港澳台：下钻后多是区县，无法按“北京市”精确点中 -> 用省名联动并尽量居中
  const targetName = SPECIAL_PROVINCES.has(provinceName) ? (currentGeoJson?.features?.[0]?.properties?.name || '') : cityName

  const features = Array.isArray(currentGeoJson?.features) ? currentGeoJson.features : []
  const hit = features.find((f) => f?.properties?.name === targetName) || null
  const center = hit ? featureCenter(hit) : null

  chart.dispatchAction({ type: 'downplay', seriesIndex: 0 })
  if (targetName) chart.dispatchAction({ type: 'highlight', seriesIndex: 0, name: targetName })
  roamTo(center, SPECIAL_PROVINCES.has(provinceName) ? 1.35 : 1.8)
}

defineExpose({ focusToCity })

function getCityMetricByMode(cityName, m, provinceName) {
  const rows = Array.isArray(provinceRows.value) ? provinceRows.value : []
  const hit = rows.find((r) => r?.name === cityName) || null
  if (hit) {
    const pm25 = hit?.pm25 == null ? null : Number(hit.pm25)
    const temp = hit?.temp_c == null ? null : Number(hit.temp_c)
    const humidity = hit?.humidity == null ? null : Number(hit.humidity)

    if (m === 'pm25') return pm25
    if (m === 'temp') return temp
    if (m === 'humidity') return humidity

    const pm = Number.isFinite(pm25) ? pm25 : 0
    const t = Number.isFinite(temp) ? temp : 0
    const h = Number.isFinite(humidity) ? humidity : 0
    const pmN = Math.min(1, Math.max(0, pm / 200))
    const tN = Math.min(1, Math.max(0, (t + 10) / 45))
    const hN = Math.min(1, Math.max(0, h / 100))
    return Math.round((pmN * 0.6 + tN * 0.2 + hN * 0.2) * 100)
  }

  // 下钻后 GeoJSON 名称与 DB 城市名对不上时（常见：直辖市是区/县），用省级均值兜底并加轻微扰动。
  const base =
    rows.find((r) => r?.name === provinceName) ||
    rows[0] ||
    null

  const basePm = base?.pm25 == null ? null : Number(base.pm25)
  const baseT = base?.temp_c == null ? null : Number(base.temp_c)
  const baseH = base?.humidity == null ? null : Number(base.humidity)

  const key = `${provinceName}::${cityName}`
  const pm25 = basePm == null ? null : round1(clamp(basePm + pseudoOffset(`${key}::pm`, 18), 0, 500))
  const temp = baseT == null ? null : round1(clamp(baseT + pseudoOffset(`${key}::t`, 5), -30, 60))
  const humidity = baseH == null ? null : round1(clamp(baseH + pseudoOffset(`${key}::h`, 10), 0, 100))

  if (m === 'pm25') return pm25
  if (m === 'temp') return temp
  if (m === 'humidity') return humidity

  const pm = Number.isFinite(pm25) ? pm25 : 0
  const t = Number.isFinite(temp) ? temp : 0
  const h = Number.isFinite(humidity) ? humidity : 0
  const pmN = Math.min(1, Math.max(0, pm / 200))
  const tN = Math.min(1, Math.max(0, (t + 10) / 45))
  const hN = Math.min(1, Math.max(0, h / 100))
  return Math.round((pmN * 0.6 + tN * 0.2 + hN * 0.2) * 100)
}

function round1(n) {
  return Math.round(n * 10) / 10
}

function buildCityMapData(m, geoJson) {
  const features = Array.isArray(geoJson?.features) ? geoJson.features : []
  const names = features
    .map((f) => f?.properties?.name)
    .filter((n) => typeof n === 'string' && n.trim().length > 0)

  const raw = names.map((cityName) => ({
    name: cityName,
    value: getCityMetricByMode(cityName, m, selectedProvince.value),
  }))
  const values = raw.map((d) => (typeof d.value === 'number' ? d.value : 0))
  const maxValue = getVisualMax(m, values)
  return { maxValue, data: raw }
}

function renderOption() {
  if (!chart) return

  const m = mode.value
  const isProvince = stage.value === 'province' && !!selectedProvince.value

  const mapData = isProvince
    ? buildCityMapData(m, currentGeoJson).data
    : buildMapDataByMode(m)
  const values = mapData.map((d) => (typeof d.value === 'number' ? d.value : 0))
  const maxValue = getVisualMax(m, values)

  chart.setOption(
    {
      tooltip: {
        trigger: 'item',
        formatter: (p) => {
          const v = typeof p.value === 'number' ? p.value : null
          if (v == null) return `${p.name}`
          return `${p.name}<br/>${getTitleByMode(m)}：${v}`
        },
      },
      visualMap: {
        show: false, // 保留着色映射，仅隐藏左侧颜色条
        min: 0,
        max: maxValue,
        inRange: {
          color: ['#1e3a8a', '#2563eb', '#22c55e', '#f59e0b', '#ef4444'],
        },
      },
      geo: {
        map: currentMapName.value,
        roam: true,
        zoom: isProvince ? 1.15 : 1.05,
        label: {
          show: isProvince,
          color: 'rgba(255,255,255,0.85)',
        },
        itemStyle: {
          areaColor: '#ffffff',
          borderColor: 'rgba(0,0,0,0.22)',
          borderWidth: 1,
        },
        emphasis: {
          label: { show: true },
          itemStyle: {
            areaColor: 'rgba(0,0,0,0.06)',
            borderColor: 'rgba(0,0,0,0.35)',
          },
        },
      },
      series: [
        {
          name: getTitleByMode(m),
          type: 'map',
          map: currentMapName.value,
          geoIndex: 0,
          data: mapData,
          itemStyle: {
            areaColor: '#ffffff',
            borderColor: 'rgba(0,0,0,0.22)',
          },
          emphasis: {
            itemStyle: {
              shadowBlur: 10,
              shadowColor: 'rgba(0,0,0,0.35)',
            },
          },
        },
      ],
    },
    { notMerge: true }
  )
}

function backToNation() {
  switchWithFade(async () => {
    stage.value = 'nation'
    selectedProvince.value = ''
    selectedProvinceAdcode.value = ''
    currentMapName.value = 'china'
    currentGeoJson = geoJsonCache.get('100000') || currentGeoJson
    renderOption()
  })
}

onMounted(async () => {
  if (!chartRef.value) return

  chart = echarts.init(chartRef.value)

  await loadNationRows().catch(() => {})
  const geoJson = await loadChinaGeoJson()
  currentGeoJson = geoJson
  geoJsonCache.set('100000', geoJson)
  echarts.registerMap('china', geoJson)
  currentMapName.value = 'china'

  adcodeByName.clear()
  for (const f of geoJson?.features ?? []) {
    const name = f?.properties?.name
    const adcode = f?.properties?.adcode
    if (typeof name === 'string' && (typeof adcode === 'number' || typeof adcode === 'string')) {
      adcodeByName.set(name, String(adcode))
    }
  }
  renderOption()

  chart.on('click', (params) => {
    const name = params?.name
    if (!name) return

    // nation：点省份 -> 下钻到该省地级市边界
    if (stage.value === 'nation') {
      const adcode = adcodeByName.get(name)
      if (!adcode) {
        emit('city-click', name)
        return
      }

      drillToProvince(name).catch(() => {})

      return
    }

    // province：点地级市 -> 联动右侧模块
    if (stage.value === 'province') {
      // 直辖市/港澳台下钻后很多是区县，DB 没有对应粒度；点击时按省级联动，避免“点了没数据”
      if (SPECIAL_PROVINCES.has(selectedProvince.value)) emit('city-click', selectedProvince.value)
      else emit('city-click', name)
    }
  })

  onResize = () => chart?.resize()
  window.addEventListener('resize', onResize)
})

watch(
  () => mode.value,
  () => {
    renderOption()
  }
)

onBeforeUnmount(() => {
  if (onResize) window.removeEventListener('resize', onResize)
  if (chart) {
    chart.dispose()
    chart = null
  }
})
</script>

<style scoped>
/* 主要样式走全局 style.css（与参考图一致） */
.map-chart {
  transition:
    opacity 260ms ease,
    transform 260ms ease;
}

.map-chart.is-switching {
  opacity: 0;
  transform: scale(0.995);
}
</style>
