// 8. EARNINGS
// ============================================
function showEarningsPanel() {
    document.querySelectorAll(".mode-container").forEach((c) => {
        c.classList.remove("active");
    });
    pendingPanel.style.display = "none";
    publishedPanel.style.display = "none";
    if (hidePostsPanel) hidePostsPanel.style.display = "none";
    if (deletePostsPanel) deletePostsPanel.style.display = "none";
    settingsPanel.style.display = "none";
    quotesPanel.style.display = "none";
    const tp = document.getElementById("textPanel");
    if (tp) tp.style.display = "none";
    const bp = document.getElementById("billingPanel");
    if (bp) bp.style.display = "none";
    earningsPanel.style.display = "flex";
    appLayout.classList.add("pending-mode");
    document.body.style.overflow = "";
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
    showPendingPanel(false, "quotes");
}

// Show published panel
function showPublishedPanel() {
    document.querySelectorAll(".mode-container").forEach((c) => {
        c.classList.remove("active");
        c.style.display = "none";
    });
    pendingPanel.style.display = "none";
    if (hidePostsPanel) hidePostsPanel.style.display = "none";
    if (deletePostsPanel) deletePostsPanel.style.display = "none";
    quotesPanel.style.display = "none";
    settingsPanel.style.display = "none";
    earningsPanel.style.display = "none";
    const tp = document.getElementById("textPanel");
    if (tp) tp.style.display = "none";
    const bp = document.getElementById("billingPanel");
    if (bp) bp.style.display = "none";
    publishedPanel.style.display = "flex";
    appLayout.classList.add("pending-mode");
    document.body.style.overflow = "";
    const currentPageId = getCurrentPageId();
    const shouldSilentRefresh =
        currentPublishedPosts.length > 0 &&
        currentPublishedPageId &&
        currentPublishedPageId === currentPageId;
    loadPublishedPosts({ silent: shouldSilentRefresh });
}

const publishedFilters = {
    query: "",
    type: "all",
    day: "all",
    customDate: "",
};

let currentPublishedPosts = [];
let currentPublishedPageId = "";
const publishedLoadState = {
    loading: false,
    activePageId: "",
    lastLoadedAt: 0,
};

function getPublishedEmptyCopy() {
    return "ยังไม่พบโพสต์ของเพจนี้";
}

function getPublishedNoResultsCopy() {
    return "ไม่พบโพสต์ที่ตรงกับ filter นี้";
}

