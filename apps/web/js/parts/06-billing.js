// Billing Dashboard Logic
(function () {
    const billingPanel = document.getElementById('billingPanel');
    if (!billingPanel) return;

    const planNameEl = document.getElementById('billingPlanName');
    const planPriceEl = document.getElementById('billingPlanPrice');
    const statusBadgeEl = document.getElementById('billingStatusBadge');
    const startDateEl = document.getElementById('billingStartDate');
    const endDateEl = document.getElementById('billingEndDate');
    const intervalEl = document.getElementById('billingInterval');
    const historyEl = document.getElementById('billingPaymentHistory');
    const cancelBtn = document.getElementById('billingCancelBtn');

    const billingState = {
        subscription: null,
        latestOrder: null,
        paymentPollTimer: null,
        paymentOrder: null,
        paymentOverlay: null,
    };

    const PLAN_META = {
        monthly_500: { label: 'รายเดือน', price: 299, intervalText: 'รายเดือน' },
        yearly_4499: { label: 'รายปี', price: 2999, intervalText: 'รายปี' },
        test_1: { label: 'แพ็กเกจทดสอบ', price: 1, intervalText: 'ทดลอง' },
    };

    function escapeHtml(value) {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function formatDate(iso) {
        if (!iso) return '-';
        try {
            return new Date(iso).toLocaleDateString('th-TH', {
                year: 'numeric',
                month: 'long',
                day: 'numeric',
            });
        } catch {
            return iso;
        }
    }

    function getPlanLabel(planCode) {
        return PLAN_META[planCode]?.label || planCode || '-';
    }

    function getPlanPrice(planCode, fallbackAmount) {
        const amount = Number(fallbackAmount ?? PLAN_META[planCode]?.price ?? 0);
        return `฿${amount.toLocaleString('th-TH')}`;
    }

    function setStatusBadge(status) {
        const map = {
            active: { text: 'Active', bg: '#ecfdf3', color: '#027a48' },
            pending_payment: { text: 'รอชำระ', bg: '#fffaeb', color: '#b54708' },
            pending: { text: 'รอชำระ', bg: '#fffaeb', color: '#b54708' },
            paid: { text: 'ชำระแล้ว', bg: '#ecfdf3', color: '#027a48' },
            expired: { text: 'หมดอายุ', bg: '#fef3f2', color: '#b42318' },
            cancelled: { text: 'ยกเลิก', bg: '#f2f4f7', color: '#344054' },
        };
        const info = map[status] || { text: status || '-', bg: '#f2f4f7', color: '#344054' };
        statusBadgeEl.textContent = info.text;
        statusBadgeEl.style.background = info.bg;
        statusBadgeEl.style.color = info.color;
    }

    function getOrderBadge(status) {
        const map = {
            pending: { text: 'รอชำระ', bg: '#fffaeb', color: '#b54708' },
            paid: { text: 'ชำระแล้ว', bg: '#ecfdf3', color: '#027a48' },
            expired: { text: 'หมดเวลา', bg: '#fef3f2', color: '#b42318' },
            cancelled: { text: 'ยกเลิกแล้ว', bg: '#f2f4f7', color: '#344054' },
        };
        return map[status] || { text: status || '-', bg: '#f2f4f7', color: '#344054' };
    }

    function apiFetch(path, options) {
        return fetch(`${window.API_BASE}${path}`, {
            credentials: 'include',
            ...(options || {}),
        });
    }

    function stopPaymentPolling() {
        if (billingState.paymentPollTimer) {
            clearInterval(billingState.paymentPollTimer);
            billingState.paymentPollTimer = null;
        }
    }

    function ensurePaymentOverlay() {
        if (billingState.paymentOverlay) return billingState.paymentOverlay;

        const overlay = document.createElement('div');
        overlay.id = 'billingPaymentOverlay';
        overlay.className = 'pubilo-auth-overlay is-hidden';
        overlay.innerHTML = `
            <div class="pubilo-auth-shell" style="grid-template-columns: minmax(320px, 560px); max-width: 560px;">
                <div class="pubilo-auth-card" id="billingPaymentCard"></div>
            </div>
        `;

        overlay.addEventListener('click', (event) => {
            if (event.target === overlay) {
                closePaymentOverlay();
            }
        });

        document.body.appendChild(overlay);
        billingState.paymentOverlay = overlay;
        return overlay;
    }

    function closePaymentOverlay() {
        stopPaymentPolling();
        if (billingState.paymentOverlay) {
            billingState.paymentOverlay.classList.add('is-hidden');
        }
        billingState.paymentOrder = null;
    }

    async function refreshAuthState() {
        if (window.PubiloAuth?.refreshState) {
            try {
                await window.PubiloAuth.refreshState();
            } catch (err) {
                console.warn('[billing] Failed to refresh auth state:', err);
            }
        }
    }

    async function rehydrateAuthGate() {
        if (window.PubiloAuth?.refreshState) {
            try {
                await window.PubiloAuth.refreshState({ rehydrate: true });
            } catch (err) {
                console.warn('[billing] Failed to rehydrate auth gate:', err);
            }
        }
    }

    function updatePlanCardState() {
        const subscription = billingState.subscription;
        const latestOrder = billingState.latestOrder;

        document.querySelectorAll('.billing-plan-card').forEach((card) => {
            const planCode = card.dataset.plan;
            const button = card.querySelector('.billing-select-plan-btn');
            if (!button) return;

            card.style.borderColor = 'transparent';
            card.style.background = '#fff';
            card.style.boxShadow = '0 10px 40px rgba(0,0,0,0.06)';
            button.disabled = false;
            button.style.opacity = '1';
            button.textContent = 'เริ่มต้นใช้งาน';

            if (subscription?.plan_code === planCode) {
                card.style.borderColor = 'var(--primary)';
                card.style.background = '#faf8ff';
                if (subscription.status === 'active') {
                    button.textContent = 'ต่ออายุแพ็กเกจ';
                } else if (subscription.status === 'pending_payment') {
                    button.textContent = 'ชำระเพื่อเปิดใช้งาน';
                } else if (subscription.status === 'cancelled') {
                    button.textContent = 'เปิดใช้งานใหม่';
                }
            }

            if (latestOrder?.plan_code === planCode && latestOrder.status === 'pending') {
                card.style.borderColor = '#f59e0b';
                card.style.background = '#fffbeb';
                button.textContent = 'ชำระต่อ order นี้';
            }
        });
    }

    function renderPaymentHistory() {
        const order = billingState.latestOrder;
        if (!order) {
            historyEl.innerHTML = '<p style="color: var(--text-muted); text-align: center; padding: 2rem 0;">ยังไม่มีประวัติการชำระเงิน</p>';
            return;
        }

        const badge = getOrderBadge(order.status);
        const planLabel = getPlanLabel(order.plan_code);
        const actions = [];
        if (order.status === 'pending') {
            actions.push('<button type="button" class="pubilo-primary-btn" data-billing-action="resume-payment" style="min-height: 44px;">ชำระตอนนี้</button>');
            actions.push('<button type="button" data-billing-action="cancel-order" style="min-height: 44px; border-radius: 14px; border: 1px solid #fecaca; background: #fff5f5; color: #b42318; font-weight: 700; cursor: pointer;">ยกเลิกออเดอร์</button>');
        } else if (order.status === 'expired') {
            actions.push('<button type="button" class="pubilo-primary-btn" data-billing-action="restart-order" style="min-height: 44px;">สร้าง QR ใหม่</button>');
        }

        historyEl.innerHTML = `
            <div style="border: 1px solid var(--border-color); border-radius: 14px; padding: 1rem 1.1rem; display: grid; gap: 1rem;">
                <div style="display: flex; justify-content: space-between; gap: 1rem; flex-wrap: wrap; align-items: flex-start;">
                    <div style="display: grid; gap: 0.35rem;">
                        <div style="font-size: 0.78rem; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.05em; font-weight: 700;">ออเดอร์ล่าสุด</div>
                        <div style="font-family: monospace; color: var(--text-main); font-size: 0.82rem;">${escapeHtml((order.id || '').slice(0, 12))}...</div>
                        <div style="color: var(--text-main); font-weight: 700;">${escapeHtml(planLabel)} · ${escapeHtml(getPlanPrice(order.plan_code, order.amount_thb))}</div>
                    </div>
                    <span style="background:${badge.bg}; color:${badge.color}; padding:0.35rem 0.75rem; border-radius:999px; font-size:0.78rem; font-weight:700;">
                        ${escapeHtml(badge.text)}
                    </span>
                </div>
                <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 0.8rem; font-size: 0.9rem;">
                    <div>
                        <div style="color: var(--text-muted); font-size: 0.75rem; margin-bottom: 0.15rem;">สร้างเมื่อ</div>
                        <div style="color: var(--text-main); font-weight: 600;">${escapeHtml(formatDate(order.created_at))}</div>
                    </div>
                    <div>
                        <div style="color: var(--text-muted); font-size: 0.75rem; margin-bottom: 0.15rem;">หมดเวลา</div>
                        <div style="color: var(--text-main); font-weight: 600;">${escapeHtml(formatDate(order.expires_at))}</div>
                    </div>
                    <div>
                        <div style="color: var(--text-muted); font-size: 0.75rem; margin-bottom: 0.15rem;">จ่ายเมื่อ</div>
                        <div style="color: var(--text-main); font-weight: 600;">${escapeHtml(formatDate(order.paid_at))}</div>
                    </div>
                </div>
                ${actions.length ? `<div style="display:flex; gap:0.75rem; flex-wrap:wrap;">${actions.join('')}</div>` : ''}
            </div>
        `;

        historyEl.querySelector('[data-billing-action="resume-payment"]')?.addEventListener('click', () => {
            openPaymentOverlay({
                id: order.id,
                plan_code: order.plan_code,
                amount_thb: order.amount_thb,
                status: order.status,
            }, { reusedOrder: true });
        });

        historyEl.querySelector('[data-billing-action="cancel-order"]')?.addEventListener('click', async () => {
            if (!confirm('ยืนยันยกเลิกออเดอร์นี้?\nถ้ายังไม่ชำระ ระบบจะหยุดรอ QR ทันที')) return;
            await cancelPaymentOrder(order.id);
        });

        historyEl.querySelector('[data-billing-action="restart-order"]')?.addEventListener('click', async () => {
            await restartCheckout(order.plan_code);
        });
    }

    function updateCurrentPlanCard() {
        const subscription = billingState.subscription;
        const order = billingState.latestOrder;

        if (subscription) {
            const plan = subscription.plan || {};
            planNameEl.textContent = plan.label || getPlanLabel(subscription.plan_code) || '-';
            planPriceEl.textContent = getPlanPrice(subscription.plan_code, subscription.amount_thb);
            setStatusBadge(subscription.status);
            startDateEl.textContent = formatDate(subscription.started_at);
            endDateEl.textContent = formatDate(subscription.current_period_end);
            intervalEl.textContent = subscription.billing_interval === 'yearly' ? 'รายปี' : 'รายเดือน';
        } else if (order) {
            planNameEl.textContent = `ออเดอร์รอชำระ · ${getPlanLabel(order.plan_code)}`;
            planPriceEl.textContent = getPlanPrice(order.plan_code, order.amount_thb);
            setStatusBadge(order.status);
            startDateEl.textContent = '-';
            endDateEl.textContent = formatDate(order.expires_at);
            intervalEl.textContent = PLAN_META[order.plan_code]?.intervalText || '-';
        } else {
            planNameEl.textContent = 'ยังไม่มีแพ็กเกจ';
            planPriceEl.textContent = '-';
            setStatusBadge('');
            startDateEl.textContent = '-';
            endDateEl.textContent = '-';
            intervalEl.textContent = '-';
        }

        cancelBtn.style.display = subscription ? 'inline-block' : 'none';
    }

    async function loadBillingData() {
        if (window.PUBILO_WEB_ONLY_MODE) {
            planNameEl.textContent = 'Free (Web Only)';
            planPriceEl.textContent = '฿0';
            setStatusBadge('active');
            startDateEl.textContent = '-';
            endDateEl.textContent = 'ไม่จำกัด';
            intervalEl.textContent = '-';
            historyEl.innerHTML = '<p style="color: var(--text-muted); text-align: center; padding: 2rem 0;">โหมด Web Only ไม่มีระบบ billing</p>';
            return;
        }

        try {
            const res = await apiFetch('/api/billing/current');
            const data = await res.json();

            if (res.status === 401 || res.status === 402 || res.status === 409) {
                billingState.subscription = null;
                billingState.latestOrder = null;
                updateCurrentPlanCard();
                renderPaymentHistory();
                updatePlanCardState();
                await rehydrateAuthGate();
                return;
            }

            if (!res.ok || !data.success) {
                throw new Error(data.error || `โหลดข้อมูล billing ไม่สำเร็จ (${res.status})`);
            }

            billingState.subscription = data.subscription || null;
            billingState.latestOrder = data.latestOrder || null;

            updateCurrentPlanCard();
            renderPaymentHistory();
            updatePlanCardState();
        } catch (err) {
            console.warn('[billing] Failed to load billing data:', err);
            planNameEl.textContent = 'เชื่อมต่อไม่ได้';
            planPriceEl.textContent = '-';
            setStatusBadge('');
            historyEl.innerHTML = '<p style="color: #b42318; text-align: center; padding: 2rem 0;">โหลดข้อมูล billing ไม่สำเร็จ</p>';
        }
    }

    function renderPaymentOverlay(order, options) {
        const overlay = ensurePaymentOverlay();
        const card = overlay.querySelector('#billingPaymentCard');
        const amount = Number(order.amount_thb || order.amountThb || 0);
        const orderId = order.id;
        const planLabel = getPlanLabel(order.plan_code);
        const note = options?.reusedOrder
            ? 'พบออเดอร์ค้างอยู่ ระบบพากลับมาชำระต่อให้เลย'
            : 'สแกน QR ผ่านแอปธนาคารหรือ e-wallet เพื่อเปิดใช้แพ็กเกจทันที';

        card.innerHTML = `
            <div class="pubilo-auth-panel pubilo-payment-panel">
                <div style="display:flex; justify-content:space-between; gap:1rem; align-items:flex-start;">
                    <div style="display:grid; gap:0.5rem;">
                        <p class="pubilo-auth-label">Billing Payment</p>
                        <h2>ชำระ ${getPlanPrice(order.plan_code, amount)}</h2>
                        <p class="pubilo-auth-copy">${escapeHtml(planLabel)} · order ${escapeHtml(orderId.slice(0, 8))}...</p>
                    </div>
                    <button type="button" id="billingClosePaymentBtn" style="border:none; background:none; color:#98a2b3; font-size:1.8rem; line-height:1; cursor:pointer;">&times;</button>
                </div>
                <div class="pubilo-qr-area" id="billingQrArea">
                    <p>กำลังสร้าง QR code...</p>
                </div>
                <div class="pubilo-payment-status" id="billingPaymentStatus"></div>
                <p class="pubilo-auth-note" id="billingPaymentNote">${escapeHtml(note)}</p>
                <div style="display:flex; gap:0.75rem; flex-wrap:wrap;">
                    <button type="button" class="pubilo-primary-btn" id="billingRefreshQrBtn" style="display:none;">สร้าง QR ใหม่</button>
                    <button type="button" id="billingCancelOrderBtn" style="min-height:56px; border-radius:16px; border:1px solid #fecaca; background:#fff5f5; color:#b42318; font-weight:700; cursor:pointer;">ยกเลิกออเดอร์นี้</button>
                </div>
            </div>
        `;

        overlay.classList.remove('is-hidden');

        card.querySelector('#billingClosePaymentBtn')?.addEventListener('click', closePaymentOverlay);
        card.querySelector('#billingCancelOrderBtn')?.addEventListener('click', async () => {
            if (!confirm('ยืนยันยกเลิกออเดอร์นี้?')) return;
            await cancelPaymentOrder(orderId);
            closePaymentOverlay();
        });
        card.querySelector('#billingRefreshQrBtn')?.addEventListener('click', async () => {
            await restartCheckout(order.plan_code);
        });
    }

    async function openPaymentOverlay(order, options) {
        billingState.paymentOrder = {
            id: order.id,
            plan_code: order.plan_code,
            amount_thb: order.amount_thb ?? order.amountThb ?? 0,
            status: order.status || 'pending',
        };
        renderPaymentOverlay(billingState.paymentOrder, options);
        await generateQr(order.id);
    }

    async function generateQr(orderId) {
        const qrArea = document.getElementById('billingQrArea');
        const statusEl = document.getElementById('billingPaymentStatus');
        const noteEl = document.getElementById('billingPaymentNote');
        const refreshBtn = document.getElementById('billingRefreshQrBtn');

        if (!qrArea || !statusEl || !noteEl) return;

        try {
            const res = await apiFetch('/api/billing/create-payment', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ orderId }),
            });
            const data = await res.json();

            if (!res.ok || !data.success) {
                qrArea.innerHTML = `<p class="pubilo-auth-error">${escapeHtml(data.error || 'สร้าง QR ไม่สำเร็จ')}</p>`;
                statusEl.innerHTML = '';
                noteEl.textContent = 'กรุณาลองใหม่ หรือเลือกแพ็กเกจอีกครั้ง';
                if (refreshBtn) refreshBtn.style.display = 'inline-flex';
                return;
            }

            const qrHtml = [];
            if (data.qrBase64) {
                qrHtml.push(`<img src="data:image/png;base64,${data.qrBase64}" alt="QR PromptPay" class="pubilo-qr-image" />`);
            }
            if (data.urlpay) {
                qrHtml.push(`<a href="${escapeHtml(data.urlpay)}" target="_blank" rel="noopener noreferrer" class="pubilo-pay-link">เปิดลิงก์ชำระเงิน</a>`);
            }
            qrArea.innerHTML = qrHtml.join('') || '<p>ไม่สามารถสร้าง QR ได้</p>';

            if (refreshBtn) refreshBtn.style.display = 'none';
            statusEl.innerHTML = '<p class="pubilo-status-waiting">รอการชำระเงิน...</p>';
            if (data.timeOut > 0) {
                noteEl.textContent = `หมดเวลาใน ${Math.ceil(data.timeOut / 60)} นาที`;
            }

            startPaymentPolling(orderId);
        } catch (err) {
            qrArea.innerHTML = `<p class="pubilo-auth-error">เกิดข้อผิดพลาด: ${escapeHtml(err.message)}</p>`;
            statusEl.innerHTML = '';
            noteEl.textContent = 'เชื่อมต่อ payment gateway ไม่สำเร็จ';
            if (refreshBtn) refreshBtn.style.display = 'inline-flex';
        }
    }

    async function handlePaidOrder(data) {
        const statusEl = document.getElementById('billingPaymentStatus');
        const noteEl = document.getElementById('billingPaymentNote');
        if (statusEl) statusEl.innerHTML = '<p class="pubilo-status-success">ชำระเงินสำเร็จ!</p>';
        if (noteEl) noteEl.textContent = 'กำลังอัปเดตแพ็กเกจของ workspace...';

        stopPaymentPolling();
        await refreshAuthState();
        await loadBillingData();

        setTimeout(() => {
            closePaymentOverlay();
            if (data?.subscription?.planCode) {
                alert(`ชำระเงินสำเร็จ\nแพ็กเกจ ${data.subscription.planCode} พร้อมใช้งานแล้ว`);
            }
        }, 1200);
    }

    function startPaymentPolling(orderId) {
        stopPaymentPolling();
        billingState.paymentPollTimer = setInterval(async () => {
            try {
                const res = await apiFetch(`/api/billing/payment-status/${orderId}`);
                const data = await res.json();
                if (!data.success) return;

                const statusEl = document.getElementById('billingPaymentStatus');
                const noteEl = document.getElementById('billingPaymentNote');
                const refreshBtn = document.getElementById('billingRefreshQrBtn');

                if (data.status === 'paid') {
                    await handlePaidOrder(data);
                    return;
                }

                if (data.status === 'expired') {
                    stopPaymentPolling();
                    if (statusEl) statusEl.innerHTML = '<p class="pubilo-auth-error">QR หมดอายุแล้ว</p>';
                    if (noteEl) noteEl.textContent = 'กดสร้าง QR ใหม่เพื่อออกออเดอร์รอบใหม่';
                    if (refreshBtn) refreshBtn.style.display = 'inline-flex';
                    return;
                }

                if (data.status === 'cancelled') {
                    stopPaymentPolling();
                    if (statusEl) statusEl.innerHTML = '<p class="pubilo-auth-error">ออเดอร์นี้ถูกยกเลิกแล้ว</p>';
                    if (noteEl) noteEl.textContent = 'เลือกแพ็กเกจใหม่เพื่อสร้างออเดอร์อีกครั้ง';
                    if (refreshBtn) refreshBtn.style.display = 'inline-flex';
                    await loadBillingData();
                    return;
                }

                if (data.timeOut > 0 && noteEl) {
                    noteEl.textContent = `หมดเวลาใน ${Math.ceil(data.timeOut / 60)} นาที`;
                }
            } catch (err) {
                console.warn('[billing] payment poll failed:', err);
            }
        }, 5000);
    }

    async function cancelPaymentOrder(orderId) {
        try {
            const res = await apiFetch('/api/billing/cancel-payment', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ orderId }),
            });
            const data = await res.json();
            if (!res.ok || !data.success) {
                alert('ยกเลิกออเดอร์ไม่สำเร็จ: ' + (data.error || 'Unknown error'));
                return false;
            }
            stopPaymentPolling();
            await refreshAuthState();
            await loadBillingData();
            alert('ยกเลิกออเดอร์เรียบร้อยแล้ว');
            return true;
        } catch (err) {
            alert('เชื่อมต่อ server ไม่ได้');
            return false;
        }
    }

    async function restartCheckout(planCode) {
        const fakeButton = document.querySelector(`.billing-select-plan-btn[data-plan="${planCode}"]`);
        await startCheckout(planCode, fakeButton, { skipConfirm: true });
    }

    async function startCheckout(planCode, triggerButton, options) {
        if (!planCode) return;

        if (window.PUBILO_WEB_ONLY_MODE) {
            alert('ระบบ Billing ยังไม่สามารถใช้งานได้ในโหมด Web Only\nกรุณาเชื่อมต่อ API Server ก่อน');
            return;
        }

        const planLabel = planCode === 'monthly_500' ? 'รายเดือน ฿299' : (planCode === 'yearly_4499' ? 'รายปี ฿2,999' : planCode);
        if (!options?.skipConfirm && !confirm(`ยืนยันเลือกแพ็กเกจ ${planLabel} ?`)) return;

        const originalText = triggerButton?.textContent || '';
        let completed = false;
        if (triggerButton) {
            triggerButton.disabled = true;
            triggerButton.textContent = 'กำลังสร้างออเดอร์...';
        }

        try {
            const res = await apiFetch('/api/billing/checkout-intent', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ planCode }),
            });
            const data = await res.json();

            if (!res.ok || !data.success) {
                alert('เกิดข้อผิดพลาด: ' + (data.error || 'Unknown error'));
                return;
            }

            const paymentOrder = {
                id: data.paymentOrder?.id,
                plan_code: planCode,
                amount_thb: data.paymentOrder?.amountThb || PLAN_META[planCode]?.price || 0,
                status: data.paymentOrder?.status || 'pending',
            };

            billingState.latestOrder = paymentOrder;
            await refreshAuthState();
            await loadBillingData();
            await openPaymentOverlay(paymentOrder, { reusedOrder: !!data.reusedOrder });
            completed = true;
        } catch (err) {
            alert('เชื่อมต่อ server ไม่ได้');
        } finally {
            if (triggerButton && !completed) {
                triggerButton.disabled = false;
                triggerButton.textContent = originalText || 'เริ่มต้นใช้งาน';
            }
        }
    }

    document.querySelectorAll('.billing-select-plan-btn').forEach((btn) => {
        btn.addEventListener('click', async () => {
            await startCheckout(btn.dataset.plan, btn);
        });
    });

    if (cancelBtn) {
        cancelBtn.addEventListener('click', async () => {
            if (window.PUBILO_WEB_ONLY_MODE) {
                alert('ไม่สามารถยกเลิกได้ในโหมด Web Only');
                return;
            }

            if (!confirm('ยืนยันยกเลิกแพ็กเกจ?\nคุณจะยังใช้งานได้จนถึงวันหมดอายุปัจจุบัน')) return;

            try {
                const res = await apiFetch('/api/billing/cancel', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                });
                const data = await res.json();
                if (data.success) {
                    await refreshAuthState();
                    await loadBillingData();
                    alert('ยกเลิกแพ็กเกจเรียบร้อยแล้ว');
                } else {
                    alert('เกิดข้อผิดพลาด: ' + (data.error || 'Unknown error'));
                }
            } catch (err) {
                alert('เชื่อมต่อ server ไม่ได้');
            }
        });
    }

    function checkBillingHash() {
        if (window.location.hash === '#billing') {
            loadBillingData();
        } else {
            closePaymentOverlay();
        }
    }

    window.addEventListener('hashchange', checkBillingHash);
    window.addEventListener('beforeunload', stopPaymentPolling);
    checkBillingHash();
})();
