<template>
  <div class="cb">
    <div class="grid">
      <!-- 左侧 50%：预测 + 模型影响 + AI 中心合并为统一模块 -->
      <section class="card card-merged">
        <div class="merged-body">
          <div class="merged-top">
            <div class="col-forecast">
              <div class="head">
                <div class="title">未来预测曲线与模型影响</div>
                <div class="tabs">
                  <button class="tab" :class="{ active: forecastTab === '24h' }" type="button" @click="forecastTab = '24h'">未来24h</button>
                  <button class="tab" :class="{ active: forecastTab === '7d' }" type="button" @click="forecastTab = '7d'">7天</button>
                </div>
              </div>
              <div class="col-forecast-inner panel">
                <div class="panel-title">
                  {{ effectiveCityName }}AQI预测曲线
                  <span class="chart-kind">折线图</span>
                  <span v-if="predicting || predictTaskRunning" class="predicting-tag">预测中...</span>
                </div>
                <div v-if="forecastTab === '24h' && hourlyForecastRows.length" class="forecast-chart-wrap">
                  <svg class="forecast-chart" viewBox="0 0 640 220" preserveAspectRatio="none">
                    <line class="axis-line" x1="46" y1="20" x2="46" y2="184" />
                    <line class="axis-line" x1="46" y1="184" x2="620" y2="184" />
                    <polyline class="trend-line" :points="forecastPolyline" />
                    <circle
                      v-for="pt in forecastChartPoints"
                      :key="pt.key"
                      :cx="pt.x"
                      :cy="pt.y"
                      r="4"
                      :fill="levelColor(pt.level)"
                      stroke="rgba(255,255,255,0.65)"
                      stroke-width="1"
                    />
                    <text class="axis-label" x="46" y="204">00:00</text>
                    <text class="axis-label" x="312" y="204">12:00</text>
                    <text class="axis-label" x="585" y="204">23:00</text>
                    <text class="axis-label" x="8" y="26">{{ yMaxLabel }}</text>
                    <text class="axis-label" x="8" y="186">{{ yMinLabel }}</text>
                  </svg>
                  <div class="level-legend">
                    <span class="dot lv-green"></span><span>优</span>
                    <span class="dot lv-yellow"></span><span>良</span>
                    <span class="dot lv-orange"></span><span>轻度</span>
                    <span class="dot lv-red"></span><span>中度</span>
                    <span class="dot lv-purple"></span><span>重度+</span>
                  </div>

                  <div class="pollutant-stack-wrap">
                    <div class="pollutant-stack-title">未来24小时多污染物叠加（堆叠面积图）</div>
                    <div ref="pollutantStackRef" class="pollutant-stack-chart" />
                  </div>
                </div>
                <div v-else-if="visibleForecast.length" class="forecast-list">
                  <div v-for="p in visibleForecast" :key="forecastKey(p)" class="forecast-row">
                    <span class="t">{{ p.日期 || '--' }}</span>
                    <span class="v">{{ forecastValueLabel(p) }}</span>
                    <span class="l" :class="toLevelClass(p.污染等级)">{{ p.污染等级 }}</span>
                  </div>
                </div>
                <div v-else class="forecast-empty">暂无该城市的预测数据</div>
              </div>
            </div>

            <div class="col-influence">
              <div class="head head-influence">
                <div class="title">各项空气数据对预测模型影响占比</div>
              </div>
              <div class="col-influence-inner panel">
                <div ref="pieChartRef" class="pie-chart"></div>
                <div class="pie-source">
                  {{ pieSourceLabel }}
                </div>
              </div>
            </div>
          </div>

          <div class="merged-bottom">
            <div class="head">
              <div class="title">AI预测与预警中心</div>
              <div class="tabs">
                <button class="tab" :class="{ active: aiExpanded }" type="button" @click="aiExpanded = !aiExpanded">
                  {{ aiExpanded ? '收起' : '展开' }}
                </button>
              </div>
            </div>

            <div class="ai">
              <div class="kpis">
                <button class="kpi" type="button" @click="openModal('ai-risk')">
                  <div class="kpi-label">风险评分</div>
                  <div class="kpi-value">
                    {{ fmt(cityRisk?.riskScore) }}
                    <span v-if="cityRisk?.riskLevel" class="risk-level">（{{ cityRisk.riskLevel }}）</span>
                  </div>
                </button>
                <div
                  class="kpi kpi-clickable"
                  role="button"
                  tabindex="0"
                  @click="openModal('ai-hit')"
                  @keydown.enter.prevent="openModal('ai-hit')"
                  @keydown.space.prevent="openModal('ai-hit')"
                >
                  <div class="kpi-label">R²</div>
                  <div class="kpi-value kpi-value-row">
                    <span>{{ fmt(metrics?.r2) }}</span>
                    <button
                      v-if="predictLogs.length"
                      class="refresh-predict-btn"
                      type="button"
                      @click.stop="predictLogsOpen = !predictLogsOpen"
                    >
                      {{ predictLogsOpen ? '收起日志' : '查看日志' }}
                    </button>
                    <button
                      v-if="predicting || predictTaskRunning"
                      class="refresh-predict-btn"
                      type="button"
                      @click.stop="stopPrediction"
                    >
                      停止预测
                    </button>
                    <button
                      class="refresh-predict-btn"
                      type="button"
                      :disabled="predicting"
                      @click.stop="refreshPrediction"
                    >
                      更新预测
                    </button>
                  </div>
                  <div v-if="predicting || predictTaskRunning" class="model-predicting-hint">模型预测中</div>
                  <div v-else-if="predictStatus" class="model-predict-status">{{ predictStatus }}</div>
                  <div v-if="predictLogsOpen && predictLogs.length" class="predict-log-wrap" @click.stop>
                    <div class="predict-log-head">推理日志（最近 {{ predictLogs.length }} 行）</div>
                    <pre class="predict-log">{{ predictLogs.map((x) => `[${(x.kind || '').toUpperCase()}] ${x.line}`).join('\n') }}</pre>
                  </div>
                </div>
                <div class="kpi kpi-model-version">
                  <div class="kpi-label">模型版本</div>
                  <select
                    v-model="selectedVariantId"
                    class="model-select"
                    aria-label="切换模型版本"
                    @change="onVariantChange"
                  >
                    <option v-for="v in modelVersions" :key="v.id" :value="v.id" :disabled="v.available === false">
                      {{ v.label }}{{ v.available === false ? '（未生成）' : '' }}
                    </option>
                  </select>
                  <button class="kpi-value kpi-value-model" type="button" @click="openModal('ai-model')">
                    {{ modelVersionDisplay }}
                  </button>
                  <div v-if="loadError" class="model-switch-hint">切换失败：{{ loadError }}</div>
                </div>
              </div>

              <div v-if="aiExpanded" class="ai-body">
                <div class="ai-sec">
                  <div class="panel-title">重点城市（预测城市 + 排名前列）</div>
                  <div class="chips">
                    <button v-for="c in hotCities" :key="c" class="chip" type="button" @click="openCity(c)">
                      {{ c }}
                    </button>
                  </div>
                </div>
                <div class="ai-sec">
                  <div class="panel-title">预警说明（Top特征）</div>
                  <div class="feature-list">
                    <div
                      v-for="f in topFeatures"
                      :key="f.特征"
                      class="feature-row"
                      :class="{ active: isActiveFeature(f) }"
                      @mouseenter="onFeatureRowEnter(f)"
                      @mouseleave="onFeatureRowLeave"
                    >
                      <div class="feature-meta">
                        <span>{{ f.特征 }}</span>
                        <span>{{ fmt(f.重要性) }}</span>
                      </div>
                      <div class="feature-bar-track">
                        <div class="feature-bar-fill" :style="{ width: `${featureWidth(f)}%` }"></div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <!-- 右侧 50%：生活气象指数中心 -->
      <div ref="lifePanelRef" class="reserved-right">
        <LifeMeteorologicalIndexPanel :city="city" />
      </div>
    </div>

    <div v-if="modalOpen" class="mask" @click.self="modalOpen = false">
      <div class="modal">
        <div class="modal-head">
          <div class="modal-title">{{ modalTitle }}</div>
          <button class="x" type="button" @click="modalOpen = false">关闭</button>
        </div>
        <div class="modal-body">
          <div class="modal-note">
            {{ modalDesc }}
          </div>
          <div v-if="modalCity" class="modal-city">
            选择城市：<b>{{ modalCity }}</b>
          </div>
          <div class="modal-actions">
            <button class="tab active" type="button" @click="emitPickCity">定位到该城市</button>
            <button class="tab" type="button" @click="modalOpen = false">我知道了</button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import * as echarts from 'echarts'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { apiGet, apiPost } from '../api'
