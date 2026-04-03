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
  <div class="split-login-container">
    <!-- Left Panel -->
    <div class="left-panel">
      
      <!-- Top Left Logo -->
      <div class="logo">
        <svg width="36" height="36" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M50 68 L80 84 L50 100 L20 84 Z" stroke="#C084FC" stroke-width="8" stroke-linejoin="round"/>
            <path d="M50 50 L80 66 L50 82 L20 66 Z" stroke="#94A3B8" stroke-width="8" stroke-linejoin="round"/>
            <path d="M50 16 L84 34 L50 52 L16 34 Z" fill="#8B5CF6"/>
            <path d="M84 34 L50 52 L50 62 L84 44 Z" fill="#7C3AED"/>
            <path d="M16 34 L50 52 L50 62 L16 44 Z" fill="#A78BFA"/>
        </svg>
        <span class="logo-text">Pubilo</span>
      </div>

      <!-- Welcome Text -->
      <div class="welcome-text">
        <h1>Work Smarter.<br>Organize Faster.<br>Manage Anywhere.</h1>
        <p>From quick team updates to full-length policies, our powerful platform lets you collaborate seamlessly across devices.</p>
        <div class="dots">
          <span class="dot active"></span>
          <span class="dot"></span>
          <span class="dot"></span>
        </div>
      </div>

    </div>

    <!-- Right Panel (Floating Card) -->
    <div class="right-panel">
      <div class="form-container">
        <h2 class="form-heading">Welcome Back!</h2>
        <p class="form-subheading">
          Log in to the administrative portal to manage workspaces and global settings.
        </p>

        <div v-if="error" class="error-msg">{{ error }}</div>

        <form @submit.prevent="handleLogin" class="login-form">
          
          <div class="input-group">
            <label>Admin User</label>
            <input type="text" class="line-input" value="System Administrator" disabled />
          </div>

          <div class="input-group">
            <label>Admin Key</label>
            <input 
              type="password" 
              class="line-input" 
              v-model="key" 
              placeholder="Input your admin key" 
              required 
              autofocus 
            />
            <svg class="input-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#a0aabf" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle>
            </svg>
          </div>

          <div class="form-actions" style="margin-bottom: 24px;">
            <label class="remember-checkbox">
              <input type="checkbox" checked />
              <span class="checkmark"></span>
              Remember Me
            </label>
            <a href="#" class="primary-link font-normal">Forgot Password?</a>
          </div>

          <button type="submit" class="submit-btn" :disabled="loading">
            {{ loading ? 'Authenticating...' : 'Login' }}
          </button>
        </form>
      </div>
    </div>
  </div>
</template>

<style scoped>
@import url('https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700;800;900&display=swap');

.split-login-container {
  display: flex;
  width: 100vw;
  height: 100vh;
  font-family: 'Montserrat', sans-serif;
  background-color: #1e0a45;
  background-image: 
      linear-gradient(145deg, rgba(88,28,135,0.8) 0%, rgba(46,16,101,0.9) 100%),
      linear-gradient(30deg, transparent 40%, rgba(139,92,246,0.15) 45%, transparent 50%),
      linear-gradient(-60deg, transparent 50%, rgba(167,139,250,0.1) 55%, transparent 60%);
  background-size: cover;
  position: absolute;
  top: 0;
  left: 0;
  z-index: 1000;
  overflow: hidden;
}

.split-login-container::before {
    content: '';
    position: absolute;
    inset: 0;
    background: radial-gradient(circle at top left, rgba(139,92,246,0.3) 0%, transparent 50%),
                radial-gradient(circle at bottom right, rgba(167,139,250,0.15) 0%, transparent 60%);
    pointer-events: none;
}

.left-panel {
  flex: 1;
  background: transparent;
  color: white;
  display: flex;
  flex-direction: column;
  padding: 60px;
  position: relative;
  z-index: 2;
}

.logo {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: auto;
}

