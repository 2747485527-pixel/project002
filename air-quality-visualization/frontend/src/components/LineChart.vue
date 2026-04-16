<template>
  <div ref="chart" style="height: 300px"></div>
</template>

<script setup>
import * as echarts from 'echarts'
import { onMounted, ref, onBeforeUnmount, watch } from 'vue'

const props = defineProps({
  city: {
    type: String,
    default: '全国',
  },
})

const chart = ref(null)
let instance = null

// 每个城市的示例数据，可后续替换为真实接口数据
const seriesByCity = {
  全国: [80, 90, 70, 100, 60],
  北京: [110, 120, 115, 130, 125],
  上海: [70, 75, 80, 82, 78],
  广州: [60, 65, 70, 68, 72],
}

const getSeriesData = (city) => {
  return seriesByCity[city] || seriesByCity['全国']
}

const updateChart = () => {
  if (!instance) return

  const data = getSeriesData(props.city)

  const option = {
    title: {
      text: `${props.city} PM2.5 趋势`,
      textStyle: { color: '#fff', fontSize: 14 },
      left: 'center',
    },
    xAxis: {
      type: 'category',
      data: ['1', '2', '3', '4', '5'],
      axisLabel: { color: '#fff' },
      boundaryGap: false,
    },
    yAxis: {
      type: 'value',
      axisLabel: { color: '#fff' },
      splitLine: {
        lineStyle: { color: 'rgba(255,255,255,0.1)' },
      },
    },
    tooltip: {
      trigger: 'axis',
    },
    series: [
      {
        data,
        type: 'line',
        smooth: true,
        areaStyle: {
          color: 'rgba(33, 150, 243, 0.3)',
        },
        lineStyle: {
          color: '#21a1f3',
        },
        symbol: 'circle',
        symbolSize: 6,
        itemStyle: {
          color: '#ffeb3b',
        },
      },
    ],
  }

  instance.setOption(option, true)
}

onMounted(() => {
  if (!chart.value) return
  instance = echarts.init(chart.value)
  updateChart()
})

watch(
  () => props.city,
  () => {
    updateChart()
  }
)

onBeforeUnmount(() => {
  if (instance) {
    instance.dispose()
  }
})
</script>