import LifeMeteorologicalIndexPanel from './LifeMeteorologicalIndexPanel.vue'

const emit = defineEmits(['pick-city'])
const props = defineProps({
  city: {
    type: String,
    default: '北京',
  },
})

const forecastTab = ref('24h') // 24h | 7d
const aiExpanded = ref(true)
const payload = ref(null)
const loadError = ref('')
const predicting = ref(false)
const predictStatus = ref('') // transient hint below R2
const predictLogs = ref([])
const predictLogsOpen = ref(false)
const activePredictJobId = ref('')
const predictTaskRunning = ref(false)
const lifePanelRef = ref(null)
let refreshTimer = null
let predictPollTimer = null
let _externalNavigate = null

const modalOpen = ref(false)
const modalKey = ref('')
const modalCity = ref('')

const modalTitle = computed(() => {
  const t = new Map([
    ['forecast', forecastTab.value === '24h' ? '未来24小时预测曲线（占位）' : '7天预测曲线（占位）'],
    ['warn-red', '红色预警详情（占位）'],
    ['warn-orange', '橙色预警详情（占位）'],
    ['warn-yellow', '黄色预警详情（占位）'],
    ['ai-risk', '风险评分详情（占位）'],
    ['ai-hit', '命中率详情（占位）'],
    ['ai-model', '模型版本详情'],
    ['ai-explain', 'AI解释与建议（占位）'],
  ])
  return t.get(modalKey.value) || '详情（占位）'
})

const modalDesc = computed(() => {
  if (loadError.value) return `模型数据加载失败：${loadError.value}`
  if (!payload.value) return '尚未加载模型数据，请先运行训练脚本。'
  const m = payload.value.metrics || {}
  const riskPart = cityRisk.value
    ? `；${effectiveCityName.value}风险评分=${fmt(cityRisk.value.riskScore)}（${cityRisk.value.riskLevel}）`
    : ''
  const vl = payload.value.variantLabel ? `；${payload.value.variantLabel}` : ''
  return `更新时间：${payload.value.updatedAt || '--'}；MAE=${fmt(m.mae)}，RMSE=${fmt(m.rmse)}，R²=${fmt(
    m.r2
  )}${vl}${riskPart}。`
})

function normalizeCityName(s) {
  const raw = s == null ? '' : String(s).trim()
  if (!raw) return ''
  // 去掉常见后缀，提升跨数据源匹配能力
  let x = raw.replace(/\s+/g, '')
  x = x.replace(/省$/g, '').replace(/市$/g, '')

  // 直辖市/特殊情况归一化
  const municipalities = new Set(['北京', '上海', '天津', '重庆'])
  if (municipalities.has(x)) return x
  return x
}

const MODEL_VARIANT_STORAGE = 'dashboard_model_variant'

const metrics = computed(() => payload.value?.metrics || null)
const modelVersions = ref([])
const selectedVariantId = ref('')
/** 上次成功拉取的 variant，请求失败时恢复下拉框 */
const lastGoodVariantId = ref('tree')

