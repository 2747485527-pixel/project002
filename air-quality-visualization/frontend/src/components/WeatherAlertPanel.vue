<template>
  <section class="weather-alert-panel">
    <div class="head">
      <div class="title">天气预警</div>
      <div class="tabs">
        <button
          class="tab"
          :class="{ active: horizonMode === '24h' }"
          type="button"
          @click="horizonMode = '24h'"
        >
          未来24小时
        </button>
        <button
          class="tab"
          :class="{ active: horizonMode === '7d' }"
          type="button"
          @click="horizonMode = '7d'"
        >
          未来7天
        </button>
      </div>
    </div>

    <div class="content">
      <div class="top">
        <div class="card">
          <div class="panel-title">极端天气等级分布</div>
          <div ref="ringRef" class="chart ring-chart" />
        </div>

        <div class="card risk-card">
          <div class="panel-title">风险评分等级表</div>
          <div class="risk-table">
            <div v-for="t in typeList" :key="t" class="risk-row">
              <div class="risk-meta">
                <span class="risk-type" :style="{ color: typeColors[t].color }">{{ t }}</span>
                <span class="risk-score">{{ Math.round(riskScoreByType[t]) }}/100</span>
              </div>
              <div class="risk-bar">
                <div
                  class="risk-bar-fill"
                  :style="{
                    width: `${riskScoreByType[t]}%`,
                    background: `linear-gradient(90deg, ${typeColors[t].color}55, ${typeColors[t].color})`,
                  }"
                />
              </div>
              <div class="risk-level">
                {{ riskLevelByType[t] }}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="bottom card">
        <div class="panel-title">极端天气强度热力图</div>
        <div ref="heatmapRef" class="chart heatmap-chart" />
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
    default: '北京',
  },
})

const typeList = ['高温', '暴雨', '雷暴', '大风', '寒潮']
const typePriorityForRing = ['大风', '高温', '暴雨', '雷暴', '寒潮']

const typeColors = {
  高温: { color: '#f44336' }, // 红
  暴雨: { color: '#2196f3' }, // 蓝
  雷暴: { color: '#fdd835' }, // 黄
  大风: { color: '#00e5ff' }, // 青
  寒潮: { color: '#ba68c8' }, // 紫
}

const ringRef = ref(null)
const heatmapRef = ref(null)
let ringChart = null
let heatmapChart = null
let resizeObserver = null

const horizonMode = ref('24h') // 24h | 7d

const points = ref([]) // 后端返回：length = horizonHours