.logo-text {
  font-size: 24px;
  font-weight: 700;
  color: white;
  letter-spacing: -0.5px;
}

.welcome-text {
  margin-top: auto;
  max-width: 440px;
}

.welcome-text h1 {
  font-size: 52px;
  font-weight: 800;
  margin: 0 0 20px 0;
  letter-spacing: -1.5px;
  line-height: 1.15;
}

.welcome-text p {
  font-size: 16px;
  font-weight: 500;
  line-height: 1.6;
  margin: 0 0 40px 0;
  opacity: 0.85;
}

.dots {
  display: flex;
  gap: 12px;
  align-items: center;
}

.dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: rgba(255,255,255,0.3);
}

.dot.active {
  width: 32px;
  height: 6px;
  border-radius: 6px;
  background: white;
}

.right-panel {
  flex: 0 0 500px;
  background: transparent;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  z-index: 2;
}

.form-container {
  width: 100%;
  height: 100%;
  background: #ffffff;
  border-radius: 32px;
  padding: 40px;
  box-shadow: 0 24px 60px rgba(0,0,0,0.15);
  display: flex;
  flex-direction: column;
  justify-content: center;
  overflow-y: auto;
}

.form-container::-webkit-scrollbar {
    display: none;
}

.form-heading {
  font-size: 36px;
  font-weight: 800;
  color: #0f172a;
  margin: 0 0 12px 0;
}

.form-subheading {
  font-size: 15px;
  color: #64748b;
  margin: 0 0 40px 0;
  line-height: 1.6;
}

.primary-link {
  color: #64748b;
  text-decoration: none;
  font-weight: 500;
  font-size: 13px;
}

.primary-link:hover {
  text-decoration: underline;
}

.error-msg {
  background: #fff1f1;
  color: #da1e28;
  padding: 16px;
  border-radius: 12px;
  margin-bottom: 24px;
  font-size: 14px;
  font-weight: 500;
}

.input-group {
  position: relative;
  margin-bottom: 24px;
}

.input-group label {
  font-size: 13px;
  font-weight: 700;
  color: #1e293b;
  margin-bottom: 8px;
  display: block;
}

.line-input {
  width: 100%;
  border: 2px solid #e2e8f0;
  border-radius: 12px;
  padding: 16px;
  font-size: 15px;
  color: #111827;
  background: #ffffff;
  outline: none;
  font-family: inherit;
  transition: border-color 0.2s;
  box-sizing: border-box;
}

.line-input:focus {
  border-color: #0f172a;
}

.line-input::placeholder {
  color: #a0aabf;
}

.line-input:disabled {
  background: #f8fafc;
  color: #94a3b8;
}

.input-icon {
  position: absolute;
  right: 16px;
  top: 42px;
  pointer-events: none;
}

.form-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.submit-btn {
  background-color: #0f172a;
  color: white;
  border: none;
  width: 100%;
  height: 56px;
  border-radius: 100px;
  font-size: 16px;
  font-weight: 700;
  cursor: pointer;
  transition: opacity 0.2s;
  display: flex;
  align-items: center;
  justify-content: center;
}

.submit-btn:hover {
  opacity: 0.9;
}

.submit-btn:disabled {
  opacity: 0.7;
  cursor: not-allowed;
}

.remember-checkbox {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  font-size: 13px;
  color: #64748b;
  font-weight: 500;
}

.remember-checkbox input {
  accent-color: #0f172a;
  width: 18px;
  height: 18px;
  margin: 0;
}

.checkmark {
  display: none;
}

@media (max-width: 900px) {
  .split-login-container {
    flex-direction: column;
  }
  .left-panel {
    flex: none;
    padding: 40px;
  }
  .right-panel {
    flex: none;
    height: auto;
    padding: 0 20px 40px 20px;
  }
  .form-container {
    border-radius: 24px;
    padding: 30px;
  }
}
</style>
