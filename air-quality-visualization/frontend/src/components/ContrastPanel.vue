<template>
  <div class="contrast">
    <div class="contrast-head">
      <div>
        <div class="contrast-title">短期差异城市</div>
        <div class="contrast-subtext">窗口：近 {{ windowMin }} 分钟 vs 前 {{ windowMin }} 分钟</div>
      </div>
      <div class="contrast-toolbar">
        <div class="contrast-tabs">
          <button class="contrast-tab" :class="{ active: kind === 'air' }" type="button" @click="kind = 'air'">空气</button>
          <button class="contrast-tab" :class="{ active: kind === 'weather' }" type="button" @click="kind = 'weather'">天气</button>
        </div>
        <div class="contrast-actions">
          <select v-model="sortKey" class="contrast-sort" aria-label="排序方式">
            <option value="delta">按变化幅度</option>
            <option value="name">按城市名</option>
            <option value="province">按省份</option>
          </select>
          <button class="contrast-refresh" type="button" @click="load">刷新</button>
        </div>
      </div>
    </div>

    <div v-if="error" class="contrast-empty">
      <div class="contrast-empty-title">加载失败</div>
      <div class="contrast-empty-sub">{{ error }}</div>
    </div>
    <div v-else-if="loading" class="contrast-empty">
      <div class="contrast-empty-title">加载中…</div>
    </div>
    <div v-else-if="!list.length" class="contrast-empty">
      <div class="contrast-empty-title">暂无差异数据</div>
      <div class="contrast-empty-sub">需要小时级历史数据（表 `city_observation_minute`，整点写入）持续同步。</div>
    </div>

    <ul v-else class="contrast-list">
      <li
        v-for="row in sortedList"
        :key="rowKey(row)"
        class="contrast-item"
        :class="{ active: isActive(row) }"
        @click="pickCity(row)"
      >
        <div class="contrast-item-left">
          <div class="contrast-item-name">{{ row.name }}</div>
          <div class="contrast-item-sub">{{ row.province || '—' }}</div>
        </div>

        <div class="contrast-item-middle">
          <div class="contrast-chart-caption">{{ chartCaption(row) }}</div>
          <div class="contrast-mini-chart" :class="kind">
            <template v-if="kind === 'air'">
              <svg class="spark-svg" viewBox="0 0 148 44" width="148" height="44" aria-hidden="true">
                <line class="spark-grid" x1="0" y1="38" x2="148" y2="38" />
                <polyline class="spark-line" :class="sparkTrendClass(row.delta)" :points="airPoints(row)" />
                <circle
                  v-for="pt in airCircles(row)"
                  :key="pt.key"
                  class="spark-dot"
                  :class="sparkTrendClass(row.delta)"
                  :cx="pt.x"
                  :cy="pt.y"
                  r="2.8"
                >
                  <title>{{ pt.tip }}</title>
                </circle>
              </svg>
            </template>
            <template v-else>
              <svg class="spark-svg weather" viewBox="0 0 148 44" width="148" height="44" aria-hidden="true">
                <line class="spark-grid" x1="0" y1="20" x2="148" y2="20" />
                <line class="spark-grid" x1="0" y1="43" x2="148" y2="43" />
                <polyline class="spark-line spark-temp" :points="tempPoints(row)" />
                <g :transform="`translate(0 ${WEATHER_HUM_OFFSET_Y})`">
                  <polyline class="spark-line spark-hum" :points="humPoints(row)" />
                </g>
              </svg>
            </template>
          </div>
        </div>

        <div class="contrast-item-right">
          <template v-if="kind === 'air'">
            <button class="contrast-detail-btn" type="button" @click.stop="open(row)">详情</button>
            <span class="contrast-delta" :class="deltaClass(row.delta)">{{ deltaText(row.delta) }}</span>
          </template>
          <template v-else>
            <button class="contrast-detail-btn" type="button" @click.stop="open(row)">详情</button>
            <span class="contrast-metric-group">
              <span class="contrast-metric">温度</span>
              <span class="contrast-delta" :class="deltaClass(row.delta_temp)">{{ deltaText(row.delta_temp, '°C') }}</span>
            </span>
            <span class="contrast-metric-group">
              <span class="contrast-metric">湿度</span>
              <span class="contrast-delta" :class="deltaClass(row.delta_hum)">{{ deltaText(row.delta_hum, '%') }}</span>
            </span>
          </template>
        </div>
      </li>
    </ul>

    <ContrastModal
      v-if="modalOpen"
      :city="selected?.name || ''"
      :province="selected?.province || ''"
      :kind="kind"
      :window-min="windowMin"
      @close="modalOpen = false"
      @pick-city="emitPickCity"
    />
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { apiGet } from '../api'
import ContrastModal from './ContrastModal.vue'

