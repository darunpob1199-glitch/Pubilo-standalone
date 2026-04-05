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

                
                <div style="display:flex; flex:1; width:100%; max-width:1200px; margin:0 auto; position:relative; z-index:2;">
                    <!-- Left Side Content -->
                    <div class="pubilo-auth-brand" style="flex:1; display:flex; flex-direction:column; justify-content:center; padding:0 60px;">
                        <!-- Pubilo Logo -->
                        <div style="display:flex; align-items:center; gap:12px; margin-bottom:48px;">
                            <svg width="48" height="48" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
                                <path d="M50 20 L80 35 L50 50 L20 35 Z" fill="#7c3aed"/>
                                <path d="M50 35 L80 50 L50 65 L20 50 Z" stroke="#94a3b8" stroke-width="6" stroke-linejoin="round"/>
                                <path d="M50 50 L80 65 L50 80 L20 65 Z" stroke="#c4b5fd" stroke-width="6" stroke-linejoin="round"/>
                            </svg>
                            <span style="font-size:28px; font-weight:800; color:#0f172a; font-family:'Montserrat', sans-serif; letter-spacing:-0.5px;">Pubilo</span>
                        </div>

                        <h1 style="font-size:72px; font-weight:800; margin-bottom:24px; line-height:1.1; letter-spacing:-2.5px; font-family:'Montserrat', sans-serif;">
                            <span style="background: linear-gradient(90deg, #8b5cf6, #7c3aed); -webkit-background-clip: text; -webkit-text-fill-color: transparent;">Simple</span><br>
                            <span style="color:#1e293b;">Secure &</span><br>
                            <span style="color:#1e293b;">Reliable</span>
                        </h1>
                        <p id="pubiloLeftSubtitle" style="font-size:22px; color:#475569; margin-bottom:40px; line-height:1.6; max-width: 440px; font-weight: 500; font-family:'Montserrat', sans-serif;">
                            Keep Connected with People through seamless workspace management and easy tools.
                        </p>
                        

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

                <div style="text-align:center; margin-bottom:32px;">
                    <h2 style="font-size:24px; font-weight:800; color:#0f172a; font-family:'Montserrat', sans-serif; margin-bottom:8px;">Welcome Back</h2>
                    <p style="font-size:14px; color:#64748b; font-family:'Inter', sans-serif;">Log in to your workspace securely.</p>
                </div>

                ${message ? `<p class="pubilo-auth-error" style="background:#fff1f1; color:#da1e28; padding:16px; border-radius:12px; margin-bottom:24px; font-size:14px; font-weight:500;">${message}</p>` : ''}
                
                <a class="pubilo-auth-provider-btn" href="${loginUrl}" style="background:#06C755; color:white; display:flex; justify-content:center; align-items:center; width:100%; border-radius:12px; height:56px; font-size:16px; font-weight:700; text-decoration:none; font-family:'Inter', sans-serif; border:none; box-shadow:0 10px 25px rgba(6,199,85,0.3); transition:all 0.2s; gap:12px;" onmouseover="this.style.transform='translateY(-2px)';" onmouseout="this.style.transform='none';">
                    <svg width="28" height="28" viewBox="0 0 24 24" fill="white" xmlns="http://www.w3.org/2000/svg">
                        <path d="M22.5 10.3c0-4.4-4.8-8-10.5-8S1.5 5.9 1.5 10.3c0 3.9 3.6 7.2 8.4 7.9l-1.4 3.3c-.1.3-.1.6 0 .8.1.2.4.3.6.3.1 0 .3 0 .4-.1l4.9-3.2c.8.2 1.6.3 2.5.3 5.7 0 10.5-3.6 10.5-8z"/>
                    </svg>
                    Log in with LINE
                </a>

                <div style="display:flex; justify-content:center; margin-top:40px; gap:8px;">
                    <span style="color:#64748b; font-size:14px; font-weight:500; font-family:'Inter', sans-serif;">New User?</span>
                    <a href="${loginUrl}" style="color:#0f172a; font-size:14px; font-weight:700; font-family:'Inter', sans-serif; text-decoration:none; border-bottom:2px solid #0f172a; padding-bottom:2px;">Create an Account</a>
                </div>

                <div style="text-align:center; margin-top:24px;">
                    <a href="#" style="color:#94a3b8; font-size:13px; font-weight:600; font-family:'Inter', sans-serif; text-decoration:none; transition:color 0.2s;" onmouseover="this.style.color='#0f172a';" onmouseout="this.style.color='#94a3b8';">Frequently Asked Questions (FAQ)</a>
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
            brand.querySelector('h1').innerHTML = `<span style="background: linear-gradient(90deg, #8b5cf6, #7c3aed); -webkit-background-clip: text; -webkit-text-fill-color: transparent;">Simple</span><br><span style="color:#1e293b;">Secure &</span><br><span style="color:#1e293b;">Reliable</span>`;
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
        // Custom text for the left panel specifically for Plan Selection
        if (brand) {
            brand.style.display = 'flex';
            brand.querySelector('h1').innerHTML = `<span style="background: linear-gradient(90deg, #8b5cf6, #7c3aed); -webkit-background-clip: text; -webkit-text-fill-color: transparent;">Choose Your</span><br><span style="color:#1e293b;">Perfect</span><br><span style="color:#1e293b;">Plan.</span>`;
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
            const intervalTag = plan.code === 'test_1' ? 'TEST' : (isYearly ? 'YEARLY' : 'MONTHLY');
            const featureList = (features[plan.code] || []).map((feature) => `
                <li style="display:flex; align-items:flex-start; gap:12px; margin-bottom:12px; font-size:14px; color:#475569; font-weight:500;">
                    <div style="background:#f1f5f9; border-radius:50%; width:20px; height:20px; display:flex; align-items:center; justify-content:center; flex-shrink:0;">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#0f172a" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
                    </div>
                    <span>${feature.replace(/^✓\s*/, '')}</span>
                </li>
            `).join('');

            return `
                <label class="pubilo-plan-card ${isSelected ? 'selected' : ''}" data-plan-card="${plan.code}" style="display:block; position:relative; border:2px solid ${isSelected ? '#8b5cf6' : 'rgba(255,255,255,0.5)'}; border-radius:24px; padding:24px; cursor:pointer; transition:all 0.3s; background:${isSelected ? '#ffffff' : 'rgba(255,255,255,0.4)'}; box-shadow:${isSelected ? '0 20px 40px rgba(139,92,246,0.1)' : 'none'}; margin-bottom:20px;">
                    ${isYearly ? '<div style="position:absolute; top:-12px; right:24px; background:linear-gradient(135deg, #8b5cf6, #7c3aed); color:white; font-size:12px; font-weight:800; padding:6px 16px; border-radius:100px; box-shadow:0 4px 12px rgba(139,92,246,0.3); font-family:\'Montserrat\', sans-serif; letter-spacing:0.5px;">RECOMMENDED</div>' : ''}
                    <input type="radio" name="selectPlanCode" value="${plan.code}" ${isSelected ? 'checked' : ''} style="display:none;" />
                    <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:20px; padding-bottom:20px; border-bottom:1px solid rgba(0,0,0,0.05);">
                        <div>
                            <div style="display:flex; align-items:center; gap:8px; margin-bottom:8px;">
                                <h3 style="font-size:18px; font-weight:800; color:#0f172a; font-family:\'Montserrat\', sans-serif; margin:0;">${plan.label}</h3> 
                                <span style="font-size:11px; font-weight:800; background:${isSelected ? '#f3e8ff' : '#f1f5f9'}; color:${isSelected ? '#7c3aed' : '#475569'}; padding:4px 10px; border-radius:100px; letter-spacing:0.5px;">${intervalTag}</span>
                            </div>
                            <div style="font-size:32px; font-weight:800; color:#0f172a; font-family:\'Montserrat\', sans-serif; display:flex; align-items:baseline; gap:4px;">
                                ฿${plan.amountThb.toLocaleString('th-TH')} <span style="font-size:15px; font-weight:600; color:#64748b;">${isYearly ? '/ yr' : '/ mo'}</span>
                            </div>
                        </div>
                        <div style="width:28px; height:28px; border-radius:50%; border:2px solid ${isSelected ? '#8b5cf6' : '#cbd5e1'}; display:flex; align-items:center; justify-content:center; background:${isSelected ? '#8b5cf6' : '#ffffff'}; transition:all 0.2s; box-shadow:${isSelected ? '0 4px 10px rgba(139,92,246,0.3)' : 'none'};">
                            ${isSelected ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>' : ''}
                        </div>
                    </div>
                    <ul style="list-style:none; padding:0; margin:0; font-family:\'Inter\', sans-serif;">${featureList}</ul>
                </label>
            `;
        }).join('');

        card.innerHTML = `
            <form id="pubiloSelectPlanForm" class="pubilo-auth-panel" style="width:100%; border:none; box-shadow:none; background:transparent;">
                <div style="text-align:center; margin-bottom:32px;">
                    <p style="background: rgba(255,255,255,0.8); color: #0f172a; font-size: 11px; letter-spacing: 2px; border-radius: 100px; padding: 6px 16px; display: inline-block; font-weight: 800; margin-bottom: 24px; text-transform: uppercase; border:1px solid #e2e8f0; font-family:'Inter', sans-serif;">${wsName}</p>
                    <h2 style="font-size:40px; font-weight:800; color:#0f172a; margin-bottom:12px; font-family:'Montserrat', sans-serif; letter-spacing:-1px;">${heading}</h2>
                    <p style="font-size:16px; color:#475569; line-height:1.6; font-family:'Inter', sans-serif; font-weight:500;">
                        ${subText}
                    </p>
                </div>
                
                <div style="margin-bottom:40px; display:flex; flex-direction:column; gap:16px;">
                    ${plansHtml}
                </div>

                <div style="position:relative;">
                    <button type="submit" style="background: linear-gradient(135deg, #8b5cf6, #7c3aed); color: white; display:flex; justify-content:center; align-items:center; width: 100%; border-radius: 100px; height: 60px; font-size:16px; font-weight:700; text-decoration:none; font-family:'Inter', sans-serif; border:none; cursor:pointer; transition:all 0.3s; box-shadow:0 10px 25px rgba(139,92,246,0.3);" onmouseover="this.style.transform='translateY(-2px)'; this.style.boxShadow='0 15px 30px rgba(139,92,246,0.4)';" onmouseout="this.style.transform='none'; this.style.boxShadow='0 10px 25px rgba(139,92,246,0.3)';">
                        Continue to Payment
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-left:8px;"><line x1="5" y1="12" x2="19" y2="12"></line><polyline points="12 5 19 12 12 19"></polyline></svg>
                    </button>
                </div>
                <p id="pubiloSelectPlanNote" style="color:#ef4444; font-size:14px; margin-top:16px; text-align:center; font-family:'Inter', sans-serif; font-weight:500;"></p>
                
                <div style="text-align:center; margin-top:24px;">
                    <button type="button" id="pubiloSelectPlanLogout" style="background:none; border:none; color:#94a3b8; font-size:14px; font-weight:600; cursor:pointer; font-family:'Inter', sans-serif; transition:all 0.2s;" onmouseover="this.style.color='#0f172a';" onmouseout="this.style.color='#94a3b8';">Cancel & Logout</button>
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
