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
  <div class="login-wrapper">
    <div class="login-split">
      
      <!-- Left Side -->
      <div class="login-hero fade-in">
        <div class="hero-content">
          <h1>Fast, Efficient and Productive</h1>
          <p>เข้าสู่ระบบจัดการแอดมิน Pubilo Workspace ปลอดภัย รวดเร็ว เตรียมพร้อมทุกการทำงานสำหรับองค์กรของคุณ</p>
        </div>
        
        <div class="hero-footer">
          <div class="lang-selector">
            <span class="flag">🇹🇭</span>
            <span>Thai</span>
            <span class="dropdown-icon">▾</span>
          </div>
          <div class="footer-links">
            <a href="#">Terms</a>
            <a href="#">Plans</a>
            <a href="#">Contact Us</a>
          </div>
        </div>
      </div>

      <!-- Right Side -->
      <div class="login-form-container">
        <div class="login-card fade-in" style="animation-delay: 0.1s;">
          <div class="form-header">
            <div class="logo-box">⚡</div>
            <h2>Pubilo Admin</h2>
            <p>Admin Dashboard Access</p>
          </div>

          <div v-if="error" class="error-msg">{{ error }}</div>

          <form @submit.prevent="handleLogin">
            <div class="input-group">
              <label for="admin-key">Admin Key</label>
              <div class="input-wrapper">
                <input
                  id="admin-key"
                  v-model="key"
                  type="password"
                  class="custom-input"
                  placeholder="Enter your admin key..."
                  autofocus
                />
              </div>
              <p class="input-hint">Use your provided secure 16-character key.</p>
            </div>

            <button type="submit" class="btn-submit" :disabled="loading">
              {{ loading ? 'Verifying...' : 'Sign In' }}
            </button>
            
            <div class="form-footer">
              Don't have a key? <a href="#">Contact Support</a>
            </div>
          </form>
        </div>
      </div>

    </div>
  </div>
</template>

<style scoped>
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');

.login-wrapper {
  min-height: 100vh;
  width: 100vw;
  background: #f8fbff;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  box-sizing: border-box;
  font-family: 'Inter', sans-serif;
  position: absolute;
  top: 0;
  left: 0;
  z-index: 1000;
}

.login-split {
  width: 100%;
  max-width: 1200px;
  height: 800px;
  max-height: 90vh;
  background: #ffffff;
  border-radius: 32px;
  box-shadow: 0 20px 40px rgba(0,0,0,0.06), 0 1px 3px rgba(0,0,0,0.02);
  display: flex;
  overflow: hidden;
  position: relative;
}

/* Left Hero Side */
.login-hero {
  flex: 1;
  position: relative;
  padding: 60px;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  background: 
    radial-gradient(circle at 10% 20%, rgba(200, 230, 255, 0.4) 0%, transparent 60%),
    radial-gradient(circle at 90% 80%, rgba(210, 220, 255, 0.5) 0%, transparent 60%),
    #ffffff;
  z-index: 1;
  overflow: hidden;
}

.login-hero::before {
  content: '';
  position: absolute;
  top: -20%;
  left: -20%;
  width: 140%;
  height: 140%;
  background: 
    radial-gradient(circle at center, rgba(160, 210, 255, 0.15) 0%, transparent 50%),
    conic-gradient(from 180deg at 50% 50%, rgba(130, 200, 255, 0.1) 0deg, rgba(200, 230, 255, 0.1) 180deg, transparent 360%);
  filter: blur(40px);
  z-index: -1;
  pointer-events: none;
}

.hero-content {
  margin-top: auto;
  margin-bottom: auto;
  padding-right: 40px;
}

.hero-content h1 {
  font-size: 42px;
  font-weight: 800;
  color: #111827;
  line-height: 1.15;
  margin-bottom: 24px;
  letter-spacing: -1px;
}

.hero-content p {
  font-size: 16px;
  color: #4b5563;
  line-height: 1.6;
  max-width: 400px;
}

.hero-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 14px;
  font-weight: 500;
}

