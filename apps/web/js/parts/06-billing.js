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

    function formatDate(iso) {
        if (!iso) return '-';
        try {
            return new Date(iso).toLocaleDateString('th-TH', {
                year: 'numeric', month: 'long', day: 'numeric',
            });
        } catch { return iso; }
    }

    function setStatusBadge(status) {
        const map = {
            active: { text: 'Active', bg: '#ecfdf3', color: '#027a48' },
            pending_payment: { text: 'รอชำระ', bg: '#fffaeb', color: '#b54708' },
            expired: { text: 'หมดอายุ', bg: '#fef3f2', color: '#b42318' },
            cancelled: { text: 'ยกเลิก', bg: '#f2f4f7', color: '#344054' },
        };
        const info = map[status] || { text: status || '-', bg: '#f2f4f7', color: '#344054' };
        statusBadgeEl.textContent = info.text;
        statusBadgeEl.style.background = info.bg;
        statusBadgeEl.style.color = info.color;
    }

    async function loadBillingData() {
        if (window.PUBILO_WEB_ONLY_MODE) {
            planNameEl.textContent = 'Free (Web Only)';
            planPriceEl.textContent = '฿0';
            setStatusBadge('active');
            startDateEl.textContent = '-';
            endDateEl.textContent = 'ไม่จำกัด';
            intervalEl.textContent = '-';
            return;
        }

        try {
            const res = await fetch(`${window.API_BASE}/api/billing/current`, { credentials: 'include' });
            const data = await res.json();

            if (data.subscription) {
                const sub = data.subscription;
                const plan = sub.plan || {};
                planNameEl.textContent = plan.label || sub.plan_code || '-';
                planPriceEl.textContent = `฿${Number(sub.amount_thb || 0).toLocaleString('th-TH')}`;
                setStatusBadge(sub.status);
                startDateEl.textContent = formatDate(sub.started_at);
                endDateEl.textContent = formatDate(sub.current_period_end);
                intervalEl.textContent = sub.billing_interval === 'yearly' ? 'รายปี' : 'รายเดือน';

                // Highlight active plan card
                document.querySelectorAll('.billing-plan-card').forEach(card => {
                    if (card.dataset.plan === sub.plan_code) {
                        card.style.borderColor = 'var(--primary)';
                        card.style.background = '#faf8ff';
                        const btn = card.querySelector('.billing-select-plan-btn');
                        if (btn) {
                            btn.textContent = 'แพ็กเกจปัจจุบัน';
                            btn.disabled = true;
                            btn.style.opacity = '0.6';
                        }
                    }
                });
            } else {
                planNameEl.textContent = 'ยังไม่มีแพ็กเกจ';
                planPriceEl.textContent = '-';
                setStatusBadge('');
            }

            if (data.latestOrder) {
                const order = data.latestOrder;
                historyEl.innerHTML = `
                    <div style="border: 1px solid var(--border-color); border-radius: 8px; overflow: hidden;">
                        <table style="width: 100%; border-collapse: collapse; font-size: 0.9rem;">
                            <thead>
                                <tr style="background: #f9fafb; border-bottom: 1px solid var(--border-color);">
                                    <th style="padding: 0.75rem 1rem; text-align: left; font-weight: 600; color: var(--text-muted);">Order ID</th>
                                    <th style="padding: 0.75rem 1rem; text-align: left; font-weight: 600; color: var(--text-muted);">แพ็กเกจ</th>
                                    <th style="padding: 0.75rem 1rem; text-align: right; font-weight: 600; color: var(--text-muted);">ยอด</th>
                                    <th style="padding: 0.75rem 1rem; text-align: center; font-weight: 600; color: var(--text-muted);">สถานะ</th>
                                    <th style="padding: 0.75rem 1rem; text-align: left; font-weight: 600; color: var(--text-muted);">วันที่</th>
                                </tr>
                            </thead>
                            <tbody>
                                <tr>
                                    <td style="padding: 0.75rem 1rem; color: var(--text-main); font-family: monospace; font-size: 0.8rem;">${(order.id || '').slice(0, 8)}...</td>
                                    <td style="padding: 0.75rem 1rem; color: var(--text-main);">${order.plan_code || '-'}</td>
                                    <td style="padding: 0.75rem 1rem; text-align: right; color: var(--text-main); font-weight: 600;">฿${Number(order.amount_thb || 0).toLocaleString('th-TH')}</td>
                                    <td style="padding: 0.75rem 1rem; text-align: center;">
                                        <span style="background: ${order.status === 'paid' ? '#ecfdf3' : '#fffaeb'}; color: ${order.status === 'paid' ? '#027a48' : '#b54708'}; padding: 0.2rem 0.6rem; border-radius: 999px; font-size: 0.75rem; font-weight: 600;">${order.status || '-'}</span>
                                    </td>
                                    <td style="padding: 0.75rem 1rem; color: var(--text-muted);">${formatDate(order.created_at)}</td>
                                </tr>
                            </tbody>
                        </table>
                    </div>`;
            }
        } catch (err) {
            console.warn('[billing] Failed to load billing data:', err);
            planNameEl.textContent = 'เชื่อมต่อไม่ได้';
            planPriceEl.textContent = '-';
            setStatusBadge('');
        }
    }

    // Plan select buttons
    document.querySelectorAll('.billing-select-plan-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
            if (btn.disabled) return;
            const planCode = btn.dataset.plan;
            if (!planCode) return;

            if (window.PUBILO_WEB_ONLY_MODE) {
                alert('ระบบ Billing ยังไม่สามารถใช้งานได้ในโหมด Web Only\nกรุณาเชื่อมต่อ API Server ก่อน');
                return;
            }

            if (!confirm(`ยืนยันเลือกแพ็กเกจ ${planCode === 'monthly_500' ? 'รายเดือน ฿500' : 'รายปี ฿4,499'} ?`)) return;

            btn.disabled = true;
            btn.textContent = 'กำลังดำเนินการ...';

            try {
                const res = await fetch(`${window.API_BASE}/api/billing/checkout-intent`, {
                    method: 'POST',
                    credentials: 'include',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ planCode }),
                });
                const data = await res.json();

                if (data.success) {
                    alert(`สร้าง Order สำเร็จ!\nOrder ID: ${data.paymentOrder?.id || '-'}\nยอด: ฿${data.paymentOrder?.amountThb || 0}\n\nกรุณาชำระเงินแล้วแจ้ง Admin เพื่อยืนยัน`);
                    loadBillingData();
                } else {
                    alert('เกิดข้อผิดพลาด: ' + (data.error || 'Unknown error'));
                    btn.textContent = 'เลือกแพ็กเกจนี้';
                    btn.disabled = false;
                }
            } catch (err) {
                alert('เชื่อมต่อ server ไม่ได้');
                btn.textContent = 'เลือกแพ็กเกจนี้';
                btn.disabled = false;
            }
        });
    });

    // Cancel button
    if (cancelBtn) {
        cancelBtn.addEventListener('click', async () => {
            if (window.PUBILO_WEB_ONLY_MODE) {
                alert('ไม่สามารถยกเลิกได้ในโหมด Web Only');
                return;
            }

            if (!confirm('ยืนยันยกเลิกแพ็กเกจ?\nคุณจะยังใช้งานได้จนถึงวันหมดอายุปัจจุบัน')) return;

            try {
                const res = await fetch(`${window.API_BASE}/api/billing/cancel`, {
                    method: 'POST',
                    credentials: 'include',
                    headers: { 'Content-Type': 'application/json' },
                });
                const data = await res.json();
                if (data.success) {
                    alert('ยกเลิกแพ็กเกจเรียบร้อยแล้ว');
                    loadBillingData();
                } else {
                    alert('เกิดข้อผิดพลาด: ' + (data.error || 'Unknown error'));
                }
            } catch (err) {
                alert('เชื่อมต่อ server ไม่ได้');
            }
        });
    }

    // Load on hash change
    function checkBillingHash() {
        if (window.location.hash === '#billing') {
            loadBillingData();
        }
    }
    window.addEventListener('hashchange', checkBillingHash);
    checkBillingHash();
})();