const props = defineProps({
  selectedCity: { type: String, default: '' },
})

const emit = defineEmits(['pick-city'])

const kind = ref('air') // air | weather
const windowMin = ref(720)
const list = ref([])
const sortKey = ref('delta')
const loading = ref(false)
const error = ref('')

const modalOpen = ref(false)
const selected = ref(null)

const rowKey = (r) => `${r?.province || ''}::${r?.name || ''}`

const deltaClass = (d) => {
  const n = Number(d)
  if (!Number.isFinite(n)) return 'muted'
  if (n > 0) return 'up'
  if (n < 0) return 'down'
  return 'muted'
}

const deltaText = (d, unit = '') => {
  const n = Number(d)
  if (!Number.isFinite(n)) return '--'
  const sign = n > 0 ? '↑' : n < 0 ? '↓' : ''
  const abs = Math.round(Math.abs(n) * 10) / 10
  return `${sign}${abs}${unit}`
}

const primaryDelta = (row) => {
  if (kind.value === 'weather') {
    const t = Number(row?.delta_temp)
    const h = Number(row?.delta_hum)
    return Math.abs(Number.isFinite(t) ? t : 0) + Math.abs(Number.isFinite(h) ? h : 0)
  }
  const d = Number(row?.delta)
  return Number.isFinite(d) ? Math.abs(d) : 0
}

const sortedList = computed(() => {
  const rows = [...list.value]
  if (sortKey.value === 'name') {
    return rows.sort((a, b) => String(a?.name || '').localeCompare(String(b?.name || ''), 'zh-CN'))
  }
  if (sortKey.value === 'province') {
    return rows.sort((a, b) => String(a?.province || '').localeCompare(String(b?.province || ''), 'zh-CN'))
  }
  return rows.sort((a, b) => primaryDelta(b) - primaryDelta(a))
})

async function load() {
  loading.value = true
  error.value = ''
  try {
    const rows = await apiGet('/api/contrast/top', { kind: kind.value, limit: 10, windowMin: windowMin.value })
    list.value = Array.isArray(rows) ? rows : []
    refreshSparklinesForList(list.value).catch(() => {})
  } catch (e) {
    list.value = []
    error.value = e?.message ? String(e.message) : '请求失败'
  } finally {
    loading.value = false
  }
}

function open(row) {
  selected.value = row
  modalOpen.value = true
}

function pickCity(row) {
  const name = (row?.name || '').trim()
  if (!name) return
  emit('pick-city', name)
}

function emitPickCity(name) {
  const n = (name || '').trim()
  if (!n) return
  emit('pick-city', n)
}

const isActive = (row) => (row?.name || '').trim() && (row?.name || '').trim() === (props.selectedCity || '').trim()

// -------- Sparkline（曲线图） --------
// 列表接口 `/api/contrast/top` 只返回 now/prev 均值；为了展示“曲线”趋势，
// 这里为列表中前 10 个城市拉取 `/api/contrast/detail` 的尾部序列并缓存。
const SPARK_W = 148
const AIR_H = 44

const WEATHER_TEMP_H = 19
const WEATHER_GAP_Y = 4
const WEATHER_HUM_H = 19
const WEATHER_HUM_OFFSET_Y = WEATHER_TEMP_H + WEATHER_GAP_Y