const modelVersionDisplay = computed(() => {
  const rv = payload.value?.resolvedVariant
  const m = payload.value?.metrics?.model
  const vl = payload.value?.variantLabel
  if (rv === 'lstm') return m || vl || 'LSTM'
  if (rv === 'transformer') return m || vl || 'Transformer'
  if (rv === 'tree') return m || vl || '树模型'
  if (vl && m) return String(m)
  if (vl) return String(vl)
  return m ? String(m) : 'N/A'
})
const activeCity = computed(() => (props.city || '').trim() || payload.value?.targetCity || '北京')
const activeCityNorm = computed(() => normalizeCityName(activeCity.value))
const payloadTargetCityNorm = computed(() => normalizeCityName(payload.value?.targetCity || ''))
const effectiveCityName = computed(() => payload.value?.targetCity || activeCity.value || '北京')
const effectiveCityNorm = computed(() => {
  const normA = activeCityNorm.value
  const normB = payloadTargetCityNorm.value
  const forecast24h = Array.isArray(payload.value?.forecast24h) ? payload.value.forecast24h : []
  const forecast7d = Array.isArray(payload.value?.forecast7dDaily) ? payload.value.forecast7dDaily : []

  const hasMatch = (norm) => {
    if (!norm) return false
    return forecast24h.some((r) => normalizeCityName(r?.城市) === norm) || forecast7d.some((r) => normalizeCityName(r?.城市) === norm)
  }

  if (hasMatch(normA)) return normA
  if (hasMatch(normB)) return normB
  return normA || normB
})
const cityRisk = computed(() => {
  const byCity = payload.value?.riskByCity
  if (!byCity || typeof byCity !== 'object') return null
  if (byCity[activeCity.value]) return byCity[activeCity.value]
  const entry = Object.entries(byCity).find(([name]) => normalizeCityName(name) === effectiveCityNorm.value)
  return entry ? entry[1] : null
})
const topFeatures = computed(() => {
  const byCity = payload.value?.topFeaturesByCity
  if (byCity && typeof byCity === 'object') {
    const rows = byCity[activeCity.value]
    if (Array.isArray(rows) && rows.length) return rows.slice(0, 6)
  }
  const allRows = Array.isArray(payload.value?.topFeatures) ? payload.value.topFeatures : []
  const cityRows = allRows.filter((x) => normalizeCityName(x?.城市) === effectiveCityNorm.value)
  if (cityRows.length) return cityRows.slice(0, 6)
  return allRows.slice(0, 6)
})

const pieChartRef = ref(null)
let pieInstance = null
const activeFeatureName = ref('')

/** 无模型特征数据时，饼图展示需求文档中的参考占比（总和 100） */
const PIE_DEMO_FALLBACK = [
  { name: '湿度', value: 22 },
  { name: '温度', value: 21 },
  { name: '风速', value: 16 },
  { name: 'AQI roll mean 3', value: 16 },
  { name: 'AQI lag 2', value: 13 },
  { name: '小时', value: 12 },
]

const pieData = computed(() => {
  const rows = Array.isArray(topFeatures.value) ? topFeatures.value : []
  const items = rows
    .map((f) => ({
      name: String(f?.特征 || '').trim(),
      value: Number(f?.重要性),
    }))
    .filter((x) => x.name && Number.isFinite(x.value) && x.value > 0)

  items.sort((a, b) => b.value - a.value)
  return items
})

const pieSeriesData = computed(() => {
  if (pieData.value.length) return pieData.value
  return PIE_DEMO_FALLBACK.map((x) => ({ name: x.name, value: x.value }))
})
const pieUsingFallback = computed(() => pieData.value.length === 0)
const pieSourceLabel = computed(() => {
  const variant = payload.value?.resolvedVariant || selectedVariantId.value || 'unknown'
  const featCount = pieData.value.length
  if (pieUsingFallback.value) {
    return `模型=${variant}，特征数据缺失，当前使用 fallback 占比`
  }
  return `模型=${variant}，当前使用 ${featCount} 个特征`
})

const pollutantStackRef = ref(null)
let pollutantStackInstance = null
let _winResize = null

const pollutantStackColors = {
  PM25: '#4fc3f7', // 青
  PM10: '#2196f3', // 蓝
  O3: '#ba68c8', // 紫
  NO2: '#ff9800', // 橙
}

function toPredTimeHm(ts) {
  if (ts == null) return '--:--'
  const s = String(ts)
  // 兼容 "YYYY-MM-DD HH:mm:ss" 和 "YYYY-MM-DDTHH:mm:ssZ"
  if (s.length >= 16 && s.includes(' ')) return `${s.slice(11, 13)}:${s.slice(14, 16)}`
  if (s.length >= 16 && s.includes('T')) return `${s.slice(11, 13)}:${s.slice(14, 16)}`
  // 退化：直接取最后 5 位
  return s.slice(-5)
}

const pollutantStackRows = computed(() => {
  // 仅在 24h tab 下渲染堆叠图
  if (forecastTab.value !== '24h') return []
  return Array.isArray(hourlyForecastRows.value) ? hourlyForecastRows.value : []
})

const pollutantStackOption = computed(() => {
  const rows = pollutantStackRows.value
  if (!rows.length) return null

  const times = rows.map((r) => toPredTimeHm(r?.预测时间))
  const getNum = (x) => {
    const n = Number(x)
    return Number.isFinite(n) ? n : null
  }

  const pollutants = [
    { key: '预测PM25', short: 'PM2.5', color: pollutantStackColors.PM25 },
    { key: '预测PM10', short: 'PM10', color: pollutantStackColors.PM10 },
    { key: '预测O3', short: 'O3', color: pollutantStackColors.O3 },
    { key: '预测NO2', short: 'NO2', color: pollutantStackColors.NO2 },
  ]

  const yMax = (() => {
    const vals = pollutants.flatMap((p) => rows.map((r) => getNum(r?.[p.key]))).filter((v) => v != null)
    if (!vals.length) return null
    return Math.max(...vals)
  })()

  return {
    times,
    pollutants,
    yMax,
    series: pollutants.map((p) => ({
      name: p.short,
      key: p.key,
      color: p.color,
      data: rows.map((r) => getNum(r?.[p.key])),
    })),
  }
})

