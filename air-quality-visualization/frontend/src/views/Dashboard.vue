<template>
  <div class="page">
    <header class="header">
      <div>
        <div class="header-title">基于模型预测的城市空气与天气质量可视化平台</div>
        <div class="header-sub">Model-Based Urban Air and Weather Quality Visualization Platform</div>
      </div>
      <div class="header-actions">
        <button type="button" class="screen-switch-btn" @click="emit('switch-screen')">公共展示版</button>
        <button
          type="button"
          class="carousel-btn"
          :class="{ active: isCarouselRunning }"
          @click="toggleCarousel"
        >
          {{ isCarouselRunning ? '停止轮播' : '开始轮播' }}
        </button>
        <div class="header-time">{{ now }}</div>
      </div>
    </header>

    <div class="dashboard">
      <!-- 左 -->
      <div class="left">
        <div class="panel panel-top">
          <PM25History :city="selectedCity" />
        </div>
        <div class="panel panel-mid">
          <RankList @select-city="handleCityPick" />
        </div>
        <div class="panel panel-bottom">
          <ContrastPanel :selected-city="selectedCity" @pick-city="handleCityPick" />
        </div>
      </div>

      <!-- 中 -->
      <div class="center">
        <div class="panel panel-map">
          <MapChart ref="mapRef" @city-click="handleCityClick" />
          <div v-if="cityPopupVisible" class="city-weather-popup">
            <div class="city-popup-head">
              <span>当前城市信息</span>
              <button type="button" class="city-weather-popup-close" @click="cityPopupVisible = false">关闭</button>
            </div>
            <WeatherPanel :city="selectedCity" />
          </div>
          <div v-if="airPopupVisible" class="city-air-analysis-popup">
            <div class="city-popup-head">
              <span>城市空气指数深度分析</span>
              <button type="button" class="city-weather-popup-close" @click="airPopupVisible = false">关闭</button>
            </div>
            <AirIndexAnalysis :city="selectedCity" @navigate="handleAirNavigate" />
          </div>
        </div>
        <div ref="centerBottomRef" class="panel panel-center-bottom">
          <CenterBottomPanels :city="selectedCity" @pick-city="handleCityPick" />
        </div>
      </div>

      <!-- 右（耦合分析占上半区，下半区预留） -->
      <div class="right reserved-right">
        <div class="right-half">
          <CouplingAnalysisPanel :city="selectedCity" />
        </div>
        <div class="right-half">
          <WeatherAlertPanel :city="selectedCity" />
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { apiGet } from '../api'
import MapChart from '../components/MapChart.vue'
import RankList from '../components/RankList.vue'
import WeatherPanel from '../components/WeatherPanel.vue'
import PM25History from '../components/PM25History.vue'
import ContrastPanel from '../components/ContrastPanel.vue'
import CenterBottomPanels from '../components/CenterBottomPanels.vue'
import AirIndexAnalysis from '../components/AirIndexAnalysis.vue'
import CouplingAnalysisPanel from '../components/CouplingAnalysisPanel.vue'
import WeatherAlertPanel from '../components/WeatherAlertPanel.vue'

const emit = defineEmits(['switch-screen'])
const now = ref('')
const selectedCity = ref('北京')
const mapRef = ref(null)
const centerBottomRef = ref(null)
const cityPopupVisible = ref(false)
const airPopupVisible = ref(false)
const isCarouselRunning = ref(false)
const carouselCities = ref([])

const parseCityName = (cityLike) => (typeof cityLike === 'string' ? cityLike : cityLike?.name || '北京')
const parseProvinceName = (cityLike) =>
  typeof cityLike === 'object' && cityLike ? String(cityLike.province || '').trim() : ''

const openCityPopup = (cityLike) => {
  selectedCity.value = parseCityName(cityLike)
  cityPopupVisible.value = true
  airPopupVisible.value = true
}

