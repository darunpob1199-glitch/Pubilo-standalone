<script setup lang="ts">
import { onMounted, computed } from 'vue'
import { adminFetch, useApiCall } from '../composables/useApi'

const { data, loading, execute } = useApiCall(() => adminFetch('/overview'))

onMounted(execute)

const overview = computed(() => data.value?.overview || {})
const revenueByDay = computed(() => overview.value.revenueByDay || [])
const recentUsers = computed(() => overview.value.recentUsers || [])
const planBreakdown = computed(() => overview.value.planBreakdown || [])

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
    day: 'numeric', month: 'short', year: '2-digit',
    hour: '2-digit', minute: '2-digit',
  })
}

function getInitial(name: string) {
  return (name || '?')[0].toUpperCase()
}

const planLabels: Record<string, string> = {
  test_1: 'ทดสอบ (1฿)',
  monthly_500: 'รายเดือน (500฿)',
  yearly_4499: 'รายปี (4,499฿)',
}
</script>

<template>
  <div class="page-container fade-in">
    <div class="page-header flex-between">
      <div>
        <h1>Overview</h1>
        <p>ภาพรวมยอดเงินและสมาชิก</p>
      </div>
      <button class="btn btn-ghost" @click="execute">↻ Refresh</button>
    </div>

    <div v-if="loading" class="loading-container">
      <div class="spinner"></div>
    </div>

    <template v-else>
      <!-- Revenue stats -->
      <div class="stat-grid">
        <div class="stat-card accent">
          <div class="stat-label">💰 รายได้ทั้งหมด</div>
          <div class="stat-value">฿{{ formatThb(overview.totalRevenue || 0) }}</div>
          <div class="stat-sub">เดือนนี้ ฿{{ formatThb(overview.monthRevenue || 0) }}</div>
        </div>

        <div class="stat-card">
          <div class="stat-label">📅 วันนี้</div>
          <div class="stat-value" style="color: var(--success)">฿{{ formatThb(overview.todayRevenue || 0) }}</div>
          <div class="stat-sub">revenue วันนี้</div>
        </div>

        <div class="stat-card">
          <div class="stat-label">👥 สมาชิก</div>
          <div class="stat-value" style="color: var(--info)">{{ overview.totalUsers || 0 }}</div>
          <div class="stat-sub">{{ overview.totalWorkspaces || 0 }} workspaces</div>
        </div>

        <div class="stat-card">
          <div class="stat-label">✅ Active Subs</div>
          <div class="stat-value" style="color: var(--success)">{{ overview.activeSubscriptions || 0 }}</div>
          <div class="stat-sub">{{ overview.pendingSubscriptions || 0 }} pending</div>
        </div>
      </div>

      <div class="grid-2">
        <!-- Revenue chart -->
        <div class="data-card">
          <div class="data-card-header">
            <h2>💹 Revenue 7 วันล่าสุด</h2>
          </div>
          <div class="data-card-body padded">
            <div v-if="revenueByDay.length === 0" class="empty-state">
              <div class="empty-icon">💹</div>
              <p>ยังไม่มี revenue ใน 7 วันล่าสุด</p>
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

        <!-- Plan breakdown -->
        <div class="data-card">
          <div class="data-card-header">
            <h2>📦 สัดส่วน Plan</h2>
          </div>
          <div class="data-card-body padded">
            <div v-if="planBreakdown.length === 0" class="empty-state">
              <div class="empty-icon">📦</div>
              <p>ยังไม่มี active subscriptions</p>
            </div>
            <div v-else>
              <div v-for="plan in planBreakdown" :key="plan.plan_code" style="margin-bottom: 16px">
                <div class="flex-between" style="margin-bottom: 6px">
                  <span style="font-weight: 600; font-size: 14px">{{ planLabels[plan.plan_code] || plan.plan_code }}</span>
                  <span style="font-weight: 700; color: var(--accent-light)">{{ plan.count }}</span>
                </div>
                <div style="height: 8px; background: var(--glass-bg); border-radius: 4px; overflow: hidden">
                  <div
                    style="height: 100%; background: var(--accent-gradient); border-radius: 4px; transition: width 0.5s ease"
                    :style="{ width: Math.max(4, (plan.count / (overview.activeSubscriptions || 1)) * 100) + '%' }"
                  ></div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Recent users -->
      <div class="data-card" style="margin-top: 24px">
        <div class="data-card-header">
          <h2>🆕 สมาชิกล่าสุด</h2>
        </div>
        <div class="data-card-body">
          <div v-if="recentUsers.length === 0" class="empty-state">
            <div class="empty-icon">👥</div>
            <p>ยังไม่มีสมาชิก</p>
          </div>
          <table v-else class="data-table">
            <thead>
              <tr>
                <th>สมาชิก</th>
                <th>สมัครเมื่อ</th>
                <th>เข้าล่าสุด</th>
              </tr>
            </thead>
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
                      <div class="sub">{{ user.email || '' }}</div>
                    </div>
                  </div>
                </td>
                <td>{{ formatDateTime(user.created_at) }}</td>
                <td>{{ formatDateTime(user.last_login_at) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </template>
  </div>
</template>
