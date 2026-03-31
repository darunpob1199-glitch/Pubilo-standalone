// 9. PENDING POSTS
// ============================================
async function fetchScheduledPostsFromFacebook() {
    const pageId = document.getElementById("pageSelect").value;
    const selectedPageToken = getPageToken();
    const accessToken =
        (typeof fbToken !== "undefined" && fbToken) ||
        localStorage.getItem("fewfeed_accessToken") ||
        localStorage.getItem("fewfeed_token") ||
        "";
    const cookieData =
        (typeof fbCookie !== "undefined" && fbCookie) ||
        localStorage.getItem("fewfeed_cookie") ||
        "";

    console.log("[FEWFEED] Fetching scheduled posts:", {
        hasPageId: !!pageId,
        pageId: pageId || "(empty)",
        hasSelectedPageToken: !!selectedPageToken,
        hasAccessToken: !!accessToken,
        hasCookie: !!cookieData,
        tokenPrefix: selectedPageToken?.substring(0, 15) + "...",
    });

    if (!pageId) {
        console.log(
            "[FEWFEED] Pages not loaded yet - showing skeleton",
        );
        return { loading: true, posts: [], meta: null, warning: "" };
    }

    try {
        const response = await fetch("/api/scheduled-posts", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                pageId,
                ...(selectedPageToken ? { pageToken: selectedPageToken } : {}),
                ...(accessToken ? { accessToken } : {}),
                ...(cookieData ? { cookieData } : {}),
            }),
        });
        const data = await response.json();

        console.log("[FEWFEED] Scheduled posts response:", data);

        if (data.success && data.posts) {
            const posts = data.posts.map((post) => ({
                id: post.id,
                queueId: post.queueId || null,
                pageId: post.pageId || "",
                pageName: post.pageName || "",
                batchId: post.batch_id || post.batchId || "",
                queueStatus: post.queueStatus || "",
                source: post.source || "",
                sourceLabel: post.sourceLabel || "",
                postType: post.type || post.postType || post.status_type || "link",
                imageUrl: post.image_url || post.imageUrl || "",
                fullImageUrl: post.image_url || post.fullImageUrl || post.imageUrl || "",
                message: post.message || "",
                scheduledTime: post.scheduled_publish_time || post.scheduledTime || 0,
                permalink: post.permalink || "",
            }));

            return {
                posts,
                meta: data.meta || null,
                warning: data.warning || "",
            };
        } else {
            console.error(
                "[FEWFEED] Failed to fetch scheduled posts:",
                data.error,
            );
            return {
                error: data.error || "ไม่สามารถดึงข้อมูลได้",
                posts: [],
                meta: null,
                warning: "",
            };
        }
    } catch (err) {
        console.error(
            "[FEWFEED] Error fetching scheduled posts:",
            err,
        );
        return {
            error: "Connection error",
            posts: [],
            meta: null,
            warning: "",
        };
    }
}

function formatPendingTime(timestamp) {
    if (!timestamp) return "-";
    return new Date(timestamp * 1000).toLocaleString("th-TH", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
    });
}

function normalizePendingWarning(warning) {
    const raw = String(warning || "").trim();
    if (!raw) return "";

    const normalized = raw.toLowerCase();
    if (normalized.includes("session has been invalidated") || normalized.includes("changed their password")) {
        return "ตอนนี้การเชื่อมต่อ Facebook หลุดอยู่ ระบบเลยแสดงเฉพาะคิวที่ยืนยันได้จาก Pubilo ก่อน";
    }
    if (normalized.includes("rate limit") || normalized.includes("temporarily blocked") || normalized.includes("code 368")) {
        return "Facebook จำกัดการดึงข้อมูลชั่วคราว รายการคิวบางส่วนอาจยังขึ้นไม่ครบในตอนนี้";
    }
    if (normalized.includes("missing page token")) {
        return "ยังไม่มี token ของเพจนี้ จึงแสดงได้เฉพาะคิวที่บันทึกไว้ในระบบก่อน";
    }

    return "บางรายการจาก Facebook ยังโหลดไม่ครบ ระบบเลยแสดงเฉพาะคิวที่ยืนยันได้ตอนนี้";
}