function ensurePollutantStackChart() {
  if (pollutantStackInstance || !pollutantStackRef.value) return
  pollutantStackInstance = echarts.init(pollutantStackRef.value, undefined, { renderer: 'canvas' })
}

function updatePollutantStackOption() {
  if (!pollutantStackInstance) return
  const opt = pollutantStackOption.value

  if (!opt) {
    pollutantStackInstance.setOption({ series: [] }, true)
    return
  }

  const option = {
    backgroundColor: 'transparent',
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'line' },
      formatter: (params) => {
        const t = params?.[0]?.axisValue ?? ''
        const lines = (params || [])
          .map((p) => {
            const v = p?.data == null ? '--' : Number(p.data)
            return `${p.seriesName}：${v == null || !Number.isFinite(v) ? '--' : v.toFixed(1)}`
          })
          .join('<br/>')
        return `${t}<br/>${lines}`
      },
    },
    legend: { show: false },
    grid: { left: 8, right: 8, top: 20, bottom: 20 },
    xAxis: {
      type: 'category',
      data: opt.times,
      axisLabel: { color: 'rgba(174, 232, 255, 0.7)', fontSize: 10 },
      axisLine: { lineStyle: { color: 'rgba(255,255,255,0.12)' } },
      boundaryGap: false,
    },
    yAxis: {
      type: 'value',
      name: '浓度',
      nameTextStyle: { color: 'rgba(174, 232, 255, 0.7)', fontSize: 10 },
      axisLabel: { color: 'rgba(174, 232, 255, 0.7)', fontSize: 10 },
      max: opt.yMax != null ? Math.ceil(opt.yMax / 10) * 10 : undefined,
      splitLine: { lineStyle: { color: 'rgba(255,255,255,0.08)' } },
    },
    series: opt.series.map((s) => ({
      name: s.name,
      type: 'line',
      stack: 'pollutants',
      data: s.data,
      showSymbol: false,
      smooth: false,
      lineStyle: { width: 1.5, color: s.color },
      areaStyle: {
        opacity: 0.22,
        color: s.color,
      },
      emphasis: { focus: 'series' },
    })),
  }

  pollutantStackInstance.setOption(option, true)
}

function ensurePieChart() {
  if (pieInstance || !pieChartRef.value) return
  pieInstance = echarts.init(pieChartRef.value, undefined, { renderer: 'canvas' })
}

function updatePieOption() {
  if (!pieInstance) return

  const data = pieSeriesData.value
  const colors = ['#4fc3f7', '#ff9800', '#f44336', '#ba68c8', '#fdd835', '#00e5ff', '#8bc34a', '#26a69a']

  if (!data.length) {
    pieInstance.setOption(
      {
        series: [],
        graphic: [
          {
            type: 'text',
            left: 'center',
            top: 'middle',
            style: {
              text: '暂无可用的影响特征数据',
              fill: 'rgba(224,247,255,0.75)',
              fontSize: 12,
            },
          },
        ],
      },
      true
    )
    return
  }

  pieInstance.setOption(
    {
      tooltip: {
        trigger: 'item',
        formatter: (p) => {
          const v = p?.value == null ? '--' : Number(p.value)
          const fmtV = Number.isFinite(v) ? v.toFixed(4) : '--'
          return `${p.name}<br/>重要性：${fmtV}<br/>占比：${p.percent.toFixed(0)}%`
        },
      },
      legend: {
        show: true,
        top: '78%',
        left: 'center',
        textStyle: { color: 'rgba(224,247,255,0.8)', fontSize: 10 },
        formatter: (name) => String(name).replace(/_/g, ' '),
      },
      series: [
        {
          name: '影响占比',
          type: 'pie',
          // 实心扇形（非圆环）
          radius: '78%',
          center: ['50%', '44%'],
          avoidLabelOverlap: false,
          emphasis: {
            itemStyle: {
              shadowBlur: 14,
              shadowColor: 'rgba(0, 0, 0, 0.45)',
            },
          },
          label: {
            show: true,
            formatter: (p) => `${Number(p.percent).toFixed(0)}%`,
            fontSize: 11,
            color: 'rgba(224,247,255,0.95)',
          },
          labelLine: { show: true, length: 10, length2: 6 },
          itemStyle: {
            borderColor: 'rgba(0,0,0,0.35)',
            borderWidth: 2,
          },
          data: data.map((d, idx) => ({
            name: d.name,
            value: d.value,
            itemStyle: { color: colors[idx % colors.length] },
          })),
        },
      ],
    },
    true
  )
}

function featureNameOf(row) {
  return String(row?.特征 || '').trim()
}

function isActiveFeature(row) {
  const n = featureNameOf(row)
  if (!n) return false
  return n === activeFeatureName.value
}

function highlightPieByName(name) {
  if (!pieInstance) return
  const n = String(name || '').trim()
  if (!n) return
  // 先取消所有，再高亮目标，避免残留
  pieInstance.dispatchAction({ type: 'downplay', seriesIndex: 0 })
  pieInstance.dispatchAction({ type: 'highlight', seriesIndex: 0, name: n })
}

function clearPieHighlight() {
  if (!pieInstance) return
  pieInstance.dispatchAction({ type: 'downplay', seriesIndex: 0 })
}

function onFeatureRowEnter(row) {
  const n = featureNameOf(row)
  if (!n) return
  activeFeatureName.value = n
  highlightPieByName(n)
}