function parsePublishedDate(value) {
    if (!value) return null;
    const raw = String(value).trim();
    if (!raw) return null;
    const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(raw)
        // D1/SQLite timestamps are UTC; append Z so browser converts to local time correctly.
        ? `${raw.replace(" ", "T")}Z`
        : raw;
    const parsed = new Date(normalized);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function getPublishedDateKey(value) {
    const date = value instanceof Date ? value : parsePublishedDate(value);
    if (!date) return "";
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
}

function getPublishedPostTypeKey(log) {
    const raw = String(log.post_type || log.media_kind || "").toLowerCase();
    if (raw.includes("reel") || raw.includes("video")) return "reels";
    if (raw.includes("image") || raw.includes("photo")) return "image";
    if (raw.includes("text")) return "text";
    return "link";
}

function normalizePublishedFacebookUrl(value) {
    const normalized = String(value || "").trim();
    if (!normalized) return "";
    if (normalized.startsWith("http://") || normalized.startsWith("https://")) return normalized;
    if (normalized.startsWith("/")) return `https://www.facebook.com${normalized}`;
    return `https://www.facebook.com/${normalized.replace(/^\/+/, "")}`;
}

function buildPublishedFacebookUrl(log) {
    const explicit = normalizePublishedFacebookUrl(log.facebook_url);
    if (explicit) return explicit;

    const pageId = String(log.page_id || getCurrentPageId() || "").trim();
    const postId = String(log.facebook_post_id || "").trim();
    const postType = getPublishedPostTypeKey(log);
    if (!postId) return "";

    const normalizedPostId = postId.replace(/^fb:/, "");

    if (postType === "reels") {
        const reelId = normalizedPostId.includes("_")
            ? normalizedPostId.split("_").pop()
            : normalizedPostId;
        return reelId ? `https://www.facebook.com/reel/${reelId}/` : "";
    }

    if (normalizedPostId.includes("_")) {
        const parts = normalizedPostId.split("_").filter(Boolean);
        const objectId = parts[parts.length - 1];
        const ownerId = pageId || parts[0];
        if (ownerId && objectId) {
            return `https://www.facebook.com/${ownerId}/posts/${objectId}`;
        }
    }

    if (pageId) {
        return `https://www.facebook.com/${pageId}/posts/${normalizedPostId}`;
    }

    return `https://www.facebook.com/${normalizedPostId}`;
}

function renderPublishedOverview(logs) {
    const summaryEl = document.getElementById("publishedSummaryBar");
    if (!summaryEl) return;

    const todayKey = getPublishedDateKey(new Date());
    const now = Date.now();
    const sevenDaysAgo = now - (7 * 24 * 60 * 60 * 1000);
    const reelsCount = logs.filter((log) => getPublishedPostTypeKey(log) === "reels").length;
    const textCount = logs.filter((log) => getPublishedPostTypeKey(log) === "text").length;
    const todayCount = logs.filter((log) => getPublishedDateKey(log.published_at || log.created_at) === todayKey).length;
    const last7DaysCount = logs.filter((log) => {
        const date = parsePublishedDate(log.published_at || log.created_at);
        return date && date.getTime() >= sevenDaysAgo;
    }).length;
    const imageCount = logs.filter((log) => getPublishedPostTypeKey(log) === "image").length;
    const lastCardLabel = "Image / Reels";
    const lastCardValue = `${imageCount} / ${reelsCount}`;

    summaryEl.innerHTML = `
        <div class="pending-stat">
            <span class="pending-stat-label">ทั้งหมด</span>
            <span class="pending-stat-value">${logs.length}</span>
        </div>
        <div class="pending-stat">
            <span class="pending-stat-label">วันนี้</span>
            <span class="pending-stat-value">${todayCount}</span>
        </div>
        <div class="pending-stat">
            <span class="pending-stat-label">7 วันล่าสุด</span>
            <span class="pending-stat-value">${last7DaysCount}</span>
        </div>
        <div class="pending-stat">
            <span class="pending-stat-label">Text / Link</span>
            <span class="pending-stat-value">${textCount} / ${Math.max(logs.length - textCount - imageCount - reelsCount, 0)}</span>
        </div>
        <div class="pending-stat">
            <span class="pending-stat-label">${lastCardLabel}</span>
            <span class="pending-stat-value">${lastCardValue}</span>
        </div>
    `;
}

function getPublishedFilterResult(logs) {
    const query = publishedFilters.query.trim().toLowerCase();
    const today = new Date();
    const todayKey = getPublishedDateKey(today);
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayKey = getPublishedDateKey(yesterday);
    const last7Limit = new Date(today);
    last7Limit.setDate(last7Limit.getDate() - 6);
    last7Limit.setHours(0, 0, 0, 0);
    const last30Limit = new Date(today);
    last30Limit.setDate(last30Limit.getDate() - 29);
    last30Limit.setHours(0, 0, 0, 0);

    const filtered = logs.filter((log) => {
        const typeKey = getPublishedPostTypeKey(log);
        const message = String(log.message_text || "").trim();
        const haystack = [
            message,
            log.facebook_post_id || "",
            log.facebook_url || "",
            log.page_id || "",
        ].join(" ").toLowerCase();

        if (query && !haystack.includes(query)) {
            return false;
        }

        if (publishedFilters.type !== "all" && typeKey !== publishedFilters.type) {
            return false;
        }

        const date = parsePublishedDate(log.published_at || log.created_at);
        const dateKey = getPublishedDateKey(date);
        if (publishedFilters.customDate) {
            return dateKey === publishedFilters.customDate;
        }

        switch (publishedFilters.day) {
            case "today":
                return dateKey === todayKey;
            case "yesterday":
                return dateKey === yesterdayKey;
            case "last7":
                return date && date >= last7Limit;
            case "last30":
                return date && date >= last30Limit;
            default:
                return true;
        }
    });

    return { filtered, total: logs.length };
}

function updatePublishedFilterMeta(filteredCount, totalCount) {
    const metaEl = document.getElementById("publishedFilterMeta");
    if (!metaEl) return;

    if (!totalCount) {
        metaEl.textContent = getPublishedEmptyCopy();
        return;
    }

    if (publishedFilters.customDate) {
        metaEl.textContent = filteredCount === totalCount
            ? `วันที่ ${publishedFilters.customDate} มี ${filteredCount} รายการ`
            : `วันที่ ${publishedFilters.customDate} แสดง ${filteredCount} / ${totalCount} รายการ`;
        return;
    }

    if (filteredCount === totalCount) {
        metaEl.textContent = `แสดง ${totalCount} รายการ`;
        return;
    }

    metaEl.textContent = `แสดง ${filteredCount} / ${totalCount} รายการ`;
}

function syncPublishedDayFiltersUi() {
    const chips = document.querySelectorAll("#publishedDayFilters .pending-filter-chip");
    chips.forEach((chip) => {
        chip.classList.toggle("is-active", chip.dataset.filter === publishedFilters.day && !publishedFilters.customDate);
    });
}

function buildPublishedTable(logs) {
    const table = document.createElement("table");
    table.className = "pending-table";

    const thead = document.createElement("thead");
    const headerRow = document.createElement("tr");
    ["Type", "Message", "Published", "Link"].forEach((text) => {
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

        const typeTd = document.createElement("td");
        const typeSpan = document.createElement("span");
        const pType = getPublishedPostTypeKey(log);
        typeSpan.className = `post-type-badge post-type-${pType}`;
        const typeIcons = {
            link: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>',
            image: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>',
            reels: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><rect x="2" y="2" width="20" height="20" rx="4"/><path d="M7 2l3 6"/><path d="M14 2l3 6"/><path d="M2 8h20"/><path d="M10 11.5l5 3.5-5 3.5z"/></svg>',
            text: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><path d="M4 7V4h16v3"/><path d="M9 20h6"/><path d="M12 4v16"/></svg>',
        };
        typeSpan.innerHTML = typeIcons[pType] || typeIcons.text;
        typeSpan.title = pType;
        typeTd.appendChild(typeSpan);
        tr.appendChild(typeTd);

        const msgTd = document.createElement("td");
        const msgWrap = document.createElement("div");
        msgWrap.className = "published-message-cell";
        const msgDiv = document.createElement("div");
        msgDiv.className = "pending-table-title";
        const message = String(log.message_text || "(No message)");
        msgDiv.textContent = message.length > 80 ? `${message.slice(0, 80)}...` : message;
        msgDiv.title = message;
        msgWrap.appendChild(msgDiv);
        if (log.is_hidden === true) {
            const hiddenBadge = document.createElement("div");
            hiddenBadge.className = "published-message-warning";
            hiddenBadge.style.color = "#2563eb";
            hiddenBadge.textContent = "ซ่อนจากหน้าเพจแล้ว (ยังเช็กจากลิงก์โพสต์ได้)";
            msgWrap.appendChild(hiddenBadge);
        }
        if (log.warning_message) {
            const warningDiv = document.createElement("div");
            warningDiv.className = "published-message-warning";
            warningDiv.textContent = log.warning_message;
            warningDiv.title = log.warning_message;
            msgWrap.appendChild(warningDiv);
        }
        msgTd.appendChild(msgWrap);
        tr.appendChild(msgTd);

        const timeTd = document.createElement("td");
        const timeSpan = document.createElement("span");
        timeSpan.className = "pending-table-time";
        const publishedDate = parsePublishedDate(log.published_at || log.created_at);
        timeSpan.textContent = publishedDate
            ? publishedDate.toLocaleString("th-TH", {
                year: "numeric",
                month: "2-digit",
                day: "2-digit",
                hour: "2-digit",
                minute: "2-digit",
            })
            : "-";
        timeTd.appendChild(timeSpan);
        tr.appendChild(timeTd);

        const linkTd = document.createElement("td");
        const facebookUrl = buildPublishedFacebookUrl(log);
        if (facebookUrl) {
            const link = document.createElement("a");
            link.href = facebookUrl;
            link.target = "_blank";
            link.rel = "noopener noreferrer";
            link.className = "pending-table-link";
            link.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>';
            link.title = "เปิดโพสต์บน Facebook";
            linkTd.appendChild(link);
        } else {
            linkTd.textContent = "-";
            linkTd.style.color = "#94a3b8";
        }
        tr.appendChild(linkTd);

        tbody.appendChild(tr);
    });

    table.appendChild(tbody);
    return table;
}

function renderPublishedPostsWithFilters() {
    const { filtered, total } = getPublishedFilterResult(currentPublishedPosts);
    updatePublishedFilterMeta(filtered.length, total);

    if (!filtered.length) {
        publishedTableContainer.innerHTML = currentPublishedPosts.length
            ? `<div class="pending-empty">${getPublishedNoResultsCopy()}</div>`
            : `<div class="pending-empty">${getPublishedEmptyCopy()}</div>`;
        return;
    }

    const table = buildPublishedTable(filtered);
    publishedTableContainer.innerHTML = "";
    publishedTableContainer.appendChild(table);
}

function syncPublishedFilterInputs() {
    const searchInput = document.getElementById("publishedSearchInput");
    const typeFilter = document.getElementById("publishedTypeFilter");
    const dateInput = document.getElementById("publishedDateInput");

    if (searchInput) searchInput.value = publishedFilters.query;
    if (typeFilter) typeFilter.value = publishedFilters.type;
    if (dateInput) dateInput.value = publishedFilters.customDate;
    syncPublishedDayFiltersUi();
}

async function loadPublishedPosts(options = {}) {
    const opts = {
        silent: false,
        force: false,
        ...(options || {}),
    };
    const pageId = getCurrentPageId();
    const summaryEl = document.getElementById("publishedSummaryBar");
    const adsToken =
        fbToken ||
        localStorage.getItem("fewfeed_accessToken") ||
        localStorage.getItem("fewfeed_token") ||
        "";
    const pageToken =
        (typeof getPageToken === "function" ? getPageToken() : "") ||
        document.getElementById("pageTokenInputPanel")?.value?.trim() ||
        "";
    const cookie = fbCookie || localStorage.getItem("fewfeed_cookie") || "";

    if (!pageId) {
        currentPublishedPosts = [];
        currentPublishedPageId = "";
        publishedLoadState.activePageId = "";
        publishedLoadState.loading = false;
        if (summaryEl) summaryEl.innerHTML = "";
        publishedTableContainer.innerHTML = '<div class="pending-empty">Please select a Page first</div>';
        return;
    }

    const now = Date.now();
    const samePageRequest = publishedLoadState.activePageId === pageId;
    const requestedTooSoon = samePageRequest && now - publishedLoadState.lastLoadedAt < 700;
    if (!opts.force) {
        if (publishedLoadState.loading && samePageRequest) {
            return;
        }
        if (requestedTooSoon) {
            return;
        }
    }

    const isPageChanged = currentPublishedPageId !== pageId;
    if (isPageChanged) {
        currentPublishedPosts = [];
    }

    publishedLoadState.loading = true;
    publishedLoadState.activePageId = pageId;

    if (!opts.silent && (isPageChanged || currentPublishedPosts.length === 0)) {
        publishedTableContainer.innerHTML = `
        <div class="pending-skeleton">
          <div class="pending-skeleton-row"><div class="sk-img"></div><div class="sk-text"></div><div class="sk-date"></div><div class="sk-badge"></div></div>
          <div class="pending-skeleton-row"><div class="sk-img"></div><div class="sk-text"></div><div class="sk-date"></div><div class="sk-badge"></div></div>
          <div class="pending-skeleton-row"><div class="sk-img"></div><div class="sk-text"></div><div class="sk-date"></div><div class="sk-badge"></div></div>
        </div>
    `;
    }

    try {
        const response = await fetch("/api/published-posts", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                pageId,
                limit: 200,
                source: "merged",
                accessToken: adsToken,
                pageToken,
                cookieData: cookie,
            }),
        });
        const data = await response.json();

        if (!data.success) {
            publishedTableContainer.innerHTML = `<div class="pending-empty">Error: ${data.error}</div>`;
            return;
        }

        currentPublishedPosts = Array.isArray(data.logs) ? data.logs : [];
        currentPublishedPageId = pageId;
        publishedLoadState.lastLoadedAt = Date.now();
        renderPublishedOverview(currentPublishedPosts);
        syncPublishedFilterInputs();
        renderPublishedPostsWithFilters();
    } catch (err) {
        publishedTableContainer.innerHTML = `<div class="pending-empty">Error: ${err.message}</div>`;
    } finally {
        publishedLoadState.loading = false;
    }
}

