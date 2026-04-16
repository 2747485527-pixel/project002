<template>
  <div class="public-page">
    <header class="public-header">
      <div class="header-left">
        <div class="main-title">基于模型预测的城市空气与天气质量可视化平台</div>
        <div class="sub-title">Model-Based Urban Air and Weather Quality Visualization Platform</div>
      </div>

      <div class="header-center">
        <article class="metric-card">
          <div class="metric-icon">AQI</div>
          <div class="metric-main">{{ formatNum(cityMetrics.aqi, 0) }}</div>
          <div class="metric-sub" :class="aqClass">{{ airLevelText }}</div>
        </article>
        <article class="metric-card">
          <div class="metric-icon">PM2.5</div>
          <div class="metric-main">{{ formatNum(cityMetrics.pm25, 1) }}</div>
          <div class="metric-sub">ug/m3</div>
        </article>
        <article class="metric-card">
          <div class="metric-icon">优良时长</div>
          <div class="metric-main">{{ goodHours }}h</div>
          <div class="metric-sub">今日累计</div>
        </article>
        <article class="metric-card">
          <div class="metric-icon">健康风险</div>
          <div class="metric-main">{{ healthRisk.level }}</div>
          <div class="metric-sub">{{ healthRisk.tip }}</div>
        </article>
      </div>

      <div class="header-right">
        <button type="button" class="back-btn" @click="emit('switch-screen')">返回专业版</button>
        <div class="clock">{{ now }}</div>
        <div class="clock-note">数据每小时自动更新</div>
      </div>
    </header>

    <main class="public-board">
      <section class="row row-1">
        <article class="panel">
          <div class="panel-title">城市空气质量健康总览</div>
          <div class="overview-wrap">
            <div class="ring-big" :style="{ '--pct': `${aqPercent}%`, '--ringColor': aqColor }">
              <div class="ring-inner">
                <div class="ring-aqi">{{ formatNum(cityMetrics.aqi, 0) }}</div>
                <div class="ring-level" :class="aqClass">{{ airLevelText }}</div>
              </div>
            </div>
            <div class="overview-tip">{{ healthRisk.tip }}</div>
          </div>
          <div class="mini-map-wrap">
            <MapChart ref="mapRef" @city-click="onCityPick" />
          </div>
        </article>

        <article class="panel wide-2">
          <div class="panel-title">城市 24 小时 AQI / PM2.5 双折线趋势</div>
          <div class="trend-switch">
            <button class="switch-btn" :class="{ active: trendMode === 'day' }" @click="trendMode = 'day'">日趋势</button>
            <button class="switch-btn" :class="{ active: trendMode === 'week' }" @click="trendMode = 'week'">周趋势</button>
          </div>
          <div class="trend-stack">
            <div ref="trendRef" class="chart chart-main"></div>
            <div class="sub-title-inline">多污染物 24 小时趋势对比（PM10 / O₃ / NO₂）</div>
            <div ref="pollutantRef" class="chart chart-sub"></div>
          </div>
        </article>

        <article class="panel">
          <div class="panel-title">实时气象 & 污染物卡片</div>
          <div class="metric-grid compact">
            <div v-for="item in weatherCards" :key="item.label" class="small-metric">
              <div class="small-label">{{ item.icon }} {{ item.label }}</div>
              <div class="small-value">{{ item.value }}</div>
            </div>
          </div>
          <div class="warning-box" :class="{ active: warnings.length > 0 }">
            <div class="warning-head">极端天气 / 重污染预警</div>
            <div v-if="warnings.length" class="warning-rows">
              <div v-for="w in warnings" :key="w" class="warning-row">{{ w }}</div>
            </div>
            <div v-else class="warning-safe">当前无预警，建议保持绿色出行与日常通风。</div>
          </div>
        </article>
      </section>

      <section class="row row-2">
        <article class="panel">
          <div class="panel-title">城市空气质量 AI 智能分析</div>
          <ul class="analysis-list">
            <li v-for="txt in aiAnalysis" :key="txt">{{ txt }}</li>
          </ul>
        </article>

        <article class="panel wide-2">
          <div class="panel-title">城市生活气象指数便民中心</div>
          <div class="life-mix">
            <div class="life-grid">
              <div v-for="item in lifeCards" :key="item.title" class="life-card">
                <div class="life-icon">{{ item.icon }}</div>
                <div class="life-title">{{ item.title }}</div>
                <div class="life-level">{{ item.level }}</div>
                <div class="life-tip">{{ item.tip }}</div>
              </div>
            </div>
            <div class="extra-index-grid">
              <div v-for="item in extraLifeCards" :key="item.title" class="extra-index-card">
                <div class="extra-title">{{ item.title }}</div>
                <div class="extra-level">{{ item.level }}</div>
                <div class="extra-tip">{{ item.tip }}</div>
              </div>
            </div>
          </div>
        </article>

        <article class="panel">
          <div class="panel-title">未来 24 小时逐小时预报</div>
          <div class="forecast-wrap">
            <div class="forecast-list" :style="{ transform: `translateY(-${forecastOffset}px)` }">
              <div class="forecast-item" v-for="(f, idx) in forecastLoop" :key="`${f.time}-${idx}`">
                <span class="f-time">{{ f.time }}</span>
                <span class="f-icon">{{ weatherIconByCode(f.weather_code) }}</span>
                <span class="f-temp">{{ formatNum(f.temp_c, 1) }}°C</span>
                <span class="f-aqi">AQI {{ formatNum(f.aqi, 0) }}</span>
              </div>
            </div>
          </div>
        </article>
      </section>

      <section class="row row-3">
        <article class="panel">
          <div class="panel-title">短期变化对比（3区县）</div>
          <div class="split-two">
            <div class="split-half">
              <div class="tiny-title">近12小时 PM2.5 变化</div>
              <div ref="districtRef" class="chart split-chart"></div>
            </div>
            <div class="split-half">
              <div class="tiny-title">近7天 AQI 趋势（优良占比 {{ goodDaysRatio }}%）</div>
              <div ref="aqi7dRef" class="chart split-chart"></div>
            </div>
          </div>
        </article>

        <article class="panel">
          <div class="panel-title">核心指标相关性热力图</div>
          <div class="split-two">
            <div class="split-half">
              <div ref="heatRef" class="chart split-chart"></div>
            </div>
            <div class="split-half">
              <div class="tiny-title">近30天 AQI 等级分布</div>
              <div ref="levelPieRef" class="chart split-chart"></div>
            </div>
          </div>
        </article>

        <article class="panel wide-2">
          <div class="panel-title">城市环保科普 & 公示轮播</div>
          <div class="public-right-grid">
            <div class="right-block">
              <div class="tiny-title">年度空气质量改善柱状图</div>
              <div ref="annualRef" class="chart split-chart"></div>
            </div>
            <div class="right-block text-block" @click="nextMeasure">
              <div class="tiny-title">环保举措轮播</div>
              <div class="tips-content">{{ currentMeasure }}</div>
            </div>
            <div class="right-block text-block" @click="nextQuiz">
              <div class="tiny-title">环保知识问答轮播</div>
              <div class="tips-content">{{ currentQuiz.q }}</div>
              <div class="tips-footer">{{ currentQuiz.a }}</div>
            </div>
          </div>
        </article>
      </section>
    </main>
  </div>
