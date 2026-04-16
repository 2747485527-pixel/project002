function num(v, fallback = 0) {
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}

function avg(arr) {
  if (!arr.length) return 0
  return arr.reduce((s, x) => s + num(x), 0) / arr.length
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v))
}

export function formatOneDecimal(v) {
  return num(v).toFixed(1)
}

export function levelClassName(level) {
  if (['强', '高风险', '不适宜', '防暑'].includes(level)) return 'lv-high'
  if (['较强', '中风险', '一般', '偏凉'].includes(level)) return 'lv-mid'
  return 'lv-good'
}

function classifyScore(s) {
  if (s >= 74) return '优'
  if (s >= 58) return '良'
  return '一般'
}

const FEATURE_ROWS = [
  { name: '温度', value: 0.24 },
  { name: '湿度', value: 0.2 },
  { name: '日照', value: 0.17 },
  { name: '风速', value: 0.14 },
  { name: 'PM2.5', value: 0.13 },
  { name: '气压', value: 0.12 },
]

export function evaluateLifeMeteorologicalModel(pointsInput, trendMode = 'day') {
  const points = Array.isArray(pointsInput) ? pointsInput : []
  const points24 = points.slice(0, 24)
  const points168 = points.slice(0, 168)

  const baseTemp = avg(points24.map((p) => p?.temp_c))
  const baseHumidity = avg(points24.map((p) => p?.humidity))
  const baseWind = avg(points24.map((p) => p?.wind_speed))
  const baseRain = avg(points24.map((p) => p?.precip_mm))
  const basePm25 = clamp(28 + baseHumidity * 0.14 + baseWind * 0.8, 10, 120)
  const basePressure = avg(points24.map((p) => p?.pressure_hpa)) || 1013

  const tempValues = points24.map((p) => num(p?.temp_c, NaN)).filter((x) => Number.isFinite(x))
  const tempMin = tempValues.length ? Math.min(...tempValues) : 12
  const tempMax = tempValues.length ? Math.max(...tempValues) : 24
  const tempSwing = tempMax - tempMin

  const uvIndex = clamp((baseTemp - 5) * 0.33 + (100 - baseHumidity) * 0.07, 0, 15)
  const uvPercent = (uvIndex / 15) * 100
  let uvLevel = '强'
  if (uvIndex < 3) uvLevel = '弱'
  else if (uvIndex < 6) uvLevel = '较弱'
  else if (uvIndex < 9) uvLevel = '中等'
  else if (uvIndex < 12) uvLevel = '较强'

  const uvAdvice =
    uvIndex >= 9
      ? '外出请做好防晒，建议遮阳帽+防晒霜。'
      : uvIndex >= 6
        ? '中午时段减少暴晒，适当补水。'
        : '户外活动较舒适，注意基础防晒。'

  let dressLevel = '防暑'
  if (baseTemp < 8) dressLevel = '保暖'
  else if (baseTemp < 16) dressLevel = '偏凉'
  else if (baseTemp < 24) dressLevel = '舒适'
  else if (baseTemp < 30) dressLevel = '轻薄'

  const dressAdviceMap = {
    保暖: '建议羽绒/厚外套，注意颈部保暖。',
    偏凉: '建议外套+长裤，早晚加一层。',
    舒适: '建议薄外套或长袖，体感舒适。',
    轻薄: '建议短袖搭配防晒外套。',
    防暑: '建议速干轻薄衣物，避免午后暴晒。',
  }

  let washLevel = '适宜'
  if (baseRain >= 1.2 || baseHumidity >= 85) washLevel = '不适宜'
  else if (baseRain >= 0.5 || baseHumidity >= 75) washLevel = '一般'
  const washIcon = washLevel === '适宜' ? '☀️' : '🌧️'
  const washDesc = washLevel === '适宜' ? '未来降雨概率较低' : '湿度/降雨偏高，易返脏'
  const washAdvice = washLevel === '适宜' ? '建议上午洗车，清洁保持时间更长。' : '建议暂缓洗车，待天气稳定后进行。'

  const coldScore = clamp(tempSwing * 8 + baseHumidity * 0.3 + (18 - baseTemp) * 2, 0, 100)
  const coldRiskLevel = coldScore < 34 ? '低风险' : coldScore < 67 ? '中风险' : '高风险'
  const coldAdvice =
    coldRiskLevel === '高风险'
      ? '注意添衣和通风，外出建议佩戴口罩。'
      : coldRiskLevel === '中风险'
        ? '早晚注意保暖，避免冷热刺激。'
        : '保持规律作息，注意补水即可。'

  const source = trendMode === 'day' ? points24 : points168
  const slice = trendMode === 'day' ? source : source.filter((_, idx) => idx % 24 === 0).slice(0, 7)
  const labels = slice.map((p, idx) => (trendMode === 'day' ? p?.time || `${String(idx).padStart(2, '0')}:00` : `D${idx + 1}`))
  const trendLines = {
    labels,
    uv: slice.map((p) => clamp((num(p?.temp_c) - 5) * 0.33 + (100 - num(p?.humidity, 50)) * 0.07, 0, 15)),
    dress: slice.map((p) => clamp((num(p?.temp_c) - 5) * 4, 0, 100)),
    wash: slice.map((p) => clamp(100 - num(p?.precip_mm) * 30 - num(p?.humidity) * 0.5, 0, 100)),
    cold: slice.map((p) => clamp((16 - num(p?.temp_c)) * 4 + num(p?.humidity) * 0.35, 0, 100)),
  }

  const sport = clamp(100 - basePm25 * 0.7 - baseHumidity * 0.2 + baseWind * 2, 0, 100)
  const drying = clamp(100 - baseHumidity * 0.8 + baseTemp * 0.9, 0, 100)
  const traffic = clamp(100 - baseRain * 28 - baseWind * 2.5 - Math.abs(basePressure - 1012) * 1.3, 0, 100)
  const travelCards = [
    { icon: '🏃', name: '运动指数', level: classifyScore(sport), advice: sport >= 60 ? '适合慢跑或骑行，注意热身。' : '建议降低强度，优先室内运动。' },
    { icon: '👕', name: '晾晒指数', level: classifyScore(drying), advice: drying >= 60 ? '可正常晾晒，通风位置更快干。' : '建议延长晾晒时间或室内烘干。' },
    { icon: '🚗', name: '交通气象指数', level: classifyScore(traffic), advice: traffic >= 60 ? '路况气象条件较稳，正常通勤。' : '出行请减速慢行，注意能见度变化。' },
  ]

  const allergy = clamp(baseHumidity * 0.5 + basePm25 * 0.5, 0, 100)
  const ac = clamp((baseTemp - 23) * 8 + baseHumidity * 0.25, 0, 100)
  const sleep = clamp(100 - Math.abs(baseTemp - 22) * 8 - baseWind * 1.8, 0, 100)
  const healthCards = [
    { icon: '🤧', name: '过敏指数', level: allergy >= 67 ? '高风险' : allergy >= 40 ? '中风险' : '低风险', advice: allergy >= 67 ? '敏感人群外出建议佩戴口罩。' : '保持室内清洁，适度开窗通风。' },
    { icon: '❄️', name: '空调开启指数', level: classifyScore(ac), advice: ac >= 60 ? '建议间歇开启空调，温度保持26°C左右。' : '自然通风即可，体感较舒适。' },
    { icon: '🛌', name: '睡眠指数', level: classifyScore(sleep), advice: sleep >= 60 ? '睡眠环境适宜，可保持规律作息。' : '建议睡前调节温湿度，减少夜醒。' },
  ]

  return {
    uvIndex,
    uvPercent,
    uvLevel,
    uvAdvice,
    dressLevel,
    dressAdvice: dressAdviceMap[dressLevel],
    washLevel,
    washIcon,
    washDesc,
    washAdvice,
    coldRiskLevel,
    coldAdvice,
    tempSwing,
    tempMin,
    tempMax,
    tempRangeText: `${formatOneDecimal(tempMin)}°C ~ ${formatOneDecimal(tempMax)}°C`,
    trendLines,
    featureRows: FEATURE_ROWS,
    travelCards,
    healthCards,
  }
}