function buildPendingStats(posts = []) {
    const nowTs = Math.floor(Date.now() / 1000);
    const soonThreshold = nowTs + (6 * 60 * 60);
    const today = new Date();
    const batchGroups = new Set();
    let todayCount = 0;
    let soonCount = 0;

    posts.forEach((post) => {
        const batchId = getValidBatchId(post);
        if (batchId) batchGroups.add(batchId);
        if (isSameLocalDay(post.scheduledTime, today)) todayCount += 1;
        if (post.scheduledTime && post.scheduledTime <= soonThreshold) soonCount += 1;
    });

    return {
        total: posts.length,
        today: todayCount,
        soon: soonCount,
        batchGroups: batchGroups.size,
    };
}

function renderPendingOverview(posts = [], warning = "", pageId = "") {
    const summaryEl = document.getElementById("pendingSummaryBar");
    const warningEl = document.getElementById("pendingWarningBox");
    if (!summaryEl || !warningEl) return;

    const stats = buildPendingStats(posts);

    summaryEl.innerHTML = `
        <div class="pending-stat">
            <span class="pending-stat-label">ทั้งหมด</span>
            <strong class="pending-stat-value">${stats.total}</strong>
        </div>
        <div class="pending-stat">
            <span class="pending-stat-label">วันนี้</span>
            <strong class="pending-stat-value">${stats.today}</strong>
        </div>
        <div class="pending-stat">
            <span class="pending-stat-label">ใกล้ถึงเวลา</span>
            <strong class="pending-stat-value">${stats.soon}</strong>
        </div>
        <div class="pending-stat">
            <span class="pending-stat-label">หลายเพจ</span>
            <strong class="pending-stat-value">${stats.batchGroups}</strong>
        </div>
    `;

    if (warning) {
        warningEl.innerHTML = `
            <strong>รายการอาจยังไม่ครบ</strong>
            <span>${normalizePendingWarning(warning)}</span>
        `;
        warningEl.style.display = "flex";
        return;
    }

    warningEl.innerHTML = "";
    warningEl.style.display = "none";
}

const pendingFilters = {
    query: "",
    type: "all",
    quick: "all",
};

let currentPendingPosts = [];

function getPendingPostTypeKey(post) {
    const type = String(post.postType || "").toLowerCase();
    if (type.includes("reel")) return "reels";
    if (type.includes("image")) return "image";
    if (type.includes("text")) return "text";
    return "link";
}

function isSameLocalDay(timestamp, compareDate = new Date()) {
    if (!timestamp) return false;
    const date = new Date(timestamp * 1000);
    return (
        date.getFullYear() === compareDate.getFullYear() &&
        date.getMonth() === compareDate.getMonth() &&
        date.getDate() === compareDate.getDate()
    );
}

function getPendingFilterResult(posts) {
    const nowTs = Math.floor(Date.now() / 1000);
    const soonThreshold = nowTs + (6 * 60 * 60);
    const query = pendingFilters.query.trim().toLowerCase();

    const batchCounts = new Map();
    posts.forEach((post) => {
        const batchId = getValidBatchId(post);
        if (!batchId) return;
        batchCounts.set(batchId, (batchCounts.get(batchId) || 0) + 1);
    });

    const filtered = posts.filter((post) => {
        const postTypeKey = getPendingPostTypeKey(post);
        const batchId = getValidBatchId(post);
        const isBatch = !!batchId && (batchCounts.get(batchId) || 0) > 1;
        const haystack = [
            post.message || "",
            post.pageName || "",
            post.pageId || "",
            batchId || "",
        ].join(" ").toLowerCase();

        if (query && !haystack.includes(query)) {
            return false;
        }

        if (pendingFilters.type !== "all" && postTypeKey !== pendingFilters.type) {
            return false;
        }

        switch (pendingFilters.quick) {
            case "soon":
                return !!post.scheduledTime && post.scheduledTime <= soonThreshold;
            case "today":
                return isSameLocalDay(post.scheduledTime);
            case "batch":
                return isBatch;
            case "single":
                return !isBatch;
            default:
                return true;
        }
    });

    return {
        filtered,
        total: posts.length,
    };
}

