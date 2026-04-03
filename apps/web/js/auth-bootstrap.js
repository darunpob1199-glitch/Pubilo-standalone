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

    function getSafeReturnToUrl() {
        const currentUrl = new URL(window.location.href);
        const safeUrl = new URL('/', window.location.origin);

        if (!currentUrl.pathname.startsWith('/api/')) {
            safeUrl.pathname = currentUrl.pathname || '/';
        }

        safeUrl.search = currentUrl.search;
        safeUrl.hash = currentUrl.hash;
        return safeUrl.toString();
    }

    function redirectToPublicEntry() {
        window.location.replace(new URL('/', window.location.origin).toString());
    }

    function setAppShellAuthenticated(isAuthenticated) {
        document.body.classList.toggle('pubilo-authenticated', !!isAuthenticated);
    }

    function ensureOverlay() {
        let overlay = document.getElementById('pubiloAuthOverlay');
        if (overlay) {
            overlay.classList.add('pubilo-auth-overlay');
            return overlay;
        }

        overlay = document.createElement('div');
        overlay.id = 'pubiloAuthOverlay';
        overlay.className = 'pubilo-auth-overlay is-hidden';
        overlay.innerHTML = `
            <div class="pubilo-auth-shell">
                <div class="pubilo-auth-brand">
                    <!-- Top Left Logo -->
                    <div style="display:flex; align-items:center; gap:12px; margin-bottom:auto;">
                        <svg width="36" height="36" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <path d="M50 68 L80 84 L50 100 L20 84 Z" stroke="#C084FC" stroke-width="8" stroke-linejoin="round"/>
                            <path d="M50 50 L80 66 L50 82 L20 66 Z" stroke="#94A3B8" stroke-width="8" stroke-linejoin="round"/>
                            <path d="M50 16 L84 34 L50 52 L16 34 Z" fill="#8B5CF6"/>
                            <path d="M84 34 L50 52 L50 62 L84 44 Z" fill="#7C3AED"/>
                            <path d="M16 34 L50 52 L50 62 L16 44 Z" fill="#A78BFA"/>
                        </svg>
                        <span style="font-size:24px; font-weight:700; color:white; font-family:'Montserrat', sans-serif; letter-spacing:-0.5px;">Pubilo</span>
                    </div>

                    <!-- Welcome Text at Bottom -->
                    <div style="margin-top:auto;" id="pubiloBrandTextWrap">
                        <h1 style="font-size:52px; font-weight:800; margin-bottom:20px; color:white; line-height:1.15; letter-spacing:-1.5px; font-family:'Montserrat', sans-serif;">Work Smarter.<br>Organize Faster.<br>Manage Anywhere.</h1>
                        <p style="font-size:16px; opacity:0.85; margin-bottom:40px; line-height:1.6; color:white; max-width: 440px; font-weight: 500; font-family:'Montserrat', sans-serif;">From quick team updates to full-length policies, our powerful platform lets you collaborate seamlessly across devices.</p>
                        <div style="display:flex; gap:12px; align-items:center;">
                          <div style="width:32px; height:6px; border-radius:6px; background:white;"></div>
                          <div style="width:8px; height:8px; border-radius:50%; background:rgba(255,255,255,0.3);"></div>
                          <div style="width:8px; height:8px; border-radius:50%; background:rgba(255,255,255,0.3);"></div>
                        </div>
                    </div>
                </div>
                <!-- Right Side Container -->
                <div id="pubiloRightContainer">
                    <div class="pubilo-auth-card" id="pubiloAuthCard"></div>
                </div>
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
        const rightContainer = overlay.querySelector('#pubiloRightContainer');

        overlay.classList.remove('pubilo-auth-overlay--billing-gate', 'pubilo-auth-overlay--onboarding');
        shell?.classList.remove('pubilo-auth-shell--billing-gate', 'pubilo-auth-shell--payment-only', 'pubilo-auth-shell--onboarding');
        card?.classList.remove('pubilo-auth-card--billing-gate', 'pubilo-auth-card--payment-only', 'pubilo-auth-card--onboarding');

        if (variant === 'billing-gate') {
            overlay.classList.add('pubilo-auth-overlay--billing-gate');
            shell?.classList.add('pubilo-auth-shell--billing-gate');
            card?.classList.add('pubilo-auth-card--billing-gate');
            if (brand) brand.style.display = 'none';
            if (rightContainer) rightContainer.style.flex = '1';
            return;
        }

        if (variant === 'payment-only') {
            shell?.classList.add('pubilo-auth-shell--payment-only');
            card?.classList.add('pubilo-auth-card--payment-only');
            if (brand) brand.style.display = 'none';
            if (rightContainer) rightContainer.style.flex = '1';
            return;
        }

        if (variant === 'onboarding') {
            overlay.classList.add('pubilo-auth-overlay--onboarding');
            shell?.classList.add('pubilo-auth-shell--onboarding');
            card?.classList.add('pubilo-auth-card--onboarding');
            if (brand) {
                brand.style.display = '';
                brand.querySelector('h1').innerHTML = "Upgrade Your<br>Workspace.";
                brand.querySelector('p').innerHTML = "Select a plan that fits your team's needs.<br>Start managing everything in one place with Pubilo.";
            }
            if (rightContainer) {
                rightContainer.style.flex = '5';
                rightContainer.style.position = 'relative';
            }
            return;
        }

        if (brand) {
            brand.style.display = '';
            brand.querySelector('h1').innerHTML = "Work Smarter.<br>Organize Faster.<br>Manage Anywhere.";
            brand.querySelector('p').innerHTML = "From quick team updates to full-length policies, our powerful platform lets you collaborate seamlessly across devices.";
        }
        if (rightContainer) rightContainer.style.flex = '4.5';
    }

    function renderLoginView(message) {
        const overlay = ensureOverlay();
        setAppShellAuthenticated(false);
        setOverlayVariant('default');
        overlay.classList.remove('is-hidden');
        writeAuthFlowState('login');
        const card = overlay.querySelector('#pubiloAuthCard');
        const loginUrl = `${window.API_BASE}/api/auth/login/line?returnTo=${encodeURIComponent(getSafeReturnToUrl())}`;
        card.innerHTML = `
            <div class="pubilo-auth-panel" style="width:100%; border:none; box-shadow:none; background:transparent;">
                <h2 style="font-size:36px; font-weight:800; color:#0f172a; margin-bottom:12px; font-family:'Montserrat', sans-serif;">Welcome Back!</h2>
                <p style="font-size:15px; color:#64748b; margin-bottom:40px; line-height:1.6; font-family:'Montserrat', sans-serif;">
                    Log in to start creating stunning workspaces with ease.
                </p>
                ${message ? `<p class="pubilo-auth-error" style="background:#fff1f1; color:#da1e28; padding:16px; border-radius:12px; margin-bottom:24px; font-size:14px; font-weight:500;">${message}</p>` : ''}
                
                <!-- Line Inputs for aesthetics (VidPro style) -->
                <div style="margin-bottom:24px;">
                    <label style="font-size: 13px; font-weight: 700; color: #1e293b; margin-bottom: 8px; display: block;">Email</label>
                    <input type="text" placeholder="Input your email" disabled style="width:100%; border:2px solid #e2e8f0; border-radius:12px; padding:16px; font-size:15px; color:#111827; background:#ffffff; outline:none; font-family:'Montserrat', sans-serif;" />
                </div>
                
                <div style="margin-bottom:32px; position:relative;">
                    <label style="font-size: 13px; font-weight: 700; color: #1e293b; margin-bottom: 8px; display: block;">Password</label>
                    <input type="password" placeholder="Input your password" disabled style="width:100%; border:2px solid #e2e8f0; border-radius:12px; padding:16px; font-size:15px; color:#111827; background:#ffffff; outline:none; font-family:'Montserrat', sans-serif;" />
                    <svg style="position:absolute; right:16px; top:42px;" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#a0aabf" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle>
                    </svg>
                </div>
                
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:32px;">
                    <label style="display:flex; align-items:center; gap:8px; cursor:pointer; font-size:13px; font-weight:500; color:#64748b; font-family:'Montserrat', sans-serif;">
                        <input type="checkbox" checked style="accent-color:#0f172a; width:18px; height:18px; border-radius:4px;" />
                        Remember Me
                    </label>
                    <a href="#" style="color:#64748b; font-size:13px; text-decoration:none; font-weight:500; font-family:'Montserrat', sans-serif;">Forgot Password?</a>
                </div>

                <a class="pubilo-auth-provider-btn" href="${loginUrl}" style="background-color: #0f172a; color: white; display:flex; justify-content:center; align-items:center; width: 100%; border-radius: 100px; height: 56px; font-size:16px; font-weight:700; text-decoration:none; font-family:'Montserrat', sans-serif; border:none; box-shadow:none;">
                    Login with LINE
                </a>

                <div style="display:flex; align-items:center; gap:16px; margin: 32px 0;">
                    <div style="flex:1; height:1px; background:#e2e8f0;"></div>
                    <span style="font-size:13px; color:#94a3b8; font-weight:500;">Or continue with</span>
                    <div style="flex:1; height:1px; background:#e2e8f0;"></div>
                </div>

                <a href="${loginUrl}" style="background-color: #ffffff; color: #0f172a; border: 2px solid #e2e8f0; display:flex; justify-content:center; align-items:center; gap: 8px; width: 100%; border-radius: 100px; height: 56px; font-size:15px; font-weight:700; text-decoration:none; font-family:'Montserrat', sans-serif;">
                    <svg width="20" height="20" viewBox="0 0 24 24">
                        <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                        <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                        <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                        <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                    </svg>
                    Continue with Google
                </a>

                <div style="text-align:center; margin-top:32px;">
                    <p style="color:#64748b; font-size:14px; font-weight:500; font-family:'Montserrat', sans-serif;">Don't have an account? <a href="${loginUrl}" style="color:#0f172a; text-decoration:none; font-weight:700;">Sign up here</a></p>
                </div>
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
        setAppShellAuthenticated(false);
        setOverlayVariant('onboarding');
        overlay.classList.remove('is-hidden');
        writeAuthFlowState('onboarding');
        const card = overlay.querySelector('#pubiloAuthCard');
        const defaultName = `${(profile?.user?.name || 'My').split(' ')[0]} Workspace`;
        const plansHtml = getPublicBillingPlans().map((plan, index) => {
            const isYearly = plan.code.includes('year') || plan.code.includes('4499') || plan.code.includes('2999');
            
            return `
            <label class="pubilo-plan-card pubilo-plan-card--horizontal ${index === 0 ? 'selected' : ''}" data-plan-card="${plan.code}">
                ${isYearly ? '<div style="position:absolute; top:-10px; right:24px; background:linear-gradient(135deg, #f59e0b, #d97706); color:white; font-size:11px; font-weight:800; padding:4px 12px; border-radius:100px; letter-spacing:0.5px; box-shadow:0 4px 10px rgba(245,158,11,0.3);">RECOMMENDED</div>' : ''}
                <div style="display:flex; align-items:center; gap:20px; flex: 1;">
                    <!-- Custom Radio -->
                    <div class="pubilo-radio-circle">
                        <input type="radio" name="planCode" value="${plan.code}" ${index === 0 ? 'checked' : ''} />
                        <div class="pubilo-radio-inner"></div>
                    </div>
                    <!-- Plan Info -->
                    <div class="pubilo-plan-info">
                        <span class="pubilo-plan-name">${plan.label}</span>
                        <div style="font-size:14px; color:#64748b; font-weight:500; margin-top:2px;">${isYearly ? 'Billed annually' : 'Billed monthly'}</div>
                    </div>
                </div>
                <!-- Price -->
                <div class="pubilo-plan-price-block">
                    <strong>฿${plan.amountThb.toLocaleString('th-TH')}</strong>
                    <span style="font-size:14px; color:#94a3b8; font-weight:500; margin-left:8px;">${isYearly ? '/yr' : '/mo'}</span>
                </div>
            </label>
            `;
        }).join('');

        card.innerHTML = `
            <form class="pubilo-auth-panel" id="pubiloOnboardingForm" style="width: 100%; border: none; background: transparent;">
                <p style="background: #f1f5f9; color: #3b82f6; font-size: 11px; letter-spacing: 1.5px; border-radius: 100px; padding: 6px 14px; display: inline-block; font-weight: 800; margin-bottom: 20px; text-transform: uppercase;">Final Step</p>
                <h2 style="font-size: 36px; font-weight: 800; color: #0f172a; margin-bottom: 12px; line-height: 1.2; letter-spacing: -1px; font-family: 'Montserrat', sans-serif;">Ready to create your workspace?</h2>
                <p style="font-size: 16px; color: #475569; margin-bottom: 40px; line-height: 1.6;">ระบุชื่อ Workspace ที่ต้องการและเลือกแพ็กเกจที่เหมาะสม ระบบจะพาคุณไปยังหน้าชำระเงิน QR Code เพื่อเริ่มใช้งานได้ทันที</p>
                
                <label class="pubilo-field" style="margin-bottom: 32px;">
                    <span style="font-size: 14px; font-weight: 700; color: #1e293b; margin-bottom: 8px; display: block;">ชื่อ Workspace ของคุณ</span>
                    <input type="text" id="pubiloWorkspaceName" value="${defaultName.replace(/"/g, '&quot;')}" required style="border-radius: 16px; border: 2px solid #e2e8f0; height: 56px; padding: 0 20px; font-size: 16px; font-weight:500; color: #0f172a; transition: all 0.2s;" onfocus="this.style.borderColor='#4f46e5'; this.style.boxShadow='0 0 0 4px rgba(79,70,229,0.1)';" onblur="this.style.borderColor='#e2e8f0'; this.style.boxShadow='none';" />
                </label>
                
                <!-- Horizontal Stack -->
                <div class="pubilo-plan-grid" style="display: flex; flex-direction: column; gap: 16px; margin-bottom: 40px;">${plansHtml}</div>
                
                <button class="pubilo-primary-btn" type="submit" style="width: 100%; height: 60px; border-radius: 16px; font-size: 16px; background: linear-gradient(135deg, #4f46e5, #3730a3); border: none; color: white; font-weight: 700; cursor: pointer; transition: all 0.2s; box-shadow: 0 10px 20px rgba(79, 70, 229, 0.2);" onmouseover="this.style.transform='translateY(-2px)'; this.style.boxShadow='0 15px 30px rgba(79, 70, 229, 0.3)';" onmouseout="this.style.transform='none'; this.style.boxShadow='0 10px 20px rgba(79, 70, 229, 0.2)';">ยืนยันและชำระเงิน</button>
                <p class="pubilo-auth-note" id="pubiloOnboardingNote" style="color: #ef4444; font-size: 14px; margin-top: 16px; text-align: center;"></p>
                
                <div style="text-align: center; margin-top: 32px;">
                    <button type="button" class="pubilo-logout-link" id="pubiloOnboardingLogout" style="background: none; border: none; font-weight:600; color: #64748b; cursor: pointer; font-size: 14px; transition: color 0.2s;" onmouseover="this.style.color='#0f172a';" onmouseout="this.style.color='#64748b';">Cancel &amp; Logout</button>
                </div>
            </form>
        `;

        card.querySelector('#pubiloOnboardingLogout').addEventListener('click', async () => {
            await nativeFetch('/api/auth/logout', { method: 'POST' });
            redirectToPublicEntry();
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
        setAppShellAuthenticated(false);
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
            redirectToPublicEntry();
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
        setAppShellAuthenticated(false);
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
            yearly_4499: ['✓ ทุกอย่างใน Monthly', '✓ ประหยัด ฿589 ต่อปี', '✓ Priority Support', '✓ Early Access ฟีเจอร์ใหม่'],
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
                : (isYearly ? 'คุ้มกว่ารายเดือน ประหยัด ฿589' : 'เริ่มใช้งานได้ทันที');
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
                    ${isYearly ? '<div class="pubilo-upgrade-badge">ประหยัด ฿589</div>' : ''}
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
            redirectToPublicEntry();
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
            redirectToPublicEntry();
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
            setAppShellAuthenticated(true);
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
            setAppShellAuthenticated(true);
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

        setAppShellAuthenticated(true);
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
                setAppShellAuthenticated(true);
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
            setAppShellAuthenticated(false);
            renderLoginView('Session หมดอายุ กรุณา login ใหม่');
        },
        handleSubscriptionRequired() {
            hydrateAndResolve();
        },
    };

    window.PUBILO_AUTH_READY_PROMISE = authReadyPromise;
    bootstrap().catch((error) => {
        console.warn('[PubiloAuth] bootstrap failed:', error);
        try {
            setAppShellAuthenticated(false);
            renderLoginView('โหลดสถานะบัญชีไม่สำเร็จ กรุณาลองใหม่อีกครั้ง');
        } catch (renderError) {
            console.warn('[PubiloAuth] failed to render fallback login view:', renderError);
        }
    });
})();
