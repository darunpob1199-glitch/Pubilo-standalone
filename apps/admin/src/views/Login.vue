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
    <!-- Left Blue Panel -->
    <div class="left-panel">
      
      <!-- Top Left Logo -->
      <div class="logo">
        <svg width="24" height="32" viewBox="0 0 24 32" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M0 0 V20 C0 26.6274 5.37258 32 12 32 C18.6274 32 24 26.6274 24 20 V8 H16 V20 C16 22.2091 14.2091 24 12 24 C9.79086 24 8 22.2091 8 20 V0 H0 Z" fill="white"/>
        </svg>
        <span class="logo-text">PubiloAdmin</span>
      </div>

      <!-- Illustration Area -->
      <div class="illustration-wrapper">
        <svg width="260" height="260" viewBox="0 0 300 300" fill="none" xmlns="http://www.w3.org/2000/svg">
          <!-- Background blobs -->
          <circle cx="150" cy="150" r="120" fill="#0348c4" opacity="0.4" />
          <path d="M40 180 Q80 120 160 160 T280 140" stroke="#003594" stroke-width="8" stroke-linecap="round" stroke-linejoin="round" />
          <!-- Clipboard -->
          <rect x="80" y="60" width="140" height="180" rx="12" fill="#e0e8f5" transform="rotate(-15 150 150)" />
          <rect x="70" y="50" width="140" height="180" rx="12" fill="#ffffff" transform="rotate(-15 150 150)" />
          <!-- Clip top -->
          <rect x="120" y="35" width="40" height="15" rx="4" fill="#a5b9d9" transform="rotate(-15 150 150)" />
          <rect x="110" y="45" width="60" height="15" rx="4" fill="#809bc4" transform="rotate(-15 150 150)" />
          <!-- Checkmarks -->
          <path d="M90 100 L105 115 L140 80" stroke="#1062fe" stroke-width="8" stroke-linecap="round" stroke-linejoin="round" transform="rotate(-15 150 150)" />
          <line x1="150" y1="100" x2="190" y2="100" stroke="#a5b9d9" stroke-width="6" stroke-linecap="round" transform="rotate(-15 150 150)" />
          
          <path d="M100 130 L120 150 M120 130 L100 150" stroke="#1062fe" stroke-width="8" stroke-linecap="round" stroke-linejoin="round" transform="rotate(-15 150 150)" />
          <line x1="150" y1="140" x2="190" y2="140" stroke="#a5b9d9" stroke-width="6" stroke-linecap="round" transform="rotate(-15 150 150)" />
          
          <path d="M90 180 L105 195 L140 160" stroke="#1062fe" stroke-width="8" stroke-linecap="round" stroke-linejoin="round" transform="rotate(-15 150 150)" />
          <line x1="150" y1="180" x2="190" y2="180" stroke="#a5b9d9" stroke-width="6" stroke-linecap="round" transform="rotate(-15 150 150)" />
        </svg>
      </div>

      <!-- Welcome Text -->
      <div class="welcome-text">
        <h1>Welcome!</h1>
        <p>Get a real admin dashboard entirely on top of<br>your Pubilo environment, with full control.</p>
        <div class="dots">
          <span class="dot active"></span>
          <span class="dot"></span>
          <span class="dot"></span>
        </div>
      </div>

    </div>

    <!-- Right White Panel -->
    <div class="right-panel">
      <div class="form-container">
        <h2 class="form-heading">Log In</h2>
        <p class="form-subheading">
          Don't have an account? <a href="#" class="primary-link">Contact Support</a><br>
          <span class="time-hint">It will take less than a minute.</span>
        </p>

        <div v-if="error" class="error-msg">{{ error }}</div>

        <form @submit.prevent="handleLogin" class="login-form">
          
          <!-- Username Input (Disabled/Visual Only) -->
          <div class="input-group">
            <input type="text" class="line-input" value="Root Administrator" disabled />
            <svg class="input-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#a0aabf" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
              <circle cx="12" cy="7" r="4"></circle>
            </svg>
          </div>

          <!-- Password / Admin Key Input -->
          <div class="input-group">
            <input 
              type="password" 
              class="line-input" 
              v-model="key" 
              placeholder="Admin Key" 
              required 
              autofocus 
            />
            <svg class="input-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#a0aabf" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
              <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
            </svg>
          </div>

          <div class="form-actions">
            <button type="submit" class="submit-btn" :disabled="loading">
              {{ loading ? 'Signing...' : 'Sign in' }}
            </button>
            <label class="remember-checkbox">
              <input type="checkbox" checked />
              <span class="checkmark"></span>
              Remember key
            </label>
          </div>

          <div class="forget-link-wrapper">
            <a href="#" class="primary-link font-normal">Forget your admin key?</a>
          </div>

        </form>
      </div>
    </div>

  </div>
