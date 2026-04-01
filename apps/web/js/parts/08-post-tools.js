const postToolConfigs = {
    delete: {
        key: "delete",
        action: "delete",
        navId: "deletePostsNavItem",
        panelId: "deletePostsPanel",
        prefix: "deletePosts",
        empty: "ยังไม่ได้โหลดโพสต์จากเพจ",
        confirm: (count) => prompt(`กำลังจะลบ ${count} โพสต์\nพิมพ์ DELETE เพื่อยืนยัน`) === "DELETE",
    },
};

const postToolStates = {
    delete: createPostToolState(),
};

function createPostToolState() {
    return {
        pageId: "",
        posts: [],
        jobs: [],
        jobDetails: {},
        expandedJobIds: new Set(),
        failedSelections: {},
        selectedIds: new Set(),
        filters: {
            query: "",
            type: "all",
            day: "all",
            customDate: "",
            clearBefore: "",
            batchSize: 20,
        },
        pagination: {
            nextCursor: "",
            hasMore: false,
            loadingMore: false,
            lastBatchCount: 0,
        },
        safeguards: {
            keepLatestEnabled: false,
            keepLatestCount: 10,
            minAgeEnabled: false,
            minAgeDays: 7,
        },
        loaded: false,
        loading: false,
        jobsLoading: false,
        pollHandle: null,
    };
}

function resetPostToolStateDefaults(toolKey) {
    const state = postToolStates[toolKey];
    if (!state) return;

    state.filters.query = "";
    state.filters.type = "all";
    state.filters.day = "all";
    state.filters.customDate = "";
    state.filters.clearBefore = "";
    state.filters.batchSize = 20;
    state.pagination.nextCursor = "";
    state.pagination.hasMore = false;
    state.pagination.loadingMore = false;
    state.pagination.lastBatchCount = 0;
    state.jobDetails = {};
    state.expandedJobIds = new Set();
    state.failedSelections = {};
    state.safeguards.keepLatestEnabled = toolKey === "hide";
    state.safeguards.keepLatestCount = 10;
    state.safeguards.minAgeEnabled = toolKey === "hide";
    state.safeguards.minAgeDays = 7;
}

Object.keys(postToolStates).forEach((toolKey) => resetPostToolStateDefaults(toolKey));

function getPostToolDom(toolKey) {
    const config = postToolConfigs[toolKey];
    const prefix = config.prefix;
    return {
        panel: document.getElementById(config.panelId),
        tableContainer: document.getElementById(`${prefix}TableContainer`),
        jobsContainer: document.getElementById(`${prefix}Jobs`),
        summaryBar: document.getElementById(`${prefix}SummaryBar`),
        refreshBtn: document.getElementById(`${prefix}RefreshBtn`),
        runBtn: document.getElementById(`${prefix}RunBtn`),
        searchInput: document.getElementById(`${prefix}SearchInput`),
        typeFilter: document.getElementById(`${prefix}TypeFilter`),
        dayFilters: document.getElementById(`${prefix}DayFilters`),
        dateInput: document.getElementById(`${prefix}DateInput`),
        pageSelect: document.getElementById(`${prefix}PageSelect`),
        clearBeforeInput: document.getElementById(`${prefix}ClearBeforeInput`),
        batchSizeInput: document.getElementById(`${prefix}BatchSizeInput`),
        autoSelectBtn: document.getElementById(`${prefix}AutoSelectBtn`),
        filterMeta: document.getElementById(`${prefix}FilterMeta`),
        selectionMeta: document.getElementById(`${prefix}SelectionMeta`),
        selectVisibleBtn: document.getElementById(`${prefix}SelectVisibleBtn`),
        clearSelectionBtn: document.getElementById(`${prefix}ClearSelectionBtn`),
        loadMoreBtn: document.getElementById(`${prefix}LoadMoreBtn`),
        loadMoreMeta: document.getElementById(`${prefix}LoadMoreMeta`),
        keepLatestToggle: document.getElementById(`${prefix}KeepLatestToggle`),
        keepLatestInput: document.getElementById(`${prefix}KeepLatestInput`),
        minAgeToggle: document.getElementById(`${prefix}MinAgeToggle`),
        minAgeInput: document.getElementById(`${prefix}MinAgeInput`),
        safeguardMeta: document.getElementById(`${prefix}SafeguardMeta`),
    };
}

function getPostToolPageName() {
    return document.querySelector(".page-selector-name")?.textContent?.trim() || "";
}

function getHidePageToken() {
    return document.getElementById("hideTokenInputPanel")?.value?.trim() || getPageToken() || "";
}

function getPostToolAuth() {
    const currentPageId = getCurrentPageId();
    return {
        postToken: getLoadedPageToken(currentPageId) || getPageToken() || "",
        hideToken: getHidePageToken(),
        accessToken: typeof getInjectedAccessToken === "function" ? getInjectedAccessToken() : "",
        cookieData:
            (typeof fbCookie !== "undefined" && fbCookie) ||
            localStorage.getItem("fewfeed_cookie") ||
            "",
    };
}

function parsePostToolDate(value) {
    if (!value) return null;
    const raw = String(value).trim();
    if (!raw) return null;
    const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(raw)
        ? raw.replace(" ", "T")
        : raw;
    const date = new Date(normalized);
    return Number.isNaN(date.getTime()) ? null : date;
}

function getPostToolDateKey(value) {
    const date = value instanceof Date ? value : parsePostToolDate(value);
    if (!date) return "";
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
}

function getPostToolType(post) {
    const raw = String(post.post_type || post.media_kind || "").toLowerCase();
    if (raw.includes("reel") || raw.includes("video")) return "reels";
    if (raw.includes("image") || raw.includes("photo")) return "image";
    if (raw.includes("text")) return "text";
    return "link";
}

function getPostToolItemId(post) {
    return String(post.facebook_post_id || post.source_ref || post.id || "").trim();
}