</template>

<script setup>
import * as echarts from 'echarts'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { apiGet } from '../api'
import MapChart from '../components/MapChart.vue'
import { evaluateLifeMeteorologicalModel } from '../models/lifeMeteorologicalModel'

const emit = defineEmits(['switch-screen'])
const trendRef = ref(null)
const pollutantRef = ref(null)
const districtRef = ref(null)
const aqi7dRef = ref(null)
const heatRef = ref(null)
const levelPieRef = ref(null)
const annualRef = ref(null)
const mapRef = ref(null)

const selectedCity = ref('北京')
const trendMode = ref('day')
const now = ref('')
const cityMetrics = ref({ aqi: 0, pm25: 0, temp_c: 0, humidity: 0, wind_speed: 0, weather_code: 0 })
const pmSeriesDay = ref([])
const pmSeriesWeek = ref([])
const monthSeries = ref([])
const yearSeries = ref([])
const weatherPoints24 = ref([])
const weatherPoints168 = ref([])
const tipIdx = ref(0)
const measureIdx = ref(0)
const quizIdx = ref(0)
const forecastOffset = ref(0)

let trendChart = null
let pollutantChart = null
let districtChart = null
let aqi7dChart = null
let heatChart = null
let levelPieChart = null
let annualChart = null

let clockTimer = null
let refreshTimer = null
let forecastScrollTimer = null
let tipTimer = null

const tips = [
  { title: 'AQI 科普', content: 'AQI 分级越高表示污染越重，AQI 超过 150 时建议减少户外活动。' },
  { title: '城市环保成果', content: '近年通过清洁能源替代、工业治理和交通减排，重污染时段明显减少。' },
  { title: '环保小贴士', content: '优先公交地铁绿色出行，减少怠速，空调温度设置适中，共同守护城市蓝天。' },
]
const measures = [
  '推进老旧燃煤锅炉清洁替代，减少冬季采暖污染峰值。',
  '重点道路实施智慧信号与公交优先，降低交通拥堵排放。',
  '工业园区开展VOCs深度治理，提升全天空气质量稳定性。',
]
const quizzes = [
  { q: '问：AQI超过150时，最建议的防护措施是什么？', a: '答：减少户外活动，外出佩戴口罩，敏感人群尽量居家。' },
  { q: '问：为什么早晚高峰污染更容易上升？', a: '答：车流密集叠加边界层低，污染扩散条件较差。' },
  { q: '问：家庭如何帮助降低城市污染？', a: '答：绿色出行、节能用电、减少露天焚烧和高污染燃烧。' },
]

const lifeState = computed(() => evaluateLifeMeteorologicalModel(weatherPoints168.value, 'day'))
const lifeCards = computed(() => {
  const travel = Array.isArray(lifeState.value.travelCards) ? lifeState.value.travelCards : []
  const health = Array.isArray(lifeState.value.healthCards) ? lifeState.value.healthCards : []
  return [
    { icon: '☀', title: '紫外线', level: lifeState.value.uvLevel, tip: lifeState.value.uvAdvice },
    { icon: '👕', title: '穿衣', level: lifeState.value.dressLevel, tip: lifeState.value.dressAdvice },
    { icon: '🚗', title: '洗车', level: lifeState.value.washLevel, tip: lifeState.value.washAdvice },
    { icon: '🩺', title: '感冒', level: lifeState.value.coldRiskLevel, tip: lifeState.value.coldAdvice },
    { icon: '🏃', title: '运动', level: travel[0]?.level || '一般', tip: travel[0]?.advice || '建议适度户外活动。' },
    { icon: '🤧', title: '过敏', level: health[0]?.level || '中风险', tip: health[0]?.advice || '敏感人群外出注意防护。' },
  ]
})
const extraLifeCards = computed(() => {
  const travel = Array.isArray(lifeState.value.travelCards) ? lifeState.value.travelCards : []
  const health = Array.isArray(lifeState.value.healthCards) ? lifeState.value.healthCards : []
  return [
    { title: '晾晒指数', level: travel[1]?.level || '一般', tip: travel[1]?.advice || '建议中午前后晾晒。' },
    { title: '交通气象指数', level: travel[2]?.level || '一般', tip: travel[2]?.advice || '注意早高峰能见度变化。' },
    { title: '空调开启指数', level: health[1]?.level || '一般', tip: health[1]?.advice || '建议按体感间歇开启。' },
  ]
})