const formatTime = () => {
  const d = new Date()
  const y = d.getFullYear()
  const M = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  const h = String(d.getHours()).padStart(2, '0')
  const m = String(d.getMinutes()).padStart(2, '0')
  const s = String(d.getSeconds()).padStart(2, '0')
  now.value = `${y}-${M}-${day} ${h}:${m}:${s}`
}

const handleCityClick = (city) => {
  openCityPopup(city)
}

const handleCityPick = async (cityLike) => {
  const raw = parseCityName(cityLike)
  const provinceHint = parseProvinceName(cityLike)
  let resolvedName = raw
  try {
    const r = await apiGet('/api/city/resolve', { name: raw, province: provinceHint })
    // 只在后端能明确归类为“城市”时才覆盖，避免把“省/全国”误当成城市导致天气类接口空数据
    if (r?.scope === 'city' && r?.name) resolvedName = r.name
  } catch {
    // resolve 失败时退化为使用前端传参
  }

  openCityPopup(resolvedName)
  mapRef.value?.focusToCity?.(selectedCity.value)
}

const pickRandomCarouselCity = () => {
  const pool = Array.isArray(carouselCities.value) ? carouselCities.value : []
  if (!pool.length) return null

  if (pool.length === 1) return pool[0]
  const current = selectedCity.value
  const candidates = pool.filter((item) => parseCityName(item) !== current)
  const targetPool = candidates.length ? candidates : pool
  const index = Math.floor(Math.random() * targetPool.length)
  return targetPool[index] || null
}

const runCarouselOnce = async () => {
  if (!isCarouselRunning.value) return
  const nextCity = pickRandomCarouselCity()
  if (!nextCity) return
  await handleCityPick(nextCity)
}

const loadCarouselCities = async () => {
  try {
    const rows = await apiGet('/api/rank', { metric: 'pm25', limit: 100, group: 'city' })
    const arr = Array.isArray(rows) ? rows : []
    carouselCities.value = arr
      .map((item) => ({
        name: parseCityName(item),
        province: parseProvinceName(item),
      }))
      .filter((item) => item.name)
  } catch {
    carouselCities.value = [{ name: '北京', province: '北京市' }]
  }
}

let carouselTimer = null
let carouselRunId = 0
const startCarousel = async () => {
  if (isCarouselRunning.value) return
  const runId = ++carouselRunId
  if (!carouselCities.value.length) {
    await loadCarouselCities()
  }
  if (runId !== carouselRunId) return
  isCarouselRunning.value = true
  await runCarouselOnce()
  if (runId !== carouselRunId) return
  carouselTimer = setInterval(() => {
    runCarouselOnce()
  }, 10000)
}

const stopCarousel = () => {
  carouselRunId += 1
  isCarouselRunning.value = false
  if (carouselTimer) {
    clearInterval(carouselTimer)
    carouselTimer = null
  }
}

const toggleCarousel = () => {
  if (isCarouselRunning.value) stopCarousel()
  else startCarousel()
}

const handleAirNavigate = (target) => {
  airPopupVisible.value = false
  centerBottomRef.value?.scrollIntoView?.({ behavior: 'smooth', block: 'center' })
  window.dispatchEvent(new CustomEvent('dashboard:navigate', { detail: { target } }))
}

let timer

onMounted(() => {
  formatTime()
  timer = setInterval(formatTime, 1000)
  loadCarouselCities()
})

onBeforeUnmount(() => {
  if (timer) {
    clearInterval(timer)
  }
  stopCarousel()
})
</script>

<style scoped>
.header-actions {
  display: flex;
  align-items: center;
  gap: 10px;
}

.carousel-btn {
  padding: 4px 10px;
  border-radius: 999px;
  border: 1px solid rgba(0, 255, 255, 0.4);
  background: rgba(0, 0, 0, 0.35);
  color: rgba(174, 232, 255, 0.92);
  font-size: 12px;
  cursor: pointer;
}