function getPostToolPositiveInt(value, fallback) {
    const parsed = parseInt(String(value || ""), 10);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function syncDeletePostToolPageSelect() {
    const dom = getPostToolDom("delete");
    const globalPageSelect = document.getElementById("pageSelect");
    if (!dom.pageSelect || !globalPageSelect) return;

    const globalOptionsHtml = globalPageSelect.innerHTML;
    if (dom.pageSelect.innerHTML !== globalOptionsHtml) {
        dom.pageSelect.innerHTML = globalOptionsHtml;
    }

    const globalValue = String(globalPageSelect.value || "");
    if (globalValue && dom.pageSelect.value !== globalValue) {
        dom.pageSelect.value = globalValue;
    }
}

function escapePostToolHtml(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function getPostToolFailedSelection(toolKey, jobId) {
    const state = postToolStates[toolKey];
    if (!state.failedSelections[jobId]) {
        state.failedSelections[jobId] = new Set();
    }
    return state.failedSelections[jobId];
}

function prunePostToolFailedSelection(toolKey, jobId, items = []) {
    const selection = getPostToolFailedSelection(toolKey, jobId);
    const validIds = new Set(
        items
            .filter((item) => String(item.status || "") === "failed")
            .map((item) => Number(item.id))
            .filter((id) => Number.isFinite(id) && id > 0),
    );

    Array.from(selection).forEach((id) => {
        if (!validIds.has(id)) {
            selection.delete(id);
        }
    });
}

function getPostToolProtectionReason(toolKey, post) {
    if (toolKey !== "hide") return "";

    const state = postToolStates[toolKey];
    const itemId = getPostToolItemId(post);
    if (!itemId) return "ไม่มี post id";

    if (post.is_pinned === true) {
        return "Pinned post";
    }

    if (post.is_hidden === true) {
        return "ซ่อนไว้อยู่แล้ว";
    }

    if (state.safeguards.keepLatestEnabled) {
        const keepLatestCount = getPostToolPositiveInt(state.safeguards.keepLatestCount, 10);
        const overallIndex = state.posts.findIndex((item) => getPostToolItemId(item) === itemId);
        if (keepLatestCount > 0 && overallIndex > -1 && overallIndex < keepLatestCount) {
            return `กันโพสต์ล่าสุด ${keepLatestCount} รายการ`;
        }
    }

    if (state.safeguards.minAgeEnabled) {
        const minAgeDays = getPostToolPositiveInt(state.safeguards.minAgeDays, 7);
        if (minAgeDays > 0) {
            const publishedDate = parsePostToolDate(post.published_at || post.created_at);
            if (publishedDate) {
                const ageMs = Date.now() - publishedDate.getTime();
                if (ageMs < minAgeDays * 24 * 60 * 60 * 1000) {
                    return `อายุน้อยกว่า ${minAgeDays} วัน`;
                }
            }
        }
    }

    return "";
}

function isPostToolSelectable(toolKey, post) {
    return !getPostToolProtectionReason(toolKey, post);
}

function getPostToolFilteredPosts(toolKey) {
    const state = postToolStates[toolKey];
    const query = state.filters.query.trim().toLowerCase();
    const today = new Date();
    const todayKey = getPostToolDateKey(today);
    const last7Limit = new Date(today);
    last7Limit.setDate(last7Limit.getDate() - 6);
    last7Limit.setHours(0, 0, 0, 0);
    const last30Limit = new Date(today);
    last30Limit.setDate(last30Limit.getDate() - 29);
    last30Limit.setHours(0, 0, 0, 0);

    return state.posts.filter((post) => {
        const typeKey = getPostToolType(post);
        const message = String(post.message_text || "").trim();
        const haystack = [
            message,
            post.facebook_post_id || "",
            post.facebook_url || "",
        ].join(" ").toLowerCase();

        if (query && !haystack.includes(query)) return false;
        if (state.filters.type !== "all" && typeKey !== state.filters.type) return false;

        const date = parsePostToolDate(post.published_at || post.created_at);
        const dateKey = getPostToolDateKey(date);
        if (state.filters.customDate) {
            return dateKey === state.filters.customDate;
        }

        switch (state.filters.day) {
            case "today":
                return dateKey === todayKey;
            case "last7":
                return date && date >= last7Limit;
            case "last30":
                return date && date >= last30Limit;
            default:
                break;
        }

        if (toolKey === "delete" && state.filters.clearBefore) {
            const clearBeforeDate = parsePostToolDate(state.filters.clearBefore);
            if (!clearBeforeDate) return false;
            return !!date && date <= clearBeforeDate;
        }

        return true;
    });
}

function getPostToolEligibleFilteredPosts(toolKey) {
    return getPostToolFilteredPosts(toolKey).filter((post) => isPostToolSelectable(toolKey, post));
}

function prunePostToolSelection(toolKey) {
    const state = postToolStates[toolKey];
    const validIds = new Set(
        state.posts
            .filter((post) => isPostToolSelectable(toolKey, post))
            .map((post) => getPostToolItemId(post))
            .filter(Boolean),
    );

    state.selectedIds.forEach((id) => {
        if (!validIds.has(id)) {
            state.selectedIds.delete(id);
        }
    });
}

function renderPostToolSummary(toolKey, filtered = getPostToolFilteredPosts(toolKey), eligible = getPostToolEligibleFilteredPosts(toolKey)) {
    const state = postToolStates[toolKey];
    const dom = getPostToolDom(toolKey);
    if (!dom.summaryBar) return;

    const selectedCount = eligible.filter((post) => state.selectedIds.has(getPostToolItemId(post))).length;
    const todayKey = getPostToolDateKey(new Date());
    const todayCount = state.posts.filter((post) => getPostToolDateKey(post.published_at || post.created_at) === todayKey).length;
    const reelsCount = state.posts.filter((post) => getPostToolType(post) === "reels").length;
    const protectedCount = state.posts.filter((post) => !isPostToolSelectable(toolKey, post)).length;

    if (toolKey === "hide") {
        dom.summaryBar.innerHTML = `
            <div class="pending-stat">
                <span class="pending-stat-label">โหลดแล้ว</span>
                <span class="pending-stat-value">${state.posts.length}</span>
            </div>
            <div class="pending-stat">
                <span class="pending-stat-label">พร้อมซ่อน</span>
                <span class="pending-stat-value">${eligible.length}</span>
            </div>
            <div class="pending-stat">
                <span class="pending-stat-label">กันไว้</span>
                <span class="pending-stat-value">${protectedCount}</span>
            </div>
            <div class="pending-stat">
                <span class="pending-stat-label">เลือกไว้</span>
                <span class="pending-stat-value">${selectedCount}</span>
            </div>
        `;
        return;
    }

    dom.summaryBar.innerHTML = `
        <div class="pending-stat">
            <span class="pending-stat-label">โหลดแล้ว</span>
            <span class="pending-stat-value">${state.posts.length}</span>
        </div>
        <div class="pending-stat">
            <span class="pending-stat-label">ตรง filter</span>
            <span class="pending-stat-value">${filtered.length}</span>
        </div>
        <div class="pending-stat">
            <span class="pending-stat-label">เลือกไว้</span>
            <span class="pending-stat-value">${selectedCount}</span>
        </div>
        <div class="pending-stat">
            <span class="pending-stat-label">วันนี้ / Reels</span>
            <span class="pending-stat-value">${todayCount} / ${reelsCount}</span>
        </div>
    `;
}

function renderPostToolFilterMeta(toolKey, filteredCount, totalCount, eligibleCount = filteredCount) {
    const dom = getPostToolDom(toolKey);
    if (!dom.filterMeta) return;

    if (!totalCount) {
        dom.filterMeta.textContent = "ยังไม่มีโพสต์จากเพจนี้";
        return;
    }

    if (postToolStates[toolKey].filters.customDate) {
        dom.filterMeta.textContent = toolKey === "hide" && filteredCount !== eligibleCount
            ? `วันที่ ${postToolStates[toolKey].filters.customDate} พบ ${eligibleCount} รายการ (กันไว้ ${filteredCount - eligibleCount})`
            : `วันที่ ${postToolStates[toolKey].filters.customDate} พบ ${filteredCount} รายการ`;
        return;
    }

    if (toolKey === "hide" && filteredCount !== eligibleCount) {
        dom.filterMeta.textContent = `แสดง ${eligibleCount} / ${totalCount} รายการ (กันไว้ ${filteredCount - eligibleCount})`;
        return;
    }

    dom.filterMeta.textContent = filteredCount === totalCount
        ? `แสดง ${totalCount} รายการ`
        : `แสดง ${filteredCount} / ${totalCount} รายการ`;
}

function renderPostToolSelectionMeta(toolKey, filtered, eligible = filtered.filter((post) => isPostToolSelectable(toolKey, post))) {
    const state = postToolStates[toolKey];
    const dom = getPostToolDom(toolKey);
    if (!dom.selectionMeta) return;

    const selectedTotal = state.selectedIds.size;
    const visibleSelected = eligible.filter((post) => state.selectedIds.has(getPostToolItemId(post))).length;
    const protectedVisible = Math.max(0, filtered.length - eligible.length);
    dom.selectionMeta.textContent = selectedTotal
        ? `เลือกไว้ ${selectedTotal} รายการ (${visibleSelected} จากที่ทำงานได้)`
        : protectedVisible > 0
            ? `พร้อมทำงาน ${eligible.length} รายการ และกันไว้ ${protectedVisible} รายการ`
            : "ยังไม่ได้เลือกโพสต์";
}

function updatePostToolActionButton(toolKey, eligible = getPostToolEligibleFilteredPosts(toolKey)) {
    const state = postToolStates[toolKey];
    const dom = getPostToolDom(toolKey);
    if (!dom.runBtn) return;

    const selectedCount = eligible.filter((post) => state.selectedIds.has(getPostToolItemId(post))).length;
    dom.runBtn.disabled = selectedCount === 0 || state.loading;
    dom.runBtn.textContent = toolKey === "hide"
        ? `ซ่อนที่เลือก${selectedCount ? ` (${selectedCount})` : ""}`
        : `ลบที่เลือก${selectedCount ? ` (${selectedCount})` : ""}`;
}

function renderPostToolDayFilters(toolKey) {
    const state = postToolStates[toolKey];
    const dom = getPostToolDom(toolKey);
    if (!dom.dayFilters) return;

    dom.dayFilters.querySelectorAll(".pending-filter-chip").forEach((chip) => {
        chip.classList.toggle("is-active", chip.dataset.filter === state.filters.day && !state.filters.customDate);
    });
}

function renderPostToolSafeguardMeta(toolKey, filtered = getPostToolFilteredPosts(toolKey), eligible = filtered.filter((post) => isPostToolSelectable(toolKey, post))) {
    const state = postToolStates[toolKey];
    const dom = getPostToolDom(toolKey);
    if (!dom.safeguardMeta) return;

    if (toolKey !== "hide") {
        dom.safeguardMeta.textContent = "";
        return;
    }

    const protectedVisible = Math.max(0, filtered.length - eligible.length);
    const protectedTotal = state.posts.filter((post) => !isPostToolSelectable(toolKey, post)).length;
    const parts = [];

    if (state.safeguards.keepLatestEnabled) {
        parts.push(`กันโพสต์ล่าสุด ${getPostToolPositiveInt(state.safeguards.keepLatestCount, 10)} รายการ`);
    }
    if (state.safeguards.minAgeEnabled) {
        parts.push(`ซ่อนเฉพาะโพสต์ที่เก่ากว่า ${getPostToolPositiveInt(state.safeguards.minAgeDays, 7)} วัน`);
    }

    if (!parts.length) {
        dom.safeguardMeta.textContent = "ยังไม่ได้เปิด safety rule ตอนนี้เลือกได้ตาม filter ตรง ๆ";
        return;
    }

    dom.safeguardMeta.textContent = `${parts.join(" • ")} ตอนนี้กันไว้ ${protectedVisible} จาก ${filtered.length} รายการที่ตรง filter (${protectedTotal} จากทั้งหมดที่โหลด)`;
}

function renderPostToolPagination(toolKey) {
    const state = postToolStates[toolKey];
    const dom = getPostToolDom(toolKey);
    if (!dom.loadMoreBtn || !dom.loadMoreMeta) return;

    const shouldShow = state.loaded || state.loading || state.pagination.loadingMore || state.posts.length > 0;
    dom.loadMoreBtn.style.display = shouldShow ? "inline-flex" : "none";
    dom.loadMoreBtn.disabled = state.loading || state.pagination.loadingMore || !state.pagination.hasMore;
    dom.loadMoreBtn.textContent = state.pagination.loadingMore ? "กำลังโหลด..." : "โหลดเพิ่ม";

    if (!shouldShow) {
        dom.loadMoreMeta.textContent = "";
        return;
    }

    if (state.pagination.loadingMore) {
        dom.loadMoreMeta.textContent = `กำลังโหลดโพสต์เพิ่ม ต่อจาก ${state.posts.length} รายการที่มีอยู่`;
        return;
    }

    if (state.pagination.hasMore) {
        dom.loadMoreMeta.textContent = `โหลดแล้ว ${state.posts.length} รายการ ยังมีโพสต์เก่ากว่านี้ให้โหลดต่อ`;
        return;
    }

    if (state.loaded && state.posts.length > 0) {
        dom.loadMoreMeta.textContent = `โหลดครบ ${state.posts.length} รายการในรอบนี้แล้ว`;
        return;
    }

    dom.loadMoreMeta.textContent = state.loaded ? "ยังไม่มีโพสต์จากเพจนี้" : "";
}

async function loadPostToolJobDetail(toolKey, jobId, { force = false } = {}) {
    const state = postToolStates[toolKey];
    const detailState = state.jobDetails[jobId] || {
        loading: false,
        loaded: false,
        error: "",
        job: null,
        items: [],
    };

    if (detailState.loading) return;
    if (detailState.loaded && !force) return;

    detailState.loading = true;
    detailState.error = "";
    state.jobDetails[jobId] = detailState;
    renderPostToolJobs(toolKey);

    try {
        const response = await fetch(`/api/post-action-jobs/${jobId}`);
        const data = await response.json();

        if (!data.success) {
            throw new Error(data.error || "Failed to load job detail");
        }

        state.jobDetails[jobId] = {
            loading: false,
            loaded: true,
            error: "",
            job: data.job || null,
            items: Array.isArray(data.items) ? data.items : [],
        };
        prunePostToolFailedSelection(toolKey, jobId, state.jobDetails[jobId].items);
    } catch (error) {
        state.jobDetails[jobId] = {
            loading: false,
            loaded: false,
            error: error.message || String(error),
            job: null,
            items: [],
        };
    }

    renderPostToolJobs(toolKey);
}

async function refreshExpandedPostToolJobDetails(toolKey) {
    const state = postToolStates[toolKey];
    const expandedIds = Array.from(state.expandedJobIds || []);
    if (!expandedIds.length) return;

    await Promise.all(expandedIds.map((jobId) => loadPostToolJobDetail(toolKey, jobId, { force: true })));
}

function renderPostToolJobItems(toolKey, jobId, detailState) {
    if (!detailState) {
        return '<div class="post-tool-job-detail-empty">ยังไม่ได้โหลดรายละเอียด</div>';
    }

    if (detailState.loading) {
        return '<div class="post-tool-job-detail-empty">กำลังโหลดรายละเอียด...</div>';
    }

    if (detailState.error) {
        return `<div class="post-tool-job-detail-empty is-error">${escapePostToolHtml(detailState.error)}</div>`;
    }

    const items = Array.isArray(detailState.items) ? detailState.items : [];
    if (!items.length) {
        return '<div class="post-tool-job-detail-empty">ไม่มีรายการใน job นี้</div>';
    }

    const failedItems = items.filter((item) => String(item.status || "") === "failed");
    const failedSelection = getPostToolFailedSelection(toolKey, jobId);
    const selectedFailedCount = Array.from(failedSelection).filter((id) => failedItems.some((item) => Number(item.id) === id)).length;

    return `
        <div class="post-tool-job-detail-toolbar">
            <span class="post-tool-job-detail-summary">fail ${failedItems.length} รายการ${selectedFailedCount ? ` • เลือกไว้ ${selectedFailedCount}` : ""}</span>
            <div class="post-tool-job-detail-actions">
                ${failedItems.length ? `<button type="button" class="post-tool-link-btn" data-job-select-failed="${jobId}" data-tool="${toolKey}">เลือก fail ทั้งหมด</button>` : ""}
                ${selectedFailedCount ? `<button type="button" class="post-tool-link-btn" data-job-clear-failed="${jobId}" data-tool="${toolKey}">ล้างที่เลือก</button>` : ""}
                ${selectedFailedCount ? `<button type="button" class="post-tool-link-btn is-retry" data-job-retry-selected="${jobId}" data-tool="${toolKey}">retry selected</button>` : ""}
            </div>
        </div>
        <div class="post-tool-job-detail-list">
            ${items.map((item) => {
                const message = String(item.post_message || item.post_id || "").trim();
                const title = message.length > 80 ? `${message.slice(0, 80)}...` : message;
                const errorText = String(item.error_message || "").trim();
                const itemId = Number(item.id || 0);
                const isFailed = String(item.status || "") === "failed";
                const isChecked = isFailed && failedSelection.has(itemId);
                return `
                    <div class="post-tool-job-detail-item is-${escapePostToolHtml(item.status || "unknown")}">
                        <div class="post-tool-job-detail-head">
                            <div class="post-tool-job-detail-status-wrap">
                                ${isFailed ? `<input type="checkbox" class="post-tool-job-item-checkbox" data-job-item-toggle="${jobId}:${itemId}" data-tool="${toolKey}" ${isChecked ? "checked" : ""} />` : `<span class="post-tool-job-item-checkbox-spacer"></span>`}
                                <span class="post-tool-job-item-status is-${escapePostToolHtml(item.status || "unknown")}">${escapePostToolHtml(item.status || "unknown")}</span>
                            </div>
                            <span class="post-tool-job-item-time">${escapePostToolHtml(String(item.processed_at || item.created_at || "-"))}</span>
                        </div>
                        <div class="post-tool-job-item-title">${escapePostToolHtml(title || item.post_id || "-")}</div>
                        <div class="post-tool-job-item-sub">${escapePostToolHtml(String(item.post_type || "link"))} • ${escapePostToolHtml(String(item.post_id || "-"))}</div>
                        ${errorText ? `<div class="post-tool-job-item-error">${escapePostToolHtml(errorText)}</div>` : ""}
                    </div>
                `;
            }).join("")}
        </div>
    `;
}

function buildPostToolTable(toolKey, posts) {
    const state = postToolStates[toolKey];
    const table = document.createElement("table");
    table.className = "pending-table";

    const thead = document.createElement("thead");
    const headerRow = document.createElement("tr");
    ["", "Type", "Post", "Published", "Link"].forEach((label) => {
        const th = document.createElement("th");
        th.textContent = label;
        headerRow.appendChild(th);
    });
    thead.appendChild(headerRow);
    table.appendChild(thead);

    const tbody = document.createElement("tbody");
    posts.forEach((post) => {
        const itemId = getPostToolItemId(post);
        const tr = document.createElement("tr");
        const protectionReason = getPostToolProtectionReason(toolKey, post);
        tr.className = protectionReason ? "post-tool-table-row is-protected" : "post-tool-table-row";
        tr.dataset.id = itemId;

        const checkboxTd = document.createElement("td");
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.className = "post-tool-checkbox";
        checkbox.checked = state.selectedIds.has(itemId);
        checkbox.disabled = Boolean(protectionReason);
        checkbox.title = protectionReason || "";
        checkbox.addEventListener("change", () => {
            if (checkbox.checked) {
                state.selectedIds.add(itemId);
            } else {
                state.selectedIds.delete(itemId);
            }
            const filtered = getPostToolFilteredPosts(toolKey);
            const eligible = filtered.filter((item) => isPostToolSelectable(toolKey, item));
            renderPostToolSelectionMeta(toolKey, filtered, eligible);
            updatePostToolActionButton(toolKey, eligible);
            renderPostToolSummary(toolKey, filtered, eligible);
        });
        checkboxTd.appendChild(checkbox);
        tr.appendChild(checkboxTd);

        const typeTd = document.createElement("td");
        const typeSpan = document.createElement("span");
        const postType = getPostToolType(post);
        typeSpan.className = `post-type-badge post-type-${postType}`;
        typeSpan.textContent = postType === "reels" ? "Reels" : postType[0].toUpperCase() + postType.slice(1);
        typeTd.appendChild(typeSpan);
        tr.appendChild(typeTd);

        const postTd = document.createElement("td");
        const wrap = document.createElement("div");
        wrap.className = "post-tool-row";
        const mediaUrl = String(post.media_url || post.media_thumb_url || "").trim();
        if (mediaUrl) {
            const thumb = document.createElement("img");
            thumb.src = mediaUrl;
            thumb.alt = "";
            thumb.className = "post-tool-thumb";
            wrap.appendChild(thumb);
        }
        const copyWrap = document.createElement("div");
        copyWrap.className = "post-tool-copy";
        const message = String(post.message_text || "(No message)");
        const title = document.createElement("div");
        title.className = "pending-table-title";
        title.textContent = message.length > 90 ? `${message.slice(0, 90)}...` : message;
        title.title = message;
        copyWrap.appendChild(title);
        const postId = document.createElement("div");
        postId.className = "pending-table-url";
        postId.textContent = post.facebook_post_id || itemId;
        copyWrap.appendChild(postId);
        if (protectionReason) {
            const protectionBadge = document.createElement("div");
            protectionBadge.className = "post-tool-protection-badge";
            protectionBadge.textContent = protectionReason;
            copyWrap.appendChild(protectionBadge);
        }
        wrap.appendChild(copyWrap);
        postTd.appendChild(wrap);
        tr.appendChild(postTd);

        const publishedTd = document.createElement("td");
        const publishedDate = parsePostToolDate(post.published_at || post.created_at);
        publishedTd.innerHTML = `<span class="pending-table-time">${publishedDate
            ? publishedDate.toLocaleString("th-TH", {
                year: "numeric",
                month: "2-digit",
                day: "2-digit",
                hour: "2-digit",
                minute: "2-digit",
            })
            : "-"}</span>`;
        tr.appendChild(publishedTd);

        const linkTd = document.createElement("td");
        const facebookUrl = String(post.facebook_url || "").trim();
        if (facebookUrl) {
            const link = document.createElement("a");
            link.href = facebookUrl;
            link.target = "_blank";
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

function renderPostToolTable(toolKey) {
    const state = postToolStates[toolKey];
    const dom = getPostToolDom(toolKey);
    if (!dom.tableContainer) return;

    const filtered = getPostToolFilteredPosts(toolKey);
    const eligible = filtered.filter((post) => isPostToolSelectable(toolKey, post));
    prunePostToolSelection(toolKey);
    renderPostToolFilterMeta(toolKey, filtered.length, state.posts.length, eligible.length);
    renderPostToolSelectionMeta(toolKey, filtered, eligible);
    updatePostToolActionButton(toolKey, eligible);
    renderPostToolSummary(toolKey, filtered, eligible);
    renderPostToolSafeguardMeta(toolKey, filtered, eligible);
    renderPostToolPagination(toolKey);

    if (!state.posts.length) {
        dom.tableContainer.innerHTML = `<div class="pending-empty">${postToolConfigs[toolKey].empty}</div>`;
        return;
    }

    if (!filtered.length) {
        dom.tableContainer.innerHTML = '<div class="pending-empty">ไม่พบโพสต์ที่ตรงกับ filter นี้</div>';
        return;
    }

    dom.tableContainer.innerHTML = "";
    dom.tableContainer.appendChild(buildPostToolTable(toolKey, filtered));
}

function syncPostToolInputs(toolKey) {
    const state = postToolStates[toolKey];
    const dom = getPostToolDom(toolKey);
    if (dom.searchInput) dom.searchInput.value = state.filters.query;
    if (dom.typeFilter) dom.typeFilter.value = state.filters.type;
    if (dom.dateInput) dom.dateInput.value = state.filters.customDate;
    if (dom.clearBeforeInput) dom.clearBeforeInput.value = state.filters.clearBefore;
    if (dom.batchSizeInput) dom.batchSizeInput.value = String(getPostToolPositiveInt(state.filters.batchSize, 20) || 20);
    if (dom.keepLatestToggle) dom.keepLatestToggle.checked = Boolean(state.safeguards.keepLatestEnabled);
    if (dom.keepLatestInput) dom.keepLatestInput.value = String(getPostToolPositiveInt(state.safeguards.keepLatestCount, 10));
    if (dom.minAgeToggle) dom.minAgeToggle.checked = Boolean(state.safeguards.minAgeEnabled);
    if (dom.minAgeInput) dom.minAgeInput.value = String(getPostToolPositiveInt(state.safeguards.minAgeDays, 7));
    renderPostToolDayFilters(toolKey);
    renderPostToolPagination(toolKey);
    if (toolKey === "delete") syncDeletePostToolPageSelect();
}

function autoSelectDeletePostsByRule() {
    const toolKey = "delete";
    const state = postToolStates[toolKey];
    const batchSize = Math.min(Math.max(getPostToolPositiveInt(state.filters.batchSize, 20), 1), 200);
    state.filters.batchSize = batchSize;

    const eligible = getPostToolEligibleFilteredPosts(toolKey)
        .slice()
        .sort((a, b) => {
            const aDate = parsePostToolDate(a.published_at || a.created_at);
            const bDate = parsePostToolDate(b.published_at || b.created_at);
            const aTime = aDate ? aDate.getTime() : Number.MAX_SAFE_INTEGER;
            const bTime = bDate ? bDate.getTime() : Number.MAX_SAFE_INTEGER;
            return aTime - bTime; // oldest first
        });

    const picked = eligible.slice(0, batchSize);
    state.selectedIds.clear();
    picked.forEach((post) => state.selectedIds.add(getPostToolItemId(post)));
    renderPostToolTable(toolKey);

    if (!picked.length) {
        alert("ไม่พบโพสต์ที่ตรงเงื่อนไขวันเวลา/ประเภทในเพจนี้");
    }
}

function mergePostToolPosts(existingPosts, incomingPosts) {
    const merged = new Map();
    existingPosts.forEach((post) => {
        const itemId = getPostToolItemId(post);
        if (itemId) merged.set(itemId, post);
    });
    incomingPosts.forEach((post) => {
        const itemId = getPostToolItemId(post);
        if (itemId) merged.set(itemId, post);
    });
    return Array.from(merged.values());
}

async function loadPostToolPosts(toolKey, { silent = false, append = false } = {}) {
    const state = postToolStates[toolKey];
    const dom = getPostToolDom(toolKey);
    const pageId = getCurrentPageId();

    if (!pageId) {
        state.posts = [];
        state.selectedIds.clear();
        state.loaded = false;
        state.pageId = "";
        resetPostToolStateDefaults(toolKey);
        if (dom.summaryBar) dom.summaryBar.innerHTML = "";
        if (dom.tableContainer) {
            dom.tableContainer.innerHTML = '<div class="pending-empty">Please select a Page first</div>';
        }
        renderPostToolSafeguardMeta(toolKey, [], []);
        renderPostToolPagination(toolKey);
        return;
    }

    if (state.pageId !== pageId) {
        state.pageId = pageId;
        state.posts = [];
        state.selectedIds.clear();
        state.loaded = false;
        resetPostToolStateDefaults(toolKey);
    }

    if (append) {
        if (!state.pagination.hasMore || !state.pagination.nextCursor) {
            renderPostToolPagination(toolKey);
            return;
        }
        if (state.pagination.loadingMore || state.loading) {
            return;
        }
        state.pagination.loadingMore = true;
    } else {
        if (state.loading) return;
        state.loading = true;
    }

    if (!silent && !append && dom.tableContainer) {
        dom.tableContainer.innerHTML = `
            <div class="pending-skeleton">
              <div class="pending-skeleton-row"><div class="sk-img"></div><div class="sk-text"></div><div class="sk-date"></div><div class="sk-badge"></div></div>
              <div class="pending-skeleton-row"><div class="sk-img"></div><div class="sk-text"></div><div class="sk-date"></div><div class="sk-badge"></div></div>
              <div class="pending-skeleton-row"><div class="sk-img"></div><div class="sk-text"></div><div class="sk-date"></div><div class="sk-badge"></div></div>
            </div>
        `;
    }

    try {
        const auth = getPostToolAuth();
        const response = await fetch("/api/published-posts", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                pageId,
                source: "facebook",
                limit: 100,
                after: append ? state.pagination.nextCursor : "",
                pageToken: auth.postToken,
                accessToken: auth.accessToken,
                cookieData: auth.cookieData,
            }),
        });
        const data = await response.json();

        if (!data.success) {
            if (append && dom.loadMoreMeta) {
                dom.loadMoreMeta.textContent = `โหลดเพิ่มไม่สำเร็จ: ${data.error || "Unknown error"}`;
            } else if (dom.tableContainer) {
                dom.tableContainer.innerHTML = `<div class="pending-empty">Error: ${data.error}</div>`;
            }
            return;
        }

        const incomingPosts = Array.isArray(data.logs) ? data.logs : [];
        state.posts = append ? mergePostToolPosts(state.posts, incomingPosts) : incomingPosts;
        state.loaded = true;
        state.pagination.nextCursor = String(data.meta?.nextCursor || "").trim();
        state.pagination.hasMore = Boolean(data.meta?.hasMore && state.pagination.nextCursor);
        state.pagination.lastBatchCount = incomingPosts.length;
        prunePostToolSelection(toolKey);
        syncPostToolInputs(toolKey);
        renderPostToolTable(toolKey);
    } catch (error) {
        if (append && dom.loadMoreMeta) {
            dom.loadMoreMeta.textContent = `โหลดเพิ่มไม่สำเร็จ: ${error.message}`;
        } else if (dom.tableContainer) {
            dom.tableContainer.innerHTML = `<div class="pending-empty">Error: ${error.message}</div>`;
        }
    } finally {
        state.loading = false;
        state.pagination.loadingMore = false;
        renderPostToolPagination(toolKey);
    }
}

function renderPostToolJobs(toolKey) {
    const state = postToolStates[toolKey];
    const dom = getPostToolDom(toolKey);
    if (!dom.jobsContainer) return;

    if (!state.jobs.length) {
        dom.jobsContainer.innerHTML = '<div class="post-tool-empty">ยังไม่มีงานล่าสุด</div>';
        return;
    }

    dom.jobsContainer.innerHTML = state.jobs.map((job) => {
        const progress = job.total_count ? Math.min(100, Math.round((job.processed_count / job.total_count) * 100)) : 0;
        const canCancel = job.status === "pending" || job.status === "processing";
        const canRetry = !canCancel && Number(job.failed_count || 0) > 0;
        const isExpanded = state.expandedJobIds.has(job.id);
        const detailState = state.jobDetails[job.id];
        const detailHtml = isExpanded
            ? `
                <div class="post-tool-job-detail">
                    ${renderPostToolJobItems(toolKey, job.id, detailState)}
                </div>
            `
            : "";
        return `
            <div class="post-tool-job">
                <div class="post-tool-job-top">
                    <span class="post-tool-job-status is-${job.status}">${job.status}</span>
                    <span class="post-tool-job-time">${new Date(job.created_at).toLocaleString("th-TH", { dateStyle: "short", timeStyle: "short" })}</span>
                </div>
                <div class="post-tool-job-counts">
                    <span>${job.success_count}/${job.total_count} สำเร็จ</span>
                    <span>${job.failed_count} fail</span>
                </div>
                <div class="post-tool-job-progress">
                    <span style="width:${progress}%"></span>
                </div>
                <div class="post-tool-job-actions">
                    <span>#${job.id}</span>
                    <div class="post-tool-job-action-buttons">
                        <button type="button" class="post-tool-link-btn" data-job-detail="${job.id}" data-tool="${toolKey}">
                            ${isExpanded ? "ซ่อนรายละเอียด" : "ดูรายละเอียด"}
                        </button>
                        ${canRetry ? `<button type="button" class="post-tool-link-btn is-retry" data-job-retry="${job.id}" data-tool="${toolKey}">retry failed</button>` : ""}
                        ${canCancel ? `<button type="button" class="post-tool-link-btn" data-job-cancel="${job.id}" data-tool="${toolKey}">ยกเลิก</button>` : ""}
                    </div>
                </div>
                ${detailHtml}
            </div>
        `;
    }).join("");

    dom.jobsContainer.querySelectorAll("[data-job-detail]").forEach((button) => {
        button.addEventListener("click", async () => {
            const jobId = Number(button.dataset.jobDetail || 0);
            if (!jobId) return;

            if (state.expandedJobIds.has(jobId)) {
                state.expandedJobIds.delete(jobId);
                renderPostToolJobs(toolKey);
                return;
            }

            state.expandedJobIds.add(jobId);
            renderPostToolJobs(toolKey);
            await loadPostToolJobDetail(toolKey, jobId);
        });
    });

    dom.jobsContainer.querySelectorAll("[data-job-item-toggle]").forEach((input) => {
        input.addEventListener("change", () => {
            const [jobIdRaw, itemIdRaw] = String(input.dataset.jobItemToggle || "").split(":");
            const jobId = Number(jobIdRaw || 0);
            const itemId = Number(itemIdRaw || 0);
            if (!jobId || !itemId) return;

            const selection = getPostToolFailedSelection(toolKey, jobId);
            if (input.checked) {
                selection.add(itemId);
            } else {
                selection.delete(itemId);
            }
            renderPostToolJobs(toolKey);
        });
    });

    dom.jobsContainer.querySelectorAll("[data-job-select-failed]").forEach((button) => {
        button.addEventListener("click", () => {
            const jobId = Number(button.dataset.jobSelectFailed || 0);
            if (!jobId) return;
            const detailState = state.jobDetails[jobId];
            const selection = getPostToolFailedSelection(toolKey, jobId);
            selection.clear();
            (detailState?.items || [])
                .filter((item) => String(item.status || "") === "failed")
                .forEach((item) => {
                    const itemId = Number(item.id || 0);
                    if (itemId > 0) selection.add(itemId);
                });
            renderPostToolJobs(toolKey);
        });
    });

    dom.jobsContainer.querySelectorAll("[data-job-clear-failed]").forEach((button) => {
        button.addEventListener("click", () => {
            const jobId = Number(button.dataset.jobClearFailed || 0);
            if (!jobId) return;
            getPostToolFailedSelection(toolKey, jobId).clear();
            renderPostToolJobs(toolKey);
        });
    });

    dom.jobsContainer.querySelectorAll("[data-job-retry]").forEach((button) => {
        button.addEventListener("click", async () => {
            const jobId = Number(button.dataset.jobRetry || 0);
            if (!jobId) return;
            if (!confirm("จะ retry เฉพาะรายการที่ fail ใน job นี้ใช่ไหม")) return;
            try {
                const response = await fetch(`/api/post-action-jobs/${jobId}/retry-failed`, {
                    method: "POST",
                });
                const data = await response.json();
                if (!data.success) {
                    throw new Error(data.error || "Retry failed");
                }
                state.expandedJobIds.add(jobId);
                await loadPostToolJobs(toolKey);
                await loadPostToolJobDetail(toolKey, jobId, { force: true });
            } catch (error) {
                alert(`Error: ${error.message}`);
            }
        });
    });

    dom.jobsContainer.querySelectorAll("[data-job-retry-selected]").forEach((button) => {
        button.addEventListener("click", async () => {
            const jobId = Number(button.dataset.jobRetrySelected || 0);
            if (!jobId) return;
            const selectedIds = Array.from(getPostToolFailedSelection(toolKey, jobId));
            if (!selectedIds.length) return;
            if (!confirm(`จะ retry ${selectedIds.length} รายการที่ fail ใน job นี้ใช่ไหม`)) return;
            try {
                const response = await fetch(`/api/post-action-jobs/${jobId}/retry-failed`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ itemIds: selectedIds }),
                });
                const data = await response.json();
                if (!data.success) {
                    throw new Error(data.error || "Retry selected failed");
                }
                getPostToolFailedSelection(toolKey, jobId).clear();
                state.expandedJobIds.add(jobId);
                await loadPostToolJobs(toolKey);
                await loadPostToolJobDetail(toolKey, jobId, { force: true });
            } catch (error) {
                alert(`Error: ${error.message}`);
            }
        });
    });

    dom.jobsContainer.querySelectorAll("[data-job-cancel]").forEach((button) => {
        button.addEventListener("click", async () => {
            const jobId = Number(button.dataset.jobCancel || 0);
            if (!jobId) return;
            if (!confirm("ยกเลิกงานนี้ใช่ไหม")) return;
            try {
                await fetch(`/api/post-action-jobs/${jobId}/cancel`, {
                    method: "POST",
                });
                await loadPostToolJobs(toolKey);
                if (state.expandedJobIds.has(jobId)) {
                    await loadPostToolJobDetail(toolKey, jobId, { force: true });
                }
            } catch (_) {
                // Ignore network errors here and let polling recover.
            }
        });
    });
}

