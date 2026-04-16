<template>
  <div class="history pm25-history">
    <div class="history-head">
      <div class="history-title-row"><span class="history-title">PM2.5 历史趋势</span></div>
      <div class="history-controls">
        <button class="history-toggle" :class="{ active: range === 'day' }" type="button" @click="range = 'day'">日趋势</button>
        <button class="history-toggle" :class="{ active: range === 'month' }" type="button" @click="range = 'month'">月趋势</button>
        <button class="history-toggle" :class="{ active: range === 'year' }" type="button" @click="range = 'year'">年趋势</button>
        <button class="history-toggle" :class="{ active: viewMode === 'selected' }" type="button" @click="viewMode = 'selected'">当前区域</button>
        <button class="history-toggle" :class="{ active: viewMode === 'national' }" type="button" @click="viewMode = 'national'">全国</button>
        <button class="history-toggle history-refresh" type="button" :disabled="loading" @click="onRefresh">{{ loading ? '加载中…' : '刷新' }}</button>
      </div>
    </div>

    <div class="pm25-history-error" v-if="errorMsg">{{ errorMsg }}</div>

    <div class="history-chart-wrap">
      <div ref="chart" class="history-chart"></div>
      <div v-if="showEmptyOverlay" class="pm25-history-empty">当前范围暂无可绘制数据</div>
    </div>
  </div>
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
  parentName: {
    type: String,
    default: '',
  },
})

const viewMode = ref('selected')
const range = ref('day')
const effectiveCity = computed(() => {
  if (viewMode.value === 'national') return '全国'
  return props.city || props.parentName || '全国'
})

const chart = ref(null)
let instance = null
let timer = null
let ro = null

const loading = ref(false)
const errorMsg = ref('')

const state = ref({
  times: [],
  values: [],
})

const hasRenderableValues = computed(() => {
  const vs = state.value.values || []
  return vs.some((v) => v != null && Number.isFinite(Number(v)))
})

const showEmptyOverlay = computed(() => !loading.value && !errorMsg.value && !hasRenderableValues.value)

const rangeMeta = computed(() => {
  if (range.value === 'month') return { label: '月趋势' }
  if (range.value === 'year') return { label: '年趋势' }
  return { label: '日趋势' }
})

async function fetchPm25SeriesFromDb() {
  return apiGet('/api/series/pm25', { name: effectiveCity.value, range: range.value })
}

async function fetchLatestPm25FromMetrics() {
  const r = await apiGet('/api/metrics/latest', { name: effectiveCity.value })
  const v = r?.pm25 ?? r?.aqi ?? null
  if (v == null) return null
  const n = Number(v)
  if (!Number.isFinite(n)) return null
  return Math.round(n)
}

async function rebuild() {
  loading.value = true
  errorMsg.value = ''
  try {
    const r = await fetchPm25SeriesFromDb()
    const times = r.times || []
    const values = (r.values || []).map((v) => (v == null ? null : Math.round(Number(v))))

    const hasRenderable = values.some((v) => v != null && Number.isFinite(Number(v)))
    if (!times.length || !hasRenderable) {
      // 兼容：部分城市可能存在“最新值”（用于排行），但分钟级历史缺失
      // 这时给出一个“最新点”兜底，避免整块看起来像没数据。
      const latest = await fetchLatestPm25FromMetrics().catch(() => null)
      if (latest != null) state.value = { times: ['最新'], values: [latest] }
      else state.value = { times: [], values: [] }
    } else {
      state.value = { times, values }
    }
  } catch (e) {
    errorMsg.value = e?.message || String(e)
    state.value = { times: [], values: [] }
  } finally {
    loading.value = false
  }
}

function onRefresh() {
  rebuild()
    .then(async () => {
      await nextTick()
      applyOption()
    })
    .catch(() => {})
}

const applyOption = () => {
  if (!instance) return

  const option = {
    title: {
      text: `${effectiveCity.value} PM2.5（${rangeMeta.value.label}）`,
      left: 'center',
      textStyle: { color: '#fff', fontSize: 14 },
    },
    grid: { left: 44, right: 16, top: 48, bottom: 28 },
    tooltip: {
      trigger: 'axis',
      valueFormatter: (v) => (v == null || v === '' ? '—' : String(v)),
    },
    xAxis: {
      type: 'category',
      data: state.value.times,
      axisLabel: { color: 'rgba(255,255,255,0.7)', fontSize: 10 },
      axisLine: { lineStyle: { color: 'rgba(255,255,255,0.2)' } },
    },
    yAxis: {
      type: 'value',
      axisLabel: { color: 'rgba(255,255,255,0.7)' },
      splitLine: { lineStyle: { color: 'rgba(255,255,255,0.1)' } },
    },
    series: [
      {
        name: 'PM2.5',
        type: 'line',
        smooth: true,
        data: state.value.values,
        connectNulls: false,
        symbol: 'circle',
        symbolSize: 4,
        showSymbol: hasRenderableValues.value,
        lineStyle: { width: 2, color: '#ffe0b2' },
        areaStyle: hasRenderableValues.value ? { color: 'rgba(93, 64, 55, 0.35)' } : undefined,
      },
    ],
  }

  instance.setOption(option, true)
  instance.resize({ animation: false })
}

const pollMs = (() => {
  const raw = import.meta.env.VITE_PM25_POLL_MS
  const n = raw != null ? Number(String(raw).trim()) : NaN
  if (Number.isFinite(n) && n >= 5000) return Math.floor(n)
  return 60_000
})()

const start = () => {
  stop()
  timer = setInterval(() => {
    rebuild()
      .then(() => applyOption())
      .catch(() => {})
  }, pollMs)
}

const stop = () => {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
}

onMounted(() => {
  if (!chart.value) return
  instance = echarts.init(chart.value)

  if (typeof ResizeObserver !== 'undefined') {
    ro = new ResizeObserver(() => {
      instance?.resize({ animation: false })
    })
    ro.observe(chart.value)
  }

  rebuild()
    .then(() => {
      applyOption()
      start()
    })
    .catch(() => {})

  const onVis = () => {
    if (document.visibilityState !== 'visible') return
    rebuild()
      .then(() => applyOption())
      .catch(() => {})
  }
  document.addEventListener('visibilitychange', onVis)
  onBeforeUnmount(() => document.removeEventListener('visibilitychange', onVis))
})

watch(
  () => [effectiveCity.value, props.city, range.value, viewMode.value],
  () => {
    rebuild()
      .then(async () => {
        await nextTick()
        applyOption()
      })
      .catch(() => {})
  }
)

onBeforeUnmount(() => {
  stop()
  if (ro) {
    ro.disconnect()
    ro = null
  }
  if (instance) instance.dispose()
})
</script>