.lang-selector {
  display: flex;
  align-items: center;
  gap: 8px;
  color: #111827;
  cursor: pointer;
}

.flag { font-size: 18px; }
.dropdown-icon { font-size: 10px; opacity: 0.6; }

.footer-links {
  display: flex;
  gap: 20px;
}

.footer-links a {
  color: #3b82f6;
  text-decoration: none;
  transition: opacity 0.2s;
}

.footer-links a:hover {
  opacity: 0.7;
}

/* Right Form Side */
.login-form-container {
  flex: 0 0 540px;
  background: #f8fafc;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 40px;
}

.login-card {
  width: 100%;
  max-width: 400px;
  background: #ffffff;
  border-radius: 24px;
  padding: 48px;
  box-shadow: 0 10px 25px rgba(0,0,0,0.03);
  border: 1px solid rgba(0,0,0,0.02);
}

.form-header {
  margin-bottom: 40px;
}

.logo-box {
  width: 48px;
  height: 48px;
  background: linear-gradient(135deg, #0ba360 0%, #3cba92 100%);
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 24px;
  margin-bottom: 16px;
  box-shadow: 0 4px 12px rgba(11, 163, 96, 0.2);
}

.form-header h2 {
  font-size: 28px;
  font-weight: 700;
  color: #111827;
  margin-bottom: 6px;
}

.form-header p {
  color: #6b7280;
  font-size: 14px;
}

.error-msg {
  background: #fef2f2;
  color: #ef4444;
  padding: 12px 16px;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 500;
  margin-bottom: 24px;
  border: 1px solid #fee2e2;
}

.input-group {
  margin-bottom: 28px;
}

.input-group label {
  display: block;
  font-size: 14px;
  font-weight: 600;
  color: #374151;
  margin-bottom: 8px;
}

.input-wrapper {
  position: relative;
}

.custom-input {
  width: 100%;
  padding: 14px 16px;
  background: #ffffff;
  border: 1px solid #e5e7eb;
  border-radius: 12px;
  font-size: 15px;
  color: #111827;
  box-sizing: border-box;
  transition: all 0.2s ease;
  outline: none;
}

.custom-input:focus {
  border-color: #3b82f6;
  box-shadow: 0 0 0 4px rgba(59, 130, 246, 0.1);
}

.custom-input::placeholder {
  color: #9ca3af;
}

.input-hint {
  font-size: 12px;
  color: #9ca3af;
  margin-top: 8px;
}

.btn-submit {
  width: 100%;
  padding: 16px;
  background: #0052ff;
  color: #ffffff;
  border: none;
  border-radius: 12px;
  font-size: 16px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
  box-shadow: 0 4px 14px rgba(0, 82, 255, 0.3);
}

.btn-submit:hover:not(:disabled) {
  background: #0040cc;
  transform: translateY(-1px);
  box-shadow: 0 6px 20px rgba(0, 82, 255, 0.4);
}

.btn-submit:disabled {
  opacity: 0.7;
  cursor: not-allowed;
}

.form-footer {
  margin-top: 24px;
  text-align: center;
  font-size: 14px;
  color: #6b7280;
}

.form-footer a {
  color: #3b82f6;
  font-weight: 500;
  text-decoration: none;
}

.form-footer a:hover {
  text-decoration: underline;
}

.fade-in {
  animation: fadeIn 0.6s ease-out forwards;
  opacity: 0;
}

@keyframes fadeIn {
  from { opacity: 0; transform: translateY(10px); }
  to { opacity: 1; transform: translateY(0); }
}

@media (max-width: 992px) {
  .login-split {
    flex-direction: column;
    height: auto;
    max-height: none;
    background: transparent;
    box-shadow: none;
  }
  
  .login-hero {
    border-radius: 32px 32px 0 0;
    padding: 40px 24px;
  }
  
  .login-form-container {
    flex: none;
    border-radius: 0 0 32px 32px;
    padding: 32px 24px;
  }
  
  .login-card {
    padding: 32px 24px;
  }
}
</style>