function toNumOrNull(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function clamp(x, min, max) {
  return Math.max(min, Math.min(max, x))
}

function hexToRgb(hex) {
  const h = String(hex).replace('#', '').trim()
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h
  const n = parseInt(full, 16)
  const r = (n >> 16) & 255
  const g = (n >> 8) & 255
  const b = n & 255
  return { r, g, b }
}

function intensityToRgba(type, v) {
  const vv = clamp(v, 0, 100) / 100
  const { r, g, b } = hexToRgb(typeColors[type].color)
  // 低强度仍可感知：用较小 alpha
  const alpha = 0.06 + 0.88 * vv
  return `rgba(${r},${g},${b},${alpha.toFixed(3)})`
}

function calcDeltas(series) {
  // series: number[] | null，返回同长度 delta：i>=3 时才有值
  const deltas = Array.from({ length: series.length }, () => null)
  for (let i = 0; i < series.length; i += 1) {
    if (i < 3) continue
    const a = series[i]
    const b = series[i - 1]
    const c = series[i - 2]
    const d = series[i - 3]
    if (a == null || b == null || c == null || d == null) continue
    const diff1 = a - b
    const diff2 = b - c
    const diff3 = c - d
    if (![diff1, diff2, diff3].every((x) => Number.isFinite(x))) continue
    deltas[i] = (diff1 + diff2 + diff3) / 3
  }
  return deltas
}

const horizonPoints168 = computed(() => {
  if (!Array.isArray(points.value)) return []
  return points.value
})

const points24 = computed(() => horizonPoints168.value.slice(0, 24))
const ringPoints = computed(() => {
  if (horizonMode.value === '24h') return horizonPoints168.value.slice(0, 24)
  return horizonPoints168.value.slice(0, 168)
})

const ringComputed = computed(() => {
  const windowPoints = ringPoints.value || []
  const intensities = { 高温: [], 暴雨: [], 雷暴: [], 大风: [], 寒潮: [] }

  const temps = windowPoints.map((p) => toNumOrNull(p?.temp_c))
  const hums = windowPoints.map((p) => toNumOrNull(p?.humidity))
  const winds = windowPoints.map((p) => toNumOrNull(p?.wind_speed))
  const pressures = windowPoints.map((p) => toNumOrNull(p?.pressure_hpa))
  const precips = windowPoints.map((p) => toNumOrNull(p?.precip_mm))

  const deltaPressure = calcDeltas(pressures)
  const deltaTemp = calcDeltas(temps)

  for (let i = 0; i < windowPoints.length; i += 1) {
    const temp = temps[i]
    const hum = hums[i]
    const wind = winds[i]
    const press = pressures[i]
    const rain = precips[i]
    // press/rain 只是参与强度计算时用；不做直接条件判断之外的事
    void press

    // 1) 大风：与 test2.py 一致（风速>=10.8）
    let windIntensity = 0
    if (wind != null && wind >= 10.8) {
      windIntensity = clamp(((wind - 10.8) / 10.0) * 100, 0, 100)
    }

    // 2) 高温：与 test2.py 一致（温度>=35）
    let heatIntensity = 0
    if (temp != null && temp >= 35) {
      heatIntensity = clamp(((temp - 35) / 10.0) * 100, 0, 100)
    }

    // 3) 暴雨：与 test2.py 一致（降水>=20 且 湿度>=85）
    let rainIntensity = 0
    if (rain != null || hum != null) {
      const rainPart = rain != null && rain >= 20 ? clamp((rain - 20) / 30, 0, 1) : 0
      const humPart = hum != null && hum >= 85 ? clamp((hum - 85) / 15, 0, 1) : 0
      rainIntensity = clamp(rainPart * 70 + humPart * 30, 0, 100)
    }

    // 4) 雷暴：与 test2.py 一致（湿度>=90 & 气压下降(deltaPressure<-5) & 气温上升(deltaTemp>1)）
    let thunderIntensity = 0
    const dp = deltaPressure[i]
    const dt = deltaTemp[i]
    if (hum != null && hum >= 90 && dp != null && dt != null && dp < -5 && dt > 1) {
      const drop = -dp // 压力下降幅度（正数）
      const dropScore = clamp((drop - 5) / 15, 0, 1) * 60
      const riseScore = clamp((dt - 1) / 3, 0, 1) * 40
      thunderIntensity = clamp(dropScore + riseScore, 0, 100)
    }

    // 5) 寒潮：test2.py 未给规则，这里提供一个可视化用的简单阈值（温度<=-5）
    let coldIntensity = 0
    if (temp != null && temp <= -5) {
      coldIntensity = clamp(((-5 - temp) / 15) * 100, 0, 100)
    }

    intensities.大风.push(windIntensity)
    intensities.高温.push(heatIntensity)
    intensities.暴雨.push(rainIntensity)
    intensities.雷暴.push(thunderIntensity)
    intensities.寒潮.push(coldIntensity)
  }

  // 将“逐小时多类型强度”落到“逐小时单类型（用于环形分布占比）”
  const chosenTypeByHour = []
  for (let i = 0; i < windowPoints.length; i += 1) {
    let maxVal = 0
    let maxType = null
    for (const t of typePriorityForRing) {
      const v = intensities[t][i] || 0
      if (v > maxVal) {
        maxVal = v
        maxType = t
      } else if (Math.abs(v - maxVal) < 1e-9 && maxType == null) {
        maxType = t
      }
    }
    chosenTypeByHour.push(maxVal > 5 ? maxType : null)
  }

  const counts = Object.fromEntries(typeList.map((t) => [t, 0]))
  let totalExtreme = 0
  for (const t of chosenTypeByHour) {
    if (!t) continue
    totalExtreme += 1
    counts[t] += 1
  }

  return {
    intensities,
    chosenTypeByHour,
    counts,
    totalExtreme,
  }
})

const ringCountsForPie = computed(() => {
  const { counts, totalExtreme } = ringComputed.value || { counts: {}, totalExtreme: 0 }
  const rows = typeList.map((t) => ({
    type: t,
    value: counts[t] || 0,
    percent: totalExtreme > 0 ? ((counts[t] || 0) / totalExtreme) * 100 : 0,
  }))
  rows.sort((a, b) => b.value - a.value)
  return { rows, totalExtreme }
})

const riskScoreByType = computed(() => {
  const windowPoints = points24.value || []
  const temps = windowPoints.map((p) => toNumOrNull(p?.temp_c))
  const hums = windowPoints.map((p) => toNumOrNull(p?.humidity))
  const winds = windowPoints.map((p) => toNumOrNull(p?.wind_speed))
  const pressures = windowPoints.map((p) => toNumOrNull(p?.pressure_hpa))
  const precips = windowPoints.map((p) => toNumOrNull(p?.precip_mm))

  const deltaPressure = calcDeltas(pressures)
  const deltaTemp = calcDeltas(temps)

  const out = Object.fromEntries(typeList.map((t) => [t, 0]))
  for (let i = 0; i < windowPoints.length; i += 1) {
    const temp = temps[i]
    const hum = hums[i]
    const wind = winds[i]
    const rain = precips[i]
    const dp = deltaPressure[i]
    const dt = deltaTemp[i]

    let windIntensity = 0
    if (wind != null && wind >= 10.8) windIntensity = clamp(((wind - 10.8) / 10.0) * 100, 0, 100)
    let heatIntensity = 0
    if (temp != null && temp >= 35) heatIntensity = clamp(((temp - 35) / 10.0) * 100, 0, 100)
    let rainIntensity = 0
    if (rain != null || hum != null) {
      const rainPart = rain != null && rain >= 20 ? clamp((rain - 20) / 30, 0, 1) : 0
      const humPart = hum != null && hum >= 85 ? clamp((hum - 85) / 15, 0, 1) : 0
      rainIntensity = clamp(rainPart * 70 + humPart * 30, 0, 100)
    }
    let thunderIntensity = 0
    if (hum != null && hum >= 90 && dp != null && dt != null && dp < -5 && dt > 1) {
      const drop = -dp
      const dropScore = clamp((drop - 5) / 15, 0, 1) * 60
      const riseScore = clamp((dt - 1) / 3, 0, 1) * 40
      thunderIntensity = clamp(dropScore + riseScore, 0, 100)
    }
    let coldIntensity = 0
    if (temp != null && temp <= -5) coldIntensity = clamp(((-5 - temp) / 15) * 100, 0, 100)

    out['大风'] = Math.max(out['大风'], windIntensity)
    out['高温'] = Math.max(out['高温'], heatIntensity)
    out['暴雨'] = Math.max(out['暴雨'], rainIntensity)
    out['雷暴'] = Math.max(out['雷暴'], thunderIntensity)
    out['寒潮'] = Math.max(out['寒潮'], coldIntensity)
  }
  return out
})

const riskLevelByType = computed(() => {
  const out = {}
  for (const t of typeList) {
    const s = riskScoreByType.value[t] || 0
    if (s < 34) out[t] = '较低风险'
    else if (s < 67) out[t] = '中风险'
    else out[t] = '高风险'
  }
  return out
})

const heatmapOption = computed(() => {
  const windowPoints = points24.value || []
  const temps = windowPoints.map((p) => toNumOrNull(p?.temp_c))
  const hums = windowPoints.map((p) => toNumOrNull(p?.humidity))
  const winds = windowPoints.map((p) => toNumOrNull(p?.wind_speed))
  const pressures = windowPoints.map((p) => toNumOrNull(p?.pressure_hpa))
  const precips = windowPoints.map((p) => toNumOrNull(p?.precip_mm))

  const deltaPressure = calcDeltas(pressures)
  const deltaTemp = calcDeltas(temps)

  const intensities = {
    高温: Array.from({ length: windowPoints.length }, () => 0),
    暴雨: Array.from({ length: windowPoints.length }, () => 0),
    雷暴: Array.from({ length: windowPoints.length }, () => 0),
    大风: Array.from({ length: windowPoints.length }, () => 0),
    寒潮: Array.from({ length: windowPoints.length }, () => 0),
  }

  for (let i = 0; i < windowPoints.length; i += 1) {
    const temp = temps[i]
    const hum = hums[i]
    const wind = winds[i]
    const rain = precips[i]
    const dp = deltaPressure[i]
    const dt = deltaTemp[i]

    let windIntensity = 0
    if (wind != null && wind >= 10.8) windIntensity = clamp(((wind - 10.8) / 10.0) * 100, 0, 100)
    let heatIntensity = 0
    if (temp != null && temp >= 35) heatIntensity = clamp(((temp - 35) / 10.0) * 100, 0, 100)
    let rainIntensity = 0
    if (rain != null || hum != null) {
      const rainPart = rain != null && rain >= 20 ? clamp((rain - 20) / 30, 0, 1) : 0
      const humPart = hum != null && hum >= 85 ? clamp((hum - 85) / 15, 0, 1) : 0
      rainIntensity = clamp(rainPart * 70 + humPart * 30, 0, 100)
    }
    let thunderIntensity = 0
    if (hum != null && hum >= 90 && dp != null && dt != null && dp < -5 && dt > 1) {
      const drop = -dp
      const dropScore = clamp((drop - 5) / 15, 0, 1) * 60
      const riseScore = clamp((dt - 1) / 3, 0, 1) * 40
      thunderIntensity = clamp(dropScore + riseScore, 0, 100)
    }
    let coldIntensity = 0
    if (temp != null && temp <= -5) coldIntensity = clamp(((-5 - temp) / 15) * 100, 0, 100)

    intensities['大风'][i] = windIntensity
    intensities['高温'][i] = heatIntensity
    intensities['暴雨'][i] = rainIntensity
    intensities['雷暴'][i] = thunderIntensity
    intensities['寒潮'][i] = coldIntensity
  }

  const hourLabels = windowPoints.map((p) => p?.time || '--')
  const heatCells = []
  for (let i = 0; i < hourLabels.length; i += 1) {
    for (let y = 0; y < typeList.length; y += 1) {
      const t = typeList[y]
      const v = intensities[t]?.[i] ?? 0
      heatCells.push({
        value: [i, y, v],
        type: t,
        time: hourLabels[i],
        intensity: v,
        itemStyle: {
          color: intensityToRgba(t, v),
        },
      })
    }
  }

  return {
    hourLabels,
    heatCells,
  }
})

function ensureRingChart() {
  if (ringChart || !ringRef.value) return
  ringChart = echarts.init(ringRef.value, undefined, { renderer: 'canvas' })
}

function ensureHeatmapChart() {
  if (heatmapChart || !heatmapRef.value) return
  heatmapChart = echarts.init(heatmapRef.value, undefined, { renderer: 'canvas' })
}

function updateRing() {
  ensureRingChart()
  if (!ringChart) return

  const { rows, totalExtreme } = ringCountsForPie.value || { rows: [], totalExtreme: 0 }
  if (!totalExtreme) {
    ringChart.setOption(
      {
        tooltip: { show: false },
        graphic: [
          {
            type: 'text',
            left: 'center',
            top: 'middle',
            style: { text: '暂无极端天气数据', fill: 'rgba(224,247,255,0.78)', fontSize: 12 },
          },
        ],
        series: [
          {
            type: 'pie',
            radius: ['55%', '78%'],
            center: ['50%', '55%'],
            data: [],
            label: { show: false },
          },
        ],
      },
      true
    )
    return
  }

  ringChart.setOption(
    {
      backgroundColor: 'transparent',
      tooltip: {
        trigger: 'item',
        formatter: (p) => {
          const v = p?.value ?? 0
          const percent = totalExtreme > 0 ? (v / totalExtreme) * 100 : 0
          const name = p?.name ?? '--'
          return `${name}<br/>占比：${percent.toFixed(0)}%（${v}小时）`
        },
      },
      legend: {
        show: true,
        top: 'bottom',
        left: 'center',
        textStyle: { color: 'rgba(224,247,255,0.78)', fontSize: 10 },
        icon: 'circle',
        formatter: (name) => name,
      },
      series: [
        {
          type: 'pie',
          radius: ['55%', '78%'],
          center: ['50%', '55%'],
          avoidLabelOverlap: false,
          label: {
            show: true,
            formatter: (p) => {
              const v = p?.value ?? 0
              const percent = totalExtreme > 0 ? (v / totalExtreme) * 100 : 0
              // 小份额不显示，避免拥挤
              return percent >= 6 ? `${percent.toFixed(0)}%` : ''
            },
            color: 'rgba(224,247,255,0.95)',
            fontSize: 10,
          },
          labelLine: { show: false },
          itemStyle: {
            borderColor: 'rgba(0,0,0,0.25)',
            borderWidth: 2,
          },
          data: rows.map((r) => ({
            name: r.type,
            value: r.value,
            itemStyle: { color: typeColors[r.type].color },
          })),
        },
      ],
    },
    true
  )
}

function updateHeatmap() {
  ensureHeatmapChart()
  if (!heatmapChart) return

  const { hourLabels, heatCells } = heatmapOption.value || { hourLabels: [], heatCells: [] }
  const n = Array.isArray(hourLabels) ? hourLabels.length : 0
  // 24 个时间标签全显示会重叠；抽稀到大约 6~8 个标签
  const step = n <= 0 ? 1 : Math.max(1, Math.ceil(n / 7))

  heatmapChart.setOption(
    {
      backgroundColor: 'transparent',
      // left 用于给 y 轴标签留出空间；你反馈左侧仍有空白，这里适当收紧。
      grid: { left: 52, right: 10, top: 18, bottom: 46, containLabel: true },
      // ECharts heatmap 必须配套 visualMap，否则会直接抛错并中断渲染
      visualMap: {
        min: 0,
        max: 100,
        dimension: 2, // heatCells: [xIndex, yIndex, value]
        show: false,
        calculable: false,
      },
      tooltip: {
        position: 'top',
        formatter: (p) => {
          const d = p?.data || {}
          const t = d.type || '--'
          const time = d.time || '--'
          const v = Number(d.intensity)
          if (!Number.isFinite(v) || v <= 0.001) return `${time}<br/>${t}：无明显极端`
          return `${time}<br/>${t}强度：${Math.round(v)} / 100`
        },
      },
      xAxis: {
        type: 'category',
        data: hourLabels,
        axisLabel: {
          color: 'rgba(224,247,255,0.72)',
          fontSize: 10,
          hideOverlap: true,
          rotate: n > 12 ? 35 : 0,
          interval: (i) => i % step !== 0,
        },
        axisLine: { lineStyle: { color: 'rgba(255,255,255,0.20)' } },
        axisTick: { show: false },
      },
      yAxis: {
        type: 'category',
        data: typeList,
        axisLabel: { color: 'rgba(224,247,255,0.72)', fontSize: 10, interval: 0, margin: 0 },
        axisLine: { lineStyle: { color: 'rgba(255,255,255,0.20)' } },
        axisTick: { show: false },
      },
      series: [
        {
          type: 'heatmap',
          data: heatCells,
          label: { show: false },
          emphasis: { itemStyle: { borderColor: 'rgba(255,255,255,0.75)', borderWidth: 1.5 } },
          itemStyle: { borderColor: 'rgba(255,255,255,0.08)', borderWidth: 1 },
        },
      ],
    },
    true
  )
}

async function load() {
  const city = (props.city || '').trim()
  if (!city || city === '全国') {
    points.value = []
    updateRing()
    updateHeatmap()
    return
  }

  const r = await apiGet('/api/weather/extreme/hourly', { city, horizonHours: 168 })
  const arr = Array.isArray(r?.points) ? r.points : []
  points.value = arr

  await nextTick()
  updateRing()
  updateHeatmap()
}

let refreshTimer = null

onMounted(() => {
  ensureRingChart()
  ensureHeatmapChart()
  load().catch(() => {
    points.value = []
    updateRing()
    updateHeatmap()
  })

  if (typeof ResizeObserver !== 'undefined') {
    resizeObserver = new ResizeObserver(() => {
      ringChart?.resize()
      heatmapChart?.resize()
    })
    if (ringRef.value) resizeObserver.observe(ringRef.value)
    if (heatmapRef.value) resizeObserver.observe(heatmapRef.value)
  }

  refreshTimer = setInterval(() => {
    load().catch(() => {})
  }, 60_000)
})

watch(
  () => props.city,
  () => {
    load().catch(() => {})
  }
)

watch(
  () => horizonMode.value,
  () => {
    updateRing()
  }
)

watch(
  () => points.value,
  () => {
    updateRing()
    updateHeatmap()
  }
)

onBeforeUnmount(() => {
  if (refreshTimer) clearInterval(refreshTimer)
  refreshTimer = null
  if (resizeObserver) {
    resizeObserver.disconnect()
    resizeObserver = null
  }
  if (ringChart) {
    ringChart.dispose()
    ringChart = null
  }
  if (heatmapChart) {
    heatmapChart.dispose()
    heatmapChart = null
  }
})
</script>

<style scoped>
.weather-alert-panel {
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
  border: 1px solid rgba(0, 255, 255, 0.22);
  border-radius: 10px;
  background: rgba(0, 0, 0, 0.20);
  padding: 10px;
  overflow: hidden;
}

.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  flex: 0 0 auto;
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
  white-space: nowrap;
}