function onFeatureRowLeave() {
  activeFeatureName.value = ''
  clearPieHighlight()
}
const forecastRows = computed(() => {
  const rows = Array.isArray(payload.value?.forecast24h) ? payload.value.forecast24h : []
  return rows.filter((r) => normalizeCityName(r?.城市) === effectiveCityNorm.value)
})
const forecast7dRows = computed(() => {
  const rows = Array.isArray(payload.value?.forecast7dDaily) ? payload.value.forecast7dDaily : []
  return rows.filter((r) => normalizeCityName(r?.城市) === effectiveCityNorm.value)
})
const hourlyForecastRows = computed(() => forecastRows.value.slice(0, 24))
const visibleForecast = computed(() => {
  if (forecastTab.value === '7d') return forecast7dRows.value.slice(0, 7)
  return forecastRows.value.slice(0, 12)
})
const hotCities = computed(() => {
  const set = new Set([effectiveCityName.value])
  const rank = Array.isArray(payload.value?.cityRankTop10) ? payload.value.cityRankTop10 : []
  for (const r of rank.slice(0, 6)) set.add(r.城市)
  return Array.from(set).filter(Boolean)
})

/** 折线图城市下拉：当前城市 + 热点 + 模型 payload 中出现的城市 */
const featureMax = computed(() => {
  if (!topFeatures.value.length) return 1
  return Math.max(...topFeatures.value.map((f) => Number(f?.重要性) || 0), 1)
})
const yRange = computed(() => {
  const vals = hourlyForecastRows.value.map((r) => Number(r?.预测AQI)).filter((v) => Number.isFinite(v))
  if (!vals.length) return { min: 0, max: 200 }

  const rawMin = Math.min(...vals)
  const rawMax = Math.max(...vals)
  if (!Number.isFinite(rawMin) || !Number.isFinite(rawMax)) return { min: 0, max: 200 }
  if (rawMax <= rawMin) {
    // 避免分母为 0：给一个固定宽度
    const min = rawMin - 5
    return { min, max: rawMin + 5 }
  }

  const range = rawMax - rawMin
  // 小波动时不要用“十”的粒度四舍五入，否则曲线会因为分母过大而几乎水平
  // 同时给一点 padding，保证点不会贴到边界。
  if (range < 20) {
    const pad = Math.max(range * 0.2, 0.2)
    const min0 = rawMin - pad
    const max0 = rawMax + pad
    const step = range < 10 ? 0.5 : 1
    const min = Math.floor(min0 / step) * step
    const max = Math.ceil(max0 / step) * step
    const safeMax = max <= min ? min + step : max
    return { min, max: safeMax }
  }

  // 大波动时保持较粗粒度的轴刻度，避免标签过碎
  const min = Math.floor(rawMin / 10) * 10
  const max = Math.ceil(rawMax / 10) * 10
  const safeMax = max <= min ? min + 20 : max
  return { min, max: safeMax }
})
const yMinLabel = computed(() => String(yRange.value.min))
const yMaxLabel = computed(() => String(yRange.value.max))
const forecastChartPoints = computed(() => {
  const rows = hourlyForecastRows.value
  if (!rows.length) return []
  const x0 = 46
  const y0 = 20
  const w = 574
  const h = 164
  const den = Math.max(1, rows.length - 1)
  const verticalRange = Math.max(1e-6, Number(yRange.value.max - yRange.value.min))
  // 当波动很小时，纵向映射会显得“过于平”，这里做轻微对比拉伸增强起伏感。
  const amplify = verticalRange < 10 ? 1.9 : verticalRange < 20 ? 1.4 : 1
  return rows.map((r, i) => {
    const v = Number(r?.预测AQI)
    const rawRatio = (v - yRange.value.min) / verticalRange
    const ratio = Math.max(0, Math.min(1, (rawRatio - 0.5) * amplify + 0.5))
    const x = x0 + (w * i) / den
    const y = y0 + h - Math.max(0, Math.min(1, ratio)) * h
    return { key: `${r.预测时间}-${i}`, x, y, level: r?.污染等级 }
  })
})
const forecastPolyline = computed(() => forecastChartPoints.value.map((p) => `${p.x},${p.y}`).join(' '))

function fmt(v) {
  const n = Number(v)
  if (!Number.isFinite(n)) return '--'
  return (Math.round(n * 100) / 100).toString()
}

function toHm(ts) {
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return '--:--'
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `${hh}:${mm}`
}

function forecastKey(row) {
  if (!row) return '--'
  return `${row.城市 || ''}-${row.预测时间 || row.日期 || ''}`
}

function forecastTimeLabel(row) {
  if (forecastTab.value === '7d') return row?.日期 || '--'
  return toHm(row?.预测时间)
}

function forecastValueLabel(row) {
  if (forecastTab.value === '7d') return `均 ${fmt(row?.平均AQI)} / 峰 ${fmt(row?.峰值AQI)}`
  return fmt(row?.预测AQI)
}
function featureWidth(row) {
  const v = Number(row?.重要性)
  if (!Number.isFinite(v)) return 0
  return Math.max(6, Math.min(100, (v / featureMax.value) * 100))
}

function toLevelClass(level) {
  if (level?.includes('重度')) return 'lv-purple'
  if (level?.includes('中度')) return 'lv-red'
  if (level?.includes('轻度')) return 'lv-orange'
  if (level === '良') return 'lv-yellow'
  if (level === '优') return 'lv-green'
  return ''
}
function levelColor(level) {
  if (level?.includes('重度')) return '#ba68c8'
  if (level?.includes('中度')) return '#f44336'
  if (level?.includes('轻度')) return '#ff9800'
  if (level === '良') return '#fdd835'
  return '#4caf50'
}

async function loadModelVersions() {
  const fallback = [
    { id: 'tree', label: '梯度提升树', available: true },
    { id: 'lstm', label: 'LSTM 多目标', available: false },
    { id: 'transformer', label: 'Transformer 多目标', available: false },
  ]
  try {
    const data = await apiGet('/api/model/versions')
    const list = Array.isArray(data?.versions) && data.versions.length ? data.versions : fallback
    modelVersions.value = list
    const saved = localStorage.getItem(MODEL_VARIANT_STORAGE)
    const pickAvailable = (id) => list.find((x) => x.id === id && x.available !== false)
    if (saved && pickAvailable(saved)) {
      selectedVariantId.value = saved
    } else if (data?.defaultVariant && pickAvailable(data.defaultVariant)) {
      selectedVariantId.value = data.defaultVariant
    } else {
      const first = list.find((x) => x.available !== false)
      selectedVariantId.value = first ? first.id : 'tree'
    }
  } catch {
    modelVersions.value = fallback
    selectedVariantId.value = 'tree'
  }
}

