<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { adminFetch, useApiCall } from '../composables/useApi'

const statusFilter = ref('')
const currentPage = ref(1)
const confirmingId = ref<string | null>(null)
const confirmLoading = ref(false)

const { data, loading, execute } = useApiCall(() =>
  adminFetch(`/payments?page=${currentPage.value}&limit=50&status=${statusFilter.value}`)
)

onMounted(execute)

function filterByStatus(status: string) {
  statusFilter.value = status
  currentPage.value = 1
  execute()
}

function changePage(page: number) {
  currentPage.value = page
  execute()
}

function formatThb(amount: number) {
  return new Intl.NumberFormat('th-TH').format(amount)
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

function badgeClass(status: string) {
  return `badge ${status || 'pending'}`
}

function showConfirm(orderId: string) {
  confirmingId.value = orderId
}

function cancelConfirm() {
  confirmingId.value = null
}

async function doConfirm() {
  if (!confirmingId.value) return
  confirmLoading.value = true
  try {
    await adminFetch('/confirm-payment', {
      method: 'POST',
      body: JSON.stringify({ orderId: confirmingId.value }),
    })
    confirmingId.value = null
    await execute()
  } catch (e: any) {
    alert('Error: ' + e.message)
  } finally {
    confirmLoading.value = false
  }
}

const statusOptions = [
  { label: 'ทั้งหมด', value: '' },
  { label: 'Pending', value: 'pending' },
  { label: 'Paid', value: 'paid' },
  { label: 'Expired', value: 'expired' },
  { label: 'Cancelled', value: 'cancelled' },
]
</script>

<template>
  <div class="page-container fade-in">
    <div class="page-header">
      <h1>Payments</h1>
      <p>จัดการ payment orders และ confirm การชำระเงิน</p>
    </div>

    <!-- Filters -->
    <div class="mb-24 flex-between">
      <div style="display: flex; gap: 8px">
        <button
          v-for="opt in statusOptions"
          :key="opt.value"
          class="btn btn-sm"
          :class="statusFilter === opt.value ? 'btn-primary' : 'btn-ghost'"
          @click="filterByStatus(opt.value)"
        >
          {{ opt.label }}
        </button>
      </div>
      <button class="btn btn-ghost" @click="execute">↻ Refresh</button>
    </div>

    <div v-if="loading" class="loading-container">
      <div class="spinner"></div>
    </div>

    <template v-else-if="data">
      <div class="data-card">
        <div class="data-card-header">
          <h2>💰 Payment Orders ({{ data.pagination?.total || 0 }})</h2>
        </div>
        <div class="data-card-body">
          <div v-if="!data.payments?.length" class="empty-state">
            <div class="empty-icon">💰</div>
            <p>ไม่มี payment orders</p>
          </div>
          <table v-else class="data-table">
            <thead>
              <tr>
                <th>Workspace</th>
                <th>Plan</th>
                <th class="text-right">Amount</th>
                <th>Status</th>
                <th>Gateway</th>
                <th>Created</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="payment in data.payments" :key="payment.id">
                <td>
                  <div class="name-cell">
                    {{ payment.workspace_name || '-' }}
                    <div class="sub mono truncate">{{ payment.id }}</div>
                  </div>
                </td>
                <td>
                  <span class="badge info">{{ payment.plan_code }}</span>
                </td>
                <td class="text-right" style="font-weight: 700; color: var(--text-primary)">
                  ฿{{ formatThb(payment.amount_thb) }}
                </td>
                <td>
                  <span :class="badgeClass(payment.status)">
                    <span class="badge-dot"></span>
                    {{ payment.status }}
                  </span>
                </td>
                <td style="color: var(--text-muted)">{{ payment.gateway || '-' }}</td>
                <td>{{ formatDateTime(payment.created_at) }}</td>
                <td>
                  <button
                    v-if="payment.status === 'pending'"
                    class="btn btn-sm btn-success"
                    @click="showConfirm(payment.id)"
                  >
                    ✓ Confirm
                  </button>
                  <span v-else-if="payment.status === 'paid'" style="color: var(--success)">
                    {{ formatDateTime(payment.paid_at) }}
                  </span>
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

    <!-- Confirm dialog -->
    <div v-if="confirmingId" class="dialog-overlay" @click.self="cancelConfirm">
      <div class="dialog-box">
        <h3>ยืนยัน Payment?</h3>
        <p>ระบบจะ activate subscription ให้ลูกค้าทันที</p>
        <p class="mono" style="color: var(--text-dim); font-size: 11px; margin-top: -12px; margin-bottom: 24px">
          {{ confirmingId }}
        </p>
        <div class="dialog-actions">
          <button class="btn btn-ghost" @click="cancelConfirm">ยกเลิก</button>
          <button class="btn btn-primary" :disabled="confirmLoading" @click="doConfirm">
            {{ confirmLoading ? 'Processing...' : '✓ ยืนยัน Confirm' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
