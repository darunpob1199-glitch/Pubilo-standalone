import { ref } from 'vue'
import { useRouter } from 'vue-router'

const API_BASE = import.meta.env.VITE_API_BASE || ''

function getAdminKey(): string {
  return localStorage.getItem('pubilo_admin_key') || ''
}

export function setAdminKey(key: string) {
  localStorage.setItem('pubilo_admin_key', key)
}

export function clearAdminKey() {
  localStorage.removeItem('pubilo_admin_key')
}

export async function adminFetch<T = any>(path: string, options: RequestInit = {}): Promise<T> {
  const key = getAdminKey()
  const url = `${API_BASE}/api/admin${path}`
  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`,
      ...(options.headers || {}),
    },
  })

  if (res.status === 403) {
    clearAdminKey()
    window.location.href = '/login'
    throw new Error('Unauthorized')
  }

  const data = await res.json()
  if (!res.ok) {
    throw new Error(data.error || `HTTP ${res.status}`)
  }
  return data as T
}

export function useApiCall<T = any>(fetcher: () => Promise<T>) {
  const data = ref<T | null>(null) as any
  const loading = ref(false)
  const error = ref<string | null>(null)

  async function execute() {
    loading.value = true
    error.value = null
    try {
      data.value = await fetcher()
    } catch (e: any) {
      error.value = e.message || 'Unknown error'
    } finally {
      loading.value = false
    }
  }

  return { data, loading, error, execute }
}
