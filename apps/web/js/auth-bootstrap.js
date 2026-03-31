(function () {
    const SHOW_BILLING_BANNER = false;
    let authReadyResolved = false;
    let resolveAuthReadyPromise = null;
    const state = {
        authenticated: false,
        user: null,
        workspace: null,
        memberships: [],
        latestPaymentOrder: null,
        plans: [],
    };
    const authReadyPromise = new Promise((resolve) => {
        resolveAuthReadyPromise = (payload) => {
            if (authReadyResolved) return;
            authReadyResolved = true;
            resolve(payload || true);
        };
    });

    const domReady = new Promise((resolve) => {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', resolve, { once: true });
        } else {
            resolve();
        }
    });

    function nativeFetch(url, options) {
        return window.__PUBILO_NATIVE_FETCH__(window.API_BASE + url, {
            credentials: 'include',
            ...(options || {}),
        });
    }

    function authErrorMessage() {
        const params = new URLSearchParams(window.location.search);
        const code = params.get('auth_error');
        if (!code) return '';

        const messages = {
            missing_code: 'LINE callback ไม่ครบ ลอง login ใหม่อีกครั้ง',
            invalid_state: 'Session login หมดอายุ ลองกดเข้าสู่ระบบอีกครั้ง',
            access_denied: 'LINE login ถูกยกเลิกจากฝั่งผู้ใช้',
            line_callback: 'LINE login ล้มเหลว ลองใหม่อีกครั้ง',
            line_not_configured: 'ระบบยังไม่ได้ตั้งค่า LINE Login (LINE_LOGIN_CHANNEL_ID/SECRET) บน API',
        };

        return messages[code] || 'เข้าสู่ระบบไม่สำเร็จ';
    }

    function ensureOverlay() {
        let overlay = document.getElementById('pubiloAuthOverlay');
        if (overlay) return overlay;

        overlay = document.createElement('div');
        overlay.id = 'pubiloAuthOverlay';
        overlay.className = 'pubilo-auth-overlay';
        overlay.innerHTML = `
            <div class="pubilo-auth-shell">
                <div class="pubilo-auth-brand">
                    <span class="pubilo-auth-kicker">Pubilo Workspace</span>
                    <h1>ล็อกอินก่อนใช้งานระบบ</h1>
                    <p id="pubiloAuthSubtitle">LINE login + workspace + billing ถูกเปิดใช้แล้ว</p>
                </div>
                <div class="pubilo-auth-card" id="pubiloAuthCard"></div>
            </div>
        `;
        document.body.appendChild(overlay);
        return overlay;
    }

    function renderLoginView(message) {
        const overlay = ensureOverlay();
        const card = overlay.querySelector('#pubiloAuthCard');
        const loginUrl = `${window.API_BASE}/api/auth/login/line?returnTo=${encodeURIComponent(window.location.href)}`;
        card.innerHTML = `
            <div class="pubilo-auth-panel">
                <p class="pubilo-auth-label">Sign in</p>
                <h2>ใช้ LINE account เข้า Pubilo</h2>
                <p class="pubilo-auth-copy">ระบบใช้ LINE Login สำหรับ dashboard โดยตรง ไม่ต้องมี Cloudflare account และไม่ต้องพึ่ง Google แล้ว</p>
                ${message ? `<p class="pubilo-auth-error">${message}</p>` : ''}
                <a class="pubilo-auth-provider-btn" href="${loginUrl}">
                    <span>Continue with LINE</span>
                </a>
            </div>
        `;
    }

    function renderOnboardingView(profile) {
        const overlay = ensureOverlay();
        const card = overlay.querySelector('#pubiloAuthCard');
        const defaultName = `${(profile?.user?.name || 'My').split(' ')[0]} Workspace`;
        const plansHtml = (state.plans || []).map((plan, index) => `
            <label class="pubilo-plan-card ${index === 0 ? 'selected' : ''}" data-plan-card="${plan.code}">
                <input type="radio" name="planCode" value="${plan.code}" ${index === 0 ? 'checked' : ''} />
                <div class="pubilo-plan-top">
                    <span class="pubilo-plan-name">${plan.label}</span>
                    <strong>฿${plan.amountThb.toLocaleString('th-TH')}</strong>
                </div>
                <p>${plan.description}</p>
            </label>
        `).join('');

        card.innerHTML = `
            <form class="pubilo-auth-panel" id="pubiloOnboardingForm">
                <p class="pubilo-auth-label">Workspace</p>
                <h2>ตั้งค่า account สำหรับขายใช้งานจริง</h2>
                <p class="pubilo-auth-copy">เลือกราคาแพ็กเกจแล้วระบบจะสร้าง workspace + subscription + payment order รอ gateway ต่อทีหลัง</p>
                <label class="pubilo-field">
                    <span>ชื่อ Workspace</span>
                    <input type="text" id="pubiloWorkspaceName" value="${defaultName.replace(/"/g, '&quot;')}" required />
                </label>
                <div class="pubilo-plan-grid">${plansHtml}</div>
                <button class="pubilo-primary-btn" type="submit">สร้าง Workspace</button>
                <p class="pubilo-auth-note" id="pubiloOnboardingNote"></p>
            </form>
        `;

        card.querySelectorAll('[data-plan-card]').forEach((node) => {
            node.addEventListener('click', () => {
                card.querySelectorAll('[data-plan-card]').forEach((item) => item.classList.remove('selected'));
                node.classList.add('selected');
                const input = node.querySelector('input');
                if (input) input.checked = true;
            });
        });

        const form = card.querySelector('#pubiloOnboardingForm');
        const note = card.querySelector('#pubiloOnboardingNote');
        form.addEventListener('submit', async (event) => {
            event.preventDefault();
            const name = card.querySelector('#pubiloWorkspaceName').value.trim();
            const planCode = form.querySelector('input[name="planCode"]:checked')?.value;

            if (!name || !planCode) {
                note.textContent = 'กรอกชื่อ workspace และเลือกแพ็กเกจก่อน';
                return;
            }

            note.textContent = 'กำลังสร้าง workspace...';

            const response = await nativeFetch('/api/auth/onboarding/workspace', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, planCode }),
            });

            const payload = await response.json();
            if (!response.ok || !payload.success) {
                note.textContent = payload.error || 'สร้าง workspace ไม่สำเร็จ';
                return;
            }

            note.textContent = `สร้าง workspace แล้ว ยอดชำระรอ gateway: ฿${(payload.paymentOrder?.amountThb || 0).toLocaleString('th-TH')}`;
            await hydrateAndResolve();
        });
    }

    function ensureHeaderControls() {
        const headerRight = document.querySelector('.header-right');
        if (!headerRight) return;

        let chip = document.getElementById('pubiloWorkspaceChip');
        if (!chip) {
            chip = document.createElement('div');
            chip.id = 'pubiloWorkspaceChip';
            chip.className = 'pubilo-workspace-chip';
            headerRight.insertBefore(chip, headerRight.firstChild);
        }

        const workspaceName = state.workspace?.name || 'No workspace';
        chip.innerHTML = `
            <span class="pubilo-workspace-label">${workspaceName}</span>
            <button type="button" id="pubiloLogoutBtn">Logout</button>
        `;

        chip.querySelector('#pubiloLogoutBtn').addEventListener('click', async () => {
            await nativeFetch('/api/auth/logout', { method: 'POST' });
            window.location.reload();
        });

        const avatarImage = document.getElementById('headerAvatarImg');
        const avatarInitial = document.getElementById('headerAvatarInitial');
        if (avatarImage && state.user?.avatar_url) {
            avatarImage.src = state.user.avatar_url;
            avatarImage.style.display = 'block';
            if (avatarInitial) avatarInitial.style.display = 'none';
        } else if (avatarInitial) {
            avatarInitial.textContent = (state.user?.name || state.user?.email || 'U').slice(0, 1).toUpperCase();
        }
    }

    function ensureBillingBanner() {
        const existing = document.getElementById('pubiloBillingBanner');
        if (!SHOW_BILLING_BANNER) {
            existing?.remove();
            return;
        }

        if (!state.workspace?.subscriptionStatus || state.workspace.subscriptionStatus === 'active') {
            existing?.remove();
            return;
        }

        let banner = existing;
        if (!banner) {
            banner = document.createElement('div');
            banner.id = 'pubiloBillingBanner';
            banner.className = 'pubilo-billing-banner';
            document.body.appendChild(banner);
        }

        const orderId = state.latestPaymentOrder?.id || '-';
        const amount = state.latestPaymentOrder?.amount_thb || state.workspace?.plan?.amountThb || 0;
        banner.textContent = `การชำระเงินยังรอเชื่อม gateway | order ${orderId} | ยอด ฿${Number(amount).toLocaleString('th-TH')}`;
    }

    async function fetchPlans() {
        const response = await nativeFetch('/api/billing/plans');
        const payload = await response.json();
        return Array.isArray(payload.plans) ? payload.plans : [];
    }

    async function fetchAuthState() {
        const response = await nativeFetch('/api/auth/me');
        const payload = await response.json();
        return payload;
    }

    function applyAuthState(payload) {
        state.authenticated = !!payload.authenticated;
        state.user = payload.user || null;
        state.workspace = payload.workspace || null;
        state.memberships = payload.memberships || [];
        state.latestPaymentOrder = payload.latestPaymentOrder || null;
        window.PUBILO_AUTH_STATE = state;
        window.PUBILO_CURRENT_WORKSPACE = state.workspace;
    }

    async function hydrateAndResolve() {
        if (window.PUBILO_WEB_ONLY_MODE) {
            const mockPayload = {
                authenticated: true,
                user: { name: 'Developer', avatar_url: '' },
                workspace: { name: 'Local Workspace', subscriptionStatus: 'active' },
                memberships: [],
                onboardingRequired: false
            };
            applyAuthState(mockPayload);
            document.body.classList.add('pubilo-authenticated');
            ensureOverlay().classList.add('is-hidden');
            ensureHeaderControls();
            resolveAuthReadyPromise?.(mockPayload);
            return mockPayload;
        }

        const payload = await fetchAuthState();
        applyAuthState(payload);

        if (!payload.authenticated) {
            renderLoginView(authErrorMessage());
            return new Promise(() => {});
        }

        if (payload.onboardingRequired || !payload.workspace) {
            renderOnboardingView(payload);
            return new Promise(() => {});
        }

        document.body.classList.add('pubilo-authenticated');
        ensureOverlay().classList.add('is-hidden');
        ensureHeaderControls();
        ensureBillingBanner();
        resolveAuthReadyPromise?.(payload);
        return payload;
    }

    async function bootstrap() {
        await domReady;
        ensureOverlay();
        state.plans = await fetchPlans();
        return hydrateAndResolve();
    }

    window.PubiloAuth = {
        state,
        handleUnauthenticated() {
            renderLoginView('Session หมดอายุ กรุณา login ใหม่');
        },
    };

    window.PUBILO_AUTH_READY_PROMISE = authReadyPromise;
    bootstrap().catch((error) => {
        console.warn('[PubiloAuth] bootstrap failed:', error);
    });
})();
