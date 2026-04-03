<script setup lang="ts">
import { onMounted, computed } from 'vue'
import { adminFetch, useApiCall } from '../composables/useApi'

const { data, loading, execute } = useApiCall(() => adminFetch('/system'))

onMounted(execute)

const system = computed(() => data.value?.system || {})
const recentErrors = computed(() => system.value.recentErrors || [])
const queueStats = computed(() => system.value.queueStats24h || [])

function formatDateTime(dateStr: string) {
  if (!dateStr) return '-'
  const d = new Date(dateStr)
  return d.toLocaleDateString('th-TH', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function truncateText(text: string, max = 80) {
  if (!text) return '-'
  return text.length > max ? text.slice(0, max) + '...' : text
}

const healthScore = computed(() => {
  const total = system.value.autoSchedulePages || 0
  const active = system.value.activePagesWithToken || 0
  if (total === 0) return 100
  return Math.round((active / total) * 100)
})

const healthColor = computed(() => {
  if (healthScore.value >= 80) return 'var(--success)'
  if (healthScore.value >= 50) return 'var(--warning)'
  return 'var(--error)'
})
</script>

<template>
  <div class="page-container fade-in">
    <div class="page-header">
      <h1>System</h1>
      <p>สุขภาพระบบ, token status, และ queue monitoring</p>
    </div>

    <div v-if="loading" class="loading-container">
      <div class="spinner"></div>
    </div>

    <template v-else>
      <!-- System stats -->
      <div class="stat-grid">
        <div class="stat-card">
          <div class="stat-label">🏥 Health Score</div>
          <div class="stat-value" :style="{ color: healthColor }">{{ healthScore }}%</div>
          <div class="stat-sub">Pages with active tokens</div>
        </div>

        <div class="stat-card">
          <div class="stat-label">📄 Total Pages</div>
          <div class="stat-value" style="color: var(--info)">{{ system.totalPages || 0 }}</div>
          <div class="stat-sub">{{ system.autoSchedulePages || 0 }} auto-schedule</div>
        </div>

        <div class="stat-card">
          <div class="stat-label">🔑 Active Tokens</div>
          <div class="stat-value" style="color: var(--success)">{{ system.activePagesWithToken || 0 }}</div>
          <div class="stat-sub">จาก {{ system.autoSchedulePages || 0 }} auto-schedule pages</div>
        </div>

        <div class="stat-card">
          <div class="stat-label">⏳ Pending Items</div>
          <div class="stat-value" style="color: var(--warning)">
            {{ (system.pendingShares || 0) + (system.activeJobs || 0) }}
          </div>
          <div class="stat-sub">{{ system.pendingShares || 0 }} shares, {{ system.activeJobs || 0 }} jobs</div>
        </div>
      </div>

      <div class="grid-2">
        <!-- Queue stats 24h -->
        <div class="data-card">
          <div class="data-card-header">
            <h2>📦 Queue 24 ชั่วโมง</h2>
            <button class="btn btn-sm btn-ghost" @click="execute">↻</button>
          </div>
          <div class="data-card-body">
            <div v-if="!queueStats.length" class="empty-state">
              <div class="empty-icon">📦</div>
              <p>ไม่มี queue items ใน 24 ชั่วโมง</p>
            </div>
            <table v-else class="data-table">
              <thead>
                <tr>
                  <th>Status</th>
                  <th class="text-right">Count</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="q in queueStats" :key="q.status">
                  <td>
                    <span :class="`badge ${q.status === 'published' ? 'success' : q.status === 'pending' ? 'pending' : q.status === 'failed' ? 'failed' : 'info'}`">
                      <span class="badge-dot"></span>
                      {{ q.status }}
                    </span>
                  </td>
                  <td class="text-right" style="font-weight: 700; font-size: 18px">
                    {{ q.count }}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <!-- Recent errors -->
        <div class="data-card">
          <div class="data-card-header">
            <h2>🚨 Recent Errors</h2>
          </div>
          <div class="data-card-body">
            <div v-if="!recentErrors.length" class="empty-state">
              <div class="empty-icon">✅</div>
              <p>ไม่มี error ล่าสุด 🎉</p>
            </div>
            <table v-else class="data-table">
              <thead>
                <tr>
                  <th>Page</th>
                  <th>Error</th>
                  <th>Time</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(err, idx) in recentErrors" :key="idx">
                  <td class="mono">{{ err.page_id }}</td>
                  <td style="color: var(--error)">{{ truncateText(err.error_message, 50) }}</td>
                  <td style="white-space: nowrap">{{ formatDateTime(err.created_at) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>
