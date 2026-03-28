// 8. EARNINGS
// ============================================
function showEarningsPanel() {
    document.querySelectorAll(".mode-container").forEach((c) => {
        c.classList.remove("active");
    });
    pendingPanel.style.display = "none";
    publishedPanel.style.display = "none";
    settingsPanel.style.display = "none";
    quotesPanel.style.display = "none";
    const tp = document.getElementById("textPanel");
    if (tp) tp.style.display = "none";
    earningsPanel.style.display = "flex";
    appLayout.classList.add("pending-mode");
    document.body.style.overflow = "hidden";
    loadEarnings();
}

// Escape HTML to prevent XSS
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Load earnings data
async function loadEarnings() {
    const loadingEl = document.getElementById("earningsLoading");
    const dataEl = document.getElementById("earningsData");

    loadingEl.style.display = "block";
    loadingEl.style.color = '';
    dataEl.style.display = "none";

    const pageId = getCurrentPageId();
    if (!pageId) {
        loadingEl.textContent = 'Please select a Page first';
        loadingEl.style.color = '#e74c3c';
        return;
    }

    try {
        const response = await fetch(`/api/earnings?pageId=${pageId}`);
        const result = await response.json();

        if (!result.success || !result.earnings || result.earnings.length === 0) {
            loadingEl.textContent = 'No earnings data available';
            return;
        }

        loadingEl.style.display = "none";
        dataEl.style.display = "block";

        // Calculate totals
        let totalDaily = 0;
        let totalWeekly = 0;
        let totalMonthly = 0;

        result.earnings.forEach(e => {
            if (!e.error) {
                totalDaily += e.daily || 0;
                totalWeekly += e.weekly || 0;
                totalMonthly += e.monthly || 0;
            }
        });

        // Clear existing content
        dataEl.textContent = '';

        // Create summary cards
        const summaryGrid = document.createElement('div');
        summaryGrid.style.cssText = 'display: grid; grid-template-columns: repeat(3, 1fr); gap: 1rem; margin-bottom: 2rem;';

        const dailyCard = document.createElement('div');
        dailyCard.style.cssText = 'background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 1.5rem; border-radius: 12px; text-align: center;';
        dailyCard.innerHTML = `<div style="font-size: 0.9rem; opacity: 0.9;">Daily Total</div><div style="font-size: 1.8rem; font-weight: bold;">$${totalDaily.toFixed(2)}</div>`;

        const weeklyCard = document.createElement('div');
        weeklyCard.style.cssText = 'background: linear-gradient(135deg, #11998e 0%, #38ef7d 100%); color: white; padding: 1.5rem; border-radius: 12px; text-align: center;';
        weeklyCard.innerHTML = `<div style="font-size: 0.9rem; opacity: 0.9;">Weekly Total</div><div style="font-size: 1.8rem; font-weight: bold;">$${totalWeekly.toFixed(2)}</div>`;

        const monthlyCard = document.createElement('div');
        monthlyCard.style.cssText = 'background: linear-gradient(135deg, #ee0979 0%, #ff6a00 100%); color: white; padding: 1.5rem; border-radius: 12px; text-align: center;';
        monthlyCard.innerHTML = `<div style="font-size: 0.9rem; opacity: 0.9;">28-Day Total</div><div style="font-size: 1.8rem; font-weight: bold;">$${totalMonthly.toFixed(2)}</div>`;

        summaryGrid.appendChild(dailyCard);
        summaryGrid.appendChild(weeklyCard);
        summaryGrid.appendChild(monthlyCard);
        dataEl.appendChild(summaryGrid);

        // Show error if any
        const pageData = result.earnings[0];
        if (pageData && pageData.error) {
            const errorEl = document.createElement('div');
            errorEl.style.cssText = 'color: #e74c3c; text-align: center; padding: 1rem;';
            errorEl.textContent = 'Error: ' + pageData.error;
            dataEl.appendChild(errorEl);
        }
    } catch (err) {
        console.error('Error loading earnings:', err);
        loadingEl.textContent = 'Failed to load earnings data';
        loadingEl.style.color = '#e74c3c';
    }
}

// Refresh earnings button
document.getElementById("refreshEarningsBtn")?.addEventListener("click", loadEarnings);

// Show quotes panel
function showQuotesPanel() {
    // Hide all mode containers
    document.querySelectorAll(".mode-container").forEach((c) => {
        c.classList.remove("active");
    });
    pendingPanel.style.display = "none";
    publishedPanel.style.display = "none";
    settingsPanel.style.display = "none";
    earningsPanel.style.display = "none";
    const tp = document.getElementById("textPanel");
    if (tp) tp.style.display = "none";
    quotesPanel.style.display = "flex";
    appLayout.classList.add("pending-mode");
    // Lock body scroll
    document.body.style.overflow = "hidden";
    // Load quotes
    loadQuotes();
}

