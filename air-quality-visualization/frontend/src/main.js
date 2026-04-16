import { createApp } from 'vue'
import App from './App.vue'
import './assets/style.css'
import './assets/extra.css'
import './assets/extra.css'

console.log('main.js 已加载')

try {
  createApp(App).mount('#app')
  console.log('Vue 挂载成功')
} catch (e) {
  console.error('Vue 挂载出错', e)
  alert('Vue 挂载出错：' + e)
}