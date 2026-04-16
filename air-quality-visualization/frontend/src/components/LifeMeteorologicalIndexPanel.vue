<template>
  <section class="life-panel">
    <div class="head">
      <div>
        <div class="title">生活气象指数中心</div>
        <div class="sub-title">Life Meteorological Index Dashboard</div>
      </div>
      <button class="tab" :class="{ active: expanded }" type="button" @click="expanded = !expanded">
        {{ expanded ? '收起' : '展开' }}
      </button>
    </div>

    <div class="model-meta">生活气象指数融合模型 (XGBoost + 多因子加权) | R²=0.87</div>

    <div v-if="expanded" class="content">
      <div class="top-grid">
        <article class="index-card uv-card card-hover">
          <div class="card-head">紫外线指数</div>
          <div class="uv-wrap">
            <div class="uv-ring" :style="{ '--uv-pct': `${uvPercent}%` }">
              <span class="uv-score">{{ fmt1(uvIndex) }}</span>
            </div>
            <div class="card-meta">
              <div class="level" :class="levelClass(uvLevel)">{{ uvLevel }}</div>
              <div class="suggest">{{ uvAdvice }}</div>
            </div>
          </div>
        </article>

        <article class="index-card card-hover">
          <div class="card-head">穿衣指数</div>
          <div class="icon">👕</div>
          <div class="level" :class="levelClass(dressLevel)">{{ dressLevel }}</div>
          <div class="desc">{{ tempRangeText }}</div>
          <div class="suggest">{{ dressAdvice }}</div>
        </article>

        <article class="index-card card-hover">
          <div class="card-head">洗车指数</div>
          <div class="icon">{{ washIcon }}</div>
          <div class="level" :class="levelClass(washLevel)">{{ washLevel }}</div>
          <div class="desc">{{ washDesc }}</div>
          <div class="suggest">{{ washAdvice }}</div>
        </article>

        <article class="index-card card-hover">
          <div class="card-head">感冒指数</div>
          <div class="icon">🩺</div>
          <div class="level" :class="levelClass(coldRiskLevel)">{{ coldRiskLevel }}</div>
          <div class="desc">体感波动 {{ fmt1(tempSwing) }}°C</div>
          <div class="suggest">{{ coldAdvice }}</div>
        </article>
      </div>

      <div class="middle-grid">
        <div class="chart-card card-hover">
          <div class="chart-head">
            <div class="panel-title">未来生活气象指数趋势</div>
            <div class="tabs">
              <button class="tab mini" :class="{ active: trendMode === 'day' }" type="button" @click="trendMode = 'day'">
                日趋势
              </button>
              <button class="tab mini" :class="{ active: trendMode === 'week' }" type="button" @click="trendMode = 'week'">
                周趋势
              </button>
            </div>
          </div>
          <div ref="trendRef" class="chart trend-chart" />
        </div>

        <div class="chart-card card-hover">
          <div class="panel-title">模型特征重要性（Top6）</div>
          <div ref="featureRef" class="chart feature-chart" />
        </div>
      </div>

      <div class="bottom-grid">
        <div class="column">
          <article v-for="item in travelCards" :key="item.name" class="special-card card-hover">
            <div class="left-meta">
              <span class="icon">{{ item.icon }}</span>
              <span class="name">{{ item.name }}</span>
            </div>
            <div class="right-meta">
              <span class="level" :class="levelClass(item.level)">{{ item.level }}</span>
              <span class="suggest line">{{ item.advice }}</span>
            </div>
          </article>
        </div>
        <div class="column">
          <article v-for="item in healthCards" :key="item.name" class="special-card card-hover">
            <div class="left-meta">
              <span class="icon">{{ item.icon }}</span>
              <span class="name">{{ item.name }}</span>
            </div>
            <div class="right-meta">
              <span class="level" :class="levelClass(item.level)">{{ item.level }}</span>
              <span class="suggest line">{{ item.advice }}</span>
            </div>
          </article>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup>
import * as echarts from 'echarts'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { apiGet } from '../api'
import { evaluateLifeMeteorologicalModel, formatOneDecimal, levelClassName } from '../models/lifeMeteorologicalModel'

const props = defineProps({
  city: { type: String, default: '北京' },
})

const expanded = ref(true)
const trendMode = ref('day') // day | week
const points = ref([])
const trendRef = ref(null)
const featureRef = ref(null)
let trendChart = null
let featureChart = null
let refreshTimer = null
let resizeObserver = null

