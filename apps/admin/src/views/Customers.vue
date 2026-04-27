<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { adminFetch, useApiCall } from '../composables/useApi'

const search = ref('')
const currentPage = ref(1)
const plans = ref<any[]>([])

// Grant plan dialog state
const grantDialog = ref(false)
const grantTarget = ref<any>(null)
const grantPlanCode = ref('')
const grantLoading = ref(false)
const grantResult = ref<string | null>(null)

const { data, loading, execute } = useApiCall(() =>
  adminFetch(`/customers?page=${currentPage.value}&limit=50&search=${encodeURIComponent(search.value)}`)
)

onMounted(async () => {
  execute()
  // Load available plans
  try {
    const res = await adminFetch('/plans')
    plans.value = res.plans || []
  } catch {}
})

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
    day: 'numeric', month: 'short', year: '2-digit',
    hour: '2-digit', minute: '2-digit',
  })
}

function getInitial(name: string) {
  return (name || '?')[0].toUpperCase()
}

function badgeClass(status: string) {
  return `badge ${status || 'pending'}`
}

// Open grant plan dialog
function openGrantDialog(customer: any) {
  grantTarget.value = customer
  grantPlanCode.value = plans.value.length > 0 ? plans.value[1]?.code || plans.value[0]?.code : ''
  grantResult.value = null
  grantDialog.value = true
}

function closeGrantDialog() {
  grantDialog.value = false
  grantTarget.value = null
  grantResult.value = null
}

async function doGrantPlan() {
  if (!grantTarget.value?.workspace_id || !grantPlanCode.value) return
  grantLoading.value = true
  grantResult.value = null
  try {
    const res = await adminFetch('/grant-plan', {
      method: 'POST',
      body: JSON.stringify({
        workspaceId: grantTarget.value.workspace_id,
        planCode: grantPlanCode.value,
      }),
    })
    grantResult.value = `✅ ${res.message}`
    // Refresh customer list after granting
    setTimeout(() => {
      closeGrantDialog()
      execute()
    }, 1500)
  } catch (e: any) {
    grantResult.value = `❌ Error: ${e.message}`
  } finally {
    grantLoading.value = false
  }
}

const planLabels: Record<string, string> = {
  test_1: 'ทดสอบ (1฿)',
  monthly_500: 'รายเดือน (500฿)',
  yearly_4499: 'รายปี (4,499฿)',
}
</script>

<template>
  <div class="page-container fade-in">
    <div class="page-header">
      <h1>Customers</h1>
      <p>จัดการสมาชิก กำหนด plan และดูสถานะ subscription</p>
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
                <th>Plan</th>
                <th>Status</th>
                <th>หมดอายุ</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="customer in data.customers" :key="customer.id + (customer.workspace_id || '')">
                <td>
                  <div class="avatar-cell">
                    <div class="avatar">
                      <img v-if="customer.avatar_url" :src="customer.avatar_url" :alt="customer.name" />
                      <span v-else>{{ getInitial(customer.name) }}</span>
                    </div>
                    <div class="name-cell">
                      {{ customer.name || 'Unknown' }}
                      <div class="sub">{{ customer.email || '' }}</div>
                    </div>
                  </div>
                </td>
                <td>
                  <span v-if="customer.workspace_name" style="font-weight: 500">{{ customer.workspace_name }}</span>
                  <span v-else style="color: var(--text-dim)">ไม่มี workspace</span>
                </td>
                <td>
                  <span v-if="customer.plan_code && customer.subscription_status" class="badge info">
                    {{ planLabels[customer.plan_code] || customer.plan_code }}
                  </span>
                  <span v-else style="color: var(--text-dim); font-size: 13px">ไม่มี plan</span>
                </td>
                <td>
                  <template v-if="customer.subscription_status">
                    <span :class="badgeClass(customer.subscription_status)">
                      <span class="badge-dot"></span>
                      {{ customer.subscription_status }}
                    </span>
                  </template>
                  <span v-else style="color: var(--text-dim)">-</span>
                </td>
                <td>
                  <span
                    v-if="customer.current_period_end && customer.subscription_status"
                    style="color: var(--text-secondary)"
                  >
                    {{ formatDateTime(customer.current_period_end) }}
                  </span>
                  <span v-else style="color: var(--text-dim)">-</span>
                </td>
                <td>
                  <button
                    v-if="customer.workspace_id"
                    class="btn btn-sm btn-primary"
                    @click="openGrantDialog(customer)"
                  >
                    🎁 กำหนด Plan
                  </button>
                </td>
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

    <!-- Grant plan dialog -->
    <div v-if="grantDialog" class="dialog-overlay" @click.self="closeGrantDialog">
      <div class="dialog-box">
        <h3>🎁 กำหนด Plan</h3>
        <p>
          Workspace: <strong>{{ grantTarget?.workspace_name }}</strong><br />
          สมาชิก: <strong>{{ grantTarget?.name }}</strong>
        </p>

        <div style="margin-bottom: 20px; text-align: left">
          <label style="display: block; font-size: 12px; font-weight: 600; color: var(--text-secondary); margin-bottom: 8px; text-transform: uppercase; letter-spacing: 0.5px">
            เลือก Plan
          </label>
          <select v-model="grantPlanCode" class="input" style="cursor: pointer">
            <option v-for="plan in plans" :key="plan.code" :value="plan.code">
              {{ plan.label }} — ฿{{ plan.amountThb.toLocaleString() }} ({{ plan.durationDays }} วัน)
            </option>
          </select>
        </div>

        <div v-if="grantResult" :style="{ color: grantResult.startsWith('✅') ? 'var(--success)' : 'var(--error)', fontSize: '14px', marginBottom: '16px', fontWeight: 600 }">
          {{ grantResult }}
        </div>

        <div class="dialog-actions">
          <button class="btn btn-ghost" @click="closeGrantDialog">ยกเลิก</button>
          <button class="btn btn-primary" :disabled="grantLoading || !grantPlanCode" @click="doGrantPlan">
            {{ grantLoading ? 'กำลังดำเนินการ...' : '✓ ยืนยันให้ Plan' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
