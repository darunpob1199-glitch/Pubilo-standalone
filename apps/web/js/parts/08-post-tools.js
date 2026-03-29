const postToolConfigs = {
    hide: {
        key: "hide",
        action: "hide",
        navId: "hidePostsNavItem",
        panelId: "hidePostsPanel",
        prefix: "hidePosts",
        empty: "ยังไม่ได้โหลดโพสต์จากเพจ",
        confirm: (count) => confirm(`ต้องการซ่อน ${count} โพสต์ที่เลือกใช่ไหม`),
    },
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
    hide: createPostToolState(),
    delete: createPostToolState(),
};

function createPostToolState() {
    return {
        pageId: "",
        posts: [],
        jobs: [],
        selectedIds: new Set(),
        filters: {
            query: "",
            type: "all",
            day: "all",
            customDate: "",
        },
        loaded: false,
        loading: false,
        jobsLoading: false,
        pollHandle: null,
    };
}

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
        filterMeta: document.getElementById(`${prefix}FilterMeta`),
        selectionMeta: document.getElementById(`${prefix}SelectionMeta`),
        selectVisibleBtn: document.getElementById(`${prefix}SelectVisibleBtn`),
        clearSelectionBtn: document.getElementById(`${prefix}ClearSelectionBtn`),
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
                return true;
        }
    });
}