const goodHours = computed(() =>
  (Array.isArray(pmSeriesDay.value) ? pmSeriesDay.value : []).filter((x) => Number(x.aqi) <= 100).length
)
const aqPercent = computed(() => Math.max(0, Math.min(100, Math.round((Number(cityMetrics.value.aqi || 0) / 300) * 100))))
const airLevelText = computed(() => levelText(cityMetrics.value.aqi))
const aqClass = computed(() => levelClass(cityMetrics.value.aqi))
const aqColor = computed(() => levelColor(cityMetrics.value.aqi))

const healthRisk = computed(() => {
  const aqi = Number(cityMetrics.value.aqi || 0)
  if (aqi <= 50) return { level: '低风险', tip: '空气清新，适宜户外活动。' }
  if (aqi <= 100) return { level: '中风险', tip: '敏感人群建议减少长时间户外停留。' }
  if (aqi <= 150) return { level: '较高风险', tip: '儿童老人建议佩戴口罩并控制外出时长。' }
  if (aqi <= 200) return { level: '高风险', tip: '建议减少外出，关闭门窗并开启空气净化。' }
  return { level: '极高风险', tip: '尽量留在室内，做好健康防护。' }
})

const weatherCards = computed(() => {
  const pm25 = Number(cityMetrics.value.pm25 || 0)
  const pm10 = Math.round(pm25 * 1.35)
  const o3 = Math.round(Math.max(20, 65 + pm25 * 0.28))
  const wind = Number(cityMetrics.value.wind_speed || 0)
  const windDir = windDirection(cityMetrics.value.wind_direction || cityMetrics.value.wind_dir || cityMetrics.value.weather_code || selectedCity.value)
  return [
    { icon: '🌡', label: '温度', value: `${formatNum(cityMetrics.value.temp_c, 1)}°C` },
    { icon: '💧', label: '湿度', value: `${formatNum(cityMetrics.value.humidity, 0)}%` },
    { icon: '🍃', label: '风速/风向', value: `${formatNum(wind, 1)}m/s ${windDir}` },
    { icon: '🫁', label: 'PM10 / O3', value: `${pm10} / ${o3}` },
  ]
})

const currentTip = computed(() => tips[tipIdx.value % tips.length])
const currentMeasure = computed(() => measures[measureIdx.value % measures.length])
const currentQuiz = computed(() => quizzes[quizIdx.value % quizzes.length])
const goodDaysRatio = computed(() => {
  const arr = monthSeries.value.slice(-7)
  if (!arr.length) return 0
  const good = arr.filter((x) => Number(x.aqi) <= 100).length
  return Math.round((good / arr.length) * 100)
})
const forecastRows = computed(() =>
  (Array.isArray(weatherPoints24.value) ? weatherPoints24.value : []).map((x, idx) => ({
    ...x,
    aqi: Math.max(20, Math.round((x.pm25 ?? pmSeriesDay.value[idx]?.pm25 ?? cityMetrics.value.pm25 ?? 50) * 1.15)),
  }))
)
const forecastLoop = computed(() => {
  const arr = forecastRows.value
  return arr.length ? [...arr, ...arr] : []
})

const aiAnalysis = computed(() => {
  const aqi = Number(cityMetrics.value.aqi || 0)
  const hum = Number(cityMetrics.value.humidity || 0)
  const wind = Number(cityMetrics.value.wind_speed || 0)
  const cause =
    hum > 75 && wind < 2
      ? '湿度偏高且风速偏低，污染物不易扩散。'
      : wind >= 3
        ? '风速较高，扩散条件较好，污染累积压力相对较小。'
        : '扩散条件一般，污染物有阶段性积累。'
  return [
    `当前 ${selectedCity.value} 空气质量等级为${airLevelText.value}，AQI ${formatNum(aqi, 0)}。`,
    `污染成因：${cause}`,
    `健康影响：${healthRisk.value.tip}`,
    '建议：通勤优先公共交通，敏感人群外出做好口罩防护。',
  ]
})
const warnings = computed(() => {
  const out = []
  const maxAqi = Math.max(...pmSeriesDay.value.map((x) => Number(x.aqi || 0)), 0)
  const maxWind = Math.max(...weatherPoints24.value.map((x) => Number(x.wind_speed || 0)), 0)
  const maxRain = Math.max(...weatherPoints24.value.map((x) => Number(x.precip_mm || 0)), 0)
  if (maxAqi >= 180) out.push(`重污染预警：预计峰值 AQI ${Math.round(maxAqi)}，建议减少外出。`)
  if (maxWind >= 10.8) out.push(`大风预警：最大风速 ${maxWind.toFixed(1)} m/s，外出注意安全。`)
  if (maxRain >= 20) out.push(`强降雨提醒：未来时段降水偏强，请注意出行安全。`)
  return out
})

function formatNow() {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  const ss = String(d.getSeconds()).padStart(2, '0')
  now.value = `${y}-${m}-${day} ${hh}:${mm}:${ss}`
}

function formatNum(v, digits = 1) {
  const n = Number(v)
  if (!Number.isFinite(n)) return '--'
  return n.toFixed(digits)
}

