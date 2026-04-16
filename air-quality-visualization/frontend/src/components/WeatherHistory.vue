<template>
  <div class="history">
    <div class="history-head">
      <div class="history-controls">
        <input class="history-date" type="date" v-model="dateStr" />
      </div>
    </div>

    <div class="history-list">
      <div v-for="item in displayRecords" :key="item.id" class="history-item">
        <div class="history-item-time">{{ item.time }}</div>
        <div class="history-item-main">
          <span class="badge temp">{{ item.temp }}°C</span>
          <span class="badge hum">{{ item.humidity }}%</span>
          <span class="badge text">{{ item.weather_text || '—' }}</span>
          <span class="badge text">{{ item.air_text || '—' }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { apiGet } from '../api'

const props = defineProps({
  city: {
    type: String,
    default: '全国',
  },
})
const emit = defineEmits(['data-state'])

const pad2 = (n) => String(n).padStart(2, '0')
const formatYMD = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`

const todayStr = () => formatYMD(new Date())
const dateStr = ref(todayStr())

const records = ref([])

const effectiveCity = computed(() => {
  const c = (props.city || '').trim()
  if (!c || c === '全国') return ''
  return c
})

function parseRowTsMs(row) {
  const raw = row?.ts || row?.id || ''
  if (!raw) return NaN
  const txt = String(raw)
  const normalized = txt.includes('T') ? txt : txt.replace(' ', 'T')
  const ms = Date.parse(normalized)
  return Number.isFinite(ms) ? ms : NaN
}

const displayRecords = computed(() => {
  // 仅展示 3 条，且相邻记录至少间隔 10 分钟
  if (!effectiveCity.value) {
    return Array.from({ length: 3 }).map((_, i) => ({
      id: `placeholder-city-${i}`,
      time: '—',
      temp: '--',
      humidity: '--',
      weather_text: '—',
      air_text: i === 0 ? '请选择城市' : '—',
    }))
  }

  const base = Array.isArray(records.value) ? records.value : []
  const picked = []
  let lastPickedTs = null
  for (const row of base) {
    if (picked.length >= 3) break
    const curTs = parseRowTsMs(row)
    if (!Number.isFinite(curTs)) continue
    if (lastPickedTs == null || Math.abs(lastPickedTs - curTs) >= 10 * 60 * 1000) {
      picked.push(row)
      lastPickedTs = curTs
    }
  }

  if (picked.length >= 3) return picked
  const need = 3 - picked.length
  const pads = Array.from({ length: need }).map((_, i) => ({
    id: `placeholder-${i}`,
    time: '—',
    temp: '--',
    humidity: '--',
    weather_text: '—',
    air_text: '暂无数据',
  }))
  return picked.concat(pads)
})

const hasRealRecords = computed(() => {
  const base = Array.isArray(records.value) ? records.value : []
  return base.length > 0
})

async function load() {
  if (!effectiveCity.value) {
    records.value = []
    return
  }
  const r = await apiGet('/api/weather/records', { city: effectiveCity.value, date: dateStr.value, limit: 120 })
  records.value = Array.isArray(r) ? r : []
}

let timer = null

const startLive = () => {
  stopLive()
  timer = setInterval(() => {
    load().catch(() => {})
  }, 300_000)
}

const stopLive = () => {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
}

watch(
  () => [effectiveCity.value, dateStr.value],
  () => {
    load()
      .then(() => startLive())
      .catch(() => {})
  },
  { immediate: true }
)

watch(
  () => hasRealRecords.value,
  (v) => emit('data-state', v),
  { immediate: true }
)

onMounted(() => {
  load()
    .then(() => startLive())
    .catch(() => {})
})

onBeforeUnmount(() => {
  stopLive()
})
</script>