function renderPostToolSummary(toolKey) {
    const state = postToolStates[toolKey];
    const dom = getPostToolDom(toolKey);
    if (!dom.summaryBar) return;

    const filtered = getPostToolFilteredPosts(toolKey);
    const selectedCount = filtered.filter((post) => state.selectedIds.has(getPostToolItemId(post))).length;
    const todayKey = getPostToolDateKey(new Date());
    const todayCount = state.posts.filter((post) => getPostToolDateKey(post.published_at || post.created_at) === todayKey).length;
    const reelsCount = state.posts.filter((post) => getPostToolType(post) === "reels").length;

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

function renderPostToolFilterMeta(toolKey, filteredCount, totalCount) {
    const dom = getPostToolDom(toolKey);
    if (!dom.filterMeta) return;

    if (!totalCount) {
        dom.filterMeta.textContent = "ยังไม่มีโพสต์จากเพจนี้";
        return;
    }

    if (postToolStates[toolKey].filters.customDate) {
        dom.filterMeta.textContent = `วันที่ ${postToolStates[toolKey].filters.customDate} พบ ${filteredCount} รายการ`;
        return;
    }

    dom.filterMeta.textContent = filteredCount === totalCount
        ? `แสดง ${totalCount} รายการ`
        : `แสดง ${filteredCount} / ${totalCount} รายการ`;
}

function renderPostToolSelectionMeta(toolKey, filtered) {
    const state = postToolStates[toolKey];
    const dom = getPostToolDom(toolKey);
    if (!dom.selectionMeta) return;

    const selectedTotal = state.selectedIds.size;
    const visibleSelected = filtered.filter((post) => state.selectedIds.has(getPostToolItemId(post))).length;
    dom.selectionMeta.textContent = selectedTotal
        ? `เลือกไว้ ${selectedTotal} รายการ (${visibleSelected} จากหน้าที่เห็น)`
        : "ยังไม่ได้เลือกโพสต์";
}

function updatePostToolActionButton(toolKey, filtered) {
    const state = postToolStates[toolKey];
    const dom = getPostToolDom(toolKey);
    if (!dom.runBtn) return;

    const selectedCount = filtered.filter((post) => state.selectedIds.has(getPostToolItemId(post))).length;
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
        tr.dataset.id = itemId;

        const checkboxTd = document.createElement("td");
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.className = "post-tool-checkbox";
        checkbox.checked = state.selectedIds.has(itemId);
        checkbox.addEventListener("change", () => {
            if (checkbox.checked) {
                state.selectedIds.add(itemId);
            } else {
                state.selectedIds.delete(itemId);
            }
            const filtered = getPostToolFilteredPosts(toolKey);
            renderPostToolSelectionMeta(toolKey, filtered);
            updatePostToolActionButton(toolKey, filtered);
            renderPostToolSummary(toolKey);
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
    renderPostToolFilterMeta(toolKey, filtered.length, state.posts.length);
    renderPostToolSelectionMeta(toolKey, filtered);
    updatePostToolActionButton(toolKey, filtered);
    renderPostToolSummary(toolKey);

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
    renderPostToolDayFilters(toolKey);
}

async function loadPostToolPosts(toolKey, { silent = false } = {}) {
    const state = postToolStates[toolKey];
    const dom = getPostToolDom(toolKey);
    const pageId = getCurrentPageId();

    if (!pageId) {
        state.posts = [];
        state.selectedIds.clear();
        state.loaded = false;
        state.pageId = "";
        if (dom.summaryBar) dom.summaryBar.innerHTML = "";
        if (dom.tableContainer) {
            dom.tableContainer.innerHTML = '<div class="pending-empty">Please select a Page first</div>';
        }
        return;
    }

    if (state.pageId !== pageId) {
        state.pageId = pageId;
        state.posts = [];
        state.selectedIds.clear();
        state.loaded = false;
        state.filters.customDate = "";
        state.filters.query = "";
        state.filters.type = "all";
        state.filters.day = "all";
    }

    state.loading = true;
    if (!silent && dom.tableContainer) {
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
                limit: 200,
                pageToken: auth.postToken,
                accessToken: auth.accessToken,
                cookieData: auth.cookieData,
            }),
        });
        const data = await response.json();

        if (!data.success) {
            if (dom.tableContainer) {
                dom.tableContainer.innerHTML = `<div class="pending-empty">Error: ${data.error}</div>`;
            }
            return;
        }

        state.posts = Array.isArray(data.logs) ? data.logs : [];
        state.loaded = true;
        syncPostToolInputs(toolKey);
        renderPostToolTable(toolKey);
    } catch (error) {
        if (dom.tableContainer) {
            dom.tableContainer.innerHTML = `<div class="pending-empty">Error: ${error.message}</div>`;
        }
    } finally {
        state.loading = false;
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
                    ${canCancel ? `<button type="button" class="post-tool-link-btn" data-job-cancel="${job.id}" data-tool="${toolKey}">ยกเลิก</button>` : ""}
                </div>
            </div>
        `;
    }).join("");

    dom.jobsContainer.querySelectorAll("[data-job-cancel]").forEach((button) => {
        button.addEventListener("click", async () => {
            const jobId = Number(button.dataset.jobCancel || 0);
            if (!jobId) return;
            if (!confirm("ยกเลิกงานนี้ใช่ไหม")) return;
            try {
                await fetch(`/api/post-action-jobs/${jobId}/cancel`, {
                    method: "POST",
                });
                loadPostToolJobs(toolKey);
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
    const filtered = getPostToolFilteredPosts(toolKey);
    const selectedPosts = filtered.filter((post) => state.selectedIds.has(getPostToolItemId(post)));

    if (!selectedPosts.length) {
        alert("เลือกโพสต์ก่อน");
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
                requestedFilters: state.filters,
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
        if (dom.dateInput) dom.dateInput.value = "";
        renderPostToolDayFilters(toolKey);
        renderPostToolTable(toolKey);
    });

    dom.dateInput?.addEventListener("change", (event) => {
        state.filters.customDate = event.target.value || "";
        renderPostToolDayFilters(toolKey);
        renderPostToolTable(toolKey);
    });

    dom.selectVisibleBtn?.addEventListener("click", () => {
        getPostToolFilteredPosts(toolKey).forEach((post) => {
            state.selectedIds.add(getPostToolItemId(post));
        });
        renderPostToolTable(toolKey);
    });

    dom.clearSelectionBtn?.addEventListener("click", () => {
        state.selectedIds.clear();
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

    const dom = getPostToolDom(toolKey);
    if (dom.panel) dom.panel.style.display = "flex";
    appLayout.classList.add("pending-mode");
    document.body.style.overflow = "hidden";

    bindPostToolEvents(toolKey);
    loadPostToolPosts(toolKey);
    loadPostToolJobs(toolKey);
}

function showHidePostsPanel() {
    showPostToolPanel("hide");
}

function showDeletePostsPanel() {
    showPostToolPanel("delete");
}
