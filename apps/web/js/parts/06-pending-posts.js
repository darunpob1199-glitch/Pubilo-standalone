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

    if (!pageId || (!selectedPageToken && !accessToken)) {
        console.log(
            "[FEWFEED] Pages not loaded yet - showing skeleton",
        );
        return { loading: true };
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
            return data.posts.map((post) => ({
                id: post.id,
                postType: post.type || "link",
                imageUrl: post.image_url || "",
                fullImageUrl: post.image_url || "",
                message: post.message || "",
                scheduledTime: post.scheduled_publish_time || 0,
                permalink: post.permalink || "",
            }));
        } else {
            console.error(
                "[FEWFEED] Failed to fetch scheduled posts:",
                data.error,
            );
            return { error: data.error || "ไม่สามารถดึงข้อมูลได้" };
        }
    } catch (err) {
        console.error(
            "[FEWFEED] Error fetching scheduled posts:",
            err,
        );
        return { error: "Connection error" };
    }
}

// Build pending table using DOM methods (safe from XSS)
function buildPendingTable(posts) {
    const table = document.createElement("table");
    table.className = "pending-table";

    const thead = document.createElement("thead");
    const headerRow = document.createElement("tr");
    ["Type", "Image", "Message", "Time", "Status", "Edit", "Delete"].forEach((text) => {
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
        timeSpan.textContent = post.scheduledTime
            ? new Date(post.scheduledTime * 1000).toLocaleString(
                  "th-TH",
                  { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }
              )
            : "-";
        timeTd.appendChild(timeSpan);
        tr.appendChild(timeTd);

        // Status cell (clickable link to Facebook post)
        const statusTd = document.createElement("td");
        if (post.permalink || post.id) {
            const statusLink = document.createElement("a");
            statusLink.className = "pending-table-status";
            statusLink.style.background = "#dcfce7";
            statusLink.style.color = "#166534";
            statusLink.textContent = "Scheduled";
            statusLink.href =
                post.permalink ||
                `https://www.facebook.com/${post.id}`;
            statusLink.target = "_blank";
            statusLink.title = "View on Facebook";
            statusTd.appendChild(statusLink);
        } else {
            const statusSpan = document.createElement("span");
            statusSpan.className = "pending-table-status";
            statusSpan.style.background = "#dcfce7";
            statusSpan.style.color = "#166534";
            statusSpan.textContent = "Scheduled";
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
                showPendingPanel();
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
                // Remove just the row instead of reloading entire panel
                const row = document.querySelector(`tr[data-id="${postId}"]`);
                if (row) {
                    row.style.transition = "opacity 0.3s";
                    row.style.opacity = "0";
                    setTimeout(() => row.remove(), 300);
                }
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

// Show pending panel (replaces both preview + form panels)
// Render posts to table
function renderPendingPosts(posts) {
    pendingTableContainer.textContent = "";
    if (!posts || posts.length === 0) {
        const emptyDiv = document.createElement("div");
        emptyDiv.className = "pending-empty";
        emptyDiv.textContent = "No scheduled posts";
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
        const table = buildPendingTable(sorted);
        pendingTableContainer.appendChild(table);
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

async function showPendingPanel(forceRefresh = false) {
    // Hide all mode containers
    document.querySelectorAll(".mode-container").forEach((c) => {
        c.classList.remove("active");
    });
    // Hide quotes, settings, published, earnings and text panels
    quotesPanel.style.display = "none";
    settingsPanel.style.display = "none";
    publishedPanel.style.display = "none";
    earningsPanel.style.display = "none";
    const tp = document.getElementById("textPanel");
    if (tp) tp.style.display = "none";
    // Lock body scroll
    document.body.style.overflow = "hidden";
    // Show pending panel (full width)
    pendingPanel.style.display = "flex";
    // Add pending mode class
    appLayout.classList.add("pending-mode");

    const pageId = getCurrentPageId();

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
        if (scheduledResult && !scheduledResult.loading && !scheduledResult.error) {
            scheduledPosts = Array.isArray(scheduledResult) ? scheduledResult : [];
        }

        // Cache for pending count
        if (scheduledPosts.length > 0) {
            setCachedPosts(pageId, scheduledPosts);
        }

        // Render list
        renderPendingPosts(scheduledPosts);

    } catch (err) {
        console.error("Failed to fetch posts:", err);
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
    quotesPanel.style.display = "none";
    settingsPanel.style.display = "none";
    earningsPanel.style.display = "none";
    const tp = document.getElementById("textPanel");
    if (tp) tp.style.display = "none";
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