function updatePendingFilterMeta(filteredCount, totalCount) {
    const metaEl = document.getElementById("pendingFilterMeta");
    if (!metaEl) return;

    if (!totalCount) {
        metaEl.textContent = "ยังไม่มีคิวโพสต์";
        return;
    }

    if (filteredCount === totalCount) {
        metaEl.textContent = `แสดง ${totalCount} รายการ`;
        return;
    }

    metaEl.textContent = `แสดง ${filteredCount} / ${totalCount} รายการ`;
}

function syncPendingQuickFiltersUi() {
    const chips = document.querySelectorAll("#pendingQuickFilters .pending-filter-chip");
    chips.forEach((chip) => {
        chip.classList.toggle("is-active", chip.dataset.filter === pendingFilters.quick);
    });
}

function renderPendingPostsWithFilters() {
    const { filtered, total } = getPendingFilterResult(currentPendingPosts);
    updatePendingFilterMeta(filtered.length, total);
    renderPendingPosts(filtered);
}

// Build pending table using DOM methods (safe from XSS)
function buildPendingTable(posts, options = {}) {
    const { showPage = false } = options;
    const table = document.createElement("table");
    table.className = "pending-table";

    const thead = document.createElement("thead");
    const headerRow = document.createElement("tr");
    const headers = showPage
        ? ["Page", "Type", "Image", "Message", "Time", "Status", "Edit", "Delete"]
        : ["Type", "Image", "Message", "Time", "Status", "Edit", "Delete"];
    headers.forEach((text) => {
        const th = document.createElement("th");
        th.textContent = text;
        headerRow.appendChild(th);
    });
    thead.appendChild(headerRow);
    table.appendChild(thead);

    const tbody = document.createElement("tbody");
    posts.forEach((post) => {
        const tr = document.createElement("tr");
        tr.dataset.id = post.id;

        if (showPage) {
            const pageTd = document.createElement("td");
            const pageWrap = document.createElement("div");
            pageWrap.className = "pending-batch-page";
            const pageNameDiv = document.createElement("div");
            pageNameDiv.className = "pending-table-title";
            pageNameDiv.textContent = post.pageName || post.pageId || "Unknown Page";
            const pageIdDiv = document.createElement("div");
            pageIdDiv.className = "pending-table-url";
            pageIdDiv.textContent = post.pageId || "";
            pageWrap.appendChild(pageNameDiv);
            if (post.pageId) pageWrap.appendChild(pageIdDiv);
            pageTd.appendChild(pageWrap);
            tr.appendChild(pageTd);
        }

        // Type cell with icon
        const typeTd = document.createElement("td");
        const typeSpan = document.createElement("span");
        const pType = post.postType || 'link';
        typeSpan.className = `post-type-badge post-type-${pType.replace('auto-', '')}`;
        const typeIcons = {
            link: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>',
            image: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>',
            reels: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18"/><line x1="7" y1="2" x2="7" y2="22"/><line x1="17" y1="2" x2="17" y2="22"/><line x1="2" y1="12" x2="22" y2="12"/><line x1="2" y1="7" x2="7" y2="7"/><line x1="2" y1="17" x2="7" y2="17"/><line x1="17" y1="7" x2="22" y2="7"/><line x1="17" y1="17" x2="22" y2="17"/></svg>',
            'auto-text': '📝',
            'auto-image': '🖼️',
            text: '📝'
        };
        const iconKey = pType.startsWith('auto-') ? pType : pType;
        typeSpan.innerHTML = typeIcons[iconKey] || typeIcons.link;
        const typeLabels = {
            link: 'Link',
            image: 'Image',
            reels: 'Reels',
            'auto-text': 'Auto Text',
            'auto-image': 'Auto Image',
            text: 'Text'
        };
        typeSpan.title = typeLabels[pType] || pType;
        typeTd.appendChild(typeSpan);
        tr.appendChild(typeTd);

        // Image cell (clickable to show lightbox, hover to preview)
        const imgTd = document.createElement("td");
        if (post.imageUrl) {
            const img = document.createElement("img");
            img.className = "pending-table-thumb";
            img.alt = "";
            img.loading = "lazy";
            img.src = post.imageUrl; // Small thumbnail from Facebook
            const fullUrl = post.fullImageUrl || post.imageUrl;
            img.onclick = () => showLightbox(fullUrl);
            img.onmouseenter = (e) => showThumbPreview(fullUrl, e);
            img.onmousemove = (e) => moveThumbPreview(e);
            img.onmouseleave = () => hideThumbPreview();
            imgTd.appendChild(img);
        } else {
            const span = document.createElement("span");
            span.style.color = "#999";
            span.textContent = "No image";
            imgTd.appendChild(span);
        }
        tr.appendChild(imgTd);

        // Message cell
        const msgTd = document.createElement("td");
        const msgDiv = document.createElement("div");
        msgDiv.className = "pending-table-title";
        const message = post.message || "(No message)";
        msgDiv.textContent =
            message.length > 50
                ? message.substring(0, 50) + "..."
                : message;
        msgDiv.title = message;
        msgTd.appendChild(msgDiv);
        tr.appendChild(msgTd);

        // Scheduled time cell
        const timeTd = document.createElement("td");
        const timeSpan = document.createElement("span");
        timeSpan.className = "pending-table-time";
        timeSpan.textContent = formatPendingTime(post.scheduledTime);
        timeTd.appendChild(timeSpan);
        tr.appendChild(timeTd);

        // Status cell (clickable link to Facebook post)
        const statusTd = document.createElement("td");
        const isSystemQueuePost = String(post.id || '').startsWith('queue:');
        if ((post.permalink || post.id) && !isSystemQueuePost) {
            const statusLink = document.createElement("a");
            statusLink.className = "pending-table-status";
            statusLink.style.background = "#dcfce7";
            statusLink.style.color = "#166534";
            statusLink.textContent = "ตั้งเวลาแล้ว";
            statusLink.href =
                post.permalink ||
                `https://www.facebook.com/${post.id}`;
            statusLink.target = "_blank";
            statusLink.rel = "noopener noreferrer";
            statusLink.title = "View on Facebook";
            statusTd.appendChild(statusLink);
        } else {
            const statusSpan = document.createElement("span");
            statusSpan.className = "pending-table-status";
            if (isSystemQueuePost) {
                const isProcessing = String(post.queueStatus || "").toLowerCase() === "processing";
                statusSpan.style.background = isProcessing ? "#fef3c7" : "#dbeafe";
                statusSpan.style.color = isProcessing ? "#b45309" : "#1d4ed8";
                statusSpan.textContent = isProcessing ? "กำลังเตรียม" : "รอเวลา";
            } else {
                statusSpan.style.background = "#dcfce7";
                statusSpan.style.color = "#166534";
                statusSpan.textContent = "ตั้งเวลาแล้ว";
            }
            statusTd.appendChild(statusSpan);
        }
        tr.appendChild(statusTd);

        // Edit time cell
        const editTd = document.createElement("td");
        const editBtn = document.createElement("button");
        editBtn.className = "pending-table-edit";
        editBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>';
        editBtn.title = "Edit scheduled time";
        editBtn.onclick = () => editScheduledTime(post.id, post.scheduledTime);
        editTd.appendChild(editBtn);
        tr.appendChild(editTd);

        // Delete cell
        const deleteTd = document.createElement("td");
        const deleteBtn = document.createElement("button");
        deleteBtn.className = "pending-table-delete";
        deleteBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>';
        deleteBtn.title = "Delete";
        deleteBtn.onclick = () => deleteScheduledPost(post.id);
        deleteTd.appendChild(deleteBtn);
        tr.appendChild(deleteTd);

        tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    return table;
}

// Edit scheduled time function - show modal
function editScheduledTime(postId, currentTime) {
    const currentDate = currentTime ? new Date(currentTime * 1000) : new Date();

    // Create modal
    const modal = document.createElement("div");
    modal.className = "edit-time-modal";
    modal.innerHTML = `
        <div class="edit-time-modal-content">
            <h3>แก้ไขเวลาโพสต์</h3>
            <div class="edit-time-fields">
                <div class="edit-time-field">
                    <label>วันที่</label>
                    <input type="date" id="editDateInput" value="${currentDate.toISOString().slice(0, 10)}">
                </div>
                <div class="edit-time-field">
                    <label>เวลา</label>
                    <input type="time" id="editTimeInput" value="${currentDate.toTimeString().slice(0, 5)}">
                </div>
            </div>
            <div class="edit-time-actions">
                <button class="edit-time-cancel" onclick="this.closest('.edit-time-modal').remove()">ยกเลิก</button>
                <button class="edit-time-save" id="editTimeSaveBtn">บันทึก</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);

    // Handle save
    document.getElementById("editTimeSaveBtn").onclick = async () => {
        const dateVal = document.getElementById("editDateInput").value;
        const timeVal = document.getElementById("editTimeInput").value;

        if (!dateVal || !timeVal) {
            alert("กรุณาเลือกวันที่และเวลา");
            return;
        }

        const newTimestamp = Math.floor(new Date(dateVal + "T" + timeVal).getTime() / 1000);

        try {
            const pageToken = getPageToken();
            const response = await fetch("/api/update-post-time", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    postId,
                    pageToken,
                    scheduledTime: newTimestamp
                })
            });
            const result = await response.json();
            if (result.success) {
                modal.remove();
                invalidatePostsCache(getCurrentPageId());
                showPendingPanel(true);
                updatePendingCount();
            } else {
                alert("Error: " + (result.error || "Failed to update"));
            }
        } catch (err) {
            alert("Error: " + err.message);
        }
    };

}

// Delete scheduled post function - show modal
function deleteScheduledPost(postId) {
    const modal = document.createElement("div");
    modal.className = "edit-time-modal";
    modal.innerHTML = `
        <div class="edit-time-modal-content">
            <h3>ยืนยันการลบ</h3>
            <p style="color: #6b7280; margin: 0 0 1.5rem 0; font-size: 0.9rem;">คุณต้องการลบโพสต์นี้หรือไม่? การลบจะไม่สามารถกู้คืนได้</p>
            <div class="edit-time-actions">
                <button class="edit-time-cancel" onclick="this.closest('.edit-time-modal').remove()">ยกเลิก</button>
                <button class="delete-confirm-btn" id="deleteConfirmBtn">ลบโพสต์</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);

    // Handle delete
    document.getElementById("deleteConfirmBtn").onclick = async () => {
        const btn = document.getElementById("deleteConfirmBtn");
        btn.textContent = "กำลังลบ...";
        btn.disabled = true;

        try {
            const pageToken = getPageToken();
            const response = await fetch("/api/delete-post", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ postId, pageToken })
            });
            const result = await response.json();
            if (result.success) {
                modal.remove();
                // Invalidate cache after successful delete
                invalidatePostsCache(getCurrentPageId());
                showPendingPanel(true);
                updatePendingCount();
            } else {
                alert("Error: " + (result.error || "Failed to delete"));
                btn.textContent = "ลบโพสต์";
                btn.disabled = false;
            }
        } catch (err) {
            alert("Error: " + err.message);
            btn.textContent = "ลบโพสต์";
            btn.disabled = false;
        }
    };

}

