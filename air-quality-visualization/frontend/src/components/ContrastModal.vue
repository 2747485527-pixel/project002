<template>
  <div class="modal-mask" @click.self="emit('close')">
    <div class="modal">
      <div class="modal-head">
        <div class="modal-title">
          <div class="modal-title-main">{{ city || '—' }}</div>
          <div class="modal-title-sub">{{ province || '' }}</div>
        </div>

        <div class="modal-actions">
          <button class="modal-btn" type="button" @click="emit('pick-city', city)">定位到该城市</button>
          <button class="modal-btn ghost" type="button" @click="emit('close')">关闭</button>
        </div>
      </div>

      <div class="modal-body">
        <div v-if="error" class="modal-empty">
          <div class="modal-empty-title">加载失败</div>
          <div class="modal-empty-sub">{{ error }}</div>
        </div>
        <div v-else-if="loading" class="modal-empty">
          <div class="modal-empty-title">加载中…</div>
        </div>

        <template v-else>
          <div class="summary">
            <div class="summary-item">
              <div class="summary-label">窗口</div>
              <div class="summary-value">{{ windowMin }} 分钟</div>
            </div>
            <div class="summary-item">
              <div class="summary-label">当前均值</div>
              <div class="summary-value">{{ fmt(detail?.summary?.now) }}</div>
            </div>
            <div class="summary-item">
              <div class="summary-label">对比均值</div>
              <div class="summary-value">{{ fmt(detail?.summary?.prev) }}</div>
            </div>
            <div class="summary-item">
              <div class="summary-label">变化</div>
              <div class="summary-value" :class="deltaClass(detail?.summary?.delta)">{{ deltaText(detail?.summary?.delta) }}</div>
            </div>
          </div>

          <div class="placeholder">
            <div class="placeholder-title">差异分析</div>
            <div class="placeholder-sub">
              {{ detail?.analysis_placeholder || '分析模型待接入：后续在此输出更具体的差异成因与建议。' }}
            </div>
          </div>

          <div class="series">
            <div class="series-title">短期序列（近 {{ windowMin * 2 }} 分钟）</div>
            <div class="series-list">
              <div v-for="(r, idx) in tailSeries" :key="idx" class="series-row">
                <div class="series-ts">{{ toTime(r.ts) }}</div>
                <div class="series-metrics">
                  <span class="chip" v-if="r.pm25 != null">PM2.5 {{ r.pm25 }}</span>
                  <span class="chip" v-if="r.temp_c != null">温度 {{ r.temp_c }}°C</span>
                  <span class="chip" v-if="r.humidity != null">湿度 {{ r.humidity }}%</span>
                </div>
              </div>
              <div v-if="!tailSeries.length" class="series-row muted">暂无序列数据</div>
            </div>
          </div>
        </template>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { apiGet } from '../api'

const props = defineProps({
  city: { type: String, default: '' },
  province: { type: String, default: '' },
  kind: { type: String, default: 'air' }, // air | weather
  windowMin: { type: Number, default: 30 },
})

const emit = defineEmits(['close', 'pick-city'])

const loading = ref(false)
const error = ref('')
const detail = ref(null)

const fmt = (v) => (v == null ? '--' : Math.round(Number(v) * 10) / 10)

const deltaClass = (d) => {
  const n = Number(d)
  if (!Number.isFinite(n)) return 'muted'
  if (n > 0) return 'up'
  if (n < 0) return 'down'
  return 'muted'
}

const deltaText = (d) => {
  const n = Number(d)
  if (!Number.isFinite(n)) return '--'
  const sign = n > 0 ? '+' : ''
  return `${sign}${Math.round(n * 10) / 10}`
}