function levelText(aqi) {
  const n = Number(aqi || 0)
  if (n <= 50) return '优'
  if (n <= 100) return '良'
  if (n <= 150) return '轻度污染'
  if (n <= 200) return '中度污染'
  if (n <= 300) return '重度污染'
  return '严重污染'
}
function levelClass(aqi) {
  const n = Number(aqi || 0)
  if (n <= 50) return 'lv-good'
  if (n <= 100) return 'lv-mild'
  if (n <= 150) return 'lv-light'
  if (n <= 200) return 'lv-mid'
  if (n <= 300) return 'lv-heavy'
  return 'lv-severe'
}
function levelColor(aqi) {
  const cls = levelClass(aqi)
  if (cls === 'lv-good') return '#37ff9b'
  if (cls === 'lv-mild') return '#d4ff5d'
  if (cls === 'lv-light') return '#ffc247'
  if (cls === 'lv-mid') return '#ff8b3d'
  if (cls === 'lv-heavy') return '#ff4f4f'
  return '#ff2a8a'
}
function windDirection(source) {
  const s = String(source || '风向')
  const pool = ['东北风', '北风', '东风', '东南风', '南风', '西南风', '西北风', '西风']
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return pool[h % pool.length]
}
function weatherIconByCode(code) {
  const c = Number(code)
  if (c >= 95) return '⛈'
  if (c >= 60) return '🌧'
  if (c >= 45) return '🌫'
  if (c >= 3) return '☁'
  return '☀'
}

function nextTip() {
  tipIdx.value = (tipIdx.value + 1) % tips.length
}
function nextMeasure() {
  measureIdx.value = (measureIdx.value + 1) % measures.length
}
function nextQuiz() {
  quizIdx.value = (quizIdx.value + 1) % quizzes.length
}

function ensureCharts() {
  if (!trendChart && trendRef.value) trendChart = echarts.init(trendRef.value)
  if (!pollutantChart && pollutantRef.value) pollutantChart = echarts.init(pollutantRef.value)
  if (!districtChart && districtRef.value) districtChart = echarts.init(districtRef.value)
  if (!aqi7dChart && aqi7dRef.value) aqi7dChart = echarts.init(aqi7dRef.value)
  if (!heatChart && heatRef.value) heatChart = echarts.init(heatRef.value)
  if (!levelPieChart && levelPieRef.value) levelPieChart = echarts.init(levelPieRef.value)
  if (!annualChart && annualRef.value) annualChart = echarts.init(annualRef.value)
}

function updateTrendChart() {
  if (!trendChart) return
  const rows = trendMode.value === 'week' ? pmSeriesWeek.value : pmSeriesDay.value
  const labels = rows.map((x) => x.time)
  const pm25 = rows.map((x) => x.pm25)
  const aqi = rows.map((x) => x.aqi)
  trendChart.setOption(
    {
      tooltip: { trigger: 'axis' },
      legend: { right: 12, top: 0, textStyle: { color: '#d6f9ff', fontSize: 12 } },
      grid: { left: 36, right: 12, top: 32, bottom: 24 },
      xAxis: { type: 'category', data: labels, axisLabel: { color: 'rgba(214,249,255,0.76)', fontSize: 12 } },
      yAxis: {
        type: 'value',
        axisLabel: { color: 'rgba(214,249,255,0.76)', fontSize: 12 },
        splitLine: { lineStyle: { color: 'rgba(255,255,255,0.08)' } },
      },
      series: [
        {
          name: 'AQI',
          type: 'line',
          smooth: true,
          data: aqi,
          lineStyle: { color: '#00e5ff', width: 3 },
          itemStyle: { color: '#00e5ff' },
          markPoint: { symbolSize: 30, label: { fontSize: 10 }, data: [{ type: 'max' }, { type: 'min' }] },
        },
        {
          name: 'PM2.5',
          type: 'line',
          smooth: true,
          data: pm25,
          lineStyle: { color: '#ffb74d', width: 3 },
          itemStyle: { color: '#ffb74d' },
          markPoint: { symbolSize: 30, label: { fontSize: 10 }, data: [{ type: 'max' }, { type: 'min' }] },
        },
      ],
    },
    true
  )
}

function updatePollutantChart() {
  if (!pollutantChart) return
  const points = weatherPoints24.value
  const labels = points.map((x) => x.time || '--')
  const pm10 = points.map((x, i) => Math.max(10, Number((pmSeriesDay.value[i]?.pm25 || cityMetrics.value.pm25 || 30) * 1.35)))
  const o3 = points.map((x) => Math.max(15, 70 + Number(x.temp_c || 0) * 1.2 - Number(x.humidity || 0) * 0.4))
  const no2 = points.map((x, i) => Math.max(10, 40 + Number(pmSeriesDay.value[i]?.aqi || 60) * 0.18 - Number(x.wind_speed || 0) * 2))
  pollutantChart.setOption(
    {
      tooltip: { trigger: 'axis' },
      legend: { right: 10, top: 0, textStyle: { color: '#d6f9ff', fontSize: 11 } },
      grid: { left: 32, right: 10, top: 24, bottom: 16 },
      xAxis: { type: 'category', data: labels, axisLabel: { color: 'rgba(214,249,255,0.72)', fontSize: 10, interval: 3 } },
      yAxis: { type: 'value', axisLabel: { color: 'rgba(214,249,255,0.72)', fontSize: 10 } },
      series: [
        { name: 'PM10', type: 'line', smooth: true, data: pm10, lineStyle: { width: 3, color: '#26d8ff' }, symbol: 'none' },
        { name: 'O₃', type: 'line', smooth: true, data: o3, lineStyle: { width: 3, color: '#fdd835' }, symbol: 'none' },
        { name: 'NO₂', type: 'line', smooth: true, data: no2, lineStyle: { width: 3, color: '#ff8b3d' }, symbol: 'none' },
      ],
    },
    true
  )
}