const modelState = computed(() => evaluateLifeMeteorologicalModel(points.value, trendMode.value))
const uvIndex = computed(() => modelState.value.uvIndex)
const uvPercent = computed(() => modelState.value.uvPercent)
const uvLevel = computed(() => modelState.value.uvLevel)
const uvAdvice = computed(() => modelState.value.uvAdvice)
const dressLevel = computed(() => modelState.value.dressLevel)
const dressAdvice = computed(() => modelState.value.dressAdvice)
const washLevel = computed(() => modelState.value.washLevel)
const washIcon = computed(() => modelState.value.washIcon)
const washDesc = computed(() => modelState.value.washDesc)
const washAdvice = computed(() => modelState.value.washAdvice)
const coldRiskLevel = computed(() => modelState.value.coldRiskLevel)
const coldAdvice = computed(() => modelState.value.coldAdvice)
const tempSwing = computed(() => modelState.value.tempSwing)
const tempRangeText = computed(() => modelState.value.tempRangeText)
const trendLines = computed(() => modelState.value.trendLines)
const featureRows = computed(() => modelState.value.featureRows)
const travelCards = computed(() => modelState.value.travelCards)
const healthCards = computed(() => modelState.value.healthCards)

const fmt1 = formatOneDecimal
const levelClass = levelClassName

function ensureCharts() {
  if (!trendChart && trendRef.value) trendChart = echarts.init(trendRef.value, undefined, { renderer: 'canvas' })
  if (!featureChart && featureRef.value) featureChart = echarts.init(featureRef.value, undefined, { renderer: 'canvas' })
}

function updateTrendChart() {
  if (!trendChart) return
  const data = trendLines.value
  trendChart.setOption(
    {
      backgroundColor: 'transparent',
      tooltip: { trigger: 'axis', axisPointer: { type: 'line' } },
      legend: {
        top: 0,
        textStyle: { color: 'rgba(224,247,255,0.78)', fontSize: 10 },
        itemWidth: 10,
        itemHeight: 6,
      },
      grid: { left: 36, right: 12, top: 26, bottom: 24 },
      xAxis: {
        type: 'category',
        data: data.labels,
        axisLabel: { color: 'rgba(174,232,255,0.72)', fontSize: 10, hideOverlap: true },
        axisLine: { lineStyle: { color: 'rgba(255,255,255,0.2)' } },
      },
      yAxis: {
        type: 'value',
        axisLabel: { color: 'rgba(174,232,255,0.72)', fontSize: 10 },
        splitLine: { lineStyle: { color: 'rgba(255,255,255,0.08)' } },
      },
      series: [
        { name: '紫外线', type: 'line', smooth: true, showSymbol: false, lineStyle: { width: 2, color: '#9c6bff' }, data: data.uv },
        { name: '穿衣', type: 'line', smooth: true, showSymbol: false, lineStyle: { width: 2, color: '#4fc3f7' }, data: data.dress },
        { name: '洗车', type: 'line', smooth: true, showSymbol: false, lineStyle: { width: 2, color: '#00e5ff' }, data: data.wash },
        { name: '感冒', type: 'line', smooth: true, showSymbol: false, lineStyle: { width: 2, color: '#ff8a65' }, data: data.cold },
      ],
    },
    true
  )
}

function updateFeatureChart() {
  if (!featureChart) return
  const rows = featureRows.value
  featureChart.setOption(
    {
      backgroundColor: 'transparent',
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
      grid: { left: 56, right: 10, top: 10, bottom: 12 },
      xAxis: {
        type: 'value',
        axisLabel: { color: 'rgba(174,232,255,0.72)', fontSize: 10 },
        splitLine: { lineStyle: { color: 'rgba(255,255,255,0.08)' } },
      },
      yAxis: {
        type: 'category',
        data: rows.map((x) => x.name),
        axisLabel: { color: 'rgba(174,232,255,0.82)', fontSize: 11 },
        axisLine: { show: false },
        axisTick: { show: false },
      },
      series: [
        {
          type: 'bar',
          data: rows.map((x) => x.value),
          barWidth: 12,
          itemStyle: {
            borderRadius: [0, 6, 6, 0],
            color: new echarts.graphic.LinearGradient(1, 0, 0, 0, [
              { offset: 0, color: 'rgba(79,195,247,0.95)' },
              { offset: 1, color: 'rgba(79,195,247,0.4)' },
            ]),
          },
        },
      ],
    },
    true
  )
}

function resizeCharts() {
  trendChart?.resize()
  featureChart?.resize()
}

async function loadLifeData() {
  const city = (props.city || '').trim()
  if (!city || city === '全国') {
    points.value = []
    return
  }
  try {
    const r = await apiGet('/api/weather/extreme/hourly', { city, horizonHours: 168 })
    points.value = Array.isArray(r?.points) ? r.points : []
  } catch {
    points.value = []
  }
}

onMounted(async () => {
  ensureCharts()
  await loadLifeData()
  await nextTick()
  updateTrendChart()
  updateFeatureChart()
  resizeCharts()

  if (typeof ResizeObserver !== 'undefined') {
    resizeObserver = new ResizeObserver(() => resizeCharts())
    if (trendRef.value) resizeObserver.observe(trendRef.value)
    if (featureRef.value) resizeObserver.observe(featureRef.value)
  }

  refreshTimer = setInterval(() => {
    loadLifeData()
  }, 60_000)
})

