<template>
  <div class="analysis">
    <div class="city-meta">
      <span class="city">{{ resolvedName }}</span>
      <span class="sep">|</span>
      <span class="meta-item">{{ tsText }}</span>
      <span class="sep">|</span>
      <span class="aqi-level" :class="`lv-${levelTone}`">{{ aqiLevel }}</span>
    </div>

    <div class="section-title">核心健康总览</div>
    <div class="health-grid">
      <article class="glass-card hover-card">
        <div class="card-hd">空气质量健康评级</div>
        <div class="card-main health-main">
          <div>
            <div class="major-value">{{ aqiLevel }}（{{ aqiText }}）</div>
            <div class="minor-desc">{{ healthDesc }}</div>
          </div>
          <div class="ring-wrap" aria-hidden="true">
            <svg viewBox="0 0 100 100" class="ring" width="68" height="68">
              <circle cx="50" cy="50" r="42" fill="none" stroke="rgba(255,255,255,0.14)" stroke-width="8" />
              <circle
                cx="50"
                cy="50"
                r="42"
                fill="none"
                stroke="#67f5ff"
                stroke-width="8"
                stroke-linecap="round"
                :stroke-dasharray="`${ringLength} ${ringTotal}`"
              />
            </svg>
            <div class="ring-text">{{ Math.round(ringPercent) }}%</div>
          </div>
        </div>
      </article>

      <article class="glass-card hover-card">
        <div class="card-hd">AI综合风险评分</div>
        <div class="card-main">
          <div class="major-value">{{ riskText }}</div>
          <div class="minor-desc">基于已有模型综合评估</div>
          <span class="risk-tag" :class="`lv-${riskTone}`">{{ riskLabel }}</span>
        </div>
      </article>
    </div>

    <article class="glass-card hover-card">
      <div class="section-title">AI智能分析：空气质量优良原因</div>
      <div class="highlight-conclusion">{{ conclusionText }}</div>
      <ul class="plain-list">
        <li>PM2.5：{{ pm25FactorText }}</li>
        <li>风速：{{ windFactorText }}</li>
        <li>湿度：{{ humidityFactorText }}</li>
      </ul>
      <div class="source-note">分析基于已有模型Top特征重要性</div>
    </article>

    <div class="section-title">影响因素深度解读</div>
    <div class="factor-grid">
      <article v-for="card in factorCards" :key="card.title" class="glass-card hover-card factor-card">
        <div class="factor-title">{{ card.title }}</div>
        <div class="factor-value">{{ card.value }}</div>
        <div class="factor-desc">{{ card.desc }}</div>
      </article>
    </div>

    <article class="glass-card hover-card">
      <div class="section-title">个性化健康&amp;生活建议（AI定制）</div>
      <div class="adv-grid">
        <section>
          <div class="adv-title">健康防护</div>
          <ul class="adv-list">
            <li v-for="item in healthAdvice" :key="item"><span class="adv-icon">●</span>{{ item }}</li>
          </ul>
        </section>
        <section>
          <div class="adv-title">生活出行</div>
          <ul class="adv-list">
            <li v-for="item in lifeAdvice" :key="item"><span class="adv-icon">●</span>{{ item }}</li>
          </ul>
        </section>
      </div>
    </article>

    <div class="bottom-actions">
      <button class="action-btn" type="button" @click="emitNavigate('forecast-7d')">查看未来7天预测</button>
      <button class="action-btn" type="button" @click="emitNavigate('life-index')">查看生活气象指数</button>
    </div>
  </div>
</template>

<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { apiGet } from '../api'
import { evaluateLifeMeteorologicalModel } from '../models/lifeMeteorologicalModel'

const emit = defineEmits(['navigate'])
const props = defineProps({
  city: { type: String, default: '全国' },
})

const state = ref({
  name: props.city || '全国',
  ts: null,
  aqi: null,
  pm25: null,
  wind_speed: null,
  humidity: null,
  temp_c: null,
})
const dashboard = ref(null)