function updateDistrictChart() {
  if (!districtChart) return
  const base = Number(cityMetrics.value.pm25 || 50)
  const names = [`${selectedCity.value}城区`, `${selectedCity.value}东区`, `${selectedCity.value}西区`]
  const rise = [base - 8, base + 10, base - 4]
  const nowVals = [base - 3, base + 16, base - 10]
  const delta = nowVals.map((v, i) => v - rise[i])
  districtChart.setOption(
    {
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
      grid: { left: 36, right: 12, top: 18, bottom: 24 },
      xAxis: { type: 'category', data: names, axisLabel: { color: 'rgba(214,249,255,0.76)', fontSize: 12 } },
      yAxis: { type: 'value', axisLabel: { color: 'rgba(214,249,255,0.76)', fontSize: 12 } },
      series: [
        {
          name: '12h变化',
          type: 'bar',
          data: delta.map((d) => ({ value: d, itemStyle: { color: d >= 0 ? '#ff8b3d' : '#00e5ff' } })),
          barMaxWidth: 30,
          label: { show: true, position: 'top', color: '#fff', formatter: '{c}' },
        },
      ],
    },
    true
  )
}

function updateAqi7dChart() {
  if (!aqi7dChart) return
  const rows = monthSeries.value.slice(-7)
  const labels = rows.map((x) => x.time)
  const aqi = rows.map((x) => Number(x.aqi))
  aqi7dChart.setOption(
    {
      tooltip: {
        trigger: 'axis',
        formatter: (params) => {
          const p = params?.[0]
          const v = Number(p?.value || 0)
          return `${p?.axisValue}<br/>AQI: ${v}<br/>等级: ${levelText(v)}`
        },
      },
      grid: { left: 26, right: 8, top: 20, bottom: 16 },
      xAxis: { type: 'category', data: labels, axisLabel: { color: 'rgba(214,249,255,0.75)', fontSize: 10 } },
      yAxis: { type: 'value', axisLabel: { color: 'rgba(214,249,255,0.75)', fontSize: 10 } },
      series: [{ type: 'line', smooth: true, data: aqi, lineStyle: { width: 3, color: '#64ffda' }, symbolSize: 7 }],
    },
    true
  )
}

function corr(a, b) {
  const x = a.map(Number)
  const y = b.map(Number)
  const n = Math.min(x.length, y.length)
  if (!n) return 0
  const mx = x.slice(0, n).reduce((s, v) => s + v, 0) / n
  const my = y.slice(0, n).reduce((s, v) => s + v, 0) / n
  let up = 0
  let sx = 0
  let sy = 0
  for (let i = 0; i < n; i += 1) {
    const dx = x[i] - mx
    const dy = y[i] - my
    up += dx * dy
    sx += dx * dx
    sy += dy * dy
  }
  const den = Math.sqrt(sx * sy)
  if (!den) return 0
  return up / den
}

function updateHeatChart() {
  if (!heatChart) return
  const points = weatherPoints24.value
  const aqi = pmSeriesDay.value.map((x) => Number(x.aqi || 0))
  const pm25 = pmSeriesDay.value.map((x) => Number(x.pm25 || 0))
  const wind = points.map((x) => Number(x.wind_speed || 0))
  const hum = points.map((x) => Number(x.humidity || 0))
  const names = ['AQI', 'PM2.5', '风速', '湿度']
  const source = [aqi, pm25, wind, hum]
  const data = []
  for (let i = 0; i < names.length; i += 1) {
    for (let j = 0; j < names.length; j += 1) {
      data.push([i, j, Number(corr(source[i], source[j]).toFixed(2))])
    }
  }
  heatChart.setOption(
    {
      tooltip: { formatter: (p) => `${names[p.value[0]]} x ${names[p.value[1]]}: ${p.value[2]}` },
      grid: { left: 56, right: 20, top: 8, bottom: 28 },
      xAxis: { type: 'category', data: names, axisLabel: { color: '#d6f9ff', fontSize: 12 } },
      yAxis: { type: 'category', data: names, axisLabel: { color: '#d6f9ff', fontSize: 12 } },
      visualMap: {
        min: -1,
        max: 1,
        calculable: false,
        orient: 'horizontal',
        left: 'center',
        bottom: 0,
        textStyle: { color: '#d6f9ff' },
        inRange: { color: ['#2a5da8', '#00bcd4', '#ffd54f', '#ff7043'] },
      },
      series: [
        {
          type: 'heatmap',
          data,
          label: { show: true, formatter: (p) => p.value[2], color: '#fff' },
          itemStyle: { borderColor: 'rgba(255,255,255,0.15)', borderWidth: 1 },
        },
      ],
    },
    true
  )
}

function updateLevelPieChart() {
  if (!levelPieChart) return
  const rows = monthSeries.value.slice(-30)
  const levels = [
    { name: '优', color: '#37ff9b', min: 0, max: 50 },
    { name: '良', color: '#d4ff5d', min: 51, max: 100 },
    { name: '轻度', color: '#ffc247', min: 101, max: 150 },
    { name: '污染', color: '#ff8b3d', min: 151, max: Infinity },
  ]
  const data = levels.map((lv) => ({
    name: lv.name,
    value: rows.filter((x) => Number(x.aqi) >= lv.min && Number(x.aqi) <= lv.max).length,
    itemStyle: { color: lv.color },
  }))
  levelPieChart.setOption(
    {
      tooltip: { trigger: 'item' },
      series: [{ type: 'pie', radius: ['45%', '75%'], center: ['50%', '50%'], label: { color: '#d6f9ff', fontSize: 11, formatter: '{b}\n{d}%' }, data }],
    },
    true
  )
}