function updatePostToolPolling(toolKey) {
    const state = postToolStates[toolKey];
    const hasRunningJob = state.jobs.some((job) => job.status === "pending" || job.status === "processing");

    if (hasRunningJob && !state.pollHandle) {
        state.pollHandle = setInterval(async () => {
            await loadPostToolJobs(toolKey);
            await refreshExpandedPostToolJobDetails(toolKey);
            const stillRunning = postToolStates[toolKey].jobs.some((job) => job.status === "pending" || job.status === "processing");
            if (!stillRunning) {
                clearInterval(state.pollHandle);
                state.pollHandle = null;
                loadPostToolPosts(toolKey, { silent: true });
            }
        }, 4000);
    } else if (!hasRunningJob && state.pollHandle) {
        clearInterval(state.pollHandle);
        state.pollHandle = null;
    }
}

async function loadPostToolJobs(toolKey) {
    const state = postToolStates[toolKey];
    const pageId = getCurrentPageId();
    if (!pageId) {
        state.jobs = [];
        state.jobDetails = {};
        state.expandedJobIds = new Set();
        renderPostToolJobs(toolKey);
        return;
    }

    try {
        const response = await fetch(`/api/post-action-jobs?pageId=${encodeURIComponent(pageId)}&action=${encodeURIComponent(postToolConfigs[toolKey].action)}&limit=8`);
        const data = await response.json();
        state.jobs = data.success && Array.isArray(data.jobs) ? data.jobs : [];
        renderPostToolJobs(toolKey);
        updatePostToolPolling(toolKey);
    } catch (_) {
        state.jobs = [];
        renderPostToolJobs(toolKey);
    }
}