function getValidBatchId(post) {
    const batchId = String(post.batchId || "").trim();
    if (!batchId) return "";
    if (!String(post.id || "").startsWith("queue:")) return "";
    return batchId;
}

function buildPendingGroups(posts) {
    const batchCounts = new Map();
    posts.forEach((post) => {
        const batchId = getValidBatchId(post);
        if (!batchId) return;
        batchCounts.set(batchId, (batchCounts.get(batchId) || 0) + 1);
    });

    const seenBatchIds = new Set();
    const groups = [];
    const singles = [];

    posts.forEach((post) => {
        const batchId = getValidBatchId(post);
        if (batchId && (batchCounts.get(batchId) || 0) > 1) {
            if (seenBatchIds.has(batchId)) return;
            seenBatchIds.add(batchId);
            groups.push({
                batchId,
                posts: posts.filter((item) => getValidBatchId(item) === batchId),
            });
            return;
        }

        singles.push(post);
    });

    return { groups, singles };
}

function buildBatchGroupSection(group) {
    const wrapper = document.createElement("section");
    wrapper.className = "pending-batch-group";

    const header = document.createElement("div");
    header.className = "pending-batch-header";

    const titleWrap = document.createElement("div");
    titleWrap.className = "pending-batch-meta";

    const title = document.createElement("div");
    title.className = "pending-batch-title";
    title.textContent = `Batch ${group.posts.length} เพจ`;

    const subtitle = document.createElement("div");
    subtitle.className = "pending-batch-subtitle";
    const pageNames = Array.from(
        new Set(
            group.posts
                .map((post) => post.pageName || post.pageId || "")
                .filter(Boolean),
        ),
    );
    subtitle.textContent = `${formatPendingTime(group.posts[0]?.scheduledTime)} • ${pageNames.join(" • ")}`;

    titleWrap.appendChild(title);
    titleWrap.appendChild(subtitle);

    const badge = document.createElement("span");
    badge.className = "pending-batch-count";
    badge.textContent = `${group.posts.length} targets`;

    header.appendChild(titleWrap);
    header.appendChild(badge);
    wrapper.appendChild(header);
    wrapper.appendChild(buildPendingTable(group.posts, { showPage: true }));

    return wrapper;
}