// Show published panel
function showPublishedPanel() {
    document.querySelectorAll(".mode-container").forEach((c) => {
        c.classList.remove("active");
        c.style.display = "none";
    });
    pendingPanel.style.display = "none";
    quotesPanel.style.display = "none";
    settingsPanel.style.display = "none";
    earningsPanel.style.display = "none";
    const tp = document.getElementById("textPanel");
    if (tp) tp.style.display = "none";
    publishedPanel.style.display = "flex";
    appLayout.classList.add("pending-mode");
    document.body.style.overflow = "hidden";
    loadPublishedPosts();
}

// Load published posts from our logs
async function loadPublishedPosts() {
    const pageId = getCurrentPageId();

    if (!pageId) {
        publishedTableContainer.innerHTML = '<div class="pending-empty">Please select a Page first</div>';
        return;
    }

    // Show skeleton
    publishedTableContainer.innerHTML = `
        <div class="pending-skeleton">
          <div class="pending-skeleton-row"><div class="sk-img"></div><div class="sk-text"></div><div class="sk-date"></div><div class="sk-badge"></div></div>
          <div class="pending-skeleton-row"><div class="sk-img"></div><div class="sk-text"></div><div class="sk-date"></div><div class="sk-badge"></div></div>
          <div class="pending-skeleton-row"><div class="sk-img"></div><div class="sk-text"></div><div class="sk-date"></div><div class="sk-badge"></div></div>
        </div>
    `;

    try {
        const response = await fetch(`/api/auto-post-logs?pageId=${pageId}&limit=50`);
        const data = await response.json();

        if (!data.success) {
            publishedTableContainer.innerHTML = `<div class="pending-empty">Error: ${data.error}</div>`;
            return;
        }

        const logs = data.logs || [];
        if (logs.length === 0) {
            publishedTableContainer.innerHTML = '<div class="pending-empty">No published posts yet</div>';
            return;
        }

        // Build table like pending
        const table = buildPublishedTable(logs);
        publishedTableContainer.innerHTML = '';
        publishedTableContainer.appendChild(table);

    } catch (err) {
        publishedTableContainer.innerHTML = `<div class="pending-empty">Error: ${err.message}</div>`;
    }
}

