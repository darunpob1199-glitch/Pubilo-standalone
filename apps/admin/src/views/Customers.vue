<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { adminFetch, useApiCall } from '../composables/useApi'

const search = ref('')
const currentPage = ref(1)

const { data, loading, execute } = useApiCall(() =>
  adminFetch(`/customers?page=${currentPage.value}&limit=50&search=${encodeURIComponent(search.value)}`)
)

onMounted(execute)

function doSearch() {
  currentPage.value = 1
  execute()
}

function changePage(page: number) {
  currentPage.value = page
  execute()
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

function badgeClass(status: string) {
  return `badge ${status || 'pending'}`
}
</script>

<template>
  <div class="page-container fade-in">
    <div class="page-header">
      <h1>Customers</h1>
      <p>จัดการสมาชิกและ workspace ทั้งหมด</p>
    </div>

    <!-- Search -->
    <div class="mb-24 flex-between">
      <form @submit.prevent="doSearch" style="flex: 1; max-width: 400px">
        <input
          v-model="search"
          class="input"
          placeholder="🔍  ค้นหาชื่อหรืออีเมล..."
          @keyup.enter="doSearch"
        />
      </form>
      <button class="btn btn-ghost" @click="execute">↻ Refresh</button>
    </div>

    <div v-if="loading" class="loading-container">
      <div class="spinner"></div>
    </div>

    <template v-else-if="data">
      <div class="data-card">
        <div class="data-card-header">
          <h2>👥 สมาชิก ({{ data.pagination?.total || 0 }})</h2>
        </div>
        <div class="data-card-body">
          <div v-if="!data.customers?.length" class="empty-state">
            <div class="empty-icon">👥</div>
            <p>ไม่พบสมาชิก</p>
          </div>
          <table v-else class="data-table">
            <thead>
              <tr>
                <th>สมาชิก</th>
                <th>Workspace</th>
                <th>Subscription</th>
                <th>หมดอายุ</th>
                <th>เข้าล่าสุด</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="customer in data.customers" :key="customer.id">
                <td>
                  <div class="avatar-cell">
                    <div class="avatar">
                      <img v-if="customer.avatar_url" :src="customer.avatar_url" :alt="customer.name" />
                      <span v-else>{{ getInitial(customer.name) }}</span>
                    </div>
                    <div class="name-cell">
                      {{ customer.name || 'Unknown' }}
                      <div class="sub">{{ customer.email }}</div>
                    </div>
                  </div>
                </td>
                <td>
                  <span v-if="customer.workspace_name">{{ customer.workspace_name }}</span>
                  <span v-else style="color: var(--text-dim)">-</span>
                </td>
                <td>
                  <span v-if="customer.subscription_status" :class="badgeClass(customer.subscription_status)">
                    <span class="badge-dot"></span>
                    {{ customer.subscription_status }}
                  </span>
                  <span v-else style="color: var(--text-dim)">-</span>
                </td>
                <td>{{ formatDateTime(customer.current_period_end) }}</td>
                <td>{{ formatDateTime(customer.last_login_at) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- Pagination -->
      <div v-if="data.pagination?.totalPages > 1" style="display: flex; gap: 8px; justify-content: center; margin-top: 16px">
        <button
          v-for="p in data.pagination.totalPages"
          :key="p"
          class="btn btn-sm"
          :class="p === currentPage ? 'btn-primary' : 'btn-ghost'"
          @click="changePage(p)"
        >
          {{ p }}
        </button>
      </div>
    </template>
  </div>
</template>