function onVariantChange() {
  if (selectedVariantId.value) {
    localStorage.setItem(MODEL_VARIANT_STORAGE, selectedVariantId.value)
  }
  loadModelPayload(activeCity.value)
}

async function loadModelPayload(cityName) {
  loadError.value = ''
  const startedAt = Date.now()
  predicting.value = true
  try {
    const params = { city: cityName || activeCity.value }
    if (selectedVariantId.value) params.variant = selectedVariantId.value
    payload.value = await apiGet('/api/model/dashboard', params)
    if (selectedVariantId.value) {
      lastGoodVariantId.value = selectedVariantId.value
    }
  } catch (e) {
    payload.value = null
    loadError.value = e?.message || '请求失败'
    selectedVariantId.value = lastGoodVariantId.value
  } finally {
    // 避免“预测中”一闪而过：保证最短展示时长
    const minMs = 1200
    const elapsed = Date.now() - startedAt
    if (elapsed < minMs) {
      await new Promise((r) => setTimeout(r, minMs - elapsed))
    }
    predicting.value = false
  }
}

async function refreshPrediction() {
  predictStatus.value = ''
  loadError.value = ''
  predicting.value = true
  predictLogs.value = []
  predictLogsOpen.value = true
  activePredictJobId.value = ''

  try {
    const city = activeCity.value
    const variant = selectedVariantId.value || 'tree'
    const started = await apiPost('/api/model/predict', { city, variant })
    const jobId = started?.jobId
    if (!jobId) throw new Error('未获取到 jobId')
    activePredictJobId.value = jobId
    predictTaskRunning.value = true

    const deadline = Date.now() + 15 * 60 * 1000
    while (Date.now() < deadline) {
      const st = await apiGet('/api/model/predict/status', { jobId })
      if (Array.isArray(st?.logs)) predictLogs.value = st.logs
      const status = st?.status
      if (status === 'done') break
      if (status === 'stopped') throw new Error('任务已停止')
      if (status === 'error') throw new Error(st?.error || '推理失败')
      await new Promise((r) => setTimeout(r, 1200))
    }

    // 推理完成：重新拉取该模型的 dashboard 数据
    await loadModelPayload(activeCity.value)
    if (loadError.value) throw new Error(loadError.value)
    predictStatus.value = '预测已更新'
  } catch (e) {
    loadError.value = e?.message || '请求失败'
    predictStatus.value = `预测失败：${loadError.value}`
  } finally {
    predicting.value = false
    predictTaskRunning.value = false
    activePredictJobId.value = ''
    setTimeout(() => {
      if (predictStatus.value === '预测已更新' || predictStatus.value.startsWith('预测失败：')) {
        predictStatus.value = ''
      }
    }, 2500)
  }
}

async function stopPrediction() {
  const jobId = activePredictJobId.value
  if (!jobId) return
  try {
    await apiPost('/api/model/predict/stop', { jobId })
    predictStatus.value = '已停止预测'
  } catch (e) {
    predictStatus.value = `停止失败：${e?.message || '请求失败'}`
  }
}

async function syncLatestPredictJob() {
  try {
    const latest = await apiGet('/api/model/predict/latest', { tail: 120 })
    if (!latest) {
      if (!predicting) predictTaskRunning.value = false
      return
    }
    if (Array.isArray(latest.logs) && latest.logs.length) {
      predictLogs.value = latest.logs
    }
    if (latest.status === 'running') {
      predictTaskRunning.value = true
      activePredictJobId.value = latest.jobId || activePredictJobId.value
      if (predictLogs.value.length) predictLogsOpen.value = true
    } else if (!predicting) {
      predictTaskRunning.value = false
    }
  } catch {
    // ignore polling errors
  }
}

function openModal(key) {
  modalKey.value = key
  modalCity.value = ''
  modalOpen.value = true
}

function openCity(name) {
  modalKey.value = 'ai-explain'
  modalCity.value = name
  modalOpen.value = true
}

function emitPickCity() {
  const c = (modalCity.value || '').trim()
  if (c) emit('pick-city', c)
}

onMounted(async () => {
  ensurePieChart()
  ensurePollutantStackChart()
  await loadModelVersions()
  loadModelPayload(activeCity.value)
  updatePieOption()
  updatePollutantStackOption()

  const onWinResize = () => resizeCharts()
  window.addEventListener('resize', onWinResize)
  _winResize = onWinResize

  // 饼图 -> 右侧特征列表联动
  if (pieInstance) {
    pieInstance.on('mouseover', (p) => {
      const n = String(p?.name || '').trim()
      if (!n) return
      activeFeatureName.value = n
    })
    pieInstance.on('mouseout', () => {
      activeFeatureName.value = ''
    })
  }

  refreshTimer = setInterval(() => {
    loadModelPayload(activeCity.value)
  }, 60000)
  syncLatestPredictJob()
  predictPollTimer = setInterval(() => {
    syncLatestPredictJob()
  }, 2000)

  _externalNavigate = (ev) => {
    const target = ev?.detail?.target
    if (target === 'forecast-7d') {
      forecastTab.value = '7d'
      return
    }
    if (target === 'life-index') {
      lifePanelRef.value?.scrollIntoView?.({ behavior: 'smooth', block: 'start' })
    }
  }
  window.addEventListener('dashboard:navigate', _externalNavigate)
})

watch(
  () => props.city,
  (city) => {
    loadModelPayload((city || '').trim() || '北京')
  }
)