// Build published table (same style as pending)
function buildPublishedTable(logs) {
    const table = document.createElement("table");
    table.className = "pending-table";

    const thead = document.createElement("thead");
    const headerRow = document.createElement("tr");
    ["Type", "Message", "Time", "Share", "Status", "Link", "Delete"].forEach((text) => {
        const th = document.createElement("th");
        th.textContent = text;
        headerRow.appendChild(th);
    });
    thead.appendChild(headerRow);
    table.appendChild(thead);

    const tbody = document.createElement("tbody");
    logs.forEach((log) => {
        const tr = document.createElement("tr");
        tr.dataset.id = log.id;

        // Type cell with icon (same style as pending)
        const typeTd = document.createElement("td");
        const typeSpan = document.createElement("span");
        const pType = log.post_type === 'image' ? 'image' : 'text';
        typeSpan.className = `post-type-badge post-type-${pType}`;
        const typeIcons = {
            image: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>',
            text: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>'
        };
        typeSpan.innerHTML = typeIcons[pType] || typeIcons.text;
        typeSpan.title = pType === 'image' ? 'Image' : 'Text';
        typeTd.appendChild(typeSpan);
        tr.appendChild(typeTd);

        // Message cell
        const msgTd = document.createElement("td");
        const msgDiv = document.createElement("div");
        msgDiv.className = "pending-table-title";
        const message = log.quote_text || "(No message)";
        msgDiv.textContent = message.length > 50 ? message.substring(0, 50) + "..." : message;
        msgDiv.title = message;
        msgTd.appendChild(msgDiv);
        tr.appendChild(msgTd);

        // Time cell
        const timeTd = document.createElement("td");
        const timeSpan = document.createElement("span");
        timeSpan.className = "pending-table-time";
        timeSpan.textContent = new Date(log.created_at).toLocaleString("th-TH", {
            year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit"
        });
        timeTd.appendChild(timeSpan);
        tr.appendChild(timeTd);

        // Share cell
        const shareTd = document.createElement("td");
        if (log.share_status === 'shared' && log.shared_at) {
            if (log.shared_post_id) {
                const shareLink = document.createElement("a");
                shareLink.href = `https://facebook.com/${log.shared_post_id}`;
                shareLink.target = "_blank";
                shareLink.className = "pending-table-link pending-table-share-link";
                shareLink.title = "ดูโพสต์ที่แชร์ - " + new Date(log.shared_at).toLocaleString("th-TH");
                // Share icon SVG
                const svgNS = "http://www.w3.org/2000/svg";
                const svg = document.createElementNS(svgNS, "svg");
                svg.setAttribute("viewBox", "0 0 24 24");
                svg.setAttribute("fill", "none");
                svg.setAttribute("stroke", "currentColor");
                svg.setAttribute("stroke-width", "2");
                svg.setAttribute("width", "16");
                svg.setAttribute("height", "16");
                const path1 = document.createElementNS(svgNS, "path");
                path1.setAttribute("d", "M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8");
                const polyline = document.createElementNS(svgNS, "polyline");
                polyline.setAttribute("points", "16 6 12 2 8 6");
                const line = document.createElementNS(svgNS, "line");
                line.setAttribute("x1", "12");
                line.setAttribute("y1", "2");
                line.setAttribute("x2", "12");
                line.setAttribute("y2", "15");
                svg.appendChild(path1);
                svg.appendChild(polyline);
                svg.appendChild(line);
                shareLink.appendChild(svg);
                shareTd.appendChild(shareLink);
            } else {
                const shareSpan = document.createElement("span");
                shareSpan.className = "pending-table-time";
                shareSpan.style.color = "#059669";
                shareSpan.textContent = new Date(log.shared_at).toLocaleString("th-TH", {
                    hour: "2-digit", minute: "2-digit"
                });
                shareSpan.title = "แชร์แล้ว: " + new Date(log.shared_at).toLocaleString("th-TH");
                shareTd.appendChild(shareSpan);
            }
        } else if (log.share_status === 'pending') {
            const pendingSpan = document.createElement("span");
            pendingSpan.style.fontSize = "1rem";
            pendingSpan.textContent = "⏳";
            pendingSpan.title = "รอแชร์";
            shareTd.appendChild(pendingSpan);
        } else {
            shareTd.textContent = "-";
            shareTd.style.color = "#999";
        }
        tr.appendChild(shareTd);

        // Status cell
        const statusTd = document.createElement("td");
        const statusSpan = document.createElement("span");
        statusSpan.className = "pending-table-status";
        if (log.status === 'success') {
            statusSpan.style.background = "#dcfce7";
            statusSpan.style.color = "#166534";
            statusSpan.textContent = "Success";
        } else if (log.status === 'failed') {
            statusSpan.style.background = "#fee2e2";
            statusSpan.style.color = "#dc2626";
            statusSpan.textContent = "Failed";
            statusSpan.title = log.error_message || '';
        } else {
            statusSpan.style.background = "#fef3c7";
            statusSpan.style.color = "#d97706";
            statusSpan.textContent = "Pending";
        }
        statusTd.appendChild(statusSpan);
        tr.appendChild(statusTd);

        // Link cell
        const linkTd = document.createElement("td");
        if (log.facebook_post_id) {
            const link = document.createElement("a");
            link.href = `https://facebook.com/${log.facebook_post_id}`;
            link.target = "_blank";
            link.className = "pending-table-link";
            link.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>';
            link.title = "View on Facebook";
            linkTd.appendChild(link);
        } else {
            linkTd.textContent = "-";
            linkTd.style.color = "#999";
        }
        tr.appendChild(linkTd);

        // Delete cell
        const deleteTd = document.createElement("td");
        const deleteBtn = document.createElement("button");
        deleteBtn.className = "pending-table-delete";
        deleteBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>';
        deleteBtn.title = "Delete";
        deleteBtn.onclick = () => deletePublishedLog(log.id);
        deleteTd.appendChild(deleteBtn);
        tr.appendChild(deleteTd);

        tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    return table;
}

// Delete published log - v5.5 fixed path params
async function deletePublishedLog(logId) {
    console.log('[DELETE] Deleting log:', logId);
    if (!confirm("ต้องการลบ log นี้?")) return;
    try {
        const response = await fetch(`/api/auto-post-logs/${logId}`, { method: 'DELETE' });
        const data = await response.json();
        if (data.success) {
            loadPublishedPosts();
        } else {
            alert("Error: " + data.error);
        }
    } catch (err) {
        alert("Error: " + err.message);
    }
}

// Show settings panel
function showSettingsPanel() {
    // Hide all mode containers
    document.querySelectorAll(".mode-container").forEach((c) => {
        c.classList.remove("active");
        c.style.display = "none";
    });
    pendingPanel.style.display = "none";
    publishedPanel.style.display = "none";
    quotesPanel.style.display = "none";
    earningsPanel.style.display = "none";
    textPanel.style.display = "none";
    const textModePanel = document.getElementById("textModePanel");
    if (textModePanel) textModePanel.style.display = "none";
    settingsPanel.style.display = "flex";
    appLayout.classList.add("pending-mode");
    document.body.style.overflow = "hidden";
    loadSettingsPanel();
}

// Show text panel (for adding quotes)
const textPanel = document.getElementById("textPanel");

function showTextPanel() {
    // Hide all panels
    document.querySelectorAll(".mode-container").forEach((c) => {
        c.classList.remove("active");
    });
    pendingPanel.style.display = "none";
    publishedPanel.style.display = "none";
    quotesPanel.style.display = "none";
    settingsPanel.style.display = "none";

    // Show text mode panel (full width like pending)
    const textModePanel = document.getElementById("textModePanel");
    if (textModePanel) {
        textModePanel.style.display = "block";
    }

    // Add pending-mode class for full width layout
    appLayout.classList.add("pending-mode");

    // Focus on text textarea
    setTimeout(() => {
        const textTextarea = document.getElementById("textMessageTextarea");
        if (textTextarea) {
            textTextarea.focus();

            // Add preview functionality
            textTextarea.oninput = () => {
                const previewContent = document.getElementById("textPreviewContent");
                if (previewContent) {
                    const text = textTextarea.value;
                    previewContent.textContent = text || "พิมพ์ข้อความในช่องด้านล่างเพื่อดูตัวอย่าง...";
                    previewContent.style.color = text ? "#333" : "#999";
                }
            };
        }

        // Add publish button handler
        const textPublishBtn = document.getElementById("textPublishBtn");
        if (textPublishBtn) {
            textPublishBtn.onclick = async () => {
                const message = document.getElementById("textMessageTextarea").value;
                if (!message.trim()) {
                    alert("กรุณาพิมพ์ข้อความก่อนโพสต์");
                    return;
                }

                const statusEl = document.getElementById("textPublishStatus");
                const showStatus = (msg, isError = false) => {
                    statusEl.style.display = 'block';
                    statusEl.style.background = isError ? '#fee2e2' : '#dcfce7';
                    statusEl.style.color = isError ? '#dc2626' : '#16a34a';
                    statusEl.innerHTML = msg;
                };

                try {
                    textPublishBtn.disabled = true;
                    textPublishBtn.innerHTML = '<span class="publish-icon">⏳</span> กำลังโพสต์...';
                    showStatus('📤 กำลังสร้างโพสต์...');

                    const pageId = getCurrentPageId();
                    if (!pageId) {
                        alert("กรุณาเลือกเพจก่อน");
                        return;
                    }

                    // Get selected share pages
                    const shareCheckboxes = document.querySelectorAll('input[name="sharePage"]:checked');
                    const shareToPages = Array.from(shareCheckboxes).map(cb => cb.value);
                    const userId = getCurrentUserId();

                    if (!userId) {
                        throw new Error('กรุณาเลือกผู้ใช้ก่อน');
                    }

                    const iUser = document.getElementById('iUserInput')?.value?.trim();

                    showStatus('📤 กำลังโพสต์...');
                    const response = await fetch("/api/text-post", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                            pageId,
                            message,
                            shareToPages,
                            userId,
                            iUser
                        }),
                    });

                    const result = await response.json();

                    if (result.success) {
                        let statusMsg = `✅ โพสต์สำเร็จ!<br>Post ID: ${result.postId}`;

                        // แสดงผล edit
                        if (result.editSuccess) {
                            statusMsg += '<br>✅ ลบรูปสำเร็จ (เหลือแค่ text)';
                        } else if (result.editError) {
                            statusMsg += '<br>❌ ลบรูปไม่สำเร็จ: ' + result.editError.slice(0, 100);
                        }

                        if (result.queuedShares?.length > 0) {
                            statusMsg += '<br><br>📢 รอแชร์ตามเวลาที่กำหนด:';
                            result.queuedShares.forEach(sr => {
                                statusMsg += sr.queued
                                    ? `<br>⏳ ${sr.pageId}`
                                    : `<br>❌ ${sr.pageId}: queue failed`;
                            });
                        }
                        showStatus(statusMsg);

                        // Clear form
                        document.getElementById("textMessageTextarea").value = "";

                        // Uncheck all share checkboxes
                        document.querySelectorAll('input[name="sharePage"]').forEach(cb => cb.checked = false);
                    } else {
                        throw new Error(result.error || 'Server error');
                    }

                } catch (error) {
                    console.error('Text post error:', error);
                    showStatus("❌ " + error.message, true);
                } finally {
                    textPublishBtn.disabled = false;
                    textPublishBtn.innerHTML = '<span class="publish-icon">📝</span> Publish Text Post';
                }
            };
        }

        // Load share pages list
        loadSharePagesList();
    }, 100);
}