.screen-switch-btn {
  padding: 4px 10px;
  border-radius: 999px;
  border: 1px solid rgba(0, 255, 255, 0.5);
  background: rgba(0, 255, 255, 0.2);
  color: #dbfbff;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
  box-shadow: 0 0 10px rgba(0, 255, 255, 0.28);
}

.carousel-btn.active {
  background: rgba(0, 255, 255, 0.28);
  color: #012b3a;
  box-shadow: 0 0 10px rgba(0, 255, 255, 0.5);
}

.dashboard {
  grid-template-columns: minmax(280px, 18vw) 1fr minmax(280px, 18vw);
}

.city-weather-popup {
  position: absolute;
  top: 58px;
  left: 12px;
  width: min(330px, 30%);
  height: calc(100% - 70px);
  border-radius: 10px;
  border: 1px solid rgba(0, 255, 255, 0.35);
  background: radial-gradient(circle at top, rgba(0, 255, 255, 0.12), rgba(0, 0, 0, 0.9));
  box-shadow: 0 0 14px rgba(0, 255, 255, 0.18);
  backdrop-filter: blur(6px);
  z-index: 20;
  padding: 8px;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.city-air-analysis-popup {
  position: absolute;
  top: 58px;
  right: 12px;
  width: min(330px, 30%);
  height: calc(100% - 70px);
  border-radius: 10px;
  border: 1px solid rgba(0, 255, 255, 0.35);
  background: radial-gradient(circle at top, rgba(0, 255, 255, 0.12), rgba(0, 0, 0, 0.9));
  box-shadow: 0 0 14px rgba(0, 255, 255, 0.18);
  backdrop-filter: blur(6px);
  z-index: 19;
  padding: 8px;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.reserved-right {
  display: grid;
  grid-template-rows: 1fr 1fr;
  gap: 10px;
  min-height: 0;
}

.right-half {
  min-height: 0;
}

.right-empty {
  border: 1px dashed rgba(0, 255, 255, 0.16);
  border-radius: 8px;
  background: rgba(0, 0, 0, 0.08);
}

.city-popup-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
  color: #aee8ff;
  font-size: 13px;
  letter-spacing: 1px;
}

.city-weather-popup-close {
  padding: 1px 8px;
  font-size: 11px;
  border-radius: 999px;
  border: 1px solid rgba(0, 255, 255, 0.45);
  background: rgba(0, 0, 0, 0.35);
  color: rgba(174, 232, 255, 0.95);
  cursor: pointer;
}

.city-weather-popup :deep(.weather-header) {
  margin-bottom: 4px;
  font-size: 13px;
}

.city-weather-popup :deep(.weather-main) {
  margin-bottom: 4px;
  gap: 6px;
}

.city-weather-popup :deep(.weather-main .temp) {
  font-size: 28px;
}

.city-weather-popup :deep(.weather-main .unit),
.city-weather-popup :deep(.weather-main .status) {
  font-size: 13px;
}

.city-weather-popup :deep(.weather-extra) {
  margin-top: 2px;
  font-size: 13px;
  gap: 3px;
}

.city-weather-popup :deep(.weather-extra .item) {
  padding: 3px 5px;
}

.city-weather-popup :deep(.weather-history) {
  margin-top: 6px;
}

.city-weather-popup :deep(.weather-history-head) {
  margin-top: 6px;
}

.city-weather-popup :deep(.weather-history-title) {
  font-size: 13px;
}

.city-weather-popup :deep(.weather-history .history-head) {
  margin-bottom: 4px;
}

.city-weather-popup :deep(.weather-history .history-list) {
  min-height: 0 !important;
  max-height: 102px;
}

.city-weather-popup :deep(.weather-th-chart) {
  margin-top: -8px;
  height: 184px;
}

.city-weather-popup :deep(.history-item) {
  min-height: 26px;
  padding: 2px 0;
}

.city-weather-popup :deep(.badge),
.city-weather-popup :deep(.history-item-time),
.city-weather-popup :deep(.history-date) {
  font-size: 12px;
}
</style>