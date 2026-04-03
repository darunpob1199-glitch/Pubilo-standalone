(function () {
    const SHOW_BILLING_BANNER = false;
    const SKIP_SIGNUP_AND_BILLING_GATE = false;
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
    const AUTH_FLOW_HISTORY_KEY = '__pubiloAuthFlow';

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

    function readAuthFlowState() {
        const current = window.history.state;
        if (!current || current[AUTH_FLOW_HISTORY_KEY] !== true) return null;
        return current;
    }

    function writeAuthFlowState(view, data = {}, mode = 'replace') {
        const nextState = {
            ...(window.history.state && typeof window.history.state === 'object' ? window.history.state : {}),
            ...data,
            [AUTH_FLOW_HISTORY_KEY]: true,
            authFlowView: view,
        };

        if (mode === 'push') {
            window.history.pushState(nextState, '', window.location.href);
            return;
        }

        window.history.replaceState(nextState, '', window.location.href);
    }

    function clearAuthFlowState() {
        const current = window.history.state;
        if (!current || current[AUTH_FLOW_HISTORY_KEY] !== true) return;
        const nextState = { ...current };
        delete nextState[AUTH_FLOW_HISTORY_KEY];
        delete nextState.authFlowView;
        delete nextState.orderId;
        window.history.replaceState(Object.keys(nextState).length ? nextState : null, '', window.location.href);
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
            <div class="pubilo-top-left-logo" style="position:absolute; top:32px; left:48px; display:flex; align-items:center; gap:12px; z-index:20;">
                <svg width="32" height="32" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M50 15L85 32.5L50 50L15 32.5L50 15Z" fill="#3b82f6"/>
                    <path d="M50 35L85 52.5L50 70L15 52.5L50 35Z" stroke="#93c5fd" stroke-width="8" fill="none"/>
                    <path d="M50 55L85 72.5L50 90L15 72.5L50 55Z" stroke="#5b21b6" stroke-width="8" fill="none"/>
                </svg>
                <span style="font-size:22px; font-weight:600; color:#1e293b; letter-spacing:-0.5px;">pubilo</span>
            </div>
            <div class="pubilo-auth-shell" style="width:100%; max-width:1100px; margin:0 auto; display:flex; align-items:center; justify-content:space-between; height:100vh;">
                <div class="pubilo-auth-brand" style="flex:1; position:relative;">
                    <div style="position:relative; max-width:480px;">
                        
                        <!-- Chat Bubbles -->
                        <div style="position:absolute; top:-120px; right:-80px; display:flex; flex-direction:column; align-items:flex-end; gap:8px;">
                            <div style="background:rgba(255,255,255,0.4); backdrop-filter:blur(4px); padding:8px 16px; border-radius:100px; font-size:12px; color:#94a3b8; filter:blur(1px);">Of course, John.</div>
                            <div style="background:rgba(255,255,255,0.7); backdrop-filter:blur(8px); padding:8px 16px; border-radius:100px; font-size:12px; color:#475569; position:relative; right:10px;">I can help you with that.</div>
                            <div style="background:#ffffff; padding:10px 16px; border-radius:100px; font-size:12px; font-weight:500; color:#1e293b; box-shadow:0 4px 12px rgba(0,0,0,0.05); position:relative; right:5px;">Give me just one second, okay?</div>
                            <div style="background:#ffffff; padding:10px 16px; border-radius:100px; font-size:12px; font-weight:500; color:#1e293b; box-shadow:0 4px 12px rgba(0,0,0,0.05);">I'll need to verify your identity first, though.</div>
                        </div>

                        <!-- Dots -->
                        <div style="position:absolute; width:6px; height:6px; background:#a5b4fc; border-radius:50%; top:20px; left:-20px;"></div>
                        <div style="position:absolute; width:10px; height:10px; background:#bfdbfe; border-radius:50%; top:60px; left:-10px;"></div>
                        <div style="position:absolute; width:4px; height:4px; background:#60a5fa; border-radius:50%; bottom:-10px; left:40px;"></div>

                        <!-- Main Title -->
                        <div style="margin-left:20px;">
                            <div style="font-size:14px; letter-spacing:6px; color:#94a3b8; font-weight:600; margin-bottom:0px; text-transform:uppercase;">THE</div>
                            <h1 style="font-size:80px; line-height:1; font-weight:400; color:#1e293b; letter-spacing:-4px; margin:0;">pubilo</h1>
                            <div style="font-size:14px; letter-spacing:8px; color:#cbd5e1; font-weight:600; margin-top:0px; text-transform:uppercase; margin-left:4px;">FUTURE</div>
                        </div>
                    </div>
                </div>
                <div class="pubilo-auth-card" id="pubiloAuthCard" style="flex:0 0 420px; z-index:10;"></div>
            </div>
        `;
        document.body.appendChild(overlay);
        return overlay;
    }

    function setOverlayVariant(variant) {
        const overlay = ensureOverlay();
        const shell = overlay.querySelector('.pubilo-auth-shell');
        const brand = overlay.querySelector('.pubilo-auth-brand');
        const card = overlay.querySelector('#pubiloAuthCard');

        overlay.classList.remove('pubilo-auth-overlay--billing-gate');
        shell?.classList.remove('pubilo-auth-shell--billing-gate');
        shell?.classList.remove('pubilo-auth-shell--payment-only');
        card?.classList.remove('pubilo-auth-card--billing-gate');
        card?.classList.remove('pubilo-auth-card--payment-only');

        if (variant === 'billing-gate') {
            overlay.classList.add('pubilo-auth-overlay--billing-gate');
            shell?.classList.add('pubilo-auth-shell--billing-gate');
            card?.classList.add('pubilo-auth-card--billing-gate');
            if (brand) brand.style.display = 'none';
            return;
        }

        if (variant === 'payment-only') {
            shell?.classList.add('pubilo-auth-shell--payment-only');
            card?.classList.add('pubilo-auth-card--payment-only');
            if (brand) brand.style.display = 'none';
            return;
        }

        if (brand) brand.style.display = '';
    }

    function renderLoginView(message) {
        const overlay = ensureOverlay();
        setOverlayVariant('default');
        overlay.classList.remove('is-hidden');
        writeAuthFlowState('login');
        const card = overlay.querySelector('#pubiloAuthCard');
        const loginUrl = `${window.API_BASE}/api/auth/login/line?returnTo=${encodeURIComponent(window.location.href)}`;
        card.innerHTML = `
            <div class="pubilo-auth-panel" style="padding: 40px;">
                <h2 style="font-size: 22px; font-weight: 600; color: #1e293b; margin-bottom: 24px; text-align: center;">เข้าสู่ระบบจัดการบัญชี</h2>
                <div style="display:flex; justify-content:center; gap: 16px; margin-bottom: 32px; font-size:14px; font-weight:500;">
                    <span style="color: #3b82f6; border-bottom: 2px solid #3b82f6; padding-bottom: 8px;">บัญชี LINE ของคุณ</span>
                </div>
                ${message ? `<p class="pubilo-auth-error">${message}</p>` : ''}
                <a class="pubilo-auth-provider-btn" href="${loginUrl}" style="background-color: #3b82f6; gap: 10px; width: 100%; border-radius: 8px;">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path d="M24 10.304C24 4.612 18.627 0 12 0C5.373 0 0 4.612 0 10.304C0 15.352 4.225 19.588 9.944 20.407C10.332 20.489 11.218 20.73 11.4 21.431C11.564 22.062 11.127 23.444 11.127 23.444C11.127 23.444 10.875 24.582 12.183 23.518C13.491 22.454 19.324 16.924 22.115 13.9C23.407 12.518 24 11.481 24 10.304ZM7.279 13.111H4.636C4.285 13.111 4 12.826 4 12.475V6.786C4 6.435 4.285 6.15 4.636 6.15H7.279C7.63 6.15 7.915 6.435 7.915 6.786C7.915 7.137 7.63 7.422 7.279 7.422H5.272V11.839H7.279C7.63 11.839 7.915 12.124 7.915 12.475C7.915 12.826 7.63 13.111 7.279 13.111ZM10.513 13.111H9.241C8.89 13.111 8.605 12.826 8.605 12.475V6.786C8.605 6.435 8.89 6.15 9.241 6.15H10.513C10.864 6.15 11.149 6.435 11.149 6.786V12.475C11.149 12.826 10.864 13.111 10.513 13.111ZM16.353 13.111H14.154C13.987 13.111 13.824 13.045 13.705 12.927C13.585 12.808 13.518 12.645 13.518 12.475V6.786C13.518 6.435 13.803 6.15 14.154 6.15C14.505 6.15 14.79 6.435 14.79 6.786V11.082L17.202 6.4C17.29 6.241 17.433 6.15 17.587 6.15H18.868C19.219 6.15 19.504 6.435 19.504 6.786V13.111C19.504 13.462 19.219 13.747 18.868 13.747C18.517 13.747 18.232 13.462 18.232 13.111V8.815L15.82 13.497C15.732 13.656 15.589 13.747 15.435 13.747C15.432 13.747 15.428 13.747 15.425 13.747C15.42 13.747 16.353 13.111 16.353 13.111Z" fill="white"/>
                    </svg>
                    <span style="font-weight: 500; letter-spacing: 0.5px;">เข้าสู่ระบบด้วย LINE</span>
                </a>
            </div>
        `;
    }

    function getPublicBillingPlans() {
        const plans = Array.isArray(state.plans) ? state.plans : [];
        const filteredPlans = plans.filter((plan) => plan.code !== 'test_1');
        return filteredPlans.length ? filteredPlans : plans;
    }

    function renderOnboardingView(profile) {
        const overlay = ensureOverlay();
        setOverlayVariant('default');
        overlay.classList.remove('is-hidden');
        writeAuthFlowState('onboarding');
        const card = overlay.querySelector('#pubiloAuthCard');
        const defaultName = `${(profile?.user?.name || 'My').split(' ')[0]} Workspace`;
        const plansHtml = getPublicBillingPlans().map((plan, index) => `
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
                <p class="pubilo-auth-copy">เลือกราคาแพ็กเกจแล้วระบบจะสร้าง workspace และเปิด QR PromptPay ให้ชำระได้ทันที</p>
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

    function renderPaymentView(orderId, options = {}) {
        const overlay = ensureOverlay();
        setOverlayVariant('payment-only');
        overlay.classList.remove('is-hidden');
        writeAuthFlowState('payment', { orderId }, options.historyMode || 'push');
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
    function renderPlanSelectionView(profile, options = {}) {
        const overlay = ensureOverlay();
        setOverlayVariant('billing-gate');
        overlay.classList.remove('is-hidden');
        writeAuthFlowState('plan-selection', {}, options.historyMode || 'replace');
        const shell = overlay.querySelector('.pubilo-auth-shell');
        const brand = overlay.querySelector('.pubilo-auth-brand');
        const card = overlay.querySelector('#pubiloAuthCard');

        const isExpired = profile.workspace?.subscriptionStatus !== 'pending_payment';
        const wsName = profile.workspace?.name || profile.user?.name || 'Pubilo';
        const heading = isExpired ? 'แพ็กเกจหมดอายุแล้ว' : 'เลือกแพ็กเกจ';
        const subText = isExpired ? 'เลือกแพ็กเกจเพื่อต่ออายุการใช้งาน และปลดล็อกการใช้งานต่อทันทีหลังชำระเงิน' : 'เลือกแพ็กเกจแล้วชำระผ่าน QR PromptPay ได้เลย';

        const features = {
            test_1: ['✓ ทดสอบระบบ', '✓ 30 วัน'],
            monthly_500: ['✓ โพสต์ไม่จำกัด', '✓ ตั้งเวลาอัตโนมัติ', '✓ จัดการคิวโพสต์', '✓ รองรับหลายเพจ'],
            yearly_4499: ['✓ ทุกอย่างใน Monthly', '✓ ประหยัด ฿1,501 ต่อปี', '✓ Priority Support', '✓ Early Access ฟีเจอร์ใหม่'],
        };

        const visiblePlans = (() => {
            const plans = getPublicBillingPlans();
            const priorityCodes = ['monthly_500', 'yearly_4499'];
            const prioritized = priorityCodes
                .map((code) => plans.find((plan) => plan.code === code))
                .filter(Boolean);
            if (prioritized.length) {
                return prioritized;
            }
            return plans;
        })();

        const currentPlanCode = profile.workspace?.planCode || profile.workspace?.plan_code || '';
        const defaultPlanCode = (() => {
            if (['monthly_500', 'yearly_4499'].includes(currentPlanCode)) return currentPlanCode;
            if (visiblePlans.some((plan) => plan.code === 'monthly_500')) return 'monthly_500';
            return visiblePlans[0]?.code || '';
        })();

        const plansHtml = visiblePlans.map((plan) => {
            const isSelected = plan.code === defaultPlanCode;
            const isYearly = plan.interval === 'yearly';
            const isTestPlan = plan.code === 'test_1';
            const intervalTag = plan.code === 'test_1' ? 'TEST' : (isYearly ? 'YEARLY' : 'MONTHLY');
            const helperText = plan.code === 'test_1'
                ? 'ใช้ทดสอบ flow จ่ายเงินจริง'
                : (isYearly ? 'คุ้มที่สุด ประหยัด 25%' : 'เริ่มใช้งานได้ทันที');
            const featureIntro = plan.code === 'yearly_4499'
                ? 'สิ่งที่จะได้รับเหมือนรายเดือน และ:'
                : isTestPlan
                    ? 'สำหรับลอง flow payment:'
                : 'สิ่งที่คุณจะได้รับ:';
            const ctaText = isTestPlan
                ? 'ลองโอน 1 บาท'
                : (plan.code === currentPlanCode && isExpired ? 'เปิดใช้งานใหม่' : 'เลือกแพ็กเกจนี้');
            const featureList = (features[plan.code] || []).map((feature) => `
                <li class="pubilo-upgrade-feature-item">
                    <span class="pubilo-upgrade-feature-check">✓</span>
                    <span>${feature.replace(/^✓\s*/, '')}</span>
                </li>
            `).join('');

            return `
                <label class="pubilo-upgrade-card ${isSelected ? 'selected' : ''} ${isTestPlan ? 'is-compact' : ''}" data-plan-card="${plan.code}">
                    ${isYearly ? '<div class="pubilo-upgrade-badge">ประหยัด 25%</div>' : ''}
                    <input type="radio" name="selectPlanCode" value="${plan.code}" ${isSelected ? 'checked' : ''} />
                    <div class="pubilo-upgrade-top">
                        <span class="pubilo-upgrade-title">${plan.label}</span>
                        <span class="pubilo-upgrade-tag">${intervalTag}</span>
                    </div>
                    <div class="pubilo-upgrade-price-row">
                        <strong>฿${plan.amountThb.toLocaleString('th-TH')}</strong>
                        <span class="pubilo-upgrade-price-suffix">${isYearly ? '/ บัญชี<br>ต่อปี' : '/ บัญชี<br>ต่อเดือน'}</span>
                    </div>
                    <p class="pubilo-upgrade-section-title">${featureIntro}</p>
                    <ul class="pubilo-upgrade-features">${featureList}</ul>
                    <div class="pubilo-upgrade-footer">
                        <button type="submit" class="pubilo-upgrade-cta" data-plan-submit="${plan.code}">
                            ${ctaText}
                        </button>
                        <p class="pubilo-upgrade-helper">${helperText}</p>
                    </div>
                </label>
            `;
        }).join('');

        card.innerHTML = `
            <form id="pubiloSelectPlanForm" class="pubilo-upgrade-panel">
                <div style="margin-bottom:4px;">
                    <span class="pubilo-auth-label">${wsName}</span>
                </div>
                <h2 class="pubilo-upgrade-heading">${heading}</h2>
                <p class="pubilo-upgrade-subtext">${subText}</p>
                <div class="pubilo-upgrade-grid">${plansHtml}</div>
                <p class="pubilo-auth-note" id="pubiloSelectPlanNote" style="margin:0;"></p>
                <button type="button" class="pubilo-logout-link" id="pubiloSelectPlanLogout">Logout</button>
            </form>
        `;

        card.querySelectorAll('[data-plan-card]').forEach((node) => {
            node.addEventListener('click', () => {
                card.querySelectorAll('[data-plan-card]').forEach((item) => {
                    item.classList.remove('selected');
                });
                node.classList.add('selected');
                const input = node.querySelector('input');
                if (input) input.checked = true;
            });
        });

        card.querySelectorAll('[data-plan-submit]').forEach((button) => {
            button.addEventListener('click', (event) => {
                const planCode = button.getAttribute('data-plan-submit');
                const matchingCard = card.querySelector(`[data-plan-card="${planCode}"]`);
                const matchingInput = card.querySelector(`input[name="selectPlanCode"][value="${planCode}"]`);
                if (matchingCard) {
                    card.querySelectorAll('[data-plan-card]').forEach((item) => item.classList.remove('selected'));
                    matchingCard.classList.add('selected');
                }
                if (matchingInput) matchingInput.checked = true;
                event.stopPropagation();
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

            try {
                const response = await nativeFetch('/api/billing/checkout-intent', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ planCode }),
                });
                const data = await response.json();
                console.log('[PubiloAuth] checkout-intent response:', response.status, data);

                if (!response.ok || !data.success) {
                    note.textContent = data.error || `สร้าง order ไม่สำเร็จ (${response.status})`;
                    return;
                }

                note.textContent = 'สร้าง Order สำเร็จ กำลังไปหน้าชำระเงิน...';
                const freshState = await fetchAuthState();
                applyAuthState(freshState);
                if (data.paymentOrder?.id) {
                    state.latestPaymentOrder = {
                        id: data.paymentOrder.id,
                        status: 'pending',
                        amount_thb: data.paymentOrder.amountThb,
                        plan_code: planCode,
                    };
                    renderPaymentView(data.paymentOrder.id, { historyMode: 'push' });
                } else {
                    note.textContent = 'สร้าง order สำเร็จแต่ไม่มี paymentOrder id';
                }
            } catch (err) {
                console.error('[PubiloAuth] checkout-intent error:', err);
                note.textContent = `เกิดข้อผิดพลาด: ${err.message}`;
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

    async function refreshState(options = {}) {
        if (options.rehydrate) {
            return hydrateAndResolve();
        }

        const payload = await fetchAuthState();
        applyAuthState(payload);
        ensureHeaderControls();
        ensureBillingBanner();
        return payload;
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

        if (SKIP_SIGNUP_AND_BILLING_GATE) {
            document.body.classList.add('pubilo-authenticated');
            ensureOverlay().classList.add('is-hidden');
            ensureHeaderControls();
            ensureBillingBanner();
            resolveAuthReadyPromise?.(payload);
            return payload;
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
        clearAuthFlowState();
        ensureHeaderControls();
        ensureBillingBanner();
        resolveAuthReadyPromise?.(payload);
        return payload;
    }

    async function bootstrap() {
        await domReady;
        ensureOverlay();
        state.plans = await fetchPlans();
        window.addEventListener('popstate', async () => {
            const authState = readAuthFlowState();
            if (!authState) return;

            const payload = await fetchAuthState();
            applyAuthState(payload);

            if (!payload.authenticated) {
                renderLoginView(authErrorMessage());
                return;
            }

            if (payload.onboardingRequired || !payload.workspace) {
                renderOnboardingView(payload);
                return;
            }

            const subStatus = payload.workspace?.subscriptionStatus;
            const periodEnd = payload.workspace?.subscriptionPeriodEnd;
            const isPeriodExpired = periodEnd ? new Date(periodEnd) < new Date() : false;
            const needsPayment =
                subStatus === 'pending_payment' ||
                (!subStatus && payload.workspace) ||
                (subStatus === 'cancelled' && isPeriodExpired) ||
                (subStatus === 'active' && isPeriodExpired);

            if (!needsPayment) {
                document.body.classList.add('pubilo-authenticated');
                ensureOverlay().classList.add('is-hidden');
                clearAuthFlowState();
                ensureHeaderControls();
                ensureBillingBanner();
                return;
            }

            if (authState.authFlowView === 'payment' && authState.orderId && payload.latestPaymentOrder?.status !== 'paid') {
                const orderId = payload.latestPaymentOrder?.id || authState.orderId;
                renderPaymentView(orderId, { historyMode: 'replace' });
                return;
            }

            if (authState.authFlowView === 'plan-selection') {
                renderPlanSelectionView(payload, { historyMode: 'replace' });
                return;
            }

            if (authState.authFlowView === 'onboarding') {
                renderOnboardingView(payload);
                return;
            }

            if (authState.authFlowView === 'login') {
                renderLoginView(authErrorMessage());
            }
        });
        return hydrateAndResolve();
    }

    window.PubiloAuth = {
        state,
        refreshState,
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
