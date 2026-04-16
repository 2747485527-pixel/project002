<template>
  <section class="card">
    <div class="head">
      <div class="title">气象-污染耦合分析</div>
      <div class="tabs">
        <button class="tab" :class="{ active: couplingX === 'temp' }" type="button" @click="couplingX = 'temp'">温度</button>
        <button class="tab" :class="{ active: couplingX === 'humidity' }" type="button" @click="couplingX = 'humidity'">湿度</button>
        <button class="tab" :class="{ active: couplingX === 'wind' }" type="button" @click="couplingX = 'wind'">风速</button>
      </div>
    </div>

    <div class="row">
      <div class="panel">
        <div class="panel-title">散点图（X：{{ couplingXLabel }}，Y：PM2.5）</div>
        <div class="panel-sub">样本数：{{ scatterCount }}（点大小按 AQI 编码）</div>
        <div ref="scatterEl" class="panel-canvas tall"></div>
      </div>
      <div class="panel">
        <div class="panel-title">相关性矩阵（皮尔逊系数，点击单元格可联动）</div>
        <div ref="matrixEl" class="panel-canvas tall"></div>
      </div>
    </div>
  </section>
</template>

<script setup>
import * as echarts from 'echarts'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { apiGet } from '../api'

const props = defineProps({
  city: {
    type: String,
    default: '全国',
  },
})

const couplingX = ref('temp') // temp | humidity | wind
const couplingXLabel = computed(() => (couplingX.value === 'temp' ? '温度' : couplingX.value === 'humidity' ? '湿度' : '风速'))

const scatterEl = ref(null)
const matrixEl = ref(null)
let scatterChart = null
let matrixChart = null
let resizeObserver = null

const rows = ref([])
const normalizedRows = computed(() =>
  rows.value.map((r) => ({
    time: r?.time || '--',
    temp: toNum(r?.temp ?? r?.temp_c),
    humidity: toNum(r?.humidity ?? r?.hum),
    wind: toNum(r?.wind ?? r?.wind_speed),
    pm25: toNum(r?.pm25 ?? r?.pm_25),
    aqi: toNum(r?.aqi),
  }))
)
const scatterCount = computed(() => {
  const xKey = couplingX.value
  return normalizedRows.value.filter((r) => toNum(r[xKey]) != null && toNum(r.pm25) != null).length
})

const metrics = [
  { key: 'temp', label: '温度' },
  { key: 'humidity', label: '湿度' },
  { key: 'wind', label: '风速' },
  { key: 'pm25', label: 'PM2.5' },
  { key: 'aqi', label: 'AQI' },
]