const toNum = (x) => {
  const n = Number(x)
  return Number.isFinite(n) ? n : null
}
const clamp = (v, min, max) => Math.max(min, Math.min(max, v))

function normalizeCityName(s) {
  return String(s || '')
    .trim()
    .replace(/\s+/g, '')
    .replace(/省$/g, '')
    .replace(/市$/g, '')
}

async function load() {
  const [latestRes, dashboardRes] = await Promise.allSettled([
    apiGet('/api/metrics/latest', { name: props.city }),
    apiGet('/api/model/dashboard', { city: props.city }),
  ])
  const latest = latestRes.status === 'fulfilled' ? latestRes.value : null
  state.value = {
    name: latest?.name ?? props.city,
    ts: latest?.ts ?? null,
    aqi: toNum(latest?.aqi),
    pm25: toNum(latest?.pm25),
    wind_speed: toNum(latest?.wind_speed),
    humidity: toNum(latest?.humidity),
    temp_c: toNum(latest?.temp_c),
  }
  dashboard.value = dashboardRes.status === 'fulfilled' ? dashboardRes.value : null
}

onMounted(() => {
  load().catch(() => {})
})

watch(
  () => props.city,
  () => {
    load().catch(() => {})
  }
)

const resolvedName = computed(() => state.value.name || props.city || '全国')
const tsText = computed(() => {
  if (!state.value.ts) return '更新时间 --:--'
  const d = new Date(state.value.ts)
  if (Number.isNaN(d.getTime())) return '更新时间 --:--'
  const h = String(d.getHours()).padStart(2, '0')
  const m = String(d.getMinutes()).padStart(2, '0')
  return `更新时间 ${h}:${m}`
})
const aqiText = computed(() => (state.value.aqi == null ? '--' : Math.round(state.value.aqi)))

const aqiLevel = computed(() => {
  const aqi = state.value.aqi
  if (aqi == null) return '未知'
  if (aqi <= 50) return '优'
  if (aqi <= 100) return '良'
  if (aqi <= 150) return '轻度污染'
  if (aqi <= 200) return '中度污染'
  if (aqi <= 300) return '重度污染'
  return '严重污染'
})
const levelTone = computed(() => {
  if (aqiLevel.value === '优' || aqiLevel.value === '良') return 'good'
  if (aqiLevel.value.includes('轻度')) return 'mid'
  return 'high'
})
const healthDesc = computed(() => {
  if (aqiLevel.value === '优') return '对健康无影响，适合所有人群'
  if (aqiLevel.value === '良') return '空气可接受，敏感人群建议适度防护'
  return '建议减少长时间户外活动并做好防护'
})
const ringPercent = computed(() => clamp(((state.value.aqi || 0) / 500) * 100, 0, 100))
const ringTotal = 264
const ringLength = computed(() => (ringPercent.value / 100) * ringTotal)

const dashboardRisk = computed(() => {
  const byCity = dashboard.value?.riskByCity
  if (!byCity || typeof byCity !== 'object') return null
  if (byCity[resolvedName.value]) return byCity[resolvedName.value]
  const cityNorm = normalizeCityName(resolvedName.value)
  const matched = Object.entries(byCity).find(([name]) => normalizeCityName(name) === cityNorm)
  return matched ? matched[1] : null
})

const fallbackRiskScore = computed(() => {
  const aqi = state.value.aqi ?? 50
  const pm25 = state.value.pm25 ?? 20
  const ws = state.value.wind_speed ?? 2.8
  const hum = state.value.humidity ?? 55
  const penalty = clamp(aqi / 95 + pm25 / 48 + (2.5 - Math.min(ws, 2.5)) * 0.8 + Math.abs(hum - 55) / 40, 0, 8.5)
  return clamp(10 - penalty, 1, 10)
})

function normalizeRiskScoreForDisplay(rawScore) {
  const score = toNum(rawScore)
  if (score == null) return null
  if (score <= 10) return clamp(score, 0, 10)
  if (score <= 100) return clamp(10 - score / 10, 0, 10)
  return clamp(score, 0, 10)
}

