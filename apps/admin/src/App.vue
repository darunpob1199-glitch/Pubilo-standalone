<script setup lang="ts">
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { clearAdminKey } from './composables/useApi'

const route = useRoute()
const router = useRouter()

const isLoginPage = computed(() => route.name === 'login')

const navItems = [
  { name: 'overview', label: 'Overview', icon: '📊' },
  { name: 'customers', label: 'Customers', icon: '👥' },
  { name: 'payments', label: 'Payments', icon: '💰' },
]

function logout() {
  clearAdminKey()
  router.push('/login')
}
</script>

<template>
  <div v-if="isLoginPage">
    <router-view />
  </div>

  <div v-else class="app-layout">
    <!-- Sidebar -->
    <aside class="sidebar">
      <div class="sidebar-logo">
        <div class="logo-icon">⚡</div>
        <div>
          <div class="logo-text">Pubilo</div>
        </div>
        <span class="logo-badge">Admin</span>
      </div>

      <nav class="sidebar-nav">
        <div class="nav-label">Dashboard</div>
        <router-link
          v-for="item in navItems"
          :key="item.name"
          :to="{ name: item.name }"
          class="nav-item"
          :class="{ active: route.name === item.name }"
        >
          <span class="nav-icon">{{ item.icon }}</span>
          {{ item.label }}
        </router-link>
      </nav>

      <div class="sidebar-footer">
        <button @click="logout">🚪 Logout</button>
      </div>
    </aside>

    <!-- Main -->
    <main class="main-content">
      <router-view />
    </main>
  </div>
</template>
