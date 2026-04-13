/* Pubilo Auth Bootstrap — Build 2026-04-05T22:52 */
(function () {
    const SHOW_BILLING_BANNER = false;
    const SKIP_SIGNUP_AND_BILLING_GATE = false;
    const AUTH_GATE_CLASS = 'pubilo-auth-gated';
    const AUTH_REQUEST_TIMEOUT_MS = 6000;
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

    function markAuthGateEnabled() {
        if (!document.body) return;
        document.body.classList.add(AUTH_GATE_CLASS);
    }

    function nativeFetch(url, options) {
        const rawOptions = options || {};
        const timeoutMs = Number.isFinite(rawOptions.timeoutMs) ? Number(rawOptions.timeoutMs) : AUTH_REQUEST_TIMEOUT_MS;
        const fetchOptions = { ...rawOptions };
        delete fetchOptions.timeoutMs;

        const requestPromise = window.__PUBILO_NATIVE_FETCH__(window.API_BASE + url, {
            credentials: 'include',
            ...fetchOptions,
        });

        if (!timeoutMs || timeoutMs <= 0) {
            return requestPromise;
        }

        let timeoutId = null;
        const timeoutPromise = new Promise((_, reject) => {
            timeoutId = window.setTimeout(() => {
                const error = new Error(`Request timeout after ${timeoutMs}ms`);
                error.code = 'ETIMEDOUT';
                reject(error);
            }, timeoutMs);
        });

        return Promise.race([requestPromise, timeoutPromise]).finally(() => {
            if (timeoutId) {
                window.clearTimeout(timeoutId);
            }
        });
    }

    function describeAuthFetchError(error) {
        const message = String(error?.message || error || '').trim();
        if (!message) return 'ระบบเชื่อมต่อไม่สำเร็จ';
        if (message.includes('ETIMEDOUT') || message.includes('timeout')) {
            return 'การเชื่อมต่อระบบใช้เวลานานเกินไป';
        }
        if (message.includes('Failed to fetch')) {
            return 'ไม่สามารถเชื่อมต่อ API ได้';
        }
        return message;
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
        markAuthGateEnabled();
        document.body.classList.toggle('pubilo-authenticated', !!isAuthenticated);
    }

    function ensureOverlay() {
        markAuthGateEnabled();
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

                
                <div style="display:flex; flex:1; width:100%; max-width:1200px; margin:0 auto; position:relative; z-index:2;">
                    <!-- Left Side Content -->
                    <div class="pubilo-auth-brand" style="flex:1; display:flex; flex-direction:column; justify-content:center; padding:0 60px;">
                        <!-- Pubilo Logo -->
                        <div style="display:flex; align-items:center; gap:16px; margin-bottom:48px;">
                            <svg width="72" height="72" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
                                <path d="M50 20 L80 35 L50 50 L20 35 Z" fill="#7c3aed"/>
                                <path d="M50 35 L80 50 L50 65 L20 50 Z" stroke="#94a3b8" stroke-width="6" stroke-linejoin="round"/>
                                <path d="M50 50 L80 65 L50 80 L20 65 Z" stroke="#c4b5fd" stroke-width="6" stroke-linejoin="round"/>
                            </svg>
                            <span style="font-size:42px; font-weight:800; color:#0f172a; font-family:'Montserrat', sans-serif; letter-spacing:-1px;">Pubilo</span>
                        </div>

                        <h1 style="font-size:72px; font-weight:800; margin-bottom:24px; line-height:1.1; letter-spacing:-2.5px; font-family:'Montserrat', sans-serif;">
                            <span style="background: linear-gradient(90deg, #8b5cf6, #7c3aed); -webkit-background-clip: text; -webkit-text-fill-color: transparent;">FACEBOOK</span><br>
                            <span style="color:#1e293b;">One Card link</span>
                        </h1>
                        

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

    function renderLoadingView(message = 'กำลังโหลดสถานะบัญชี...') {
        const overlay = ensureOverlay();
        setAppShellAuthenticated(false);
        setOverlayVariant('default');
        overlay.classList.remove('is-hidden');
        clearAuthFlowState();
        const card = overlay.querySelector('#pubiloAuthCard');
        if (!card) return;

        card.innerHTML = `
            <div style="width:100%; display:flex; flex-direction:column; align-items:center; justify-content:center; min-height:320px; gap:14px; text-align:center;">
                <div style="width:44px; height:44px; border:4px solid #e2e8f0; border-top-color:#4f46e5; border-radius:50%; animation:pubiloAuthSpin 0.85s linear infinite;"></div>
                <p style="font-size:15px; font-weight:600; color:#475569; margin:0;">${message}</p>
                <p style="font-size:13px; color:#94a3b8; margin:0;">ระบบกำลังเชื่อมต่อข้อมูลของคุณ</p>
                <style>
                    @keyframes pubiloAuthSpin {
                        to { transform: rotate(360deg); }
                    }
                </style>
            </div>
        `;
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
            return;
        }

        if (brand) brand.style.display = 'flex';
        if (rightContainer) rightContainer.style.flex = '1';
        if (card) {
            card.style.maxWidth = '440px';
            card.style.background = 'rgba(255,255,255,0.7)';
        }
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
                <div style="text-align:center; margin-bottom:32px;">
                    <h2 style="font-size:28px; font-weight:800; color:#0f172a; font-family:'Montserrat', sans-serif; margin-bottom:8px;">ยินดีต้อนรับ</h2>
                    <p style="font-size:14px; color:#64748b; font-family:'Inter', sans-serif; margin:0;">เชื่อมต่อ Facebook ในคลิกเดียว</p>
                </div>

                ${message ? `<p class="pubilo-auth-error" style="background:#fff1f1; color:#da1e28; padding:16px; border-radius:12px; margin-bottom:24px; font-size:14px; font-weight:500;">${message}</p>` : ''}
                
                <a class="pubilo-auth-provider-btn" href="${loginUrl}" style="background:linear-gradient(135deg, #06C755 0%, #05a847 100%); color:white; display:flex; justify-content:center; align-items:center; width:100%; border-radius:12px; height:56px; font-size:16px; font-weight:700; text-decoration:none; font-family:'Inter', sans-serif; border:none; box-shadow:0 10px 25px rgba(6,199,85,0.3); transition:all 0.25s ease; gap:12px;" onmouseover="this.style.transform='translateY(-2px)';this.style.background='linear-gradient(135deg, #07dc5e 0%, #06C755 100%)';this.style.boxShadow='0 14px 32px rgba(6,199,85,0.42)';" onmouseout="this.style.transform='none';this.style.background='linear-gradient(135deg, #06C755 0%, #05a847 100%)';this.style.boxShadow='0 10px 25px rgba(6,199,85,0.3)';">
                    <svg width="28" height="28" viewBox="0 0 24 24" fill="white" xmlns="http://www.w3.org/2000/svg">
                        <path d="M22.5 10.3c0-4.4-4.8-8-10.5-8S1.5 5.9 1.5 10.3c0 3.9 3.6 7.2 8.4 7.9l-1.4 3.3c-.1.3-.1.6 0 .8.1.2.4.3.6.3.1 0 .3 0 .4-.1l4.9-3.2c.8.2 1.6.3 2.5.3 5.7 0 10.5-3.6 10.5-8z"/>
                    </svg>
                    เข้าสู่ระบบด้วย LINE
                </a>

                <div style="text-align:center; margin-top:40px;">
                    <a href="#" style="color:#94a3b8; font-size:13px; font-weight:600; font-family:'Inter', sans-serif; text-decoration:none; transition:color 0.2s;" onmouseover="this.style.color='#0f172a';" onmouseout="this.style.color='#94a3b8';">คำถามที่พบบ่อย (FAQ)</a>
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
            brand.querySelector('h1').innerHTML = `<span style="background: linear-gradient(90deg, #8b5cf6, #7c3aed); -webkit-background-clip: text; -webkit-text-fill-color: transparent;">ใช้งานง่าย</span><br><span style="color:#1e293b;">ปลอดภัย &</span><br><span style="color:#1e293b;">มั่นใจได้</span>`;
            const subtitle = brand.querySelector('#pubiloLeftSubtitle');
            if (subtitle) {
                subtitle.innerHTML = "ชำระเงินเพื่อปลดล็อกฟีเจอร์พรีเมียมและเริ่มต้นจัดการพื้นที่ทำงานของคุณได้อย่างราบรื่น";
            }
        }

        const amount = state.latestPaymentOrder?.amount_thb || 0;
        const rawPlanCode = state.latestPaymentOrder?.plan_code;
        let planLabel = state.plans?.find((p) => p.code === rawPlanCode)?.label || '';
        if (rawPlanCode === 'monthly_500') planLabel = 'รายเดือน (Basic)';
        else if (rawPlanCode === 'yearly_4499') planLabel = 'รายปี (Professional)';

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
                    <p style="font-size:14px; font-weight:700; color:#64748b; letter-spacing:1px; text-transform:uppercase; margin-bottom:8px; font-family:'Inter', sans-serif;">รอการชำระเงิน</p>
                    <h2 style="font-size:32px; font-weight:800; color:#0f172a; font-family:'Montserrat', sans-serif; margin-bottom:8px;">&#3647;${Number(amount).toLocaleString('th-TH')}</h2>
                    <p style="font-size:15px; color:#475569; font-weight:500; font-family:'Inter', sans-serif;">${planLabel}</p>
                </div>

                <div style="background:#ffffff; border-radius:24px; padding:24px; display:flex; flex-direction:column; align-items:center; box-shadow:0 10px 30px rgba(0,0,0,0.05); border:1px solid #e2e8f0; margin-bottom:24px;">
                    <div id="pubiloQrArea" style="min-height:200px; display:flex; flex-direction:column; justify-content:center; align-items:center; width:100%;">
                        <div style="width:40px; height:40px; border:3px solid #e2e8f0; border-top-color:#0f172a; border-radius:50%; animation:spin 1s linear infinite;"></div>
                        <p style="margin-top:16px; font-size:14px; color:#64748b; font-weight:500; font-family:'Inter', sans-serif;">ระบบกำลังสร้างคิวอาร์โค้ด...</p>
                        <style>@keyframes spin { to { transform: rotate(360deg); } }</style>
                    </div>
                    
                    <div id="pubiloPaymentStatus" style="margin-top:16px; text-align:center; width:100%;"></div>
                    <p id="pubiloPaymentNote" style="font-size:13px; color:#ef4444; font-weight:600; font-family:'Inter', sans-serif; margin-top:8px; text-align:center;"></p>
                </div>

                <button type="button" id="pubiloPaymentLogout" style="width:100%; border:2px solid #e2e8f0; background:transparent; color:#64748b; padding:16px; border-radius:12px; font-size:15px; font-weight:700; font-family:'Inter', sans-serif; cursor:pointer; transition:all 0.2s;">ยกเลิกรายการและออกจากระบบ</button>
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

        // Hide the left brand panel entirely for the new full-width centered layout
        if (brand) brand.style.display = 'none';

        const isExpired = profile.workspace?.subscriptionStatus !== 'pending_payment';
        const wsName = profile.workspace?.name || profile.user?.name || 'Pubilo';

        const features = {
            test_1: { specs: ['ทดสอบระบบ', '30 วัน'], extras: [] },
            monthly_500: {
                specs: ['โพสต์คอนเทนต์ไม่จำกัด', 'ตั้งเวลาล่วงหน้าอัตโนมัติ', 'จัดการคิวโพสต์ง่ายและรวดเร็ว'],
                extras: ['รองรับการสลับหลายเพจ', 'Auto Hide Posts อัตโนมัติ'],
            },
            yearly_4499: {
                specs: ['พิเศษ: ทุกฟังก์ชันในรายเดือน', 'ใช้งานได้นาน 365 วันไม่มีสะดุด', 'ประหยัดคุ้มกว่า ฿589 / ปี'],
                extras: ['Priority Support', 'Early Access ฟีเจอร์ใหม่', 'ไม่หักค่าธรรมเนียมเพิ่มเติม'],
            },
        };

        const visiblePlans = (() => {
            const plans = getPublicBillingPlans();
            const priorityCodes = ['monthly_500', 'yearly_4499'];
            const prioritized = priorityCodes
                .map((code) => plans.find((plan) => plan.code === code))
                .filter(Boolean);
            return prioritized.length ? prioritized : plans;
        })();

        const currentPlanCode = profile.workspace?.planCode || profile.workspace?.plan_code || '';
        const defaultPlanCode = (() => {
            if (['monthly_500', 'yearly_4499'].includes(currentPlanCode)) return currentPlanCode;
            if (visiblePlans.some((plan) => plan.code === 'monthly_500')) return 'monthly_500';
            return visiblePlans[0]?.code || '';
        })();

        const specIcon = (code) => {
            const icons = {
                0: '<rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>',
                1: '<circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline>',
                2: '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon>',
            };
            return icons[code] || icons[0];
        };

        const plansHtml = visiblePlans.map((plan) => {
            const isSelected = plan.code === defaultPlanCode;
            const isYearly = plan.interval === 'yearly';
            const f = features[plan.code] || { specs: [], extras: [] };
            const planLabel = plan.code === 'monthly_500' ? 'รายเดือน (Basic)' : (plan.code === 'yearly_4499' ? 'รายปี (Professional)' : plan.label);
            const planDesc = plan.code === 'monthly_500'
                ? 'สำหรับทีมเล็กหรือเริ่มต้นใช้งาน จัดการโพสต์ได้ง่าย'
                : (plan.code === 'yearly_4499' ? 'สำหรับทีมที่ต้องการความคุ้มค่าและฟีเจอร์เต็มรูปแบบ' : plan.label);
            const btnBg = isYearly ? '#a855f7' : '#1c1c1e';
            const borderColor = isYearly ? '#a855f7' : '#e2e8f0';
            const shadowColor = isYearly ? 'rgba(168,85,247,0.1)' : 'rgba(0,0,0,0.03)';

            const specsHtml = f.specs.map((s, i) => `
                <div style="display:flex; align-items:flex-start; gap:12px; font-size:13px; color:#4b5563; font-weight:500;">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#6b7280" stroke-width="2" style="flex-shrink:0;">${specIcon(i)}</svg>
                    ${s}
                </div>
            `).join('');

            const extrasLabel = isYearly ? 'Everything in Free, plus:' : 'Free includes:';
            const extrasHtml = f.extras.map((e) => `
                <div style="display:flex; align-items:center; gap:10px; font-size:13px; color:#6b7280; font-weight:500;">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#a855f7" stroke-width="3" stroke-linecap="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
                    ${e}
                </div>
            `).join('');

            return `
                <div class="pubilo-plan-card" data-plan-card="${plan.code}" style="flex:1; min-width:280px; max-width:380px; background:white; border-radius:20px; padding:36px 32px; box-shadow:0 20px 50px ${shadowColor}; border:2px solid ${borderColor}; position:relative; display:flex; flex-direction:column; cursor:pointer; transition:all 0.3s;">
                    ${isYearly ? '<div style="position:absolute; top:36px; right:32px; background:#a855f7; color:white; padding:4px 12px; border-radius:100px; font-weight:700; font-size:10px; letter-spacing:0.03em;">ยอดนิยม</div>' : ''}
                    <input type="radio" name="selectPlanCode" value="${plan.code}" ${isSelected ? 'checked' : ''} style="display:none;" />
                    <h3 style="font-size:20px; font-weight:700; color:#111827; margin:0 0 12px 0;">${planLabel}</h3>
                    <p style="font-size:14px; color:#6b7280; font-weight:500; margin:0 0 32px 0; line-height:1.5; min-height:42px; padding-right:20px;">${planDesc}</p>
                    <div style="display:flex; align-items:baseline; gap:4px; margin-bottom:24px;">
                        <span style="font-size:44px; font-weight:800; color:#111827; letter-spacing:-0.04em; line-height:1;">฿${plan.amountThb.toLocaleString('th-TH')}</span>
                    </div>
                    <div style="font-size:14px; font-weight:500; color:#9ca3af; margin-bottom:24px;">${isYearly ? 'ต่อปี' : 'ต่อเดือน'}</div>
                    <button type="button" data-plan-submit="${plan.code}" style="width:100%; background:${btnBg}; color:white; border:none; padding:14px; border-radius:10px; font-size:15px; font-weight:${isYearly ? '700' : '600'}; cursor:pointer; margin-bottom:0; transition:opacity 0.2s;">เริ่มต้นใช้งาน</button>
                </div>
            `;
        }).join('');

        card.innerHTML = `
            <form id="pubiloSelectPlanForm" style="width:100%; border:none; box-shadow:none; background:transparent; position:relative;">
                <!-- Pattern Background -->
                <div style="position:absolute; top:0; left:-50vw; right:-50vw; height:60%; background-image:radial-gradient(#d1d5db 1px, transparent 1px); background-size:32px 32px; opacity:0.35; z-index:0; pointer-events:none;"></div>

                <div style="position:relative; z-index:1;">
                    <!-- Header -->
                    <div style="text-align:center; margin-bottom:48px; max-width:650px; margin-left:auto; margin-right:auto;">
                        <h2 style="font-size:46px; font-weight:800; color:#111827; margin:0 0 16px 0; letter-spacing:-0.04em; line-height:1.1; font-family:'Montserrat', sans-serif;">
                            เลือกแพ็กเกจที่ <span style="color:#a855f7;">ตอบโจทย์</span> คุณ
                        </h2>
                        <p style="font-size:16px; font-weight:500; color:#6b7280; margin:0; line-height:1.6; font-family:'Inter', sans-serif;">
                            ${isExpired ? 'แพ็กเกจของคุณหมดอายุแล้ว เลือกแพ็กเกจเพื่อกลับมาใช้งานต่อทันที' : 'ให้เราช่วยจัดการโพสต์ของคุณ เลือกแพ็กเกจด้านล่างและชำระเงินผ่าน QR PromptPay เพื่อเริ่มใช้งาน'}
                        </p>

                        <div style="display:inline-flex; align-items:center; background:#ffffff; border-radius:100px; padding:4px; box-shadow:0 2px 10px rgba(0,0,0,0.05); border:1px solid #e2e8f0; margin-top:32px;">
                            <div style="padding:8px 24px; background:#a855f7; color:white; border-radius:100px; font-size:13px; font-weight:700; letter-spacing:0.02em;">รายเดือน</div>
                            <div style="padding:8px 24px; color:#64748b; font-size:13px; font-weight:600; display:flex; align-items:center; gap:8px;">
                                รายปี
                                <span style="background:#f3e8ff; color:#7c3aed; padding:2px 8px; border-radius:100px; font-size:11px; font-weight:800;">ประหยัด 20%</span>
                            </div>
                        </div>
                    </div>

                    <!-- Cards Row -->
                    <div style="display:flex; gap:24px; flex-wrap:wrap; justify-content:center; width:100%; margin-bottom:48px; align-items:stretch;">
                        ${plansHtml}
                    </div>

                    <p id="pubiloSelectPlanNote" style="color:#ef4444; font-size:14px; margin-top:0; margin-bottom:16px; text-align:center; font-family:'Inter', sans-serif; font-weight:500;"></p>

                    <div style="text-align:center; margin-top:12px;">
                        <button type="button" id="pubiloSelectPlanLogout" style="background:none; border:none; color:#94a3b8; font-size:14px; font-weight:600; cursor:pointer; font-family:'Inter', sans-serif; transition:all 0.2s;" onmouseover="this.style.color='#0f172a';" onmouseout="this.style.color='#94a3b8';">Cancel & Logout</button>
                    </div>
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
            button.addEventListener('click', async (event) => {
                event.stopPropagation();
                const planCode = button.getAttribute('data-plan-submit');
                const matchingInput = card.querySelector(`input[name="selectPlanCode"][value="${planCode}"]`);
                if (matchingInput) matchingInput.checked = true;

                // Directly trigger checkout
                const note = card.querySelector('#pubiloSelectPlanNote');
                if (note) note.textContent = 'กำลังสร้าง Order...';
                try {
                    const response = await nativeFetch('/api/billing/checkout-intent', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ planCode }),
                    });
                    const data = await response.json();
                    console.log('[PubiloAuth] checkout-intent response:', response.status, data);
                    if (!response.ok || !data.success) {
                        if (note) note.textContent = data.error || `สร้าง order ไม่สำเร็จ (${response.status})`;
                        return;
                    }
                    if (note) note.textContent = 'สร้าง Order สำเร็จ กำลังไปหน้าชำระเงิน...';
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
                        if (note) note.textContent = 'สร้าง order สำเร็จแต่ไม่มี paymentOrder id';
                    }
                } catch (err) {
                    console.error('[PubiloAuth] checkout-intent error:', err);
                    if (note) note.textContent = `เกิดข้อผิดพลาด: ${err.message}`;
                }
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
        const hasFacebookSession = !!(
            localStorage.getItem('fewfeed_accessToken') ||
            localStorage.getItem('fewfeed_token') ||
            localStorage.getItem('fewfeed_cookie') ||
            localStorage.getItem('fewfeed_postToken')
        );
        const facebookAvatarUrl = localStorage.getItem('fewfeed_avatarUrl') || '';
        const facebookUserName = localStorage.getItem('fewfeed_userName') || '';

        // Do not override Facebook avatar when token/cookie session is active.
        if (hasFacebookSession && avatarImage) {
            if (facebookAvatarUrl) {
                avatarImage.src = facebookAvatarUrl;
                avatarImage.style.display = 'block';
                if (avatarInitial) avatarInitial.style.display = 'none';
            } else if (avatarInitial) {
                avatarImage.style.display = 'none';
                avatarInitial.style.display = 'flex';
                avatarInitial.textContent = (facebookUserName || state.user?.name || state.user?.email || 'U').slice(0, 1).toUpperCase();
            }
        } else if (avatarImage && state.user?.avatar_url) {
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
        try {
            const response = await nativeFetch('/api/billing/plans', { timeoutMs: AUTH_REQUEST_TIMEOUT_MS });
            if (!response.ok) {
                throw new Error(`plans request failed (${response.status})`);
            }
            const payload = await response.json();
            return Array.isArray(payload.plans) ? payload.plans : [];
        } catch (error) {
            console.warn('[PubiloAuth] fetchPlans failed, fallback to empty plans:', error);
            return [];
        }
    }

    async function fetchAuthState(options = {}) {
        const { allowFallback = true } = options;

        try {
            const response = await nativeFetch('/api/auth/me', { timeoutMs: AUTH_REQUEST_TIMEOUT_MS });
            if (!response.ok) {
                throw new Error(`auth state request failed (${response.status})`);
            }

            const payload = await response.json();
            if (!payload || typeof payload !== 'object') {
                throw new Error('auth state response is invalid');
            }
            return payload;
        } catch (error) {
            if (!allowFallback) throw error;
            const message = describeAuthFetchError(error);
            console.warn('[PubiloAuth] fetchAuthState fallback:', message);
            return {
                authenticated: false,
                user: null,
                workspace: null,
                memberships: [],
                latestPaymentOrder: null,
                onboardingRequired: false,
                __fetchError: message,
            };
        }
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

        const payload = await fetchAuthState({ allowFallback: false });
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

        const payload = await fetchAuthState({ allowFallback: true });
        applyAuthState(payload);

        if (!payload.authenticated) {
            const fetchErrorMessage = typeof payload.__fetchError === 'string' ? payload.__fetchError : '';
            renderLoginView(fetchErrorMessage ? `${fetchErrorMessage} กรุณาลองใหม่อีกครั้ง` : authErrorMessage());
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
        renderLoadingView();
        state.plans = await fetchPlans();
        window.addEventListener('popstate', async () => {
            try {
                const authState = readAuthFlowState();
                if (!authState) return;

                const payload = await fetchAuthState({ allowFallback: true });
                applyAuthState(payload);

                if (!payload.authenticated) {
                    const fetchErrorMessage = typeof payload.__fetchError === 'string' ? payload.__fetchError : '';
                    renderLoginView(fetchErrorMessage ? `${fetchErrorMessage} กรุณาลองใหม่อีกครั้ง` : authErrorMessage());
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
            } catch (error) {
                console.warn('[PubiloAuth] popstate rehydrate failed:', error);
                renderLoginView('โหลดสถานะบัญชีไม่สำเร็จ กรุณาลองใหม่อีกครั้ง');
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
            try {
                if (document.body) {
                    document.body.classList.remove(AUTH_GATE_CLASS);
                    document.body.classList.add('pubilo-authenticated');
                }
            } catch (fallbackError) {
                console.warn('[PubiloAuth] failed to recover app shell visibility:', fallbackError);
            }
        }
    });
})();
