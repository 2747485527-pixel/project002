<template>
  <Dashboard v-if="screenMode === 'professional'" @switch-screen="screenMode = 'public'" />
  <PublicDisplayScreen v-else @switch-screen="screenMode = 'professional'" />
</template>

<script setup>
import { ref } from 'vue'
import Dashboard from './views/Dashboard.vue'
import PublicDisplayScreen from './views/PublicDisplayScreen.vue'

const screenMode = ref('professional')
</script>