const SPARK_PAD_AIR = { left: 4, right: 4, top: 6, bottom: 6 }
const SPARK_PAD_WEATHER = { left: 4, right: 4, top: 4, bottom: 4 }

const SPARK_TAIL_N = 14

const sparkData = ref({}) // key => { ready, loading, pm25Points, tempPoints, humPoints, pm25Dots, series }
const sparkDataCache = new Map() // key => { pm25Points, tempPoints, humPoints, pm25Dots, series }

let sparkSeq = 0
const currentSparkSeqRef = ref(0)

const sparkKeyForCity = (cityName, curWindowMin) => `${String(cityName || '').trim()}::${curWindowMin}`

const sparkPoints = (values, totalW, totalH, pad) => {
  const arr = Array.isArray(values) ? values : []
  if (arr.length < 2) return ''

  let min = Infinity
  let max = -Infinity
  for (const v of arr) {
    const n = Number(v)
    if (!Number.isFinite(n)) continue
    if (n < min) min = n
    if (n > max) max = n
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) return ''
  if (min === max) max = min + 1e-6

  const xSpan = totalW - pad.left - pad.right
  const ySpan = totalH - pad.top - pad.bottom
  const denom = arr.length - 1

  const points = []
  for (let i = 0; i < arr.length; i++) {
    const v = Number(arr[i])
    if (!Number.isFinite(v)) continue
    const x = pad.left + (denom > 0 ? (i * xSpan) / denom : xSpan / 2)
    const t = (v - min) / (max - min)
    const y = pad.top + (1 - t) * ySpan
    points.push(`${x.toFixed(2)},${y.toFixed(2)}`)
  }

  return points.join(' ')
}

const makeTailFinite = (arr, n) => {
  const finite = Array.isArray(arr)
    ? arr
        .map((x) => (x == null ? null : Number(x)))
        .filter((x) => x != null && Number.isFinite(x))
    : []
  return finite.slice(-n)
}

const ensureSparkForCity = async (row) => {
  const city = (row?.name || '').trim()
  if (!city) return

  const curWindowMin = windowMin.value
  const key = sparkKeyForCity(city, curWindowMin)

  // cache 命中：直接使用
  if (sparkDataCache.has(key)) {
    if (!sparkData.value[key]?.ready) {
      const cached = sparkDataCache.get(key)
      sparkData.value = { ...sparkData.value, [key]: { ready: true, loading: false, ...cached } }
    }
    return
  }

  // 已在加载中
  if (sparkData.value?.[key]?.loading) return

  sparkData.value = {
    ...sparkData.value,
    [key]: { ready: false, loading: true, pm25Points: '', tempPoints: '', humPoints: '', pm25Dots: [], series: [] },
  }

  try {
    const d = await apiGet('/api/contrast/detail', { city, kind: kind.value, windowMin: curWindowMin })
    const series = Array.isArray(d?.series) ? d.series : []

    const pm25Vals = makeTailFinite(series.map((p) => p.pm25), SPARK_TAIL_N)
    const tempVals = makeTailFinite(series.map((p) => p.temp_c), SPARK_TAIL_N)
    const humVals = makeTailFinite(series.map((p) => p.humidity), SPARK_TAIL_N)

    const pm25Points = sparkPoints(pm25Vals, SPARK_W, AIR_H, SPARK_PAD_AIR)
    const tempPoints = sparkPoints(tempVals, SPARK_W, WEATHER_TEMP_H, SPARK_PAD_WEATHER)
    const humPoints = sparkPoints(humVals, SPARK_W, WEATHER_HUM_H, SPARK_PAD_WEATHER)
    const pm25Dots = sparkDots(pm25Vals, series.slice(-pm25Vals.length), SPARK_W, AIR_H, SPARK_PAD_AIR)

    sparkDataCache.set(key, { pm25Points, tempPoints, humPoints, pm25Dots, series })

    if (sparkSeq !== currentSparkSeqRef.value) return
    sparkData.value = { ...sparkData.value, [key]: { ready: true, loading: false, pm25Points, tempPoints, humPoints, pm25Dots, series } }
  } catch {
    if (sparkSeq !== currentSparkSeqRef.value) return
    sparkData.value = { ...sparkData.value, [key]: { ready: false, loading: false, pm25Points: '', tempPoints: '', humPoints: '', pm25Dots: [], series: [] } }
  }
}