</template>

<style scoped>
@import url('https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700&display=swap');

.split-login-container {
  display: flex;
  width: 100vw;
  height: 100vh;
  font-family: 'Montserrat', sans-serif;
  background: white;
  position: absolute;
  top: 0;
  left: 0;
  z-index: 1000;
}

/* Left Panel */
.left-panel {
  flex: 5.5;
  background-color: #0f62fe; /* Upteamist vibrant blue */
  color: white;
  display: flex;
  flex-direction: column;
  padding: 40px;
  position: relative;
  overflow: hidden;
}

.logo {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: auto;
}

.logo-text {
  font-size: 22px;
  font-weight: 600;
  letter-spacing: 0.5px;
}

.illustration-wrapper {
  margin: 0 auto;
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 2;
}

.welcome-text {
  margin-top: auto;
  margin-bottom: 20px;
  padding-left: 20px;
}

.welcome-text h1 {
  font-size: 42px;
  font-weight: 500;
  margin: 0 0 16px 0;
  letter-spacing: -0.5px;
}

.welcome-text p {
  font-size: 15px;
  line-height: 1.6;
  margin: 0 0 32px 0;
  opacity: 0.9;
}

.dots {
  display: flex;
  gap: 12px;
}

.dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  border: 1px solid white;
  background: transparent;
}

.dot.active {
  background: white;
}

/* Right Panel */
.right-panel {
  flex: 4.5;
  background-color: #ffffff;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 40px;
}

.form-container {
  width: 100%;
  max-width: 400px;
  padding: 20px;
}

.form-heading {
  font-size: 32px;
  font-weight: 500;
  color: #0f62fe;
  margin: 0 0 16px 0;
}

.form-subheading {
  font-size: 14px;
  color: #697077;
  margin: 0 0 40px 0;
  line-height: 1.6;
}

.primary-link {
  color: #0f62fe;
  text-decoration: none;
  font-weight: 600;
}

.primary-link:hover {
  text-decoration: underline;
}

.font-normal {
  font-weight: 500;
  font-size: 14px;
}

.time-hint {
  color: #a2a9b0;
  font-size: 13px;
}

.error-msg {
  background: #fff1f1;
  color: #da1e28;
  padding: 12px;
  border-radius: 4px;
  border: 1px solid #ffb3b8;
  margin-bottom: 24px;
  font-size: 14px;
}

.input-group {
  position: relative;
  margin-bottom: 32px;
}

.line-input {
  width: 100%;
  border: none;
  border-bottom: 1px solid #d1d5db;
  padding: 12px 0;
  font-size: 15px;
  color: #111827;
  background: transparent;
  outline: none;
  font-family: inherit;
  transition: border-color 0.2s;
}

.line-input:focus {
  border-bottom-color: #0f62fe;
}

.line-input::placeholder {
  color: #a0aabf;
  font-weight: 400;
}

.line-input:disabled {
  color: #a0aabf;
}

.input-icon {
  position: absolute;
  right: 0;
  top: 50%;
  transform: translateY(-50%);
  pointer-events: none;
}

.form-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 40px;
  margin-bottom: 24px;
}

.submit-btn {
  background-color: #0f62fe;
  color: white;
  border: none;
  padding: 14px 32px;
  border-radius: 4px;
  font-size: 15px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.2s;
}

.submit-btn:hover {
  background-color: #0353e9;
}

.submit-btn:disabled {
  background-color: #87b2ff;
  cursor: not-allowed;
}

/* Custom Checkbox */
.remember-checkbox {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  font-size: 13px;
  color: #878d96;
}

.remember-checkbox input {
  display: none;
}

.checkmark {
  width: 16px;
  height: 16px;
  border: 1px solid #c6cace;
  border-radius: 2px;
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
}

.remember-checkbox input:checked ~ .checkmark {
  background-color: #0f62fe;
  border-color: #0f62fe;
}

.remember-checkbox input:checked ~ .checkmark::after {
  content: '';
  width: 4px;
  height: 8px;
  border: solid white;
  border-width: 0 2px 2px 0;
  transform: rotate(45deg);
  margin-bottom: 2px;
}

.forget-link-wrapper {
  text-align: center;
}

/* Responsiveness */
@media (max-width: 900px) {
  .split-login-container {
    flex-direction: column;
  }
  .left-panel {
    flex: none;
    padding: 30px;
    height: auto;
    min-height: 380px;
  }
  .right-panel {
    flex: none;
    height: auto;
    padding: 40px 20px;
  }
  .illustration-wrapper {
    display: none; /* hide illustration on small screens to save space */
  }
  .welcome-text {
    margin-top: 40px;
  }
}
</style>
