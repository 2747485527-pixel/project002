<template>
  <div class="rank-list">
    <div class="rank-head">
      <h3>{{ rankMode === 'province' ? '污染省份排行' : '污染城市排行' }}</h3>
      <div class="rank-tabs">
        <button class="rank-tab" :class="{ active: rankMode === 'city' }" @click="rankMode = 'city'">城市</button>
        <button class="rank-tab" :class="{ active: rankMode === 'province' }" @click="rankMode = 'province'">省份</button>
      </div>
    </div>
    <div v-if="error" class="rank-empty">
      <div class="rank-empty-title">数据加载失败</div>
      <div class="rank-empty-sub">{{ error }}</div>
    </div>
    <div v-else-if="loading" class="rank-empty">
      <div class="rank-empty-title">加载中…</div>
    </div>
    <div v-else-if="!list.length" class="rank-empty">
      <div class="rank-empty-title">暂无数据</div>
      <div class="rank-empty-sub">请确认后端服务与数据库已有最新数据。</div>
    </div>
    <ul v-else>
      <li v-for="item in list" :key="`${item.province || ''}-${item.name}`" class="rank-item" @click="pick(item)">
        <span class="rank-item-name">{{ displayName(item) }}</span>
        <span class="rank-item-value">{{ fmt(item.value) }}</span>
      </li>
    </ul>
  </div>
</template>

<script setup>
import { onMounted, ref, watch } from 'vue'
import { apiGet } from '../api'

const emit = defineEmits(['select-city'])

const list = ref([])
const rankMode = ref('city') // city | province
const loading = ref(false)
const error = ref('')
const fmt = (v) => (v == null ? '--' : Math.round(Number(v) * 10) / 10)

const displayName = (item) => {
  if (!item) return ''
  if (rankMode.value === 'province') return item.name || ''
  const p = (item.province || '').trim()
  const n = (item.name || '').trim()
  return p ? `${p} ${n}` : n
}

const pick = (item) => {
  const n = (item?.name || '').trim()
  if (!n) return
  emit('select-city', {
    name: n,
    province: (item?.province || '').trim(),
  })
}

async function load() {
  loading.value = true
  error.value = ''
  let rows = []
  try {
    rows = await apiGet('/api/rank', { metric: 'pm25', limit: 10, group: rankMode.value })
  } catch (e) {
    error.value = e?.message ? String(e.message) : '请求失败'
    list.value = []
    return
  } finally {
    loading.value = false
  }

  const arr = Array.isArray(rows) ? rows : []

  // 兼容后端未带 province 字段时：对前 10 条补齐省份
  if (rankMode.value === 'city') {
    const needFill = arr.some((x) => x && typeof x === 'object' && !('province' in x))
    if (needFill) {
      const enriched = await Promise.all(
        arr.map(async (x) => {
          if (!x || typeof x !== 'object') return x
          if ('province' in x) return x
          try {
            const r = await apiGet('/api/city/resolve', { name: x.name })
            if (r?.scope === 'city') return { ...x, province: r.province || '' }
            if (r?.scope === 'province') return { ...x, province: r.name || '' }
            return { ...x, province: '' }
          } catch {
            return { ...x, province: '' }
          }
        })
      )
      list.value = enriched
      return
    }
  }

  list.value = arr
}

onMounted(() => {
  load()
})

watch(
  () => rankMode.value,
  () => {
    load()
  }
)
</script>

<style scoped>
.rank-list {
  height: 100%;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.rank-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin: 0 0 8px;
}

.rank-head h3 {
  margin: 0;
  font-size: 16px;
  font-weight: 700;
  letter-spacing: 1px;
  color: #aee8ff;
}

.rank-tabs {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: 0 0 auto;
}

.rank-tab {
  padding: 2px 8px;
  font-size: 13px;
  border-radius: 12px;
  border: 1px solid rgba(0, 255, 255, 0.45);
  background: rgba(0, 0, 0, 0.35);
  color: rgba(174, 232, 255, 0.9);
  cursor: pointer;
  line-height: 1.2;
}

.rank-tab.active {
  background: rgba(0, 255, 255, 0.28);
  color: #012b3a;
  box-shadow: 0 0 8px rgba(0, 255, 255, 0.55);
}

.rank-list ul {
  list-style: none;
  padding: 0;
  margin: 0;
  min-height: 0;
}

.rank-empty {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  gap: 6px;
  padding: 10px 0;
  color: rgba(224, 247, 255, 0.92);
  text-align: center;
}

.rank-empty-title {
  font-size: 14px;
  color: #aee8ff;
  letter-spacing: 1px;
}

.rank-empty-sub {
  font-size: 12px;
  opacity: 0.78;
  max-width: 240px;
  line-height: 1.35;
}

.rank-item {
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 2px;
  line-height: 1.1;
  border-bottom: 1px dashed rgba(0, 255, 255, 0.16);
}

.rank-item:last-child {
  border-bottom: none;
}

.rank-item:hover {
  background: rgba(255, 255, 255, 0.06);
}

.rank-item-name {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: 14px;
  opacity: 0.92;
}

.rank-item-value {
  opacity: 0.9;
  flex: 0 0 auto;
  font-size: 14px;
  font-variant-numeric: tabular-nums;
  color: rgba(255, 255, 255, 0.9);
}
</style>