onBeforeUnmount(() => {
  if (_winResize) {
    window.removeEventListener('resize', _winResize)
    _winResize = null
  }
  if (refreshTimer) {
    clearInterval(refreshTimer)
    refreshTimer = null
  }
  if (predictPollTimer) {
    clearInterval(predictPollTimer)
    predictPollTimer = null
  }
  if (_externalNavigate) {
    window.removeEventListener('dashboard:navigate', _externalNavigate)
    _externalNavigate = null
  }
  if (pieInstance) {
    pieInstance.off('mouseover')
    pieInstance.off('mouseout')
    pieInstance.dispose()
    pieInstance = null
  }
  if (pollutantStackInstance) {
    pollutantStackInstance.dispose()
    pollutantStackInstance = null
  }
})

function resizeCharts() {
  pieInstance?.resize()
  pollutantStackInstance?.resize()
}

watch(
  pieSeriesData,
  () => {
    ensurePieChart()
    updatePieOption()
  },
  { immediate: true }
)

watch(
  () => [forecastTab.value, payload.value, activeCityNorm.value],
  () => {
    ensurePollutantStackChart()
    updatePollutantStackOption()
  },
  { immediate: true }
)

watch(
  () => aiExpanded.value,
  () => {
    nextTick(() => resizeCharts())
  }
)
</script>

