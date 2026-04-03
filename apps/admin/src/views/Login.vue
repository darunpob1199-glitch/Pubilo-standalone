<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { setAdminKey, adminFetch } from '../composables/useApi'

const router = useRouter()
const key = ref('')
const error = ref('')
const loading = ref(false)

async function handleLogin() {
  if (!key.value.trim()) {
    error.value = 'กรุณาใส่ Admin Key'
    return
  }

  loading.value = true
  error.value = ''

  try {
    setAdminKey(key.value.trim())
    await adminFetch('/overview')
    router.push('/overview')
  } catch (e: any) {
    error.value = 'Admin Key ไม่ถูกต้อง'
    localStorage.removeItem('pubilo_admin_key')
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="login-page">
    <div class="login-card fade-in">
      <div class="logo">⚡</div>
      <h1>Pubilo Admin</h1>
      <p>เข้าสู่ระบบจัดการ Dashboard</p>

      <div v-if="error" class="error-msg">{{ error }}</div>

      <form @submit.prevent="handleLogin">
        <div class="input-group">
          <label for="admin-key">Admin Key</label>
          <input
            id="admin-key"
            v-model="key"
            type="password"
            class="input"
            placeholder="Enter your admin key..."
            autofocus
          />
        </div>

        <button type="submit" class="btn btn-primary" style="width: 100%; padding: 14px" :disabled="loading">
          {{ loading ? 'Verifying...' : 'เข้าสู่ระบบ' }}
        </button>
      </form>
    </div>
  </div>
</template>