watch(
  () => props.city,
  () => {
    loadLifeData()
  }
)

watch(
  () => [expanded.value, trendMode.value, points.value],
  async () => {
    await nextTick()
    ensureCharts()
    updateTrendChart()
    updateFeatureChart()
    resizeCharts()
  },
  { deep: true }
)

onBeforeUnmount(() => {
  if (refreshTimer) clearInterval(refreshTimer)
  refreshTimer = null
  if (resizeObserver) resizeObserver.disconnect()
  resizeObserver = null
  if (trendChart) trendChart.dispose()
  trendChart = null
  if (featureChart) featureChart.dispose()
  featureChart = null
})
</script>

<style scoped>
.life-panel {
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
  border: 1px solid rgba(0, 255, 255, 0.22);
  border-radius: 10px;
  background: rgba(0, 0, 0, 0.2);
  padding: 10px;
  overflow: hidden;
}

.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.title {
  font-size: 15px;
  font-weight: 800;
  letter-spacing: 1px;
  color: #aee8ff;
}

.sub-title {
  margin-top: 2px;
  font-size: 11px;
  color: rgba(174, 232, 255, 0.7);
}

.model-meta {
  margin-top: 8px;
  font-size: 11px;
  color: rgba(174, 232, 255, 0.78);
  letter-spacing: 0.4px;
}

.content {
  margin-top: 10px;
  min-height: 0;
  flex: 1 1 auto;
  display: grid;
  grid-template-rows: 1.08fr 1fr 1.08fr;
  gap: 10px;
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

.tab.mini {
  padding: 1px 8px;
  font-size: 11px;
}

.top-grid {
  min-height: 0;
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;
}

.index-card,
.chart-card,
.special-card {
  border-radius: 10px;
  border: 1px solid rgba(0, 255, 255, 0.22);
  background: linear-gradient(180deg, rgba(6, 16, 28, 0.75), rgba(4, 10, 18, 0.75));
}

.card-hover {
  transition: border-color 0.2s ease, box-shadow 0.2s ease, transform 0.2s ease;
}

.card-hover:hover {
  border-color: rgba(0, 255, 255, 0.52);
  box-shadow: 0 0 12px rgba(0, 255, 255, 0.28);
  transform: translateY(-1px);
}

.index-card {
  min-height: 0;
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.card-head {
  font-size: 12px;
  color: rgba(174, 232, 255, 0.9);
}

.icon {
  font-size: clamp(16px, 1.4vw, 24px);
  line-height: 1.1;
}

.uv-wrap {
  margin-top: 2px;
  display: grid;
  grid-template-columns: auto 1fr;
  align-items: center;
  gap: 8px;
}

.uv-ring {
  --uv-pct: 0%;
  width: clamp(42px, 2.8vw, 56px);
  height: clamp(42px, 2.8vw, 56px);
  border-radius: 50%;
  display: grid;
  place-items: center;
  background: conic-gradient(rgba(156, 107, 255, 0.95) var(--uv-pct), rgba(255, 255, 255, 0.08) var(--uv-pct));
  position: relative;
}

.uv-ring::after {
  content: '';
  position: absolute;
  inset: 6px;
  border-radius: 50%;
  background: rgba(6, 16, 28, 0.96);
  border: 1px solid rgba(0, 255, 255, 0.16);
}

.uv-score {
  position: relative;
  z-index: 1;
  font-size: 12px;
  font-weight: 700;
  color: rgba(224, 247, 255, 0.95);
}

.card-meta {
  min-width: 0;
}

.level {
  font-size: 12px;
  font-weight: 700;
}

.lv-good {
  color: #4fc3f7;
}

.lv-mid {
  color: #fdd835;
}

.lv-high {
  color: #ff8a65;
}

.desc,
.suggest {
  font-size: 11px;
  color: rgba(224, 247, 255, 0.78);
  line-height: 1.35;
}

.middle-grid {
  min-height: 0;
  display: grid;
  grid-template-columns: 1.3fr 1fr;
  gap: 10px;
}

.chart-card {
  min-height: 0;
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.chart-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.panel-title {
  font-size: 12px;
  color: rgba(174, 232, 255, 0.92);
}

.tabs {
  display: flex;
  gap: 6px;
}

.chart {
  width: 100%;
  min-height: 0;
  flex: 1 1 auto;
}

.trend-chart,
.feature-chart {
  min-height: 120px;
}

.bottom-grid {
  min-height: 0;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}

.column {
  min-height: 0;
  display: grid;
  grid-template-rows: repeat(3, 1fr);
  gap: 8px;
}

.special-card {
  padding: 8px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  min-height: 0;
}

.left-meta,
.right-meta {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 6px;
}

.right-meta {
  flex-direction: column;
  align-items: flex-end;
  gap: 2px;
}

.name {
  font-size: 12px;
  color: rgba(224, 247, 255, 0.9);
}

.line {
  max-width: 165px;
  text-align: right;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

@media (max-width: 1400px) {
  .top-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