<style scoped>
.cb {
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.grid {
  flex: 1 1 auto;
  height: 100%;
  min-height: 0;
  display: grid;
  grid-template-columns: 1fr 1fr;
  grid-template-rows: minmax(0, 1fr);
  align-items: stretch;
  gap: 10px;
}

.card {
  border: 1px solid rgba(0, 255, 255, 0.22);
  border-radius: 10px;
  background: rgba(0, 0, 0, 0.22);
  padding: 10px;
  min-height: 0;
  min-width: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.card-merged {
  flex: 1 1 auto;
  min-width: 0;
}

.merged-body {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.merged-top {
  flex: 1 1 56%;
  min-height: 0;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
  align-items: stretch;
}

.merged-bottom {
  flex: 1 1 44%;
  min-height: 0;
  display: flex;
  flex-direction: column;
  border-top: 1px solid rgba(0, 255, 255, 0.14);
  padding-top: 10px;
  box-shadow: inset 0 1px 0 rgba(0, 255, 255, 0.06);
}

.col-forecast,
.col-influence {
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.col-forecast-inner,
.col-influence-inner {
  flex: 1 1 auto;
  min-height: 0;
}

/* 折线图 + 图例 + 堆叠图总高度常超出左栏：在此区域内滚轮上下滚动查看 */
.col-forecast-inner {
  overflow-y: auto;
  overflow-x: hidden;
  overscroll-behavior: contain;
  scrollbar-gutter: stable;
}

.col-forecast-inner::-webkit-scrollbar {
  width: 6px;
}

.col-forecast-inner::-webkit-scrollbar-thumb {
  background: rgba(0, 255, 255, 0.32);
  border-radius: 999px;
}

.col-forecast-inner::-webkit-scrollbar-track {
  background: rgba(0, 0, 0, 0.25);
}

.head-influence {
  justify-content: flex-start;
}

.reserved-right {
  min-height: 0;
  min-width: 0;
  background: transparent;
}

.chart-kind {
  margin-left: 8px;
  font-size: 11px;
  font-weight: 500;
  color: rgba(174, 232, 255, 0.55);
  letter-spacing: 0.5px;
}

.kpi-model-version {
  cursor: default;
}

.kpi-model-version .model-select {
  width: 100%;
  max-width: 100%;
  margin-top: 6px;
  box-sizing: border-box;
  font-size: 11px;
  padding: 4px 8px;
  border-radius: 6px;
  border: 1px solid rgba(0, 255, 255, 0.35);
  background: rgba(0, 0, 0, 0.45);
  color: rgba(224, 247, 255, 0.95);
  cursor: pointer;
}

.kpi-model-version .kpi-value {
  cursor: pointer;
}

.model-switch-hint {
  margin-top: 6px;
  font-size: 11px;
  line-height: 1.35;
  color: #ffab91;
}

.kpi-value-model {
  font-size: 13px;
  line-height: 1.25;
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  line-clamp: 2;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}

.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  flex-shrink: 0;
}

.merged-top .head {
  min-height: 34px;
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
.predicting-tag {
  margin-left: 8px;
  font-size: 11px;
  color: #fdd835;
}

.panel-canvas {
  flex: 1 1 auto;
  min-height: 0;
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
  min-height: 120px;
}

.warns {
  display: grid;
  grid-template-columns: 1fr;
  gap: 8px;
}

.warn {
  padding: 8px 10px;
  border-radius: 10px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  color: #fff;
  cursor: pointer;
  text-align: left;
  background: rgba(0, 0, 0, 0.25);
}
.warn.red {
  border-color: rgba(255, 105, 97, 0.35);
  background: rgba(255, 105, 97, 0.12);
}
.warn.orange {
  border-color: rgba(255, 183, 77, 0.35);
  background: rgba(255, 183, 77, 0.12);
}
.warn.yellow {
  border-color: rgba(255, 235, 59, 0.35);
  background: rgba(255, 235, 59, 0.12);
}

.hint {
  font-size: 12px;
  opacity: 0.7;
}

.forecast-list {
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
  border-radius: 8px;
  border: 1px solid rgba(0, 255, 255, 0.12);
  padding: 6px;
}
.forecast-chart-wrap {
  border-radius: 8px;
  border: 1px solid rgba(0, 255, 255, 0.12);
  padding: 8px 8px 6px;
  background: rgba(255, 255, 255, 0.03);
}
.forecast-chart {
  width: 100%;
  height: clamp(110px, 18vh, 180px);
  flex-shrink: 0;
}
.axis-line {
  stroke: rgba(174, 232, 255, 0.25);
  stroke-width: 1;
}
.trend-line {
  fill: none;
  stroke: #4fc3f7;
  stroke-width: 3;
}
.axis-label {
  fill: rgba(174, 232, 255, 0.82);
  font-size: 11px;
}
.level-legend {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  color: rgba(224, 247, 255, 0.8);
  padding: 2px 2px 0;
}
.dot {
  width: 8px;
  height: 8px;
  border-radius: 999px;
  display: inline-block;
}

.forecast-empty {
  padding: 10px 8px;
  border-radius: 8px;
  border: 1px dashed rgba(0, 255, 255, 0.18);
  background: rgba(0, 0, 0, 0.12);
  color: rgba(224, 247, 255, 0.78);
  font-size: 12px;
}

.pie-chart {
  width: 100%;
  height: 180px;
  flex: 1 1 auto;
  min-height: 0;
}

.pie-sub {
  font-size: 12px;
  opacity: 0.7;
}

.pie-source {
  font-size: 11px;
  color: rgba(174, 232, 255, 0.8);
  line-height: 1.35;
}

.pollutant-stack-wrap {
  margin-top: 10px;
  border-radius: 8px;
  border: 1px solid rgba(0, 255, 255, 0.12);
  background: rgba(255, 255, 255, 0.03);
  padding: 8px;
}

.pollutant-stack-title {
  font-size: 12px;
  opacity: 0.85;
  color: rgba(174, 232, 255, 0.92);
  margin-bottom: 6px;
}

.pollutant-stack-chart {
  width: 100%;
  height: clamp(120px, 16vh, 168px);
  min-height: 100px;
  flex-shrink: 0;
}

.forecast-row {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  gap: 8px;
  font-size: 12px;
  padding: 4px 2px;
  border-bottom: 1px dashed rgba(0, 255, 255, 0.16);
}

.forecast-row:last-child {
  border-bottom: none;
}

.forecast-row .t {
  opacity: 0.82;
}

.forecast-row .v {
  font-weight: 700;
}

.forecast-row .l {
  text-align: right;
}

.lv-green {
  color: #4caf50;
}
.lv-yellow {
  color: #fdd835;
}
.lv-orange {
  color: #ff9800;
}
.lv-red {
  color: #f44336;
}
.lv-purple {
  color: #ba68c8;
}

.ai {
  margin-top: 8px;
  min-height: 0;
  flex: 1 1 auto;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.kpis {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
}

.kpi {
  border-radius: 10px;
  border: 1px solid rgba(0, 255, 255, 0.18);
  background: rgba(0, 0, 0, 0.18);
  padding: 10px;
  text-align: left;
  cursor: pointer;
  color: rgba(224, 247, 255, 0.92);
}

.kpi-clickable {
  user-select: none;
}

.kpi-clickable:focus-visible {
  outline: 2px solid rgba(79, 195, 247, 0.75);
  outline-offset: 2px;
}

.kpi-label {
  font-size: 12px;
  opacity: 0.7;
}

.kpi-value {
  margin-top: 6px;
  font-size: 16px;
  font-weight: 800;
  font-variant-numeric: tabular-nums;
}

.kpi-value-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.refresh-predict-btn {
  flex: 0 0 auto;
  padding: 3px 10px;
  font-size: 12px;
  border-radius: 999px;
  border: 1px solid rgba(0, 255, 255, 0.35);
  background: rgba(0, 0, 0, 0.25);
  color: rgba(174, 232, 255, 0.92);
  cursor: pointer;
}

.refresh-predict-btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.model-predicting-hint {
  margin-top: 6px;
  font-size: 11px;
  font-weight: 600;
  color: #fdd835;
  letter-spacing: 0.5px;
}

.model-predict-status {
  margin-top: 6px;
  font-size: 11px;
  font-weight: 600;
  color: rgba(224, 247, 255, 0.82);
  letter-spacing: 0.2px;
}

.predict-log-wrap {
  margin-top: 8px;
  border-radius: 8px;
  border: 1px dashed rgba(0, 255, 255, 0.22);
  background: rgba(0, 0, 0, 0.22);
  padding: 8px;
  max-height: 180px;
  overflow: auto;
}

.predict-log-head {
  font-size: 11px;
  font-weight: 700;
  color: rgba(174, 232, 255, 0.9);
  margin-bottom: 6px;
}

.predict-log {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
  font-size: 11px;
  line-height: 1.35;
  color: rgba(224, 247, 255, 0.78);
}

.risk-level {
  margin-left: 6px;
  font-size: 11px;
  font-weight: 600;
  opacity: 0.86;
}

.ai-body {
  display: grid;
  grid-template-columns: 1fr;
  gap: 10px;
  min-height: 0;
  flex: 1 1 auto;
  overflow: auto;
  overscroll-behavior: contain;
}

.ai-sec .chips {
  margin-top: 8px;
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.feature-list {
  margin-top: 8px;
  border-radius: 8px;
  border: 1px solid rgba(0, 255, 255, 0.12);
  padding: 6px;
}

.feature-row {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 12px;
  padding: 6px 2px;
  border-bottom: 1px dashed rgba(0, 255, 255, 0.16);
}

.feature-row.active {
  background: rgba(79, 195, 247, 0.10);
  border-radius: 8px;
  padding: 6px 8px;
  margin: 0 -6px;
  border-bottom-color: rgba(79, 195, 247, 0.25);
}
.feature-meta {
  display: flex;
  justify-content: space-between;
  gap: 10px;
}
.feature-bar-track {
  width: 100%;
  height: 8px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.08);
  overflow: hidden;
}
.feature-bar-fill {
  height: 100%;
  border-radius: 999px;
  background: linear-gradient(90deg, rgba(79, 195, 247, 0.5), rgba(79, 195, 247, 0.95));
}

.feature-row:last-child {
  border-bottom: none;
}

.chip {
  padding: 6px 10px;
  font-size: 12px;
  border-radius: 999px;
  border: 1px solid rgba(0, 255, 255, 0.18);
  background: rgba(0, 0, 0, 0.25);
  color: rgba(224, 247, 255, 0.92);
  cursor: pointer;
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

.modal-city {
  margin-top: 10px;
  font-size: 12px;
  opacity: 0.9;
}

.modal-actions {
  margin-top: 12px;
  display: flex;
  gap: 8px;
}
</style>