// Show pending panel (replaces both preview + form panels)
// Render posts to table
function renderPendingPosts(posts) {
    pendingTableContainer.textContent = "";
    if (!posts || posts.length === 0) {
        const emptyDiv = document.createElement("div");
        emptyDiv.className = "pending-empty";
        emptyDiv.textContent = currentPendingPosts.length > 0
            ? "ไม่พบรายการที่ตรงกับ filter นี้"
            : "ยังไม่มีคิวโพสต์";
        pendingTableContainer.appendChild(emptyDiv);
    } else {
        // Sort based on user preference
        const sorted = [...posts].sort((a, b) => {
            const timeA = a.scheduledTime || 0;
            const timeB = b.scheduledTime || 0;
            // sortNewestFirst: true = newest scheduled time first (descending)
            // sortNewestFirst: false = soonest to post first (ascending)
            return sortNewestFirst ? (timeB - timeA) : (timeA - timeB);
        });
        const { groups, singles } = buildPendingGroups(sorted);

        if (groups.length === 0) {
            pendingTableContainer.appendChild(buildPendingTable(sorted));
            return;
        }

        const fragment = document.createDocumentFragment();

        groups.forEach((group) => {
            fragment.appendChild(buildBatchGroupSection(group));
        });

        if (singles.length > 0) {
            const singlesSection = document.createElement("section");
            singlesSection.className = "pending-batch-group pending-batch-group--singles";

            const header = document.createElement("div");
            header.className = "pending-batch-header";

            const titleWrap = document.createElement("div");
            titleWrap.className = "pending-batch-meta";

            const title = document.createElement("div");
            title.className = "pending-batch-title";
            title.textContent = "โพสต์เดี่ยว";

            const subtitle = document.createElement("div");
            subtitle.className = "pending-batch-subtitle";
            subtitle.textContent = "รายการที่ไม่ได้อยู่ใน batch หลายเพจ";

            titleWrap.appendChild(title);
            titleWrap.appendChild(subtitle);
            header.appendChild(titleWrap);
            singlesSection.appendChild(header);
            singlesSection.appendChild(buildPendingTable(singles));
            fragment.appendChild(singlesSection);
        }

        pendingTableContainer.appendChild(fragment);
    }
}

