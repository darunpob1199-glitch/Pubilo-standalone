import { createRouter, createWebHistory } from 'vue-router'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/',
      redirect: '/overview',
    },
    {
      path: '/overview',
      name: 'overview',
      component: () => import('../views/Overview.vue'),
    },
    {
      path: '/customers',
      name: 'customers',
      component: () => import('../views/Customers.vue'),
    },
    {
      path: '/payments',
      name: 'payments',
      component: () => import('../views/Payments.vue'),
    },
    {
      path: '/activity',
      name: 'activity',
      component: () => import('../views/Activity.vue'),
    },
    {
      path: '/system',
      name: 'system',
      component: () => import('../views/System.vue'),
    },
    {
      path: '/login',
      name: 'login',
      component: () => import('../views/Login.vue'),
    },
  ],
})

router.beforeEach((to) => {
  const key = localStorage.getItem('pubilo_admin_key')
  if (!key && to.name !== 'login') {
    return { name: 'login' }
  }
})

export { router }