const toTime = (ts) => {
  if (!ts) return '—'
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return String(ts).slice(11, 19) || '—'
  const pad2 = (n) => String(n).padStart(2, '0')
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`
}

const tailSeries = computed(() => {
  const arr = Array.isArray(detail.value?.series) ? detail.value.series : []
  return arr.slice(Math.max(0, arr.length - 18))
})

async function load() {
  const c = (props.city || '').trim()
  if (!c) return
  loading.value = true
  error.value = ''
  try {
    detail.value = await apiGet('/api/contrast/detail', { city: c, kind: props.kind, windowMin: props.windowMin })
  } catch (e) {
    detail.value = null
    error.value = e?.message ? String(e.message) : '请求失败'
  } finally {
    loading.value = false
  }
}

watch(
  () => [props.city, props.kind, props.windowMin],
  () => load(),
  { immediate: true }
)

onMounted(() => load())
</script>

<style scoped>
.modal-mask {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.55);
  z-index: 1000;
  display: flex;
  justify-content: center;
  align-items: center;
  padding: 16px;
}

.modal {
  width: min(860px, 96vw);
  max-height: min(680px, 92vh);
  background: radial-gradient(circle at top, rgba(0, 255, 255, 0.10), rgba(0, 0, 0, 0.88));
  border: 1px solid rgba(0, 255, 255, 0.35);
  border-radius: 10px;
  box-shadow: 0 0 18px rgba(0, 255, 255, 0.18);
  backdrop-filter: blur(8px);
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.modal-head {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 14px;
  border-bottom: 1px solid rgba(0, 255, 255, 0.22);
}

.modal-title-main {
  font-size: 16px;
  font-weight: 800;
  color: #aee8ff;
  letter-spacing: 1px;
}

.modal-title-sub {
  font-size: 12px;
  opacity: 0.75;
  margin-top: 2px;
}

.modal-actions {
  display: flex;
  gap: 8px;
  align-items: center;
  flex: 0 0 auto;
}

.modal-btn {
  padding: 4px 10px;
  font-size: 12px;
  border-radius: 999px;
  border: 1px solid rgba(0, 255, 255, 0.45);
  background: rgba(0, 255, 255, 0.18);
  color: #012b3a;
  cursor: pointer;
}

.modal-btn.ghost {
  background: rgba(0, 0, 0, 0.25);
  color: rgba(174, 232, 255, 0.92);
}

.modal-body {
  padding: 12px 14px;
  overflow: auto;
  min-height: 0;
}

.modal-empty {
  padding: 24px 0;
  text-align: center;
}

.modal-empty-title {
  font-size: 14px;
  color: #aee8ff;
  letter-spacing: 1px;
}

.modal-empty-sub {
  font-size: 12px;
  opacity: 0.78;
  margin-top: 6px;
}

.summary {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
}

.summary-item {
  background: rgba(0, 0, 0, 0.28);
  border: 1px solid rgba(0, 255, 255, 0.18);
  border-radius: 8px;
  padding: 10px;
}

.summary-label {
  font-size: 12px;
  opacity: 0.7;
}

.summary-value {
  margin-top: 6px;
  font-size: 16px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

.summary-value.up {
  color: rgba(255, 186, 184, 0.95);
}

.summary-value.down {
  color: rgba(200, 255, 200, 0.95);
}

.summary-value.muted {
  opacity: 0.8;
}

.placeholder {
  margin-top: 12px;
  padding: 10px;
  border-radius: 8px;
  border: 1px dashed rgba(0, 255, 255, 0.25);
  background: rgba(0, 0, 0, 0.18);
}

.placeholder-title {
  font-size: 13px;
  color: #aee8ff;
  letter-spacing: 1px;
}

.placeholder-sub {
  margin-top: 6px;
  font-size: 12px;
  opacity: 0.78;
  line-height: 1.45;
}

.series {
  margin-top: 12px;
}

.series-title {
  font-size: 13px;
  color: #aee8ff;
  letter-spacing: 1px;
  margin-bottom: 6px;
}

.series-list {
  border: 1px solid rgba(0, 255, 255, 0.16);
  border-radius: 8px;
  overflow: hidden;
}

.series-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border-bottom: 1px dashed rgba(0, 255, 255, 0.12);
}

.series-row:last-child {
  border-bottom: none;
}

.series-row.muted {
  opacity: 0.75;
  justify-content: center;
}

.series-ts {
  font-size: 12px;
  opacity: 0.75;
  width: 70px;
  flex: 0 0 auto;
}

.series-metrics {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.chip {
  font-size: 12px;
  padding: 2px 6px;
  border-radius: 999px;
  background: rgba(0, 0, 0, 0.35);
  border: 1px solid rgba(0, 255, 255, 0.18);
}
</style>