// Load pages for sharing - ดึงจาก database
async function loadSharePagesList() {
    const container = document.getElementById('sharePagesList');
    if (!container) return;

    container.innerHTML = '<div style="color: #666; padding: 8px;">กำลังโหลด...</div>';

    try {
        const currentPageId = getCurrentPageId();
        const userId = getCurrentUserId();

        if (!userId) {
            container.innerHTML = '<div style="color: #999; padding: 8px;">กรุณาเลือกผู้ใช้ก่อน</div>';
            return;
        }

        // ดึง pages ของ user จาก Graph API
        const res = await fetch(`/api/pages?userId=${userId}`);
        const data = await res.json();

        if (data.success && data.pages?.length > 0) {
            renderPagesList(container, data.pages, currentPageId);
        } else {
            container.innerHTML = '<div style="color: #999; padding: 8px;">ไม่พบรายการเพจ</div>';
        }

    } catch (e) {
        console.error('Load pages error:', e);
        container.innerHTML = '<div style="color: #f00; padding: 8px;">เกิดข้อผิดพลาด</div>';
    }
}

function renderPagesList(container, pages, currentPageId) {
    const filteredPages = pages.filter(p => p.page_id !== currentPageId);
    if (filteredPages.length === 0) {
        container.innerHTML = '<div style="color: #999; padding: 8px;">ไม่มีเพจอื่นให้แชร์</div>';
        return;
    }

    container.innerHTML = filteredPages.map(p => `
        <label style="display: flex; align-items: center; gap: 8px; padding: 8px; cursor: pointer; border-radius: 4px; transition: background 0.2s;" 
               onmouseover="this.style.background='#f0f0f0'" 
               onmouseout="this.style.background='transparent'">
            <input type="checkbox" name="sharePage" value="${p.page_id}" style="width: 18px; height: 18px; cursor: pointer;">
            <span style="flex: 1; font-size: 14px;">${p.page_name || p.page_id}</span>
        </label>
    `).join('');
}