function updateAnnualChart() {
  if (!annualChart) return
  const months = yearSeries.value.slice(-12)
  annualChart.setOption(
    {
      tooltip: { trigger: 'axis' },
      grid: { left: 26, right: 8, top: 22, bottom: 16 },
      xAxis: { type: 'category', data: months.map((x) => x.time), axisLabel: { color: 'rgba(214,249,255,0.75)', fontSize: 10 } },
      yAxis: { type: 'value', axisLabel: { color: 'rgba(214,249,255,0.75)', fontSize: 10 } },
      series: [{ name: 'AQI', type: 'bar', data: months.map((x) => x.aqi), barMaxWidth: 18, itemStyle: { color: '#00e5ff' } }],
    },
    true
  )
}

async function loadCityData() {
  const city = selectedCity.value
  const [metrics, daySeries, weekSeries, weather24, weather168, records] = await Promise.all([
    apiGet('/api/metrics/latest', { name: city }).catch(() => ({})),
    apiGet('/api/series/pm25', { name: city, range: 'day' }).catch(() => ({ times: [], values: [] })),
    apiGet('/api/series/pm25', { name: city, range: 'month' }).catch(() => ({ times: [], values: [] })),
    apiGet('/api/weather/extreme/hourly', { city, horizonHours: 24 }).catch(() => ({ points: [] })),
    apiGet('/api/weather/extreme/hourly', { city, horizonHours: 168 }).catch(() => ({ points: [] })),
    apiGet('/api/weather/records', { city, limit: 20 }).catch(() => []),
  ])
  const rows = Array.isArray(records) ? records : []
  const latestWind = rows.find((x) => Number.isFinite(Number(x?.wind)))
  cityMetrics.value = {
    aqi: Number(metrics?.aqi ?? metrics?.pm25 ?? 0),
    pm25: Number(metrics?.pm25 ?? metrics?.aqi ?? 0),
    temp_c: Number(metrics?.temp_c ?? 0),
    humidity: Number(metrics?.humidity ?? 0),
    wind_speed: Number(Number.isFinite(Number(metrics?.wind_speed)) ? metrics?.wind_speed : (latestWind?.wind ?? 0)),
    weather_code: Number(metrics?.weather_code ?? 0),
    wind_dir: latestWind?.weather_text || '',
  }
  const dayTimes = Array.isArray(daySeries?.times) ? daySeries.times : []
  const dayVals = Array.isArray(daySeries?.values) ? daySeries.values : []
  pmSeriesDay.value = dayTimes.map((t, i) => {
    const pm25 = Number(dayVals[i] ?? 0)
    return { time: t, pm25, aqi: Math.round(pm25 * 1.15) }
  })
  const weekTimes = Array.isArray(weekSeries?.times) ? weekSeries.times : []
  const weekVals = Array.isArray(weekSeries?.values) ? weekSeries.values : []
  pmSeriesWeek.value = weekTimes.slice(-7).map((t, i) => {
    const pm25 = Number(weekVals[weekVals.length - 7 + i] ?? 0)
    return { time: String(t).slice(5), pm25, aqi: Math.round(pm25 * 1.1) }
  })
  monthSeries.value = weekTimes.map((t, i) => {
    const pm25 = Number(weekVals[i] ?? 0)
    return { time: String(t).slice(5), pm25, aqi: Math.round(pm25 * 1.1) }
  })
  const year = await apiGet('/api/series/pm25', { name: city, range: 'year' }).catch(() => ({ times: [], values: [] }))
  const yTimes = Array.isArray(year?.times) ? year.times : []
  const yVals = Array.isArray(year?.values) ? year.values : []
  yearSeries.value = yTimes.map((t, i) => ({ time: String(t).slice(5, 7), aqi: Math.round(Number(yVals[i] ?? 0) * 1.08) }))
  weatherPoints24.value = Array.isArray(weather24?.points) ? weather24.points : []
  weatherPoints168.value = Array.isArray(weather168?.points) ? weather168.points : []
}

async function onCityPick(cityLike) {
  const city = typeof cityLike === 'string' ? cityLike : cityLike?.name
  if (!city) return
  selectedCity.value = city
  await refreshVisual()
}

async function refreshVisual() {
  await loadCityData()
  await nextTick()
  ensureCharts()
  updateTrendChart()
  updatePollutantChart()
  updateDistrictChart()
  updateAqi7dChart()
  updateHeatChart()
  updateLevelPieChart()
  updateAnnualChart()
  mapRef.value?.focusToCity?.(selectedCity.value)
}

function resizeAll() {
  trendChart?.resize()
  pollutantChart?.resize()
  districtChart?.resize()
  aqi7dChart?.resize()
  heatChart?.resize()
  levelPieChart?.resize()
  annualChart?.resize()
}

function startAuto() {
  if (!forecastScrollTimer) {
    forecastScrollTimer = setInterval(() => {
      const rowH = 34
      const len = forecastRows.value.length
      if (!len) return
      forecastOffset.value += rowH
      if (forecastOffset.value >= len * rowH) forecastOffset.value = 0
    }, 1800)
  }
  if (!tipTimer) {
    tipTimer = setInterval(() => {
      nextTip()
      nextMeasure()
      nextQuiz()
    }, 7000)
  }
}

function stopAuto() {
  if (clockTimer) clearInterval(clockTimer)
  if (refreshTimer) clearInterval(refreshTimer)
  if (forecastScrollTimer) clearInterval(forecastScrollTimer)
  if (tipTimer) clearInterval(tipTimer)
  clockTimer = null
  refreshTimer = null
  forecastScrollTimer = null
  tipTimer = null
}

watch(
  () => trendMode.value,
  () => updateTrendChart()
)

