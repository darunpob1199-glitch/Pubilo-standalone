<script setup lang="ts">
import { onMounted, computed } from 'vue'
import { adminFetch, useApiCall } from '../composables/useApi'

const { data, loading, execute } = useApiCall(() => adminFetch('/activity'))

onMounted(execute)

const recentPosts = computed(() => data.value?.recentPosts || [])
const queueStatus = computed(() => data.value?.queueStatus || [])
const recentLogs = computed(() => data.value?.recentLogs || [])

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

function truncateText(text: string, max = 60) {
  if (!text) return '-'
  return text.length > max ? text.slice(0, max) + '...' : text
}

function badgeClass(status: string) {
  const map: Record<string, string> = {
    success: 'success', published: 'published',
    error: 'error', failed: 'failed',
    pending: 'pending', processing: 'processing',
  }
  return `badge ${map[status] || 'info'}`
}
</script>

<template>
  <div class="page-container fade-in">
    <div class="page-header">
      <h1>Activity</h1>
      <p>ดู publish history, scheduled queue, และ auto-post logs</p>
    </div>

    <div v-if="loading" class="loading-container">
      <div class="spinner"></div>
    </div>

    <template v-else>
      <!-- Queue status summary -->
      <div class="stat-grid mb-32">
        <div v-for="q in queueStatus" :key="q.status" class="stat-card">
          <div class="stat-label">📦 Queue: {{ q.status }}</div>
          <div class="stat-value" :style="{ color: q.status === 'pending' ? 'var(--warning)' : q.status === 'published' ? 'var(--success)' : 'var(--text-primary)' }">
            {{ q.count }}
          </div>
        </div>
      </div>

      <div class="grid-2">
        <!-- Recent published posts -->
        <div class="data-card">
          <div class="data-card-header">
            <h2>📝 Published Posts ล่าสุด</h2>
            <button class="btn btn-sm btn-ghost" @click="execute">↻</button>
          </div>
          <div class="data-card-body">
            <div v-if="!recentPosts.length" class="empty-state">
              <div class="empty-icon">📝</div>
              <p>ยังไม่มี published posts</p>
            </div>
            <table v-else class="data-table">
              <thead>
                <tr>
                  <th>Page</th>
                  <th>Content</th>
                  <th>Time</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="post in recentPosts.slice(0, 20)" :key="post.id">
                  <td>
                    <div class="name-cell">
                      {{ post.page_name || post.page_id }}
                      <div class="sub">{{ post.post_type || post.source }}</div>
                    </div>
                  </td>
                  <td>
                    <span v-if="post.facebook_url">
                      <a :href="post.facebook_url" target="_blank" rel="noopener">
                        {{ truncateText(post.message_text) }}
                      </a>
                    </span>
                    <span v-else>{{ truncateText(post.message_text) }}</span>
                  </td>
                  <td style="white-space: nowrap">{{ formatDateTime(post.published_at) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <!-- Auto-post logs -->
        <div class="data-card">
          <div class="data-card-header">
            <h2>🤖 Auto-Post Logs</h2>
          </div>
          <div class="data-card-body">
            <div v-if="!recentLogs.length" class="empty-state">
              <div class="empty-icon">🤖</div>
              <p>ยังไม่มี auto-post logs</p>
            </div>
            <table v-else class="data-table">
              <thead>
                <tr>
                  <th>Page</th>
                  <th>Status</th>
                  <th>Time</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="log in recentLogs" :key="log.id">
                  <td>
                    <div class="name-cell">
                      {{ log.page_id }}
                      <div v-if="log.error_message" class="sub" style="color: var(--error)">
                        {{ truncateText(log.error_message, 40) }}
                      </div>
                    </div>
                  </td>
                  <td>
                    <span :class="badgeClass(log.status)">
                      <span class="badge-dot"></span>
                      {{ log.status }}
                    </span>
                  </td>
                  <td style="white-space: nowrap">{{ formatDateTime(log.created_at) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>