const refreshSparklinesForList = async (rows) => {
  const listArr = Array.isArray(rows) ? rows : []
  if (!listArr.length) return

  // 每次刷新都让旧请求失效
  const seq = ++sparkSeq
  currentSparkSeqRef.value = seq

  // 限制并发，避免同时打爆后端
  const concurrency = 3
  let idx = 0
  const workers = Array.from({ length: concurrency }, () =>
    (async () => {
      while (idx < listArr.length) {
        const i = idx++
        await ensureSparkForCity(listArr[i])
      }
    })()
  )

  await Promise.allSettled(workers)
}

const rowSparkKey = (row) => sparkKeyForCity(row?.name, windowMin.value)

const airPoints = (row) => sparkData.value?.[rowSparkKey(row)]?.pm25Points || ''
const tempPoints = (row) => sparkData.value?.[rowSparkKey(row)]?.tempPoints || ''
const humPoints = (row) => sparkData.value?.[rowSparkKey(row)]?.humPoints || ''
const airCircles = (row) => sparkData.value?.[rowSparkKey(row)]?.pm25Dots || []

const sparkTrendClass = (delta) => (Number(delta) > 0 ? 'spark-up' : Number(delta) < 0 ? 'spark-down' : 'spark-flat')

const chartCaption = (row) => {
  if (kind.value === 'air') return '近720分钟 PM2.5趋势'
  const t = deltaText(row?.delta_temp, '°C')
  const h = deltaText(row?.delta_hum, '%')
  return `温度 ${t} · 湿度 ${h}`
}

const sparkDots = (values, rawSeries, totalW, totalH, pad) => {
  const arr = Array.isArray(values) ? values : []
  if (arr.length < 2) return []

  let min = Infinity
  let max = -Infinity
  for (const v of arr) {
    const n = Number(v)
    if (!Number.isFinite(n)) continue
    if (n < min) min = n
    if (n > max) max = n
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) return []
  if (min === max) max = min + 1e-6

  const prev = arr.slice(0, -1).reduce((s, x) => s + x, 0) / Math.max(1, arr.length - 1)
  const xSpan = totalW - pad.left - pad.right
  const ySpan = totalH - pad.top - pad.bottom
  const denom = arr.length - 1

  return arr.map((v, i) => {
    const x = pad.left + (denom > 0 ? (i * xSpan) / denom : xSpan / 2)
    const t = (v - min) / (max - min)
    const y = pad.top + (1 - t) * ySpan
    const point = rawSeries[i] || {}
    const time = point?.time || point?.ts || `T${i + 1}`
    const ratio = prev ? (((v - prev) / prev) * 100).toFixed(1) : '0.0'
    return {
      key: `${time}-${i}`,
      x: x.toFixed(2),
      y: y.toFixed(2),
      tip: `${time} | PM2.5 ${Math.round(v * 10) / 10} | 环比 ${ratio}%`,
    }
  })
}

let timer = null
const startLive = () => {
  stopLive()
  timer = setInterval(() => load(), 120_000)
}
const stopLive = () => {
  if (timer) clearInterval(timer)
  timer = null
}

watch(
  () => [kind.value, windowMin.value],
  () => load().then(startLive),
  { immediate: true }
)

onMounted(() => {
  load().then(startLive)
})

onBeforeUnmount(() => {
  stopLive()
})
</script>