// Check if posts arrays are different
function postsChanged(oldPosts, newPosts) {
    if (!oldPosts || !newPosts) return true;
    if (oldPosts.length !== newPosts.length) return true;
    const oldIds = oldPosts.map(p => p.id).sort().join(",");
    const newIds = newPosts.map(p => p.id).sort().join(",");
    return oldIds !== newIds;
}

const pendingRefreshBtn = document.getElementById("pendingRefreshBtn");
const pendingSearchInput = document.getElementById("pendingSearchInput");
const pendingTypeFilter = document.getElementById("pendingTypeFilter");
const pendingQuickFilters = document.getElementById("pendingQuickFilters");
const pendingPostsTab = document.getElementById("pendingPostsTab");
const pendingQuotesTab = document.getElementById("pendingQuotesTab");
const quotesPostsTab = document.getElementById("quotesPostsTab");
const quotesQuotesTab = document.getElementById("quotesQuotesTab");

let pendingSectionView = "posts";

function syncPendingSectionTabs() {
    const isQuotes = pendingSectionView === "quotes";
    pendingPostsTab?.classList.toggle("is-active", !isQuotes);
    quotesPostsTab?.classList.toggle("is-active", !isQuotes);
    pendingQuotesTab?.classList.toggle("is-active", isQuotes);
    quotesQuotesTab?.classList.toggle("is-active", isQuotes);
}