const publishedRefreshBtn = document.getElementById("publishedRefreshBtn");
const publishedSearchInput = document.getElementById("publishedSearchInput");
const publishedTypeFilter = document.getElementById("publishedTypeFilter");
const publishedDayFilters = document.getElementById("publishedDayFilters");
const publishedDateInput = document.getElementById("publishedDateInput");

if (publishedRefreshBtn && !publishedRefreshBtn.dataset.bound) {
    publishedRefreshBtn.dataset.bound = "true";
    publishedRefreshBtn.addEventListener("click", () => loadPublishedPosts({ force: true }));
}

if (publishedSearchInput && !publishedSearchInput.dataset.bound) {
    publishedSearchInput.dataset.bound = "true";
    publishedSearchInput.addEventListener("input", (event) => {
        publishedFilters.query = event.target.value || "";
        renderPublishedPostsWithFilters();
    });
}

if (publishedTypeFilter && !publishedTypeFilter.dataset.bound) {
    publishedTypeFilter.dataset.bound = "true";
    publishedTypeFilter.addEventListener("change", (event) => {
        publishedFilters.type = event.target.value || "all";
        renderPublishedPostsWithFilters();
    });
}

if (publishedDayFilters && !publishedDayFilters.dataset.bound) {
    publishedDayFilters.dataset.bound = "true";
    publishedDayFilters.addEventListener("click", (event) => {
        const target = event.target.closest("[data-filter]");
        if (!target) return;
        publishedFilters.day = target.dataset.filter || "all";
        publishedFilters.customDate = "";
        if (publishedDateInput) publishedDateInput.value = "";
        syncPublishedDayFiltersUi();
        renderPublishedPostsWithFilters();
    });
}