function toNum(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function pearson(arrA, arrB) {
  const xs = []
  const ys = []
  const n = Math.min(arrA.length, arrB.length)
  for (let i = 0; i < n; i += 1) {
    const a = toNum(arrA[i])
    const b = toNum(arrB[i])
    if (a == null || b == null) continue
    xs.push(a)
    ys.push(b)
  }
  if (xs.length < 3) return null
  const meanX = xs.reduce((s, v) => s + v, 0) / xs.length
  const meanY = ys.reduce((s, v) => s + v, 0) / ys.length
  let num = 0
  let denX = 0
  let denY = 0
  for (let i = 0; i < xs.length; i += 1) {
    const dx = xs[i] - meanX
    const dy = ys[i] - meanY
    num += dx * dy
    denX += dx * dx
    denY += dy * dy
  }
  const den = Math.sqrt(denX * denY)
  if (!Number.isFinite(den) || den === 0) return null
  return num / den
}

function linearRegression(points) {
  if (!Array.isArray(points) || points.length < 2) return null
  let sumX = 0
  let sumY = 0
  let sumXY = 0
  let sumXX = 0
  const n = points.length
  for (const p of points) {
    const x = toNum(p?.[0])
    const y = toNum(p?.[1])
    if (x == null || y == null) continue
    sumX += x
    sumY += y
    sumXY += x * y
    sumXX += x * x
  }
  const den = n * sumXX - sumX * sumX
  if (!Number.isFinite(den) || den === 0) return null
  const slope = (n * sumXY - sumX * sumY) / den
  const intercept = (sumY - slope * sumX) / n
  if (!Number.isFinite(slope) || !Number.isFinite(intercept)) return null
  return { slope, intercept }
}

function buildScatterOption() {
  const xKey = couplingX.value
  const xName = metrics.find((m) => m.key === xKey)?.label || 'X'
  const points = normalizedRows.value
    .map((r) => [toNum(r[xKey]), toNum(r.pm25), toNum(r.aqi), r.time || '--'])
    .filter((p) => p[0] != null && p[1] != null)
  const model = linearRegression(points)
  const xs = points.map((p) => p[0]).sort((a, b) => a - b)
  const lineData =
    model && xs.length > 1
      ? xs.map((x) => [x, model.slope * x + model.intercept])
      : []

  return {
    grid: { left: 8, right: 12, top: 20, bottom: 8, containLabel: true },
    xAxis: {
      type: 'value',
      name: xName,
      nameLocation: 'end',
      nameGap: 8,
      nameTextStyle: { color: 'rgba(224,247,255,0.72)', fontSize: 11, padding: [0, 0, 0, 6] },
      axisLabel: { color: 'rgba(224,247,255,0.72)', fontSize: 10, margin: 6 },
      splitLine: { lineStyle: { color: 'rgba(255,255,255,0.10)' } },
    },
    yAxis: {
      type: 'value',
      name: 'PM2.5',
      nameLocation: 'end',
      nameRotate: 90,
      nameGap: 10,
      nameTextStyle: { color: 'rgba(224,247,255,0.72)', fontSize: 11, padding: [0, 0, 6, 0] },
      axisLabel: { color: 'rgba(224,247,255,0.72)', fontSize: 10, margin: 6 },
      splitLine: { lineStyle: { color: 'rgba(255,255,255,0.10)' } },
    },
    tooltip: {
      trigger: 'item',
      formatter: (params) => {
        const d = params?.data || []
        const aqiTxt = d[2] == null ? '--' : String(Math.round(d[2]))
        return `时间：${d[3]}<br/>${xName}：${d[0]}<br/>PM2.5：${d[1]}<br/>AQI：${aqiTxt}`
      },
    },
    graphic:
      points.length === 0
        ? [
            {
              type: 'text',
              left: 'center',
              top: 'middle',
              style: {
                text: '暂无可用散点数据',
                fill: 'rgba(224,247,255,0.6)',
                fontSize: 12,
              },
            },
          ]
        : [],
    series: [
      {
        name: '样本点',
        type: 'scatter',
        data: points,
        symbolSize: (d) => {
          const aqi = toNum(d?.[2])
          if (aqi == null) return 8
          return Math.max(6, Math.min(20, 6 + aqi / 25))
        },
        itemStyle: { color: 'rgba(79,195,247,0.9)' },
        emphasis: { itemStyle: { color: '#ffeb3b' } },
      },
      {
        name: '趋势线',
        type: 'line',
        data: lineData,
        showSymbol: false,
        smooth: false,
        lineStyle: { width: 2, color: 'rgba(255,152,0,0.95)' },
        tooltip: { show: false },
      },
    ],
  }
}

function buildMatrixOption() {
  const labels = metrics.map((m) => m.label)
  const vectorByKey = Object.fromEntries(metrics.map((m) => [m.key, normalizedRows.value.map((r) => toNum(r[m.key]))]))
  const data = []
  const labelMap = new Map()
  for (let y = 0; y < metrics.length; y += 1) {
    for (let x = 0; x < metrics.length; x += 1) {
      const kx = metrics[x].key
      const ky = metrics[y].key
      const val = x === y ? 1 : pearson(vectorByKey[kx], vectorByKey[ky])
      const shown = val == null ? '--' : Number(val.toFixed(2))
      labelMap.set(`${x}-${y}`, shown)
      data.push([x, y, val == null ? 0 : Number(val.toFixed(2))])
    }
  }

  return {
    grid: { left: 54, right: 20, top: 20, bottom: 40 },
    tooltip: {
      formatter: (p) => {
        const x = p?.data?.[0]
        const y = p?.data?.[1]
        const v = labelMap.get(`${x}-${y}`) ?? '--'
        return `${labels[y]} / ${labels[x]}<br/>相关系数：${v}`
      },
    },
    xAxis: {
      type: 'category',
      data: labels,
      axisLabel: { color: 'rgba(224,247,255,0.72)', fontSize: 10, interval: 0 },
      axisLine: { lineStyle: { color: 'rgba(255,255,255,0.25)' } },
    },
    yAxis: {
      type: 'category',
      data: labels,
      axisLabel: { color: 'rgba(224,247,255,0.72)', fontSize: 10, interval: 0 },
      axisLine: { lineStyle: { color: 'rgba(255,255,255,0.25)' } },
    },
    visualMap: {
      min: -1,
      max: 1,
      calculable: false,
      orient: 'horizontal',
      left: 'center',
      bottom: 0,
      textStyle: { color: 'rgba(224,247,255,0.72)', fontSize: 10 },
      inRange: {
        color: ['#2563eb', '#0b1220', '#ef4444'],
      },
    },
    series: [
      {
        type: 'heatmap',
        data,
        label: {
          show: true,
          color: 'rgba(224,247,255,0.9)',
          fontSize: 10,
          formatter: ({ data }) => {
            const v = labelMap.get(`${data[0]}-${data[1]}`)
            return String(v ?? '--')
          },
        },
        itemStyle: {
          borderColor: 'rgba(255,255,255,0.08)',
          borderWidth: 1,
        },
      },
    ],
  }
}

function renderCharts() {
  scatterChart?.setOption(buildScatterOption(), true)
  matrixChart?.setOption(buildMatrixOption(), true)
}

async function loadData() {
  const city = (props.city || '').trim() || '全国'
  const date = new Date().toISOString().slice(0, 10)
  const r = await apiGet('/api/weather/records', { city, date, limit: 240 })
  rows.value = Array.isArray(r) ? r : []
  await nextTick()
  onResize()
  renderCharts()
}

function onResize() {
  scatterChart?.resize()
  matrixChart?.resize()
}

onMounted(() => {
  if (scatterEl.value) scatterChart = echarts.init(scatterEl.value)
  if (matrixEl.value) matrixChart = echarts.init(matrixEl.value)
  matrixChart?.on('click', (params) => {
    const idx = Number(params?.data?.[0])
    const key = metrics[idx]?.key
    if (key === 'temp' || key === 'humidity' || key === 'wind') {
      couplingX.value = key
    }
  })
  loadData().catch(() => {
    rows.value = []
    renderCharts()
  })
  if (typeof ResizeObserver !== 'undefined') {
    resizeObserver = new ResizeObserver(() => {
      onResize()
    })
    if (scatterEl.value) resizeObserver.observe(scatterEl.value)
    if (matrixEl.value) resizeObserver.observe(matrixEl.value)
  }
  window.addEventListener('resize', onResize)
})

watch(
  () => props.city,
  () => {
    loadData().catch(() => {
      rows.value = []
      renderCharts()
    })
  }
)

watch(
  () => couplingX.value,
  () => {
    scatterChart?.setOption(buildScatterOption(), true)
  }
)

onBeforeUnmount(() => {
  window.removeEventListener('resize', onResize)
  if (resizeObserver) {
    resizeObserver.disconnect()
    resizeObserver = null
  }
  if (scatterChart) {
    scatterChart.dispose()
    scatterChart = null
  }
  if (matrixChart) {
    matrixChart.dispose()
    matrixChart = null
  }
})
</script>

<style scoped>
.card {
  height: 100%;
  border: 1px solid rgba(0, 255, 255, 0.22);
  border-radius: 10px;
  background: rgba(0, 0, 0, 0.22);
  padding: 10px;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.title {
  font-size: 15px;
  font-weight: 800;
  letter-spacing: 1px;
  color: #aee8ff;
}

.tabs {
  display: flex;
  gap: 6px;
  flex: 0 0 auto;
}

.tab {
  padding: 2px 10px;
  font-size: 12px;
  border-radius: 999px;
  border: 1px solid rgba(0, 255, 255, 0.45);
  background: rgba(0, 0, 0, 0.35);
  color: rgba(174, 232, 255, 0.92);
  cursor: pointer;
}

.tab.active {
  background: rgba(0, 255, 255, 0.28);
  color: #012b3a;
  box-shadow: 0 0 8px rgba(0, 255, 255, 0.35);
}

.row {
  margin-top: 10px;
  display: grid;
  grid-template-columns: 1fr;
  grid-template-rows: minmax(0, 1fr) minmax(0, 1fr);
  gap: 10px;
  min-height: 0;
  flex: 1 1 auto;
}

.panel {
  min-height: 0;
  border-radius: 10px;
  border: 1px dashed rgba(0, 255, 255, 0.18);
  background: rgba(0, 0, 0, 0.12);
  padding: 10px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.panel-title {
  font-size: 13px;
  color: rgba(174, 232, 255, 0.92);
  letter-spacing: 1px;
}

.panel-sub {
  margin-top: -4px;
  font-size: 11px;
  color: rgba(174, 232, 255, 0.72);
}

.panel-canvas {
  flex: 1 1 auto;
  min-height: 160px;
  border-radius: 10px;
  border: 1px solid rgba(0, 255, 255, 0.12);
  background: rgba(255, 255, 255, 0.04);
  color: rgba(224, 247, 255, 0.92);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: 10px;
  line-height: 1.4;
}

.panel-canvas.tall {
  min-height: 160px;
}

.mask {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.55);
  z-index: 1200;
  display: flex;
  justify-content: center;
  align-items: center;
  padding: 16px;
}

.modal {
  width: min(720px, 96vw);
  border-radius: 12px;
  border: 1px solid rgba(0, 255, 255, 0.3);
  background: radial-gradient(circle at top, rgba(0, 255, 255, 0.10), rgba(0, 0, 0, 0.88));
  box-shadow: 0 0 18px rgba(0, 255, 255, 0.18);
  overflow: hidden;
}

.modal-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border-bottom: 1px solid rgba(0, 255, 255, 0.18);
}

.modal-title {
  font-size: 14px;
  font-weight: 800;
  letter-spacing: 1px;
  color: #aee8ff;
}

.x {
  padding: 2px 10px;
  font-size: 12px;
  border-radius: 999px;
  border: 1px solid rgba(0, 255, 255, 0.35);
  background: rgba(0, 0, 0, 0.25);
  color: rgba(174, 232, 255, 0.92);
  cursor: pointer;
}

.modal-body {
  padding: 12px;
}

.modal-note {
  font-size: 12px;
  opacity: 0.78;
  line-height: 1.45;
}

.modal-actions {
  margin-top: 12px;
  display: flex;
  gap: 8px;
}
</style>