async function runPostToolAction(toolKey) {
    const state = postToolStates[toolKey];
    const eligible = getPostToolEligibleFilteredPosts(toolKey);
    const selectedPosts = eligible.filter((post) => state.selectedIds.has(getPostToolItemId(post)));
    const batchSize = Math.min(Math.max(getPostToolPositiveInt(state.filters.batchSize, 20), 1), 200);

    if (!selectedPosts.length) {
        alert("เลือกโพสต์ก่อน");
        return;
    }

    if (toolKey === "delete" && selectedPosts.length > batchSize) {
        alert(`ตั้งค่าให้ลบทีละ ${batchSize} โพสต์ แต่ตอนนี้เลือกไว้ ${selectedPosts.length} โพสต์\nกรุณาลดจำนวนที่เลือก หรือกด "เลือกตามวันเวลา + จำนวน"`);
        return;
    }

    if (!postToolConfigs[toolKey].confirm(selectedPosts.length)) {
        return;
    }

    const pageId = getCurrentPageId();
    const auth = getPostToolAuth();

    try {
        const response = await fetch("/api/post-action-jobs", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                pageId,
                pageName: getPostToolPageName(),
                action: postToolConfigs[toolKey].action,
                postToken: auth.postToken,
                hideToken: auth.hideToken,
                requestedFilters: {
                    ...state.filters,
                    safeguards: state.safeguards,
                },
                posts: selectedPosts.map((post) => ({
                    id: getPostToolItemId(post),
                    messageText: post.message_text || "",
                    postType: getPostToolType(post),
                    publishedAt: post.published_at || post.created_at || "",
                    facebookUrl: post.facebook_url || "",
                    mediaUrl: post.media_url || post.media_thumb_url || "",
                })),
            }),
        });
        const data = await response.json();

        if (!data.success) {
            throw new Error(data.error || "Failed to start job");
        }

        state.selectedIds.clear();
        renderPostToolTable(toolKey);
        await loadPostToolJobs(toolKey);
    } catch (error) {
        alert(`Error: ${error.message}`);
    }
}