if (publishedDateInput && !publishedDateInput.dataset.bound) {
    publishedDateInput.dataset.bound = "true";
    publishedDateInput.addEventListener("change", (event) => {
        publishedFilters.customDate = event.target.value || "";
        syncPublishedDayFiltersUi();
        renderPublishedPostsWithFilters();
    });
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
    if (hidePostsPanel) hidePostsPanel.style.display = "none";
    if (deletePostsPanel) deletePostsPanel.style.display = "none";
    quotesPanel.style.display = "none";
    earningsPanel.style.display = "none";
    textPanel.style.display = "none";
    const bp = document.getElementById("billingPanel");
    if (bp) bp.style.display = "none";
    const textModePanel = document.getElementById("textModePanel");
    if (textModePanel) textModePanel.style.display = "none";
    settingsPanel.style.display = "flex";
    appLayout.classList.add("pending-mode");
    document.body.style.overflow = "";
    loadSettingsPanel();
}

// Show text panel (for adding quotes)
const textPanel = document.getElementById("textPanel");

function showTextPanel() {
    setPostMode("text");
    showDashboard();
    setTimeout(() => {
        document.getElementById("textPrimaryText")?.focus();
        if (typeof renderTextComposerUi === "function") {
            renderTextComposerUi();
        }
    }, 50);
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
                textQuoteStatus.textContent = "✓ บันทึกสำเร็จ กำลังไปหน้า Pending > Quotes...";
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