<style scoped>
.contrast {
  height: 100%;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.contrast-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.contrast-title {
  font-size: 15px;
  font-weight: 700;
  letter-spacing: 1px;
  color: #aee8ff;
}

.contrast-subtext {
  margin-top: 2px;
  font-size: 11px;
  color: rgba(200, 236, 245, 0.76);
}

.contrast-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.contrast-tabs {
  display: flex;
  gap: 4px;
  padding: 2px;
  border-radius: 999px;
  border: 1px solid rgba(0, 255, 255, 0.22);
  background: rgba(0, 12, 18, 0.72);
}

.contrast-tab {
  padding: 3px 10px;
  font-size: 12px;
  border-radius: 999px;
  border: none;
  background: transparent;
  color: rgba(180, 205, 214, 0.8);
  cursor: pointer;
  line-height: 1.2;
  transition: background 0.2s ease, color 0.2s ease, box-shadow 0.2s ease;
}

.contrast-tab:hover {
  color: #d7f9ff;
  background: rgba(0, 229, 255, 0.08);
}

.contrast-tab.active {
  background: linear-gradient(90deg, rgba(0, 229, 255, 0.9), rgba(0, 179, 255, 0.82));
  color: #fff;
  box-shadow: 0 0 10px rgba(0, 229, 255, 0.35);
}

.contrast-actions {
  display: flex;
  align-items: center;
  gap: 6px;
}

.contrast-sort {
  min-width: 88px;
  padding: 4px 8px;
  border-radius: 999px;
  border: 1px solid rgba(0, 229, 255, 0.22);
  background: rgba(0, 0, 0, 0.42);
  color: rgba(220, 245, 255, 0.9);
  font-size: 11px;
}

.contrast-refresh {
  padding: 4px 10px;
  font-size: 11px;
  border-radius: 999px;
  border: 1px solid rgba(0, 229, 255, 0.55);
  background: rgba(0, 0, 0, 0.18);
  color: #8febff;
  cursor: pointer;
  transition: background 0.2s ease, box-shadow 0.2s ease;
}

.contrast-refresh:hover {
  background: rgba(0, 229, 255, 0.08);
  box-shadow: 0 0 8px rgba(0, 229, 255, 0.18);
}

.contrast-list {
  list-style: none;
  margin: 8px 0 0;
  padding: 0;
  min-height: 0;
  overflow: auto;
  display: grid;
  gap: 9px;
  overscroll-behavior: contain;
  scrollbar-gutter: stable;
}

.contrast-list::-webkit-scrollbar {
  width: 6px;
}

.contrast-list::-webkit-scrollbar-thumb {
  background: rgba(0, 229, 255, 0.35);
  border-radius: 999px;
}

.contrast-list::-webkit-scrollbar-track {
  background: rgba(255, 255, 255, 0.06);
}

.contrast-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 8px 10px;
  border: 1px solid rgba(0, 229, 255, 0.28);
  background: rgba(4, 16, 24, 0.76);
  box-shadow: inset 0 0 10px rgba(0, 229, 255, 0.05), 0 0 8px rgba(0, 229, 255, 0.08);
  cursor: pointer;
  border-radius: 14px;
  transition: background 0.2s ease, box-shadow 0.2s ease, border-color 0.2s ease, transform 0.2s ease;
}

.contrast-item:hover {
  background: rgba(0, 229, 255, 0.1);
  border-color: rgba(0, 229, 255, 0.46);
  box-shadow: inset 0 0 12px rgba(0, 229, 255, 0.08), 0 0 14px rgba(0, 229, 255, 0.16);
  transform: translateY(-1px);
}

.contrast-item-left {
  width: 82px;
  flex: 0 0 82px;
}

.contrast-detail-btn {
  flex: 0 0 auto;
  padding: 3px 9px;
  border-radius: 999px;
  border: 1px solid rgba(0, 229, 255, 0.4);
  background: rgba(0, 0, 0, 0.3);
  color: #8fefff;
  font-size: 11px;
  cursor: pointer;
  transition: background 0.2s ease, box-shadow 0.2s ease;
}

.contrast-detail-btn:hover {
  background: rgba(0, 229, 255, 0.1);
  box-shadow: 0 0 10px rgba(0, 229, 255, 0.16);
}

.contrast-item.active {
  background: rgba(0, 255, 255, 0.12);
  border-color: rgba(0, 255, 255, 0.42);
}

