<template>
  <div class="weather-th-chart">
    <div ref="chartEl" class="weather-th-chart-canvas"></div>
  </div>
</template>

<script setup>
import * as echarts from 'echarts'
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { apiGet } from '../api'

const props = defineProps({
  city: {
    type: String,
    default: '全国',
  },
})

const chartEl = ref(null)
let chart = null

const labels = ref([])
const tempSeries = ref([])
const humiditySeries = ref([])

function toNumOrNull(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function buildOption() {
  const n = Array.isArray(labels.value) ? labels.value.length : 0
  // 24 个点全显示会重叠；根据点数自动抽稀到大约 6~8 个标签
  const step = n <= 0 ? 1 : Math.max(1, Math.ceil(n / 7))
  return {
    color: ['#ffb74d', '#4fc3f7'],
    grid: { left: 30, right: 10, top: 28, bottom: 34, containLabel: true },
    legend: {
      top: 0,
      right: 4,
      textStyle: { color: 'rgba(224,247,255,0.92)', fontSize: 11 },
      data: ['温度(°C)', '湿度(%)'],
    },
    tooltip: {
      trigger: 'axis',
      valueFormatter: (v) => (v == null ? '--' : String(Math.round(v * 10) / 10)),
    },
    xAxis: {
      type: 'category',
      data: labels.value,
      boundaryGap: false,
      axisLabel: {
        color: 'rgba(224,247,255,0.72)',
        fontSize: 10,
        hideOverlap: true,
        rotate: n > 12 ? 35 : 0,
        // interval 支持函数：返回 true 表示显示
        interval: (i) => i % step !== 0,
      },
      axisLine: { lineStyle: { color: 'rgba(255,255,255,0.25)' } },
    },
    yAxis: {
      type: 'value',
      axisLabel: { color: 'rgba(224,247,255,0.75)', fontSize: 10 },
      splitLine: { lineStyle: { color: 'rgba(255,255,255,0.10)' } },
    },
    series: [
      {
        name: '温度(°C)',
        type: 'line',
        smooth: true,
        showSymbol: false,
        data: tempSeries.value,
        lineStyle: { width: 2 },
      },
      {
        name: '湿度(%)',
        type: 'line',
        smooth: true,
        showSymbol: false,
        data: humiditySeries.value,
        lineStyle: { width: 2 },
      },
    ],
  }
}

function renderChart() {
  if (!chart) return
  chart.setOption(buildOption(), true)
}

async function load() {
  const city = (props.city || '').trim()
  if (!city || city === '全国') {
    labels.value = []
    tempSeries.value = []
    humiditySeries.value = []
    renderChart()
    return
  }

  const rows = await apiGet('/api/weather/trend', { city })
  const list = Array.isArray(rows) ? rows : []
  labels.value = list.map((x) => x.time || '--')
  tempSeries.value = list.map((x) => toNumOrNull(x.temp))
  humiditySeries.value = list.map((x) => toNumOrNull(x.humidity))

  const hasFiniteTemp = tempSeries.value.some((v) => v != null && Number.isFinite(Number(v)))
  const hasFiniteHum = humiditySeries.value.some((v) => v != null && Number.isFinite(Number(v)))

  // 兜底：近 24 小时分钟数据缺失时，trend 会返回全 null
  // 用 weather/records 拉取最近分钟记录，至少让曲线可见。
  if (!hasFiniteTemp && !hasFiniteHum) {
    try {
      const rec = await apiGet('/api/weather/records', { city, limit: 20 })
      const recList = Array.isArray(rec) ? rec : []
      labels.value = recList.map((x) => x.time || '--')
      tempSeries.value = recList.map((x) => toNumOrNull(x.temp))
      humiditySeries.value = recList.map((x) => toNumOrNull(x.humidity))
    } catch {
      // 忽略兜底失败：保持 trend 的结果（可能全 null）
    }
  }
  renderChart()
}

const handleResize = () => {
  chart?.resize()
}

onMounted(() => {
  if (!chartEl.value) return
  chart = echarts.init(chartEl.value)
  load().catch(() => {
    labels.value = []
    tempSeries.value = []
    humiditySeries.value = []
    renderChart()
  })
  window.addEventListener('resize', handleResize)
})

watch(
  () => props.city,
  () => {
    load().catch(() => {
      labels.value = []
      tempSeries.value = []
      humiditySeries.value = []
      renderChart()
    })
  }
)

onBeforeUnmount(() => {
  window.removeEventListener('resize', handleResize)
  if (chart) {
    chart.dispose()
    chart = null
  }
})
</script>

<style scoped>
.weather-th-chart {
  margin-top: 0;
  height: 188px;
  border: 1px solid rgba(0, 255, 255, 0.2);
  border-radius: 6px;
  background: rgba(0, 0, 0, 0.18);
}

.weather-th-chart-canvas {
  width: 100%;
  height: 100%;
}
</style>
