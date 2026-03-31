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
        // Keep overlay hidden by default to avoid flash on refresh for authenticated users.
        overlay.className = 'pubilo-auth-overlay is-hidden';
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
        overlay.classList.remove('is-hidden');
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
        overlay.classList.remove('is-hidden');
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
                <button type="button" class="pubilo-logout-link" id="pubiloOnboardingLogout">Logout</button>
            </form>
        `;

        card.querySelector('#pubiloOnboardingLogout').addEventListener('click', async () => {
            await nativeFetch('/api/auth/logout', { method: 'POST' });
            window.location.reload();
        });

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

            note.textContent = 'สร้าง workspace แล้ว กำลังไปหน้าชำระเงิน...';
            const freshState = await fetchAuthState();
            applyAuthState(freshState);
            if (freshState.latestPaymentOrder?.id && freshState.latestPaymentOrder?.status !== 'paid') {
                renderPaymentView(freshState.latestPaymentOrder.id);
            } else {
                await hydrateAndResolve();
            }
        });
    }

    // ===== Payment QR View =====
    let paymentPollTimer = null;

    function renderPaymentView(orderId) {
        const overlay = ensureOverlay();
        overlay.classList.remove('is-hidden');
        const card = overlay.querySelector('#pubiloAuthCard');
        const amount = state.latestPaymentOrder?.amount_thb || 0;
        const planLabel = state.plans?.find((p) => p.code === state.latestPaymentOrder?.plan_code)?.label || '';

        card.innerHTML = `
            <div class="pubilo-auth-panel pubilo-payment-panel">
                <p class="pubilo-auth-label">ชำระเงิน</p>
                <h2>สแกน QR เพื่อชำระ &#3647;${Number(amount).toLocaleString('th-TH')}</h2>
                <p class="pubilo-auth-copy">${planLabel} — สแกนผ่านแอปธนาคารหรือ e-wallet</p>
                <div class="pubilo-qr-area" id="pubiloQrArea">
                    <p>กำลังสร้าง QR code...</p>
                </div>
                <div class="pubilo-payment-status" id="pubiloPaymentStatus"></div>
                <p class="pubilo-auth-note" id="pubiloPaymentNote"></p>
                <button type="button" class="pubilo-logout-link" id="pubiloPaymentLogout">Logout</button>
            </div>
        `;

        card.querySelector('#pubiloPaymentLogout').addEventListener('click', async () => {
            await nativeFetch('/api/auth/logout', { method: 'POST' });
            window.location.reload();
        });

        generateQr(orderId);
    }

    async function generateQr(orderId) {
        const qrArea = document.getElementById('pubiloQrArea');
        const statusEl = document.getElementById('pubiloPaymentStatus');
        const noteEl = document.getElementById('pubiloPaymentNote');

        try {
            const res = await nativeFetch('/api/billing/create-payment', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ orderId }),
            });
            const data = await res.json();

            if (!res.ok || !data.success) {
                qrArea.innerHTML = `<p class="pubilo-auth-error">${data.error || 'สร้าง QR ไม่สำเร็จ'}</p>`;
                return;
            }

            let qrHtml = '';
            if (data.qrBase64) {
                qrHtml = `<img src="data:image/png;base64,${data.qrBase64}" alt="QR PromptPay" class="pubilo-qr-image" />`;
            }

            if (data.urlpay) {
                qrHtml += `<a href="${data.urlpay}" target="_blank" class="pubilo-pay-link">เปิดลิงก์ชำระเงิน</a>`;
            }

            qrArea.innerHTML = qrHtml || '<p>ไม่สามารถสร้าง QR ได้</p>';

            if (data.timeOut > 0) {
                noteEl.textContent = `หมดเวลาใน ${Math.ceil(data.timeOut / 60)} นาที`;
            }

            statusEl.innerHTML = '<p class="pubilo-status-waiting">รอการชำระเงิน...</p>';
            startPaymentPolling(orderId);
        } catch (err) {
            qrArea.innerHTML = `<p class="pubilo-auth-error">เกิดข้อผิดพลาด: ${err.message}</p>`;
        }
    }

    function startPaymentPolling(orderId) {
        if (paymentPollTimer) clearInterval(paymentPollTimer);

        paymentPollTimer = setInterval(async () => {
            try {
                const res = await nativeFetch(`/api/billing/payment-status/${orderId}`);
                const data = await res.json();
                if (!data.success) return;

                const statusEl = document.getElementById('pubiloPaymentStatus');
                const noteEl = document.getElementById('pubiloPaymentNote');

                if (data.status === 'paid') {
                    clearInterval(paymentPollTimer);
                    paymentPollTimer = null;
                    if (statusEl) statusEl.innerHTML = '<p class="pubilo-status-success">ชำระเงินสำเร็จ!</p>';
                    if (noteEl) noteEl.textContent = 'กำลังเข้าสู่ระบบ...';
                    setTimeout(() => hydrateAndResolve(), 1500);
                    return;
                }

                if (data.status === 'expired') {
                    clearInterval(paymentPollTimer);
                    paymentPollTimer = null;
                    if (statusEl) statusEl.innerHTML = '<p class="pubilo-auth-error">QR หมดอายุ</p>';
                    if (noteEl) noteEl.innerHTML = '<button class="pubilo-primary-btn" id="pubiloRetryPayment">สร้าง QR ใหม่</button>';
                    document.getElementById('pubiloRetryPayment')?.addEventListener('click', () => renderPaymentView(orderId));
                    return;
                }

                if (data.timeOut > 0 && noteEl) {
                    noteEl.textContent = `หมดเวลาใน ${Math.ceil(data.timeOut / 60)} นาที`;
                }
            } catch {}
        }, 5000);
    }

    // ===== Plan Selection View (pending_payment / expired / renewal) =====
    function renderPlanSelectionView(profile) {
        const overlay = ensureOverlay();
        overlay.classList.remove('is-hidden');
        const card = overlay.querySelector('#pubiloAuthCard');
        const subtitle = overlay.querySelector('#pubiloAuthSubtitle');

        const isExpired = profile.workspace?.subscriptionStatus !== 'pending_payment';
        if (subtitle) subtitle.textContent = isExpired ? 'กรุณาต่ออายุเพื่อใช้งานต่อ' : 'เลือกแพ็กเกจเพื่อเริ่มใช้งาน';

        const wsName = profile.workspace?.name || profile.user?.name || 'Pubilo';
        const heading = isExpired ? 'แพ็กเกจหมดอายุแล้ว' : 'เลือกแพ็กเกจ';
        const btnText = isExpired ? 'ต่ออายุแพ็กเกจ' : 'ชำระเงิน';

        const plansHtml = (state.plans || []).map((plan, index) => {
            const isYearly = plan.interval === 'yearly';
            const badge = isYearly ? '<span class="pubilo-plan-badge">ประหยัด 25%</span>' : '';
            return `
                <label class="pubilo-plan-card ${index === 0 ? 'selected' : ''}" data-plan-card="${plan.code}">
                    <input type="radio" name="selectPlanCode" value="${plan.code}" ${index === 0 ? 'checked' : ''} />
                    ${badge}
                    <div class="pubilo-plan-top">
                        <span class="pubilo-plan-name">${plan.label}</span>
                        <strong>&#3647;${plan.amountThb.toLocaleString('th-TH')}</strong>
                    </div>
                    <p>${plan.description}</p>
                    <span class="pubilo-plan-duration">${plan.durationDays} วัน</span>
                </label>
            `;
        }).join('');

        card.innerHTML = `
            <form class="pubilo-auth-panel" id="pubiloSelectPlanForm">
                <p class="pubilo-auth-label">${wsName}</p>
                <h2>${heading}</h2>
                <p class="pubilo-auth-copy">เลือกแพ็กเกจแล้วชำระผ่าน QR PromptPay ได้เลย</p>
                <div class="pubilo-plan-grid">${plansHtml}</div>
                <button class="pubilo-primary-btn" type="submit">${btnText}</button>
                <p class="pubilo-auth-note" id="pubiloSelectPlanNote"></p>
                <button type="button" class="pubilo-logout-link" id="pubiloSelectPlanLogout">Logout</button>
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

        card.querySelector('#pubiloSelectPlanLogout').addEventListener('click', async () => {
            await nativeFetch('/api/auth/logout', { method: 'POST' });
            window.location.reload();
        });

        const form = card.querySelector('#pubiloSelectPlanForm');
        const note = card.querySelector('#pubiloSelectPlanNote');
        form.addEventListener('submit', async (event) => {
            event.preventDefault();
            const planCode = form.querySelector('input[name="selectPlanCode"]:checked')?.value;
            if (!planCode) {
                note.textContent = 'เลือกแพ็กเกจก่อน';
                return;
            }
            note.textContent = 'กำลังสร้าง Order...';

            const response = await nativeFetch('/api/billing/checkout-intent', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ planCode }),
            });
            const data = await response.json();
            if (!response.ok || !data.success) {
                note.textContent = data.error || 'สร้าง order ไม่สำเร็จ';
                return;
            }

            const freshState = await fetchAuthState();
            applyAuthState(freshState);
            if (data.paymentOrder?.id) {
                state.latestPaymentOrder = {
                    id: data.paymentOrder.id,
                    status: 'pending',
                    amount_thb: data.paymentOrder.amountThb,
                    plan_code: planCode,
                };
                renderPaymentView(data.paymentOrder.id);
            }
        });
    }

    function getDaysRemaining() {
        const periodEnd = state.workspace?.subscriptionPeriodEnd;
        if (!periodEnd) return null;
        const diff = new Date(periodEnd) - new Date();
        if (diff <= 0) return 0;
        return Math.ceil(diff / (24 * 60 * 60 * 1000));
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
        const daysLeft = getDaysRemaining();
        const daysHtml = daysLeft !== null
            ? `<span class="pubilo-days-badge${daysLeft <= 7 ? ' is-warning' : ''}">${daysLeft} วัน</span>`
            : '';
        chip.innerHTML = `
            <span class="pubilo-workspace-label">${workspaceName}</span>
            ${daysHtml}
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

        // เช็ค subscription ที่ต้องจ่ายเงิน / หมดอายุ / ไม่มี
        const subStatus = payload.workspace?.subscriptionStatus;
        const periodEnd = payload.workspace?.subscriptionPeriodEnd;
        const isPeriodExpired = periodEnd ? new Date(periodEnd) < new Date() : false;
        const needsPayment =
            subStatus === 'pending_payment' ||
            (!subStatus && payload.workspace) ||
            (subStatus === 'cancelled' && isPeriodExpired) ||
            (subStatus === 'active' && isPeriodExpired);

        if (needsPayment) {
            renderPlanSelectionView(payload);
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
        handleSubscriptionRequired() {
            hydrateAndResolve();
        },
    };

    window.PUBILO_AUTH_READY_PROMISE = authReadyPromise;
    bootstrap().catch((error) => {
        console.warn('[PubiloAuth] bootstrap failed:', error);
    });
})();