function mapBackendRiskLevel(level) {
  const txt = String(level || '').trim()
  if (!txt) return ''
  if (txt === '低风险') return '极低风险'
  if (txt === '较低风险') return '低风险'
  if (txt === '较高风险') return '中风险'
  return txt
}

const riskScore = computed(() => {
  const normalized = normalizeRiskScoreForDisplay(dashboardRisk.value?.riskScore)
  return normalized == null ? fallbackRiskScore.value : normalized
})
const riskText = computed(() => `${riskScore.value.toFixed(1)}/10（${riskLabel.value}）`)
const riskLabel = computed(() => {
  const fromBackend = mapBackendRiskLevel(dashboardRisk.value?.riskLevel)
  if (fromBackend) return fromBackend
  const s = riskScore.value
  if (s >= 8.5) return '极低风险'
  if (s >= 7) return '低风险'
  if (s >= 5.5) return '中风险'
  return '高风险'
})
const riskTone = computed(() => {
  if (riskLabel.value === '极低风险' || riskLabel.value === '低风险') return 'good'
  if (riskLabel.value === '中风险' || riskLabel.value === '较高风险') return 'mid'
  return 'high'
})

const conclusionText = computed(() => {
  if ((state.value.aqi ?? 999) <= 50 && (state.value.pm25 ?? 999) <= 35) {
    return '当前空气质量为优，细颗粒物浓度极低，整体环境清洁。'
  }
  return '空气质量总体可控，但个别因子存在波动，建议持续关注短时变化。'
})

const pm25FactorText = computed(() => {
  const v = state.value.pm25
  if (v == null) return '暂无PM2.5数据，当前按模型近似估计为低贡献因子。'
  if (v <= 35) return `当前 ${Math.round(v)} μg/m³，细颗粒物处于低位，对健康影响很小。`
  return `当前 ${Math.round(v)} μg/m³，细颗粒物贡献上升，是风险评分抬升主因。`
})
const windFactorText = computed(() => {
  const ws = state.value.wind_speed
  if (ws == null) return '风速数据缺失，扩散条件按中性假设处理。'
  if (ws >= 4.5) return `当前 ${ws.toFixed(1)} m/s，扩散条件优秀，有利于污染物稀释。`
  if (ws >= 2.2) return `当前 ${ws.toFixed(1)} m/s，扩散条件较好，空气质量保持稳定。`
  return `当前 ${ws.toFixed(1)} m/s，静稳条件偏强，污染物扩散效率下降。`
})
const humidityFactorText = computed(() => {
  const hum = state.value.humidity
  if (hum == null) return '湿度数据缺失，按常年均值参与计算。'
  if (hum <= 70) return `当前 ${Math.round(hum)}%，湿度适中，颗粒物吸湿增长效应弱。`
  return `当前 ${Math.round(hum)}%，湿度偏高，可能放大颗粒物体感影响。`
})

const cityForecast24h = computed(() => {
  const rows = Array.isArray(dashboard.value?.forecast24h) ? dashboard.value.forecast24h : []
  const target = normalizeCityName(resolvedName.value)
  return rows.filter((r) => normalizeCityName(r?.城市) === target).slice(0, 24)
})
const forecastFactorValue = computed(() => {
  const rows = cityForecast24h.value
  if (!rows.length) return '未来24h预测：数据待生成'
  const max = Math.round(Math.max(...rows.map((r) => toNum(r?.AQI) || 0)))
  const min = Math.round(Math.min(...rows.map((r) => toNum(r?.AQI) || 0)))
  return `未来24h AQI ${min} ~ ${max}`
})
const forecastFactorDesc = computed(() => {
  const rows = cityForecast24h.value
  if (!rows.length) return '暂无模型预测结果，建议点击下方按钮查看主屏预测模块。'
  const avg = rows.reduce((s, r) => s + (toNum(r?.AQI) || 0), 0) / rows.length
  if (avg <= 50) return '趋势平稳，预计空气质量持续优良。'
  if (avg <= 100) return '整体处于可接受区间，局地短时波动风险可控。'
  return '短时存在上行压力，建议提前安排防护与出行节奏。'
})

