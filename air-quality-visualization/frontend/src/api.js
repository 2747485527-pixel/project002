const DEV_DEFAULT_BASE = 'http://localhost:3001'
const SAME_ORIGIN_BASE =
  typeof window !== 'undefined' && window.location && window.location.origin ? window.location.origin : DEV_DEFAULT_BASE

// 生产环境优先走同源（避免部署后还去请求 localhost 导致 Failed to fetch）
const DEFAULT_BASE = import.meta.env.PROD ? SAME_ORIGIN_BASE : DEV_DEFAULT_BASE
const FALLBACK_BASES = [SAME_ORIGIN_BASE, 'http://localhost:3001', 'http://localhost:3002']

function buildUrl(base, path, params) {
  const u = new URL(path, base)
  if (params && typeof params === 'object') {
    for (const [k, v] of Object.entries(params)) {
      if (v == null || v === '') continue
      u.searchParams.set(k, String(v))
    }
  }
  return u.toString()
}

export async function apiGet(path, params) {
  const envBase = import.meta.env.VITE_API_BASE || DEFAULT_BASE
  const bases = Array.from(new Set([envBase, ...FALLBACK_BASES]))

  let lastError = null
  for (const base of bases) {
    const url = buildUrl(base, path, params)
    try {
      const res = await fetch(url, { cache: 'no-store' })
      const json = await res.json().catch(() => null)
      if (!res.ok || !json || json.ok === false) {
        const msg = json?.error || `请求失败：${res.status}`
        // 404 且后端返回明确错误（如缺少某模型产物）时不再换端口重试，避免误用其它服务上的旧数据
        if (res.status === 404 && json?.error) {
          throw new Error(msg)
        }
        lastError = new Error(msg)
        console.error('[apiGet] failed', { url, status: res.status, msg })
        continue
      }
      return json.data
    } catch (e) {
      lastError = e
      console.error('[apiGet] network failed', { url, msg: e?.message || String(e) })
    }
  }

  throw new Error(
    lastError?.message ||
      '后端接口不可达：请确认后端服务已启动（backend: npm run server），且端口 3001/3002 可访问。'
  )
}

export async function apiPost(path, body, params) {
  const envBase = import.meta.env.VITE_API_BASE || DEFAULT_BASE
  const bases = Array.from(new Set([envBase, ...FALLBACK_BASES]))

  let lastError = null
  for (const base of bases) {
    const url = buildUrl(base, path, params)
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: body == null ? '{}' : JSON.stringify(body),
        cache: 'no-store',
      })
      const json = await res.json().catch(() => null)
      if (!res.ok || !json || json.ok === false) {
        const msg = json?.error || `请求失败：${res.status}`
        if (res.status === 404 && json?.error) {
          throw new Error(msg)
        }
        lastError = new Error(msg)
        console.error('[apiPost] failed', { url, status: res.status, msg })
        continue
      }
      return json.data
    } catch (e) {
      lastError = e
      console.error('[apiPost] network failed', { url, msg: e?.message || String(e) })
    }
  }

  throw new Error(
    lastError?.message ||
      '后端接口不可达：请确认后端服务已启动（backend: npm run server），且端口 3001/3002 可访问。'
  )
}

