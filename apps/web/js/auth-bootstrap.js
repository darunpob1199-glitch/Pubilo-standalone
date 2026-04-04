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
                <!-- Top Navigation -->
                <div style="display:flex; justify-content:center; align-items:center; height:80px; gap:40px; font-weight:600; color:#64748b; font-size:14px; position:relative; z-index:2; font-family:'Inter', sans-serif;">
                    <span style="color:#1e293b; cursor:pointer;">Home</span>
                    <span style="cursor:pointer;">Who We Are</span>
                    <span style="cursor:pointer;">What We Build</span>
                    <span style="cursor:pointer;">Advertisements</span>
                    <span style="cursor:pointer;">Careers</span>
                    <span style="cursor:pointer;">Business</span>
                </div>
                
                <div style="display:flex; flex:1; width:100%; max-width:1200px; margin:0 auto; position:relative; z-index:2;">
                    <!-- Left Side Content -->
                    <div class="pubilo-auth-brand" style="flex:1; display:flex; flex-direction:column; justify-content:center; padding:0 60px;">
                        <h1 style="font-size:72px; font-weight:800; margin-bottom:24px; line-height:1.1; letter-spacing:-2.5px; font-family:'Montserrat', sans-serif;">
                            <span style="background: linear-gradient(90deg, #f59e0b, #d97706); -webkit-background-clip: text; -webkit-text-fill-color: transparent;">Simple</span><br>
                            <span style="color:#1e293b;">Secure &</span><br>
                            <span style="color:#1e293b;">Reliable</span>
                        </h1>
                        <p id="pubiloLeftSubtitle" style="font-size:22px; color:#475569; margin-bottom:40px; line-height:1.6; max-width: 440px; font-weight: 500; font-family:'Montserrat', sans-serif;">
                            Keep Connected with People through seamless workspace management and easy tools.
                        </p>
                        
                        <!-- Store Buttons -->
                        <div style="display:flex; gap:16px;">
                            <a href="#" style="display:flex; align-items:center; gap:12px; padding:12px 24px; border:2px solid #e2e8f0; border-radius:12px; background:rgba(255,255,255,0.8); backdrop-filter:blur(10px); color:#0f172a; text-decoration:none; font-weight:600; font-family:'Inter', sans-serif; transition:all 0.2s;">
                                <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M16.365 21.43c-1.393.99-2.775 1.018-4.053.037-1.314-.997-2.673-.97-4.015.01-1.619 1.157-3.238.169-4.832-1.928C.486 15.65.045 11.238 2.502 6.643c1.246-2.316 3.123-3.665 5.568-3.722 1.408-.032 2.89.914 4.09.914 1.258 0 2.871-1.042 4.417-.923 2.128.163 3.823 1.066 4.908 2.76-4.148 2.548-3.268 8.01 1.04 9.771-1.047 2.685-2.73 5.485-6.16 6.014v-.025-.002zm-4.135-21.43c-.15 2.518-2.129 4.887-4.898 4.79.034-2.85 2.56-5.187 4.898-4.79z"></path></svg>
                                App store
                            </a>
                            <a href="#" style="display:flex; align-items:center; gap:12px; padding:12px 24px; border:2px solid #e2e8f0; border-radius:12px; background:rgba(255,255,255,0.8); backdrop-filter:blur(10px); color:#0f172a; text-decoration:none; font-weight:600; font-family:'Inter', sans-serif; transition:all 0.2s;">
                                <svg width="24" height="24" viewBox="0 0 256 256" fill="none"><path d="M128 256C198.7 256 256 198.7 256 128C256 57.3 198.7 0 128 0C57.3 0 0 57.3 0 128C0 198.7 57.3 256 128 256Z" fill="url(#paint0_linear)"/><path d="M128 256C198.7 256 256 198.7 256 128C256 57.3 198.7 0 128 0C57.3 0 0 57.3 0 128C0 198.7 57.3 256 128 256Z" fill="url(#paint1_linear)"/><path d="M128 256C198.7 256 256 198.7 256 128C256 57.3 198.7 0 128 0C57.3 0 0 57.3 0 128C0 198.7 57.3 256 128 256Z" fill="url(#paint2_linear)"/><path d="M69.5 73.8L165.7 128L69.5 182.2V73.8Z" fill="white"/><defs><linearGradient id="paint0_linear" x1="128" y1="0" x2="128" y2="256" gradientUnits="userSpaceOnUse"><stop stop-color="#4CAF50"/><stop offset="1" stop-color="#388E3C"/></linearGradient><linearGradient id="paint1_linear" x1="128" y1="0" x2="128" y2="256" gradientUnits="userSpaceOnUse"><stop stop-color="#FFEB3B"/><stop offset="1" stop-color="#FBC02D"/></linearGradient><linearGradient id="paint2_linear" x1="128" y1="0" x2="128" y2="256" gradientUnits="userSpaceOnUse"><stop stop-color="#2196F3"/><stop offset="1" stop-color="#1976D2"/></linearGradient></defs></svg>
                                Play store
                            </a>
                        </div>
                    </div>
                    
                    <!-- Right Side Container (Card) -->
                    <div id="pubiloRightContainer" style="flex:1; display:flex; justify-content:center; align-items:center;">
                        <div class="pubilo-auth-card" id="pubiloAuthCard" style="background:rgba(255,255,255,0.7); backdrop-filter:blur(30px); -webkit-backdrop-filter:blur(30px); border-radius:32px; box-shadow:0 20px 60px rgba(0,0,0,0.08); border:1px solid rgba(255,255,255,0.8); padding:40px; width:100%; max-width:440px;"></div>
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);
        return overlay;
    }

    function setOverlayVariant(variant) {
        const overlay = ensureOverlay();
        const brand = overlay.querySelector('.pubilo-auth-brand');
        const card = overlay.querySelector('#pubiloAuthCard');
        const rightContainer = overlay.querySelector('#pubiloRightContainer');

        if (variant === 'billing-gate' || variant === 'payment-only') {
            if (brand) brand.style.display = 'none';
            if (rightContainer) rightContainer.style.flex = '1';
            if (card) {
                card.style.maxWidth = '900px';
                card.style.background = '#ffffff';
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
            <div style="width:100%; border:none; box-shadow:none; background:transparent;">
                <div style="display:flex; flex-direction:column; align-items:center; margin-bottom:32px;">
                    <!-- Pubilo Logo -->
                    <div style="display:flex; align-items:center; justify-content:center; gap:12px; margin-bottom:8px;">
                        <svg width="48" height="48" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <path d="M50 20 L80 35 L50 50 L20 35 Z" fill="#7c3aed"/>
                            <path d="M50 35 L80 50 L50 65 L20 50 Z" stroke="#94a3b8" stroke-width="6" stroke-linejoin="round"/>
                            <path d="M50 50 L80 65 L50 80 L20 65 Z" stroke="#c4b5fd" stroke-width="6" stroke-linejoin="round"/>
                        </svg>
                        <span style="font-size:28px; font-weight:800; color:#0f172a; font-family:'Montserrat', sans-serif; letter-spacing:-0.5px;">Pubilo</span>
                    </div>
                </div>

                ${message ? `<p class="pubilo-auth-error" style="background:#fff1f1; color:#da1e28; padding:16px; border-radius:12px; margin-bottom:24px; font-size:14px; font-weight:500;">${message}</p>` : ''}
                
                <div style="margin-bottom:16px; position:relative;">
                    <div style="position:absolute; left:16px; top:16px; color:#94a3b8;">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"></path><polyline points="22,6 12,13 2,6"></polyline></svg>
                    </div>
                    <input type="text" placeholder="Enter your Mail" disabled style="width:100%; border:2px solid #e2e8f0; border-radius:8px; padding:16px 16px 16px 48px; font-size:14px; color:#111827; background:#ffffff; outline:none; font-family:'Inter', sans-serif; transition:all 0.2s;" />
                </div>
                
                <div style="margin-bottom:16px; position:relative;">
                    <div style="position:absolute; left:16px; top:16px; color:#94a3b8;">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>
                    </div>
                    <input type="password" placeholder="Enter your Password" disabled style="width:100%; border:2px solid #e2e8f0; border-radius:8px; padding:16px 16px 16px 48px; font-size:14px; color:#111827; background:#ffffff; outline:none; font-family:'Inter', sans-serif; transition:all 0.2s;" />
                </div>
                
                <div style="display:flex; justify-content:flex-start; margin-bottom:24px;">
                    <a href="#" style="color:#2563eb; font-size:13px; text-decoration:none; font-weight:600; font-family:'Inter', sans-serif;">Forget Password?</a>
                </div>

                <a class="pubilo-auth-provider-btn" href="${loginUrl}" style="background:linear-gradient(90deg, #0f40d6, #0e30aa); color:white; display:flex; justify-content:center; align-items:center; width:100%; border-radius:8px; height:52px; font-size:15px; font-weight:700; text-decoration:none; font-family:'Inter', sans-serif; border:none; box-shadow:0 10px 20px rgba(15, 64, 214, 0.2); letter-spacing:0.5px;">
                    LOGIN
                </a>

                <div style="display:flex; justify-content:center; margin-top:32px; gap:8px;">
                    <button style="border:none; border-bottom:2px solid #e2e8f0; background:transparent; padding:0 0 4px 0; color:#94a3b8; font-size:12px; font-weight:500; font-family:'Inter', sans-serif;">New User?</button>
                    <button style="border:none; border-bottom:2px solid #0f172a; background:transparent; padding:0 0 4px 0; color:#0f172a; font-size:12px; font-weight:700; font-family:'Inter', sans-serif; cursor:pointer;" onclick="window.location.href='${loginUrl}'">Sign Up</button>
                </div>

                <div style="text-align:center; margin-top:24px;">
                    <a href="#" style="color:#0f172a; font-size:13px; font-weight:700; font-family:'Inter', sans-serif; text-decoration:none;">Frequently Asked Questions(FAQ) ?</a>
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
        setOverlayVariant('default');
        overlay.classList.remove('is-hidden');
        writeAuthFlowState('payment', { orderId }, options.historyMode || 'push');
        
        const shell = overlay.querySelector('.pubilo-auth-shell');
        const brand = overlay.querySelector('.pubilo-auth-brand');
        const card = overlay.querySelector('#pubiloAuthCard');
        
        if (brand) {
            brand.querySelector('h1').innerHTML = `<span style="background: linear-gradient(90deg, #f59e0b, #d97706); -webkit-background-clip: text; -webkit-text-fill-color: transparent;">Simple</span><br><span style="color:#1e293b;">Secure &</span><br><span style="color:#1e293b;">Reliable</span>`;
            const subtitle = brand.querySelector('#pubiloLeftSubtitle');
            if (subtitle) {
                subtitle.innerHTML = "Complete your payment to unlock all premium features and seamless workspace management.";
            }
        }

        const amount = state.latestPaymentOrder?.amount_thb || 0;
        const planLabel = state.plans?.find((p) => p.code === state.latestPaymentOrder?.plan_code)?.label || '';

        card.innerHTML = `
            <div style="width:100%; border:none; box-shadow:none; background:transparent;">
                <div style="display:flex; flex-direction:column; align-items:center; margin-bottom:24px;">
                    <!-- Pubilo Logo -->
                    <div style="display:flex; align-items:center; justify-content:center; gap:12px; margin-bottom:8px;">
                        <svg width="48" height="48" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <path d="M50 20 L80 35 L50 50 L20 35 Z" fill="#7c3aed"/>
                            <path d="M50 35 L80 50 L50 65 L20 50 Z" stroke="#94a3b8" stroke-width="6" stroke-linejoin="round"/>
                            <path d="M50 50 L80 65 L50 80 L20 65 Z" stroke="#c4b5fd" stroke-width="6" stroke-linejoin="round"/>
                        </svg>
                        <span style="font-size:28px; font-weight:800; color:#0f172a; font-family:'Montserrat', sans-serif; letter-spacing:-0.5px;">Pubilo</span>
                    </div>
                </div>

                <div style="text-align:center; margin-bottom:24px;">
                    <p style="font-size:14px; font-weight:700; color:#64748b; letter-spacing:1px; text-transform:uppercase; margin-bottom:8px; font-family:'Inter', sans-serif;">Payment Required</p>
                    <h2 style="font-size:32px; font-weight:800; color:#0f172a; font-family:'Montserrat', sans-serif; margin-bottom:8px;">&#3647;${Number(amount).toLocaleString('th-TH')}</h2>
                    <p style="font-size:15px; color:#475569; font-weight:500; font-family:'Inter', sans-serif;">${planLabel}</p>
                </div>

                <div style="background:#ffffff; border-radius:24px; padding:24px; display:flex; flex-direction:column; align-items:center; box-shadow:0 10px 30px rgba(0,0,0,0.05); border:1px solid #e2e8f0; margin-bottom:24px;">
                    <div id="pubiloQrArea" style="min-height:200px; display:flex; flex-direction:column; justify-content:center; align-items:center; width:100%;">
                        <div style="width:40px; height:40px; border:3px solid #e2e8f0; border-top-color:#0f172a; border-radius:50%; animation:spin 1s linear infinite;"></div>
                        <p style="margin-top:16px; font-size:14px; color:#64748b; font-weight:500; font-family:'Inter', sans-serif;">Generating QR Code...</p>
                        <style>@keyframes spin { to { transform: rotate(360deg); } }</style>
                    </div>
                    
                    <div id="pubiloPaymentStatus" style="margin-top:16px; text-align:center; width:100%;"></div>
                    <p id="pubiloPaymentNote" style="font-size:13px; color:#ef4444; font-weight:600; font-family:'Inter', sans-serif; margin-top:8px; text-align:center;"></p>
                </div>

                <button type="button" id="pubiloPaymentLogout" style="width:100%; border:2px solid #e2e8f0; background:transparent; color:#64748b; padding:16px; border-radius:12px; font-size:15px; font-weight:700; font-family:'Inter', sans-serif; cursor:pointer; transition:all 0.2s;">Cancel & Logout</button>
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
        // Use default variant to keep the split-screen design from Login page
        setOverlayVariant('default');
        overlay.classList.remove('is-hidden');
        writeAuthFlowState('plan-selection', {}, options.historyMode || 'replace');
        const shell = overlay.querySelector('.pubilo-auth-shell');
        const brand = overlay.querySelector('.pubilo-auth-brand');
        const card = overlay.querySelector('#pubiloAuthCard');

        // Custom text for the left panel specifically for Plan Selection
        if (brand) {
            brand.style.display = '';
            brand.querySelector('h1').innerHTML = "Choose Your<br>Perfect Plan.";
            brand.querySelector('p').innerHTML = "Select a plan that fits your team's needs to unlock all premium features and start managing seamlessly.";
        }

        const isExpired = profile.workspace?.subscriptionStatus !== 'pending_payment';
        const wsName = profile.workspace?.name || profile.user?.name || 'Pubilo';
        const heading = isExpired ? 'แพ็กเกจหมดอายุแล้ว' : 'Choose a Plan';
        const subText = isExpired ? 'เลือกแพ็กเกจเพื่อต่ออายุการใช้งาน และปลดล็อกการใช้งานต่อทันทีหลังชำระเงิน' : 'Select a plan below and pay via QR PromptPay to get started.';

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
            const featureList = (features[plan.code] || []).map((feature) => `
                <li style="display:flex; align-items:center; gap:8px; margin-bottom:8px; font-size:13px; color:#64748b; font-weight:500;">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#0f172a" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
                    <span>${feature.replace(/^✓\s*/, '')}</span>
                </li>
            `).join('');

            return `
                <label class="pubilo-plan-card ${isSelected ? 'selected' : ''}" data-plan-card="${plan.code}" style="display:block; position:relative; border:2px solid ${isSelected ? '#0f172a' : '#e2e8f0'}; border-radius:16px; padding:20px; cursor:pointer; transition:all 0.2s; background:${isSelected ? '#f8fafc' : '#ffffff'}; margin-bottom:16px;">
                    ${isYearly ? '<div style="position:absolute; top:-10px; right:20px; background:linear-gradient(135deg, #8B5CF6, #7C3AED); color:white; font-size:11px; font-weight:800; padding:4px 12px; border-radius:100px; font-family:\'Montserrat\', sans-serif;">SAVE ฿589</div>' : ''}
                    <input type="radio" name="selectPlanCode" value="${plan.code}" ${isSelected ? 'checked' : ''} style="display:none;" />
                    <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:16px;">
                        <div>
                            <div style="font-size:16px; font-weight:700; color:#0f172a; margin-bottom:4px; font-family:\'Montserrat\', sans-serif;">${plan.label} <span style="font-size:11px; font-weight:700; background:#e2e8f0; color:#475569; padding:2px 8px; border-radius:100px; margin-left:4px;">${intervalTag}</span></div>
                            <div style="font-size:24px; font-weight:800; color:#0f172a; font-family:\'Montserrat\', sans-serif;">฿${plan.amountThb.toLocaleString('th-TH')} <span style="font-size:14px; font-weight:500; color:#64748b;">${isYearly ? '/ yr' : '/ mo'}</span></div>
                        </div>
                        <div style="width:24px; height:24px; border-radius:50%; border:2px solid ${isSelected ? '#0f172a' : '#cbd5e1'}; display:flex; align-items:center; justify-content:center; background:${isSelected ? '#0f172a' : 'transparent'};">
                            ${isSelected ? '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>' : ''}
                        </div>
                    </div>
                    <ul style="list-style:none; padding:0; margin:0; font-family:\'Montserrat\', sans-serif;">${featureList}</ul>
                </label>
            `;
        }).join('');

        card.innerHTML = `
            <form id="pubiloSelectPlanForm" class="pubilo-auth-panel" style="width:100%; border:none; box-shadow:none; background:transparent;">
                <p style="background: #f1f5f9; color: #64748b; font-size: 11px; letter-spacing: 1.5px; border-radius: 100px; padding: 6px 14px; display: inline-block; font-weight: 800; margin-bottom: 20px; text-transform: uppercase;">${wsName}</p>
                <h2 style="font-size:36px; font-weight:800; color:#0f172a; margin-bottom:12px; font-family:'Montserrat', sans-serif;">${heading}</h2>
                <p style="font-size:15px; color:#64748b; margin-bottom:40px; line-height:1.6; font-family:'Montserrat', sans-serif;">
                    ${subText}
                </p>
                
                <div style="margin-bottom:32px;">
                    ${plansHtml}
                </div>

                <button type="submit" style="background-color: #0f172a; color: white; display:flex; justify-content:center; align-items:center; width: 100%; border-radius: 100px; height: 56px; font-size:16px; font-weight:700; text-decoration:none; font-family:'Montserrat', sans-serif; border:none; cursor:pointer; transition:all 0.2s;" onmouseover="this.style.transform='translateY(-2px)';" onmouseout="this.style.transform='none';">
                    Continue to Payment
                </button>
                <p id="pubiloSelectPlanNote" style="color:#ef4444; font-size:14px; margin-top:16px; text-align:center; font-family:'Montserrat', sans-serif;"></p>
                
                <div style="text-align:center; margin-top:24px;">
                    <button type="button" id="pubiloSelectPlanLogout" style="background:none; border:none; color:#64748b; font-size:14px; font-weight:600; cursor:pointer; font-family:'Montserrat', sans-serif; text-decoration:underline;">Cancel & Logout</button>
                </div>
            </form>
        `;

        card.querySelectorAll('[data-plan-card]').forEach((node) => {
            node.addEventListener('click', () => {
                card.querySelectorAll('[data-plan-card]').forEach((item) => {
                    item.style.borderColor = '#e2e8f0';
                    item.style.backgroundColor = '#ffffff';
                    const icon = item.querySelector('div[style*="width:24px"]');
                    if (icon) {
                        icon.style.borderColor = '#cbd5e1';
                        icon.style.backgroundColor = 'transparent';
                        icon.innerHTML = '';
                    }
                });
                
                node.style.borderColor = '#0f172a';
                node.style.backgroundColor = '#f8fafc';
                const icon = node.querySelector('div[style*="width:24px"]');
                if (icon) {
                    icon.style.borderColor = '#0f172a';
                    icon.style.backgroundColor = '#0f172a';
                    icon.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>';
                }
                
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
