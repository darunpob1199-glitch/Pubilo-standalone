<script setup lang="ts">
import { onMounted, computed } from 'vue'
import { adminFetch, useApiCall } from '../composables/useApi'

const { data, loading, execute } = useApiCall(() => adminFetch('/overview'))

onMounted(execute)

const overview = computed(() => data.value?.overview || {})
const revenueByDay = computed(() => overview.value.revenueByDay || [])
const recentUsers = computed(() => overview.value.recentUsers || [])

const maxRevenue = computed(() => {
  const vals = revenueByDay.value.map((d: any) => d.total || 0)
  return Math.max(...vals, 1)
})

function formatThb(amount: number) {
  return new Intl.NumberFormat('th-TH').format(amount)
}

function formatDate(dateStr: string) {
  if (!dateStr) return '-'
  const d = new Date(dateStr)
  return d.toLocaleDateString('th-TH', { day: 'numeric', month: 'short' })
}

function formatDateTime(dateStr: string) {
  if (!dateStr) return '-'
  const d = new Date(dateStr)
  return d.toLocaleDateString('th-TH', {
    day: 'numeric',
    month: 'short',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function getInitial(name: string) {
  return (name || '?')[0].toUpperCase()
}
</script>

<template>
  <div class="page-container fade-in">
    <div class="page-header">
      <h1>Overview</h1>
      <p>ภาพรวมระบบ Pubilo ทั้งหมด</p>
    </div>

    <div v-if="loading" class="loading-container">
      <div class="spinner"></div>
    </div>

    <template v-else>
      <!-- Stat cards -->
      <div class="stat-grid">
        <div class="stat-card accent">
          <div class="stat-label">💰 Total Revenue</div>
          <div class="stat-value">฿{{ formatThb(overview.totalRevenue || 0) }}</div>
          <div class="stat-sub">วันนี้ ฿{{ formatThb(overview.todayRevenue || 0) }}</div>
        </div>

        <div class="stat-card success">
          <div class="stat-label">👥 Users</div>
          <div class="stat-value">{{ overview.totalUsers || 0 }}</div>
          <div class="stat-sub">{{ overview.totalWorkspaces || 0 }} workspaces</div>
        </div>

        <div class="stat-card">
          <div class="stat-label">✅ Active Subs</div>
          <div class="stat-value" style="color: var(--success)">{{ overview.activeSubscriptions || 0 }}</div>
          <div class="stat-sub">{{ overview.pendingSubscriptions || 0 }} pending</div>
        </div>

        <div class="stat-card">
          <div class="stat-label">📝 Posts</div>
          <div class="stat-value" style="color: var(--info)">{{ overview.postsToday || 0 }}</div>
          <div class="stat-sub">สัปดาห์นี้ {{ overview.postsThisWeek || 0 }}</div>
        </div>
      </div>

      <!-- Revenue chart + Recent users -->
      <div class="grid-2">
        <div class="data-card">
          <div class="data-card-header">
            <h2>💹 Revenue 7 วันล่าสุด</h2>
          </div>
          <div class="data-card-body padded">
            <div v-if="revenueByDay.length === 0" class="empty-state">
              <p>ยังไม่มีข้อมูล revenue</p>
            </div>
            <div v-else class="bar-chart">
              <div v-for="day in revenueByDay" :key="day.day" class="bar-item">
                <div class="bar-value">{{ formatThb(day.total) }}</div>
                <div
                  class="bar-fill"
                  :style="{ height: Math.max(4, (day.total / maxRevenue) * 100) + '%' }"
                ></div>
                <div class="bar-label">{{ formatDate(day.day) }}</div>
              </div>
            </div>
          </div>
        </div>

        <div class="data-card">
          <div class="data-card-header">
            <h2>🆕 สมาชิกล่าสุด</h2>
          </div>
          <div class="data-card-body">
            <div v-if="recentUsers.length === 0" class="empty-state">
              <p>ยังไม่มีสมาชิก</p>
            </div>
            <table v-else class="data-table">
              <tbody>
                <tr v-for="user in recentUsers" :key="user.id">
                  <td>
                    <div class="avatar-cell">
                      <div class="avatar">
                        <img v-if="user.avatar_url" :src="user.avatar_url" :alt="user.name" />
                        <span v-else>{{ getInitial(user.name) }}</span>
                      </div>
                      <div class="name-cell">
                        {{ user.name || 'Unknown' }}
                        <div class="sub">{{ formatDateTime(user.created_at) }}</div>
                      </div>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>