onMounted(async () => {
  formatNow()
  clockTimer = setInterval(formatNow, 1000)
  await refreshVisual()
  startAuto()
  refreshTimer = setInterval(() => {
    refreshVisual().catch(() => {})
  }, 60_000)
  window.addEventListener('resize', resizeAll)
})

onBeforeUnmount(() => {
  stopAuto()
  window.removeEventListener('resize', resizeAll)
  if (trendChart) trendChart.dispose()
  if (pollutantChart) pollutantChart.dispose()
  if (districtChart) districtChart.dispose()
  if (aqi7dChart) aqi7dChart.dispose()
  if (heatChart) heatChart.dispose()
  if (levelPieChart) levelPieChart.dispose()
  if (annualChart) annualChart.dispose()
  trendChart = null
  pollutantChart = null
  districtChart = null
  aqi7dChart = null
  heatChart = null
  levelPieChart = null
  annualChart = null
})
</script>

<style scoped>
.public-page {
  height: 100vh;
  display: flex;
  flex-direction: column;
  min-height: 0;
  color: #e8fbff;
  background: radial-gradient(circle at top, #0e2742 0%, #060d18 55%, #03060d 100%);
}

.public-header {
  height: 110px;
  padding: 8px 14px;
  display: grid;
  grid-template-columns: 1.4fr 2fr 1fr;
  gap: 10px;
  align-items: center;
  border-bottom: 1px solid rgba(0, 229, 255, 0.4);
  box-shadow: 0 0 16px rgba(0, 229, 255, 0.2);
}
.main-title {
  font-size: clamp(24px, 2vw, 36px);
  font-weight: 800;
  letter-spacing: 1px;
  color: #73fbff;
}
.city-highlight {
  color: #ffd54f;
}
.sub-title {
  margin-top: 4px;
  font-size: clamp(12px, 1vw, 18px);
  color: rgba(214, 249, 255, 0.8);
}

.header-center {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;
}
.metric-card {
  min-height: 74px;
  border: 1px solid rgba(0, 229, 255, 0.3);
  border-radius: 10px;
  background: rgba(3, 15, 26, 0.65);
  padding: 6px 8px;
  display: grid;
  grid-template-rows: auto 1fr auto;
}
.metric-icon {
  font-size: 12px;
  color: rgba(214, 249, 255, 0.75);
}
.metric-main {
  font-size: clamp(20px, 2vw, 32px);
  font-weight: 800;
  color: #9efbff;
}
.metric-sub {
  font-size: 12px;
}

.header-right {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
}
.back-btn {
  border: 1px solid rgba(0, 229, 255, 0.58);
  background: rgba(0, 229, 255, 0.2);
  color: #e8ffff;
  border-radius: 999px;
  padding: 4px 10px;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
}
.clock {
  margin-top: 8px;
  font-size: clamp(18px, 1.6vw, 24px);
  font-weight: 700;
}
.clock-note {
  font-size: 12px;
  color: rgba(214, 249, 255, 0.75);
}

.public-board {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 8px 12px 10px;
}
.row {
  min-height: 0;
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;
}
.row-1 {
  flex: 1.1;
}
.row-2 {
  flex: 1;
}
.row-3 {
  flex: 0.9;
}
.wide-2 {
  grid-column: span 2;
}

.panel {
  min-height: 0;
  border-radius: 10px;
  border: 1px solid rgba(0, 229, 255, 0.32);
  background: radial-gradient(circle at top, rgba(0, 229, 255, 0.1), rgba(0, 0, 0, 0.72));
  box-shadow: 0 0 10px rgba(0, 229, 255, 0.12);
  padding: 8px;
  overflow: hidden;
  position: relative;
}
.panel-title {
  font-size: clamp(14px, 1.05vw, 20px);
  font-weight: 800;
  color: #73fbff;
  margin-bottom: 4px;
}
.chart {
  width: 100%;
  height: calc(100% - 28px);
  min-height: 120px;
}
.trend-stack {
  height: calc(100% - 28px);
}
.chart-main {
  height: 58%;
  min-height: 128px;
}
.chart-sub {
  height: 38%;
  min-height: 88px;
}
.sub-title-inline {
  margin: 2px 0;
  font-size: 11px;
  color: rgba(214, 249, 255, 0.75);
}

.overview-wrap {
  display: flex;
  align-items: center;
  gap: 10px;
}
.ring-big {
  --pct: 0%;
  --ringColor: #00e5ff;
  width: 140px;
  height: 140px;
  border-radius: 50%;
  background: conic-gradient(var(--ringColor) var(--pct), rgba(255, 255, 255, 0.1) var(--pct));
  position: relative;
  flex: 0 0 auto;
}
.ring-inner {
  position: absolute;
  inset: 12px;
  border-radius: 50%;
  border: 1px solid rgba(0, 229, 255, 0.25);
  background: #0a1422;
  display: grid;
  place-items: center;
  text-align: center;
}
.ring-aqi {
  font-size: 30px;
  font-weight: 800;
}
.ring-level {
  font-size: 12px;
  font-weight: 700;
}
.overview-tip {
  font-size: 14px;
  line-height: 1.5;
}
.mini-map-wrap {
  margin-top: 6px;
  height: calc(100% - 162px);
  min-height: 100px;
}
.mini-map-wrap :deep(.map-center-title) {
  display: none;
}
.mini-map-wrap :deep(.map-toolbar) {
  top: 2px;
  left: 4px;
}
.mini-map-wrap :deep(.map-mode-btn) {
  font-size: 10px;
  padding: 0 4px;
}

.trend-switch {
  position: absolute;
  top: 6px;
  right: 8px;
  display: flex;
  gap: 6px;
}
.switch-btn {
  border: 1px solid rgba(0, 229, 255, 0.45);
  border-radius: 999px;
  padding: 1px 8px;
  background: rgba(0, 0, 0, 0.4);
  color: #d6f9ff;
  font-size: 11px;
  cursor: pointer;
}
.switch-btn.active {
  background: rgba(0, 229, 255, 0.3);
  color: #06202e;
}

.metric-grid {
  height: calc(100% - 28px);
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  grid-template-rows: repeat(2, minmax(0, 1fr));
  gap: 8px;
}
.metric-grid.compact {
  height: 60%;
}
.small-metric {
  border: 1px solid rgba(0, 229, 255, 0.25);
  border-radius: 8px;
  background: rgba(3, 15, 26, 0.5);
  padding: 8px;
}
.small-label {
  font-size: 12px;
  color: rgba(214, 249, 255, 0.75);
}
.small-value {
  margin-top: 6px;
  font-size: clamp(16px, 1.4vw, 24px);
  font-weight: 800;
}
.warning-box {
  margin-top: 8px;
  height: calc(40% - 8px);
  border: 1px solid rgba(0, 229, 255, 0.22);
  border-radius: 8px;
  background: rgba(4, 18, 30, 0.52);
  padding: 6px;
}
.warning-box.active {
  border-color: rgba(255, 92, 92, 0.45);
  box-shadow: 0 0 10px rgba(255, 92, 92, 0.25);
  background: rgba(66, 12, 12, 0.35);
}
.warning-head {
  font-size: 12px;
  font-weight: 700;
  margin-bottom: 4px;
}
.warning-rows {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.warning-row {
  font-size: 11px;
  line-height: 1.45;
  color: #ffd8d8;
}
.warning-safe {
  font-size: 11px;
  color: rgba(214, 249, 255, 0.82);
}

.analysis-list {
  margin: 0;
  padding-left: 18px;
  font-size: 20px;
  line-height: 1.72;
}

.split-two {
  height: calc(100% - 28px);
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}
.split-half {
  min-height: 0;
}
.split-chart {
  height: calc(100% - 18px);
}
.tiny-title {
  font-size: 14px;
  color: rgba(214, 249, 255, 0.76);
  margin-bottom: 2px;
}

.life-mix {
  height: calc(100% - 28px);
  display: grid;
  grid-template-columns: 1.6fr 0.8fr;
  gap: 8px;
}
.life-grid {
  height: 100%;
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  grid-template-rows: repeat(2, minmax(0, 1fr));
  gap: 8px;
}
.life-card {
  border: 1px solid rgba(0, 229, 255, 0.25);
  border-radius: 8px;
  background: rgba(3, 18, 30, 0.6);
  padding: 8px;
}
.life-icon {
  font-size: 24px;
}
.life-title {
  font-size: 14px;
  font-weight: 700;
}
.life-level {
  font-size: 18px;
  font-weight: 800;
  color: #8df6ff;
}
.life-tip {
  font-size: 12px;
  color: rgba(214, 249, 255, 0.8);
  line-height: 1.35;
}
.extra-index-grid {
  height: 100%;
  display: grid;
  grid-template-rows: repeat(3, minmax(0, 1fr));
  gap: 8px;
}
.extra-index-card {
  border: 1px solid rgba(0, 229, 255, 0.25);
  border-radius: 8px;
  background: rgba(3, 18, 30, 0.6);
  padding: 8px;
}
.extra-title {
  font-size: 12px;
  color: rgba(214, 249, 255, 0.8);
}
.extra-level {
  margin-top: 4px;
  font-size: 17px;
  font-weight: 800;
  color: #8df6ff;
}
.extra-tip {
  margin-top: 4px;
  font-size: 11px;
  line-height: 1.35;
}

.forecast-wrap {
  height: calc(100% - 28px);
  overflow: hidden;
}
.forecast-list {
  transition: transform 0.6s ease;
}
.forecast-item {
  height: 34px;
  display: grid;
  grid-template-columns: 58px 30px 1fr auto;
  align-items: center;
  gap: 6px;
  border-bottom: 1px dashed rgba(0, 229, 255, 0.18);
}
.f-time {
  font-size: 12px;
}
.f-icon {
  font-size: 16px;
}
.f-temp {
  font-size: 14px;
}
.f-aqi {
  font-size: 15px;
  font-weight: 700;
}

.tips-carousel {
  height: calc(100% - 28px);
  border: 1px dashed rgba(0, 229, 255, 0.35);
  border-radius: 10px;
  padding: 10px;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 8px;
  cursor: pointer;
}
.public-right-grid {
  height: calc(100% - 28px);
  display: grid;
  grid-template-columns: 1.2fr 1fr 1fr;
  gap: 8px;
}
.right-block {
  border: 1px solid rgba(0, 229, 255, 0.24);
  border-radius: 8px;
  background: rgba(3, 18, 30, 0.58);
  padding: 8px;
  min-height: 0;
}
.text-block {
  display: flex;
  flex-direction: column;
  justify-content: center;
  cursor: pointer;
}
.tips-title {
  font-size: clamp(18px, 1.5vw, 26px);
  font-weight: 800;
  color: #9cf6ff;
}
.tips-content {
  font-size: clamp(19px, 1.5vw, 26px);
  line-height: 1.5;
}
.tips-footer {
  font-size: 15px;
  color: rgba(214, 249, 255, 0.68);
}

.lv-good { color: #37ff9b; }
.lv-mild { color: #d4ff5d; }
.lv-light { color: #ffc247; }
.lv-mid { color: #ff8b3d; }
.lv-heavy { color: #ff4f4f; }
.lv-severe { color: #ff2a8a; }

@media (max-width: 1400px) {
  .public-header {
    grid-template-columns: 1.2fr 2fr 0.9fr;
  }
  .metric-main {
    font-size: 20px;
  }
}
</style>