function bindPendingSectionTabs() {
    const buttons = [
        [pendingPostsTab, "pending"],
        [quotesPostsTab, "pending"],
        [pendingQuotesTab, "quotes"],
        [quotesQuotesTab, "quotes"],
    ];

    buttons.forEach(([button, hash]) => {
        if (!button || button.dataset.bound) return;
        button.dataset.bound = "true";
        button.addEventListener("click", () => {
            window.location.hash = hash;
        });
    });
}

bindPendingSectionTabs();

if (pendingRefreshBtn && !pendingRefreshBtn.dataset.bound) {
    pendingRefreshBtn.dataset.bound = "true";
    pendingRefreshBtn.addEventListener("click", () => {
        invalidatePostsCache(getCurrentPageId());
        showPendingPanel(true);
        updatePendingCount();
    });
}

if (pendingSearchInput && !pendingSearchInput.dataset.bound) {
    pendingSearchInput.dataset.bound = "true";
    pendingSearchInput.addEventListener("input", (event) => {
        pendingFilters.query = event.target.value || "";
        renderPendingPostsWithFilters();
    });
}

if (pendingTypeFilter && !pendingTypeFilter.dataset.bound) {
    pendingTypeFilter.dataset.bound = "true";
    pendingTypeFilter.addEventListener("change", (event) => {
        pendingFilters.type = event.target.value || "all";
        renderPendingPostsWithFilters();
    });
}

if (pendingQuickFilters && !pendingQuickFilters.dataset.bound) {
    pendingQuickFilters.dataset.bound = "true";
    pendingQuickFilters.addEventListener("click", (event) => {
        const chip = event.target.closest(".pending-filter-chip");
        if (!chip) return;
        pendingFilters.quick = chip.dataset.filter || "all";
        syncPendingQuickFiltersUi();
        renderPendingPostsWithFilters();
    });
    syncPendingQuickFiltersUi();
}