function bindPostToolEvents(toolKey) {
    const state = postToolStates[toolKey];
    const dom = getPostToolDom(toolKey);
    if (!dom.panel || dom.panel.dataset.bound === "true") return;
    dom.panel.dataset.bound = "true";

    dom.refreshBtn?.addEventListener("click", () => {
        loadPostToolPosts(toolKey);
        loadPostToolJobs(toolKey);
    });

    dom.searchInput?.addEventListener("input", (event) => {
        state.filters.query = event.target.value || "";
        renderPostToolTable(toolKey);
    });

    dom.typeFilter?.addEventListener("change", (event) => {
        state.filters.type = event.target.value || "all";
        renderPostToolTable(toolKey);
    });

    dom.dayFilters?.addEventListener("click", (event) => {
        const target = event.target.closest("[data-filter]");
        if (!target) return;
        state.filters.day = target.dataset.filter || "all";
        state.filters.customDate = "";
        state.filters.clearBefore = "";
        if (dom.dateInput) dom.dateInput.value = "";
        if (dom.clearBeforeInput) dom.clearBeforeInput.value = "";
        renderPostToolDayFilters(toolKey);
        renderPostToolTable(toolKey);
    });

    dom.dateInput?.addEventListener("change", (event) => {
        state.filters.customDate = event.target.value || "";
        if (state.filters.customDate) {
            state.filters.clearBefore = "";
            if (dom.clearBeforeInput) dom.clearBeforeInput.value = "";
        }
        renderPostToolDayFilters(toolKey);
        renderPostToolTable(toolKey);
    });

    dom.pageSelect?.addEventListener("change", () => {
        const globalPageSelect = document.getElementById("pageSelect");
        if (!globalPageSelect) return;
        const nextPageId = String(dom.pageSelect.value || "");
        if (!nextPageId || globalPageSelect.value === nextPageId) return;
        globalPageSelect.value = nextPageId;
        globalPageSelect.dispatchEvent(new Event("change"));
        loadPostToolPosts(toolKey);
        loadPostToolJobs(toolKey);
    });

    dom.clearBeforeInput?.addEventListener("change", (event) => {
        state.filters.clearBefore = event.target.value || "";
        if (state.filters.clearBefore) {
            state.filters.customDate = "";
            state.filters.day = "all";
            if (dom.dateInput) dom.dateInput.value = "";
        }
        renderPostToolDayFilters(toolKey);
        renderPostToolTable(toolKey);
    });

    dom.batchSizeInput?.addEventListener("input", (event) => {
        state.filters.batchSize = Math.min(Math.max(getPostToolPositiveInt(event.target.value, 20), 1), 200);
        event.target.value = String(state.filters.batchSize);
    });

    dom.autoSelectBtn?.addEventListener("click", () => {
        if (toolKey !== "delete") return;
        autoSelectDeletePostsByRule();
    });

    dom.selectVisibleBtn?.addEventListener("click", () => {
        getPostToolEligibleFilteredPosts(toolKey).forEach((post) => {
            state.selectedIds.add(getPostToolItemId(post));
        });
        renderPostToolTable(toolKey);
    });

    dom.clearSelectionBtn?.addEventListener("click", () => {
        state.selectedIds.clear();
        renderPostToolTable(toolKey);
    });

    dom.loadMoreBtn?.addEventListener("click", () => {
        loadPostToolPosts(toolKey, { silent: true, append: true });
    });

    dom.keepLatestToggle?.addEventListener("change", (event) => {
        state.safeguards.keepLatestEnabled = Boolean(event.target.checked);
        prunePostToolSelection(toolKey);
        renderPostToolTable(toolKey);
    });

    dom.keepLatestInput?.addEventListener("input", (event) => {
        state.safeguards.keepLatestCount = getPostToolPositiveInt(event.target.value, 10);
        prunePostToolSelection(toolKey);
        renderPostToolTable(toolKey);
    });

    dom.minAgeToggle?.addEventListener("change", (event) => {
        state.safeguards.minAgeEnabled = Boolean(event.target.checked);
        prunePostToolSelection(toolKey);
        renderPostToolTable(toolKey);
    });

    dom.minAgeInput?.addEventListener("input", (event) => {
        state.safeguards.minAgeDays = getPostToolPositiveInt(event.target.value, 7);
        prunePostToolSelection(toolKey);
        renderPostToolTable(toolKey);
    });

    dom.runBtn?.addEventListener("click", () => runPostToolAction(toolKey));
}