.contrast-item-name {
  font-size: 15px;
  font-weight: 700;
  color: rgba(244, 251, 255, 0.96);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.contrast-item-sub {
  font-size: 11px;
  color: rgba(203, 221, 232, 0.72);
  margin-top: 2px;
}

.contrast-item-middle {
  min-width: 0;
  flex: 1 1 auto;
}

.contrast-chart-caption {
  font-size: 11px;
  color: rgba(206, 238, 246, 0.72);
}

.contrast-item-right {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 6px;
  flex: 0 0 auto;
  min-width: 112px;
  font-variant-numeric: tabular-nums;
  flex-wrap: wrap;
}

.contrast-metric {
  font-size: 11px;
  color: rgba(202, 230, 240, 0.72);
}

.contrast-metric-group {
  display: inline-flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
}

.contrast-delta {
  font-size: 12px;
  font-weight: 700;
  padding: 3px 7px;
  border-radius: 999px;
  border: 1px solid rgba(0, 255, 255, 0.25);
  background: rgba(0, 0, 0, 0.35);
}

.contrast-delta.up {
  border-color: rgba(255, 87, 34, 0.4);
  color: #ff8a65;
  box-shadow: 0 0 8px rgba(255, 87, 34, 0.14);
}

.contrast-delta.down {
  border-color: rgba(0, 229, 255, 0.42);
  color: #00e5ff;
  box-shadow: 0 0 8px rgba(0, 229, 255, 0.14);
}

.contrast-delta.muted {
  opacity: 0.7;
}

.contrast-empty {
  flex: 1 1 auto;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  gap: 6px;
  text-align: center;
  padding: 10px 0;
}

.contrast-empty-title {
  font-size: 14px;
  color: #aee8ff;
  letter-spacing: 1px;
}

.contrast-empty-sub {
  font-size: 12px;
  opacity: 0.78;
  max-width: 300px;
  line-height: 1.35;
}

.contrast-mini-chart {
  margin-top: 3px;
  display: flex;
  align-items: center;
  justify-content: flex-start;
  min-height: 44px;
}

.spark-svg {
  display: block;
  overflow: visible;
}

.spark-grid {
  stroke: rgba(174, 232, 255, 0.14);
  stroke-width: 1;
}

.spark-line {
  fill: none;
  stroke-width: 1.9;
  stroke-linecap: round;
  stroke-linejoin: round;
  filter: drop-shadow(0 0 4px rgba(0, 229, 255, 0.22));
}

.spark-up {
  stroke: #ff5722;
  filter: drop-shadow(0 0 4px rgba(255, 87, 34, 0.28));
}

.spark-down {
  stroke: #00e5ff;
  filter: drop-shadow(0 0 4px rgba(0, 229, 255, 0.28));
}

.spark-flat {
  stroke: rgba(174, 232, 255, 0.72);
}

.spark-temp {
  stroke: rgba(255, 183, 77, 0.95);
  filter: drop-shadow(0 0 4px rgba(255, 183, 77, 0.18));
}

.spark-hum {
  stroke: rgba(120, 201, 255, 0.85);
  filter: drop-shadow(0 0 4px rgba(120, 201, 255, 0.18));
}

.spark-dot {
  opacity: 0;
  transition: opacity 0.16s ease;
}

.spark-svg:hover .spark-dot {
  opacity: 1;
}

.spark-dot.spark-up {
  fill: #ff5722;
}

.spark-dot.spark-down {
  fill: #00e5ff;
}

.spark-dot.spark-flat {
  fill: rgba(174, 232, 255, 0.72);
}

@media (max-width: 1280px) {
  .contrast-head {
    align-items: flex-start;
  }

  .contrast-item {
    align-items: flex-start;
    flex-wrap: wrap;
  }

  .contrast-item-left,
  .contrast-item-right {
    width: 100%;
    flex: 1 1 100%;
  }

  .contrast-item-middle {
    order: 3;
    width: 100%;
    flex: 1 1 100%;
  }

  .contrast-item-right {
    justify-content: flex-start;
    min-width: 0;
  }
}
</style>