async function showPendingPanel(forceRefresh = false, view = "posts") {
    if (window.PUBILO_WEB_ONLY_MODE && view === "quotes") {
        view = "posts";
    }
    pendingSectionView = view === "quotes" ? "quotes" : "posts";
    syncPendingSectionTabs();
    // Hide all mode containers
    document.querySelectorAll(".mode-container").forEach((c) => {
        c.classList.remove("active");
    });
    // Hide quotes, settings, published, earnings and text panels
    quotesPanel.style.display = "none";
    settingsPanel.style.display = "none";
    publishedPanel.style.display = "none";
    if (hidePostsPanel) hidePostsPanel.style.display = "none";
    if (deletePostsPanel) deletePostsPanel.style.display = "none";
    earningsPanel.style.display = "none";
    const tp = document.getElementById("textPanel");
    if (tp) tp.style.display = "none";
    const bp = document.getElementById("billingPanel");
    if (bp) bp.style.display = "none";
    // Lock body scroll
    document.body.style.overflow = "hidden";
    // Add pending mode class
    appLayout.classList.add("pending-mode");

    if (pendingSectionView === "quotes") {
        pendingPanel.style.display = "none";
        quotesPanel.style.display = "flex";
        if (typeof loadQuotes === "function") {
            loadQuotes();
        }
        return;
    }

    // Show pending panel (full width)
    pendingPanel.style.display = "flex";
    quotesPanel.style.display = "none";

    const pageId = getCurrentPageId();

    if (pendingSearchInput) pendingSearchInput.value = pendingFilters.query;
    if (pendingTypeFilter) pendingTypeFilter.value = pendingFilters.type;
    syncPendingQuickFiltersUi();

    if (!pageId) {
        currentPendingPosts = [];
        renderPendingOverview([], "", "");
        updatePendingFilterMeta(0, 0);
        pendingTableContainer.innerHTML =
            '<div class="pending-empty">กรุณาเลือกเพจหลักก่อน</div>';
        return;
    }

    // Show skeleton while loading
    pendingTableContainer.innerHTML = `
        <div class="pending-skeleton">
          <div class="pending-skeleton-row"><div class="sk-img"></div><div class="sk-text"></div><div class="sk-date"></div><div class="sk-badge"></div></div>
          <div class="pending-skeleton-row"><div class="sk-img"></div><div class="sk-text"></div><div class="sk-date"></div><div class="sk-badge"></div></div>
          <div class="pending-skeleton-row"><div class="sk-img"></div><div class="sk-text"></div><div class="sk-date"></div><div class="sk-badge"></div></div>
        </div>
    `;

    try {
        // Fetch scheduled posts from Facebook
        const scheduledResult = await fetchScheduledPostsFromFacebook();

        // Process scheduled posts
        let scheduledPosts = [];
        let scheduledMeta = null;
        let pendingWarning = "";
        if (scheduledResult && !scheduledResult.loading && !scheduledResult.error) {
            scheduledPosts = Array.isArray(scheduledResult.posts) ? scheduledResult.posts : [];
            scheduledMeta = scheduledResult.meta || null;
            pendingWarning = scheduledResult.warning || "";
        } else if (scheduledResult?.error) {
            pendingWarning = scheduledResult.error;
        }

        // Cache for pending count
        if (scheduledPosts.length > 0) {
            setCachedPosts(pageId, scheduledPosts);
        }

        currentPendingPosts = scheduledPosts;

        renderPendingOverview(
            scheduledPosts,
            pendingWarning,
            pageId,
        );

        renderPendingPostsWithFilters();

    } catch (err) {
        console.error("Failed to fetch posts:", err);
        currentPendingPosts = [];
        renderPendingOverview([], "โหลดคิวโพสต์ไม่สำเร็จ", pageId);
        updatePendingFilterMeta(0, 0);
        pendingTableContainer.textContent = "";
        const errorDiv = document.createElement("div");
        errorDiv.className = "pending-empty";
        errorDiv.textContent = "Failed to load posts";
        pendingTableContainer.appendChild(errorDiv);
    }
}

// Show dashboard (hide pending/quotes/settings panels, show mode containers)
function showDashboard() {
    pendingPanel.style.display = "none";
    publishedPanel.style.display = "none";
    if (hidePostsPanel) hidePostsPanel.style.display = "none";
    if (deletePostsPanel) deletePostsPanel.style.display = "none";
    quotesPanel.style.display = "none";
    settingsPanel.style.display = "none";
    earningsPanel.style.display = "none";
    const tp = document.getElementById("textPanel");
    if (tp) tp.style.display = "none";
    const bp = document.getElementById("billingPanel");
    if (bp) bp.style.display = "none";
    const textModePanel = document.getElementById("textModePanel");
    if (textModePanel) textModePanel.style.display = "none";
    // Reset mode-container display
    document.querySelectorAll(".mode-container").forEach((c) => {
        c.style.display = "";
    });
    document.body.style.overflow = "";
    appLayout.classList.remove("pending-mode");
}

// ============================================