function showPostToolPanel(toolKey) {
    document.querySelectorAll(".mode-container").forEach((container) => {
        container.classList.remove("active");
        container.style.display = "none";
    });

    if (pendingPanel) pendingPanel.style.display = "none";
    if (publishedPanel) publishedPanel.style.display = "none";
    if (hidePostsPanel) hidePostsPanel.style.display = "none";
    if (deletePostsPanel) deletePostsPanel.style.display = "none";
    if (quotesPanel) quotesPanel.style.display = "none";
    if (settingsPanel) settingsPanel.style.display = "none";
    if (earningsPanel) earningsPanel.style.display = "none";
    const textPanelEl = document.getElementById("textPanel");
    if (textPanelEl) textPanelEl.style.display = "none";
    const bp = document.getElementById("billingPanel");
    if (bp) bp.style.display = "none";

    const dom = getPostToolDom(toolKey);
    if (dom.panel) dom.panel.style.display = "flex";
    appLayout.classList.add("pending-mode");
    document.body.style.overflow = "hidden";

    bindPostToolEvents(toolKey);
    if (toolKey === "delete") {
        syncDeletePostToolPageSelect();
    }
    loadPostToolPosts(toolKey);
    loadPostToolJobs(toolKey);
}

function showDeletePostsPanel() {
    showPostToolPanel("delete");
}
