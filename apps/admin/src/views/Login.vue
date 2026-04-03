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
        <svg width="32" height="32" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M50 68 L80 84 L50 100 L20 84 Z" stroke="#ffffff" stroke-width="8" stroke-linejoin="round"/>
            <path d="M50 50 L80 66 L50 82 L20 66 Z" stroke="#e2e8f0" stroke-width="8" stroke-linejoin="round"/>
            <path d="M50 16 L84 34 L50 52 L16 34 Z" fill="#ffffff"/>
            <path d="M84 34 L50 52 L50 62 L84 44 Z" fill="#e2e8f0"/>
            <path d="M16 34 L50 52 L50 62 L16 44 Z" fill="#f8fafc"/>
        </svg>
        <span class="logo-text">Pubilo</span>
      </div>

      <!-- Welcome Text -->
      <div class="welcome-text">
        <h1>Edit Smarter. Export Faster.<br>Create Anywhere.</h1>
        <p>From quick social media clips to full-length videos, our powerful editor<br>lets you work seamlessly across devices.</p>
        <div class="dots">
          <span class="dot active"></span>
          <span class="dot"></span>
          <span class="dot"></span>
        </div>
      </div>

      <!-- Background Image Layer -->
      <div class="bg-layer"></div>
    </div>

    <!-- Right Panel (Floating Card & Nav) -->
    <div class="right-panel">
      <a href="#" class="back-link">&larr; Back to Website</a>
      
      <div class="form-container">
        <h2 class="form-heading">Welcome Back!</h2>
        <p class="form-subheading">
          Log in to start creating stunning videos with ease.
        </p>

        <form @submit.prevent="handleLogin" class="login-form">
          <div class="input-group">
            <label>Email</label>
            <input type="text" class="line-input" placeholder="Input your email" disabled />
          </div>

          <div class="input-group">
            <label>Password</label>
            <input 
              type="password" 
              class="line-input" 
              v-model="key" 
              placeholder="Input your company name" 
              required 
            />
            <svg class="input-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#a0aabf" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle>
            </svg>
          </div>

          <div class="form-actions">
            <label class="remember-checkbox">
              <input type="checkbox" checked />
              <span class="checkmark"></span>
              Remember Me
            </label>
            <a href="#" class="primary-link">Forgot Password?</a>
          </div>

          <button type="submit" class="submit-btn" :disabled="loading">
            {{ loading ? 'Signing in...' : 'Login' }}
          </button>

          <div class="divider">
            <span>Or continue with:</span>
          </div>

          <button type="button" class="google-btn">
            <svg width="20" height="20" viewBox="0 0 24 24">
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
            </svg>
            Continue with Google
          </button>

          <p class="signup-text">
            Don't have an account? <a href="#">Sign up here</a>
          </p>

        </form>
      </div>
    </div>
  </div>
</template>

<style scoped>
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');

.split-login-container {
  display: flex;
  width: 100vw;
  height: 100vh;
  font-family: 'Inter', sans-serif;
  position: absolute;
  top: 0;
  left: 0;
  z-index: 1000;
  overflow: hidden;
  background-color: #121c2d; /* Fallback background matching image */
}

/* Base image for left panel. Right panel will overlap it slightly */
.bg-layer {
  position: absolute;
  inset: 0;
  background-image: url('https://images.unsplash.com/photo-1541888049187-21fb9be59685?auto=format&fit=crop&q=80&w=2560');
  background-position: center;
  background-size: cover;
  opacity: 0.25;
  mix-blend-mode: overlay;
  z-index: 0;
}

.left-panel {
  flex: 1;
  background: linear-gradient(135deg, #111a28 0%, #1c3552 100%);
  color: white;
  display: flex;
  flex-direction: column;
  padding: 60px;
  position: relative;
}

.logo {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: auto;
  z-index: 2;
}

.logo-text {
  font-size: 24px;
  font-weight: 700;
  color: white;
  letter-spacing: -0.5px;
}

.welcome-text {
  margin-top: auto;
  max-width: 600px;
  z-index: 2;
}

.welcome-text h1 {
  font-size: 54px;
  font-weight: 700;
  margin: 0 0 20px 0;
  letter-spacing: -1.5px;
  line-height: 1.15;
}

.welcome-text p {
  font-size: 16px;
  font-weight: 400;
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
  flex: 0 0 600px;
  background: transparent;
  display: flex;
  flex-direction: column;
  padding: 40px 40px 40px 0;
  position: relative;
  z-index: 2;
}

.back-link {
  position: absolute;
  top: 60px;
  left: -120px;
  color: white;
  text-decoration: none;
  font-size: 14px;
  font-weight: 500;
  opacity: 0.9;
  z-index: 10;
}

.back-link:hover {
  opacity: 1;
}

.form-container {
  width: 100%;
  height: 100%;
  background: #ffffff;
  border-radius: 20px;
  padding: 60px 80px;
  display: flex;
  flex-direction: column;
  justify-content: center;
  overflow-y: auto;
}

.form-container::-webkit-scrollbar {
    display: none;
}

.form-heading {
  font-size: 40px;
  font-weight: 700;
  color: #111827;
  margin: 0 0 12px 0;
  letter-spacing: -1px;
}

.form-subheading {
  font-size: 15px;
  color: #6b7280;
  margin: 0 0 40px 0;
  line-height: 1.6;
}

.input-group {
  position: relative;
  margin-bottom: 24px;
}

.input-group label {
  font-size: 13px;
  font-weight: 700;
  color: #374151;
  margin-bottom: 8px;
  display: block;
}

.line-input {
  width: 100%;
  border: 1px solid #e5e7eb;
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
  border-color: #111827;
}

.line-input::placeholder {
  color: #9ca3af;
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
  margin-bottom: 32px;
}

.primary-link {
  color: #6b7280;
  text-decoration: none;
  font-weight: 500;
  font-size: 13px;
}

.primary-link:hover {
  color: #111827;
}

.remember-checkbox {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  font-size: 13px;
  color: #6b7280;
  font-weight: 500;
}

.remember-checkbox input {
  accent-color: #111827;
  width: 16px;
  height: 16px;
  margin: 0;
}

.submit-btn {
  background-color: #111827;
  color: white;
  border: none;
  width: 100%;
  height: 52px;
  border-radius: 100px;
  font-size: 15px;
  font-weight: 600;
  cursor: pointer;
  transition: opacity 0.2s;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 24px;
}

.submit-btn:hover {
  opacity: 0.9;
}

.divider {
  display: flex;
  align-items: center;
  text-align: center;
  margin-bottom: 24px;
}

.divider::before, .divider::after {
  content: '';
  flex: 1;
  border-bottom: 1px solid #e5e7eb;
}

.divider span {
  padding: 0 10px;
  color: #9ca3af;
  font-size: 12px;
  font-weight: 500;
}

.google-btn {
  background-color: #ffffff;
  color: #374151;
  border: 1px solid #e5e7eb;
  width: 100%;
  height: 52px;
  border-radius: 100px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  margin-bottom: 32px;
  font-family: 'Inter', sans-serif;
  transition: background 0.2s;
}

.google-btn:hover {
  background-color: #f9fafb;
}

.signup-text {
  text-align: center;
  font-size: 14px;
  color: #6b7280;
  margin: 0;
}

.signup-text a {
  color: #111827;
  font-weight: 700;
  text-decoration: none;
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
    border-radius: 20px;
    padding: 40px;
  }
  .back-link {
    display: none;
  }
}
</style>