.tab.active {
  background: rgba(0, 255, 255, 0.28);
  color: #012b3a;
  box-shadow: 0 0 8px rgba(0, 255, 255, 0.35);
}

.content {
  min-height: 0;
  flex: 1 1 auto;
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-top: 10px;
}

.top {
  flex: 0 0 44%;
  display: grid;
  grid-template-columns: 1fr 0.95fr;
  gap: 10px;
  min-height: 0;
}

.card {
  min-height: 0;
  border-radius: 10px;
  border: 1px dashed rgba(0, 255, 255, 0.18);
  background: rgba(0, 0, 0, 0.12);
  padding: 10px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.bottom {
  flex: 1 1 auto;
  /* 下半区只用于热力图：让热力图贴近卡片边框 */
  padding: 0;
}

.bottom .panel-title {
  padding: 10px 10px 6px;
}

.panel-title {
  font-size: 13px;
  color: rgba(174, 232, 255, 0.92);
  letter-spacing: 1px;
  flex: 0 0 auto;
}

.subtext {
  margin-top: 6px;
  font-size: 11px;
  color: rgba(174, 232, 255, 0.70);
  opacity: 0.9;
}

.chart {
  width: 100%;
  flex: 1 1 auto;
  min-height: 0;
}

.ring-chart {
  min-height: 140px;
}

.heatmap-chart {
  height: calc(100% - 6px);
  min-height: 0;
  margin: 0;
  margin-top: 6px;
}

.risk-card {
  gap: 8px;
}

.risk-table {
  margin-top: 10px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  overflow: auto;
  padding-right: 4px;
}

.risk-row {
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.10);
  background: rgba(0, 0, 0, 0.18);
  padding: 8px 10px;
}

.risk-meta {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 10px;
}

.risk-type {
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.5px;
}

.risk-score {
  font-size: 12px;
  color: rgba(224, 247, 255, 0.92);
  font-weight: 800;
}

.risk-bar {
  margin-top: 8px;
  height: 10px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.08);
  overflow: hidden;
}

.risk-bar-fill {
  height: 100%;
  border-radius: 999px;
  width: 0%;
}

.risk-level {
  margin-top: 6px;
  font-size: 11px;
  color: rgba(174, 232, 255, 0.72);
}
</style>