// Text Quote Form Handlers
const textQuoteInput = document.getElementById("textQuoteInput");
const textQuoteClearBtn = document.getElementById("textQuoteClearBtn");
const textQuoteSubmitBtn = document.getElementById("textQuoteSubmitBtn");
const textQuoteStatus = document.getElementById("textQuoteStatus");

if (textQuoteClearBtn) {
    textQuoteClearBtn.addEventListener("click", () => {
        textQuoteInput.value = "";
        textQuoteStatus.textContent = "";
        textQuoteInput.focus();
    });
}

if (textQuoteSubmitBtn) {
    textQuoteSubmitBtn.addEventListener("click", async () => {
        const text = textQuoteInput.value.trim();
        if (!text) {
            textQuoteStatus.textContent = "กรุณาใส่ข้อความ";
            textQuoteStatus.style.color = "#dc3545";
            return;
        }

        textQuoteSubmitBtn.disabled = true;
        textQuoteStatus.textContent = "กำลังบันทึก...";
        textQuoteStatus.style.color = "#666";

        try {
            const response = await fetch("/api/quotes", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ quoteText: text })
            });
            const data = await response.json();

            if (data.success) {
                textQuoteStatus.textContent = "✓ บันทึกสำเร็จ กำลังไปหน้า Quotes...";
                textQuoteStatus.style.color = "#28a745";
                textQuoteInput.value = "";
                // Navigate to quotes page after brief delay
                setTimeout(() => {
                    window.location.hash = "quotes";
                    handleNavigation();
                }, 500);
            } else {
                textQuoteStatus.textContent = data.error || "บันทึกไม่สำเร็จ";
                textQuoteStatus.style.color = "#dc3545";
            }
        } catch (error) {
            console.error("Failed to save quote:", error);
            textQuoteStatus.textContent = "เกิดข้อผิดพลาด";
            textQuoteStatus.style.color = "#dc3545";
        } finally {
            textQuoteSubmitBtn.disabled = false;
        }
    });
}

// ============================================