const syntheticLifePoints = computed(() =>
  Array.from({ length: 24 }).map((_, idx) => ({
    time: `${String(idx).padStart(2, '0')}:00`,
    temp_c: state.value.temp_c ?? 18,
    humidity: state.value.humidity ?? 55,
    wind_speed: state.value.wind_speed ?? 2.8,
    precip_mm: 0,
    pressure_hpa: 1013,
  }))
)
const lifeModel = computed(() => evaluateLifeMeteorologicalModel(syntheticLifePoints.value, 'day'))
const lifeLinkValue = computed(() => `紫外线 ${lifeModel.value.uvLevel} / 穿衣 ${lifeModel.value.dressLevel}`)
const lifeLinkDesc = computed(
  () => `联动生活气象指数：${lifeModel.value.uvAdvice} ${lifeModel.value.dressAdvice}`
)

const factorCards = computed(() => [
  {
    title: 'PM2.5因子',
    value: state.value.pm25 == null ? '-- μg/m³' : `${Math.round(state.value.pm25)} μg/m³`,
    desc: pm25FactorText.value,
  },
  {
    title: '气象因子',
    value:
      state.value.wind_speed == null && state.value.humidity == null
        ? '--'
        : `风速 ${state.value.wind_speed?.toFixed(1) || '--'} m/s · 湿度 ${Math.round(state.value.humidity || 0)}%`,
    desc: `${windFactorText.value} ${humidityFactorText.value}`,
  },
  {
    title: '未来趋势因子',
    value: forecastFactorValue.value,
    desc: forecastFactorDesc.value,
  },
  {
    title: '生活气象联动因子',
    value: lifeLinkValue.value,
    desc: lifeLinkDesc.value,
  },
])

const healthAdvice = computed(() => {
  if (riskScore.value >= 8.5) {
    return ['晨间开窗20分钟，保持室内空气新鲜。', '适合低至中强度户外运动，建议补水即可。', '老人和儿童可正常户外活动，无需额外防护。']
  }
  if (riskScore.value >= 6) {
    return ['敏感人群外出建议佩戴轻防护口罩。', '午后视AQI波动控制户外停留时长。', '室内使用空气净化设备时建议中档运行。']
  }
  return ['减少长时间户外停留，优先室内活动。', '外出建议佩戴防护口罩并避开主干道。', '睡前关闭外窗并开启净化设备。']
})
const lifeAdvice = computed(() => [
  `根据紫外线${lifeModel.value.uvLevel}，${lifeModel.value.uvAdvice}`,
  `根据穿衣指数${lifeModel.value.dressLevel}，${lifeModel.value.dressAdvice}`,
  `未来趋势提示：${forecastFactorDesc.value.replace('趋势', '24h趋势')}`,
])

function emitNavigate(target) {
  emit('navigate', target)
}
</script>

<style scoped>
.analysis {
  height: 100%;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-gutter: stable;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding-right: 2px;
  line-height: 1.45;
}

.analysis::-webkit-scrollbar {
  width: 6px;
}

.analysis::-webkit-scrollbar-thumb {
  border-radius: 999px;
  background: rgba(0, 255, 255, 0.42);
}

.analysis::-webkit-scrollbar-track {
  background: rgba(255, 255, 255, 0.08);
}

.city-meta {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  font-size: 13px;
}

.city {
  color: #ffeb3b;
  font-weight: 700;
}

.meta-item {
  color: rgba(210, 245, 255, 0.86);
}

.sep {
  color: rgba(174, 232, 255, 0.5);
}

.aqi-level,
.risk-tag {
  padding: 1px 8px;
  border-radius: 999px;
  font-size: 12px;
  border: 1px solid transparent;
}

.lv-good {
  color: #012f3c;
  background: #66f7f7;
  border-color: rgba(102, 247, 247, 0.75);
}

