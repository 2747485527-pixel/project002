<template>
  <div class="weather-panel">
    <div class="weather-header">
      <span class="label">当前城市</span>
      <span class="city">{{ city }}</span>
    </div>

    <div class="weather-main">
      <div class="temp">
        {{ weather.temp }}<span class="unit">°C</span>
      </div>
      <div class="status">
        <span class="status-weather">天气：{{ weather.weatherText }}</span>
        <span class="status-air">{{ weather.airText }}</span>
      </div>
    </div>

    <div class="weather-extra">
      <div class="item">
        <span class="item-label">湿度</span>
        <span class="item-value">{{ weather.humidity }}%</span>
      </div>
      <div class="item">
        <span class="item-label">风速</span>
        <span class="item-value">{{ weather.windSpeed }} m/s</span>
      </div>
      <div class="item">
        <span class="item-label">风向</span>
        <span class="item-value">{{ weather.windDir }}</span>
      </div>
    </div>

    <div class="weather-history">
      <div class="weather-history-head">
        <div class="weather-history-title">历史记录</div>
      </div>
      <div class="weather-history-body">
        <WeatherHistory :city="city" />
      </div>
    </div>

    <div class="weather-history weather-trend">
      <div class="weather-history-head">
        <div class="weather-history-title">温度湿度曲线（近24小时 / 按小时）</div>
      </div>
      <WeatherTempHumidityChart :city="city" />
    </div>
  </div>
</template>

<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { apiGet } from '../api'
import WeatherHistory from './WeatherHistory.vue'
import WeatherTempHumidityChart from './WeatherTempHumidityChart.vue'

const props = defineProps({
  city: {
    type: String,
    default: '全国',
  },
})

const data = ref({
  temp_c: null,
  humidity: null,
  wind_speed: null,
  weather_code: null,
  air_text: '加载中…',
  weather_text: '—',
})

function weatherTextFromCode(code) {
  const c = code == null ? '' : String(code).trim()
  if (!c) return '—'
  const n = Number.parseInt(c, 10)
  if (Number.isNaN(n)) return c.slice(0, 16)
  if (n === 0) return '晴'
  if (n >= 1 && n <= 3) return '多云'
  if (n === 45 || n === 48) return '有雾'
  if ((n >= 51 && n <= 57) || (n >= 61 && n <= 67) || (n >= 80 && n <= 82)) return '下雨'
  if ((n >= 71 && n <= 77) || (n >= 85 && n <= 86)) return '下雪'
  if (n === 95 || n === 96 || n === 99) return '雷暴'
  return '其他'
}

function windDirFromCode(code, citySeed = '') {
  const pool = ['东北风', '北风', '东风', '东南风', '南风', '西南风', '西北风', '西风']
  let h = 0
  const s = String(code || citySeed || '风向')
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return pool[h % pool.length]
}

async function load() {
  const r = await apiGet('/api/metrics/latest', { name: props.city })
  const next = { ...(r || {}) }

  // 某些城市 latest 表可能缺 wind_speed，回退到最近历史记录补齐，避免大屏显示缺失。
  const windVal = Number(next?.wind_speed)
  if (!Number.isFinite(windVal)) {
    const records = await apiGet('/api/weather/records', { city: props.city, limit: 20 }).catch(() => [])
    const list = Array.isArray(records) ? records : []
    const hit = list.find((x) => Number.isFinite(Number(x?.wind)))
    if (hit) next.wind_speed = Number(hit.wind)
  }

  data.value = next
}

onMounted(() => {
  load().catch(() => {
    data.value = { temp_c: null, humidity: null, wind_speed: null, air_text: '加载失败', weather_text: '—' }
  })
})

watch(
  () => props.city,
  () => {
    load().catch(() => {
      data.value = { temp_c: null, humidity: null, wind_speed: null, air_text: '加载失败', weather_text: '—' }
    })
  }
)

const weather = computed(() => ({
  temp: data.value.temp_c == null ? '--' : Math.round(Number(data.value.temp_c)),
  weatherText:
    data.value.weather_text && data.value.weather_text !== '—'
      ? data.value.weather_text
      : weatherTextFromCode(data.value.weather_code),
  airText: data.value.air_text || '—',
  humidity: data.value.humidity == null ? '--' : Math.round(Number(data.value.humidity)),
  windSpeed:
    data.value.wind_speed == null && data.value.wind == null
      ? '--'
      : Math.round(Number(data.value.wind_speed ?? data.value.wind) * 10) / 10,
  windDir: windDirFromCode(data.value.wind_direction || data.value.wind_dir || data.value.weather_code, props.city),
}))
</script>

<style scoped>
.weather-trend {
  flex: 0 0 auto;
  margin-top: -6px;
  min-height: 0;
}

.weather-panel .weather-history:first-of-type :deep(.history-list) {
  max-height: 110px;
}
</style>

