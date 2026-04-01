(function () {
    const SHOW_BILLING_BANNER = false;
    const SKIP_SIGNUP_AND_BILLING_GATE = true;
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
        const shell = overlay.querySelector('.pubilo-auth-shell');
        const brand = overlay.querySelector('.pubilo-auth-brand');
        const card = overlay.querySelector('#pubiloAuthCard');

        // ซ่อน brand card + full width
        if (brand) brand.style.display = 'none';
        if (shell) {
            shell.style.gridTemplateColumns = '1fr';
            shell.style.maxWidth = '920px';
        }

        const isExpired = profile.workspace?.subscriptionStatus !== 'pending_payment';
        const wsName = profile.workspace?.name || profile.user?.name || 'Pubilo';
        const heading = isExpired ? 'แพ็กเกจหมดอายุแล้ว' : 'เลือกแพ็กเกจ';
        const subText = isExpired ? 'เลือกแพ็กเกจเพื่อต่ออายุการใช้งาน' : 'เลือกแพ็กเกจแล้วชำระผ่าน QR PromptPay ได้เลย';
        const btnText = isExpired ? 'ต่ออายุแพ็กเกจ' : 'ชำระเงิน';

        const checkSvg = `<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="8" fill="currentColor" opacity="0.15"/><path d="M5 8l2 2 4-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

        const features = {
            test_1: ['ทดสอบระบบ', '30 วัน'],
            monthly_500: ['โพสต์ไม่จำกัด', 'ตั้งเวลาอัตโนมัติ', 'Auto Hide Posts', 'รองรับหลายเพจ'],
            yearly_4499: ['ทุกอย่างใน Monthly', 'ประหยัด ฿1,501 ต่อปี', 'Priority Support', 'Early Access ฟีเจอร์ใหม่'],
        };

        const plansHtml = (state.plans || []).map((plan, index) => {
            const isYearly = plan.interval === 'yearly';
            const perUnit = isYearly ? '/ ปี' : '/ เดือน';
            const intervalTag = plan.code === 'test_1' ? 'TEST' : (isYearly ? 'YEARLY' : 'MONTHLY');
            const isHighlight = isYearly;
            const featureList = (features[plan.code] || []).map(f => `
                <li style="display:flex;align-items:center;gap:8px;padding:6px 0;font-size:0.9rem;">
                    <span style="color:${isHighlight ? '#a78bfa' : '#6b7280'};flex-shrink:0;">${checkSvg}</span>
                    <span style="color:${isHighlight ? '#e2e8f0' : '#4b5563'};">${f}</span>
                </li>
            `).join('');

            if (isHighlight) {
                return `
                    <div class="pubilo-big-plan-card" data-plan-card="${plan.code}" style="
                        position:relative;cursor:pointer;transition:all 0.3s ease;
                        border-radius:20px;padding:2px;
                        background:linear-gradient(135deg, #7c3aed, #a78bfa, #7c3aed);
                        background-size:200% 200%;
                        animation:gradientShift 3s ease infinite;
                    ">
                        <div style="
                            background:linear-gradient(135deg, #1e1145, #2d1b69);
                            border-radius:18px;padding:1.75rem;height:100%;
                            display:flex;flex-direction:column;
                        ">
                            <input type="radio" name="selectPlanCode" value="${plan.code}" ${index === 0 ? 'checked' : ''} style="display:none;" />
                            <div style="position:absolute;top:-14px;right:20px;">
                                <span style="
                                    background:linear-gradient(135deg, #f59e0b, #ef4444);
                                    color:#fff;padding:6px 14px;border-radius:999px;
                                    font-size:0.72rem;font-weight:700;letter-spacing:0.03em;
                                    box-shadow:0 4px 12px rgba(245,158,11,0.4);
                                    display:inline-flex;align-items:center;gap:4px;
                                ">🔥 ประหยัด 25%</span>
                            </div>
                            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1.25rem;">
                                <span style="font-weight:700;font-size:1.15rem;color:#e2e8f0;">${plan.label}</span>
                                <span style="background:rgba(167,139,250,0.2);padding:4px 10px;border-radius:999px;font-size:0.7rem;font-weight:600;color:#a78bfa;letter-spacing:0.05em;">${intervalTag}</span>
                            </div>
                            <div style="margin-bottom:1.25rem;">
                                <span style="font-size:2.4rem;font-weight:800;color:#fff;letter-spacing:-0.02em;">&#3647;${plan.amountThb.toLocaleString('th-TH')}</span>
                                <span style="color:#a78bfa;font-size:0.85rem;margin-left:4px;">${perUnit}</span>
                            </div>
                            <div style="background:rgba(255,255,255,0.06);border-radius:12px;padding:4px 0;margin-bottom:auto;">
                                <ul style="list-style:none;padding:0 12px;margin:0;">${featureList}</ul>
                            </div>
                        </div>
                    </div>
                `;
            }

            return `
                <div class="pubilo-big-plan-card ${index === 0 ? 'selected' : ''}" data-plan-card="${plan.code}" style="
                    border:2px solid #e5e7eb;border-radius:20px;padding:1.75rem;
                    cursor:pointer;transition:all 0.3s ease;background:#fff;position:relative;
                    display:flex;flex-direction:column;
                ">
                    <input type="radio" name="selectPlanCode" value="${plan.code}" ${index === 0 ? 'checked' : ''} style="display:none;" />
                    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1.25rem;">
                        <span style="font-weight:700;font-size:1.15rem;color:#1f2937;">${plan.label}</span>
                        <span style="background:#f2f4f7;padding:4px 10px;border-radius:999px;font-size:0.7rem;font-weight:600;color:#6b7280;letter-spacing:0.05em;">${intervalTag}</span>
                    </div>
                    <div style="margin-bottom:1.25rem;">
                        <span style="font-size:2.4rem;font-weight:800;color:#1f2937;letter-spacing:-0.02em;">&#3647;${plan.amountThb.toLocaleString('th-TH')}</span>
                        <span style="color:#9ca3af;font-size:0.85rem;margin-left:4px;">${perUnit}</span>
                    </div>
                    <div style="background:#f9fafb;border-radius:12px;padding:4px 0;margin-bottom:auto;">
                        <ul style="list-style:none;padding:0 12px;margin:0;">${featureList}</ul>
                    </div>
                </div>
            `;
        }).join('');

        card.innerHTML = `
            <style>
                @keyframes gradientShift {
                    0%, 100% { background-position: 0% 50%; }
                    50% { background-position: 100% 50%; }
                }
                @keyframes fadeInUp {
                    from { opacity: 0; transform: translateY(16px); }
                    to { opacity: 1; transform: translateY(0); }
                }
                .pubilo-plan-selector-form {
                    text-align: center;
                    display: grid;
                    gap: 24px;
                    animation: fadeInUp 0.5s ease;
                }
                .pubilo-plan-selector-form h2 {
                    margin: 0;
                    font-size: 1.9rem;
                    font-weight: 800;
                    color: #1f2937;
                    letter-spacing: -0.02em;
                }
                .pubilo-plan-selector-grid {
                    display: grid;
                    grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
                    gap: 20px;
                    text-align: left;
                }
                .pubilo-big-plan-card:not([style*="gradient"]):hover {
                    border-color: #7c3aed !important;
                    box-shadow: 0 0 0 3px rgba(124,58,237,0.1), 0 8px 24px rgba(0,0,0,0.08) !important;
                    transform: translateY(-2px);
                }
                .pubilo-big-plan-card.selected:not([style*="gradient"]) {
                    border-color: #7c3aed !important;
                    box-shadow: 0 0 0 3px rgba(124,58,237,0.15), 0 12px 32px rgba(124,58,237,0.12) !important;
                    background: #faf5ff !important;
                }
                .pubilo-plan-submit-btn {
                    width: 100%;
                    min-height: 56px;
                    border: none;
                    border-radius: 14px;
                    background: linear-gradient(135deg, #7c3aed, #6d28d9);
                    color: #fff;
                    font-size: 1.05rem;
                    font-weight: 700;
                    cursor: pointer;
                    transition: all 0.3s ease;
                    box-shadow: 0 4px 16px rgba(124,58,237,0.3);
                    letter-spacing: 0.01em;
                }
                .pubilo-plan-submit-btn:hover {
                    background: linear-gradient(135deg, #6d28d9, #5b21b6);
                    box-shadow: 0 8px 24px rgba(124,58,237,0.4);
                    transform: translateY(-1px);
                }
                .pubilo-plan-submit-btn:active {
                    transform: translateY(0);
                }
            </style>
            <form id="pubiloSelectPlanForm" class="pubilo-plan-selector-form">
                <div style="margin-bottom:4px;">
                    <span style="
                        display:inline-block;padding:4px 14px;border-radius:999px;
                        background:linear-gradient(135deg, rgba(124,58,237,0.1), rgba(167,139,250,0.15));
                        color:#7c3aed;font-size:0.8rem;font-weight:600;letter-spacing:0.03em;
                    ">${wsName}</span>
                </div>
                <h2>${heading}</h2>
                <p style="margin:0;color:#6b7280;font-size:0.95rem;max-width:480px;margin:0 auto;">${subText}</p>
                <div class="pubilo-plan-selector-grid">${plansHtml}</div>
                <button class="pubilo-plan-submit-btn" type="submit">${btnText}</button>
                <p class="pubilo-auth-note" id="pubiloSelectPlanNote" style="margin:0;font-size:0.85rem;"></p>
                <button type="button" class="pubilo-logout-link" id="pubiloSelectPlanLogout" style="
                    background:none;border:none;color:#9ca3af;font-size:0.85rem;
                    cursor:pointer;padding:4px;transition:color 0.2s;
                ">Logout</button>
            </form>
        `;

        card.querySelectorAll('[data-plan-card]').forEach((node) => {
            node.addEventListener('click', () => {
                card.querySelectorAll('[data-plan-card]').forEach((item) => {
                    item.classList.remove('selected');
                    // Reset non-gradient cards
                    if (!item.style.background?.includes('gradient')) {
                        item.style.borderColor = '#e5e7eb';
                        item.style.boxShadow = 'none';
                        item.style.background = '#fff';
                        item.style.transform = '';
                    }
                });
                node.classList.add('selected');
                if (!node.style.background?.includes('gradient')) {
                    node.style.borderColor = '#7c3aed';
                    node.style.boxShadow = '0 0 0 3px rgba(124,58,237,0.15), 0 12px 32px rgba(124,58,237,0.12)';
                    node.style.background = '#faf5ff';
                }
                const input = node.querySelector('input');
                if (input) input.checked = true;
            });
        });

        // Auto-select first card visual
        const firstCard = card.querySelector('[data-plan-card]');
        if (firstCard && !firstCard.style.background?.includes('gradient')) {
            firstCard.style.borderColor = '#7c3aed';
            firstCard.style.boxShadow = '0 0 0 3px rgba(124,58,237,0.15)';
            firstCard.style.background = '#faf5ff';
        }

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
                    renderPaymentView(data.paymentOrder.id);
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
            // Temporary bypass: allow entering app even if onboarding/payment is pending.
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