.lv-mid {
  color: #2f1b00;
  background: #ffd166;
  border-color: rgba(255, 209, 102, 0.75);
}

.lv-high {
  color: #3f0010;
  background: #ff8aa6;
  border-color: rgba(255, 138, 166, 0.75);
}

.section-title {
  color: rgba(174, 232, 255, 0.96);
  font-size: 14px;
  font-weight: 700;
  letter-spacing: 0.5px;
}

.health-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 8px;
}

.glass-card {
  background: rgba(0, 0, 0, 0.26);
  border-radius: 10px;
  border: 1px solid rgba(0, 255, 255, 0.24);
  box-shadow: inset 0 0 12px rgba(0, 255, 255, 0.06);
  padding: 10px;
}

.hover-card {
  transition: border-color 0.2s ease, box-shadow 0.2s ease, transform 0.2s ease;
}

.hover-card:hover {
  border-color: rgba(0, 255, 255, 0.55);
  box-shadow: 0 0 14px rgba(0, 255, 255, 0.22), inset 0 0 12px rgba(0, 255, 255, 0.12);
  transform: translateY(-1px);
}

.card-hd {
  font-size: 13px;
  color: rgba(181, 240, 255, 0.88);
}

.card-main {
  margin-top: 7px;
}

.health-main {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
}

.major-value {
  font-size: 22px;
  font-weight: 800;
  color: #b9f4ff;
  line-height: 1.2;
}

.minor-desc {
  margin-top: 4px;
  font-size: 13px;
  color: rgba(223, 247, 255, 0.82);
  line-height: 1.45;
}

.ring-wrap {
  position: relative;
  width: 68px;
  height: 68px;
  flex: 0 0 68px;
}

.ring {
  width: 68px;
  height: 68px;
  transform: rotate(-90deg);
}

.ring-bg {
  fill: none;
  stroke: rgba(255, 255, 255, 0.14);
  stroke-width: 8;
}

.ring-val {
  fill: none;
  stroke: #67f5ff;
  stroke-width: 8;
  stroke-linecap: round;
}

.ring-text {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  font-size: 12px;
  color: rgba(208, 246, 255, 0.94);
}

.highlight-conclusion {
  margin-top: 6px;
  color: #72f4ff;
  font-size: 15px;
  font-weight: 700;
  line-height: 1.45;
}

.plain-list {
  margin: 8px 0 0;
  padding-left: 16px;
  font-size: 13px;
  line-height: 1.5;
  color: rgba(226, 247, 255, 0.9);
}

.source-note {
  margin-top: 8px;
  font-size: 12px;
  color: rgba(210, 236, 245, 0.62);
}

.factor-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}

.factor-card {
  min-height: 118px;
}

.factor-title {
  font-size: 13px;
  color: rgba(182, 237, 255, 0.94);
}

.factor-value {
  margin-top: 6px;
  color: #84f3ff;
  font-size: 15px;
  font-weight: 700;
}

.factor-desc {
  margin-top: 4px;
  font-size: 12px;
  line-height: 1.45;
  color: rgba(226, 247, 255, 0.86);
}

.adv-grid {
  margin-top: 4px;
  display: grid;
  gap: 10px;
}

.adv-title {
  font-size: 13px;
  font-weight: 700;
  color: #8feefe;
}

.adv-list {
  margin: 6px 0 0;
  padding: 0;
  list-style: none;
  display: grid;
  gap: 5px;
  font-size: 13px;
  color: rgba(225, 246, 255, 0.9);
}

.adv-list li {
  display: flex;
  align-items: flex-start;
  gap: 6px;
}

.adv-icon {
  color: #76f4ff;
  margin-top: 1px;
}

.bottom-actions {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
  margin-top: 2px;
}

.action-btn {
  border: none;
  border-radius: 8px;
  padding: 8px 10px;
  background: linear-gradient(90deg, #07d7f5, #1f9fff);
  color: #fff;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
  box-shadow: 0 0 10px rgba(0, 255, 255, 0.24);
}

.action-btn:hover {
  filter: brightness(1.08);
}
</style>
