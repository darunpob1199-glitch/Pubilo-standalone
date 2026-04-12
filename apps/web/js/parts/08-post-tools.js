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
        confirm: (count) => confirm(`กำลังจะลบ ${count} โพสต์จากเพจนี้\nยืนยันการลบหรือไม่`),
    },
};

const DELETE_BATCH_DEFAULT = 50;
const DELETE_BATCH_MIN = 1;
const DELETE_BATCH_MAX = 200;
const DELETE_BATCH_PRESETS = [50, 80, 120];

const postToolStates = {
    hide: createPostToolState(),
    delete: createPostToolState(),
};

const postToolDateRangeFilterUtils = window.PubiloDateRangeFilter || {
    normalizeValue: (value) => String(value || "").trim(),
    parseRange: (value) => {
        const normalized = String(value || "").trim();
        return {
            start: normalized,
            end: normalized,
            isRange: false,
        };
    },
    getLabel: (value) => {
        const normalized = String(value || "").trim();
        return normalized ? `วันที่ ${normalized}` : "";
    },
    createBoundary: () => null,
    includes: (date, value) => {
        const normalized = String(value || "").trim();
        return !normalized || getPostToolDateKey(date) === normalized;
    },
    syncInputValue: (input, value) => {
        if (input) input.value = String(value || "").trim();
    },
};

function createPostToolState() {
    return {
        pageId: "",
        pageMetaById: {},
        pageResolveAttempts: 0,
        authRecoveryTried: false,
        authRecoveryInFlight: false,
        activeJobId: 0,
        lastJobToastKey: "",
        posts: [],
        jobs: [],
        jobDetails: {},
        expandedJobIds: new Set(),
        failedSelections: {},
        reconciledJobIds: new Set(),
        localRemovedIds: new Set(),
        selectedIds: new Set(),
        filters: {
            query: "",
            type: "all",
            day: "all",
            customDate: "",
            clearBefore: "",
            batchSize: DELETE_BATCH_DEFAULT,
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
        pendingReload: false,
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
    state.filters.batchSize = DELETE_BATCH_DEFAULT;
    state.pagination.nextCursor = "";
    state.pagination.hasMore = false;
    state.pagination.loadingMore = false;
    state.pagination.lastBatchCount = 0;
    state.pageResolveAttempts = 0;
    state.pageMetaById = {};
    state.authRecoveryTried = false;
    state.authRecoveryInFlight = false;
    state.activeJobId = 0;
    state.lastJobToastKey = "";
    state.pendingReload = false;
    state.jobDetails = {};
    state.expandedJobIds = new Set();
    state.failedSelections = {};
    state.reconciledJobIds = new Set();
    state.localRemovedIds = new Set();
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
        statusPanel: document.getElementById(`${prefix}StatusPanel`),
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
        batchPresets: document.getElementById(`${prefix}BatchPresets`),
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

function showPostToolStatusToast(message, type = "success") {
    if (!message) return;
    if (typeof window.showPublishToast === "function") {
        window.showPublishToast(message, type);
        return;
    }

    let toast = document.getElementById("postToolStatusToast");
    if (!toast) {
        toast = document.createElement("div");
        toast.id = "postToolStatusToast";
        toast.className = "publish-toast";
        document.body.appendChild(toast);
    }

    toast.textContent = message;
    toast.classList.remove("is-success", "is-error", "is-visible");
    toast.classList.add(type === "error" ? "is-error" : "is-success");
    requestAnimationFrame(() => {
        toast.classList.add("is-visible");
    });
    window.setTimeout(() => {
        toast.classList.remove("is-visible");
    }, 2400);
}

function getPostToolPageName() {
    return document.querySelector(".page-selector-name")?.textContent?.trim() || "";
}

function getHidePageToken() {
    const panelToken = document.getElementById("hideTokenInputPanel")?.value?.trim() || "";
    const selectedToken = typeof getPageToken === "function" ? (getPageToken() || "") : "";
    return panelToken || selectedToken;
}

function getPostToolAccessToken() {
    const fromInjectedFn = typeof getInjectedAccessToken === "function"
        ? String(getInjectedAccessToken() || "").trim()
        : "";
    const fromStorage = String(
        localStorage.getItem("fewfeed_accessToken")
        || localStorage.getItem("fewfeed_token")
        || "",
    ).trim();
    const fromMemory = typeof fbToken !== "undefined"
        ? String(fbToken || "").trim()
        : "";

    return fromInjectedFn || fromStorage || fromMemory;
}

function getPostToolPageToken(pageId = "") {
    const normalizedPageId = String(pageId || "").trim();
    const loadedPageToken = typeof getLoadedPageToken === "function"
        ? String(getLoadedPageToken(normalizedPageId) || "").trim()
        : "";
    const selectedToken = typeof getPageToken === "function"
        ? String(getPageToken() || "").trim()
        : "";

    return loadedPageToken || selectedToken;
}

function getPostToolAuth(pageId = getCurrentPageId()) {
    const currentPageId = String(pageId || "").trim();
    return {
        postToken: getPostToolPageToken(currentPageId),
        hideToken: getHidePageToken(),
        accessToken: getPostToolAccessToken(),
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

function normalizePageIdCandidate(value) {
    const normalized = String(value || "").trim();
    if (!normalized || normalized === "-") return "";
    if (/^\d+$/.test(normalized)) return normalized;
    const match = normalized.match(/(\d{8,})/);
    return match ? match[1] : "";
}

function isPostToolGenericPageName(name = "", pageId = "") {
    const normalizedName = String(name || "").trim();
    const normalizedPageId = String(pageId || "").trim();
    if (!normalizedName) return true;

    const lowered = normalizedName.toLowerCase();
    if (["page", "unknown page", "saved page"].includes(lowered)) return true;
    if (normalizedPageId && normalizedName === normalizedPageId) return true;

    if (/^page\s+\d+$/i.test(normalizedName)) {
        if (!normalizedPageId) return true;
        return normalizedName.toLowerCase() === `page ${normalizedPageId}`.toLowerCase();
    }

    return false;
}

function resolvePostToolPageName(name = "", pageId = "") {
    const normalizedName = String(name || "").trim();
    const normalizedPageId = String(pageId || "").trim();
    if (!isPostToolGenericPageName(normalizedName, normalizedPageId)) {
        return normalizedName;
    }
    return normalizedPageId ? `เพจ ${normalizedPageId}` : "เพจไม่ทราบชื่อ";
}

function resolvePostToolPagePicture(picture = "", pageId = "") {
    const normalized = typeof picture === "string"
        ? picture.trim()
        : typeof picture === "object" && picture
            ? String(
                picture?.data?.url
                || picture?.url
                || picture?.picture?.data?.url
                || picture?.picture
                || "",
            ).trim()
            : "";
    if (normalized) return normalized;
    const normalizedPageId = String(pageId || "").trim();
    return normalizedPageId
        ? `https://graph.facebook.com/${normalizedPageId}/picture?type=small`
        : "";
}

function normalizeDeleteBatchSize(value, fallback = DELETE_BATCH_DEFAULT) {
    return Math.min(
        Math.max(getPostToolPositiveInt(value, fallback), DELETE_BATCH_MIN),
        DELETE_BATCH_MAX,
    );
}

function isPostToolFacebookAuthInvalidError(payload = {}) {
    const category = String(payload?.errorCategory || "").trim().toLowerCase();
    if (category === "facebook_auth_invalid") return true;

    const errorCode = Number(payload?.errorCode || payload?.error?.code || 0);
    const errorSubcode = Number(payload?.errorSubcode || payload?.error?.error_subcode || 0);
    const errorType = String(payload?.errorType || payload?.error?.type || "").trim().toLowerCase();
    const errorMessage = String(payload?.error || payload?.message || "").trim().toLowerCase();
    if (errorCode === 190) return true;
    if (errorCode === 102) return true;
    if ([460, 463, 467, 490].includes(errorSubcode)) return true;
    if (errorMessage.includes("error validating access token")) return true;
    if (errorMessage.includes("session has been invalidated")) return true;
    if (errorMessage.includes("invalid oauth access token")) return true;
    if (errorMessage.includes("cannot parse access token")) return true;
    if (errorMessage.includes("access token could not be decrypted")) return true;
    if (
        errorCode === 1 &&
        errorType === "oauthexception" &&
        (
            errorMessage.includes("access token")
            || errorMessage.includes("session has been invalidated")
            || errorMessage.includes("invalid oauth")
        )
    ) {
        return true;
    }
    return false;
}

async function tryRecoverPostToolFacebookSession(toolKey, { manual = false } = {}) {
    const state = postToolStates[toolKey];
    if (!state) return false;
    if (state.authRecoveryInFlight) return false;
    if (!manual && state.authRecoveryTried) return false;
    if (typeof syncWithExtensionNow !== "function") return false;

    state.authRecoveryInFlight = true;
    if (!manual) {
        state.authRecoveryTried = true;
    }

    try {
        // Access token can be invalidated server-side while local cache still has the old value.
        // Clear stale token first so extension refresh can replace it instead of reusing it.
        localStorage.setItem("fewfeed_accessToken", "");
        localStorage.setItem("fewfeed_token", "");
        if (typeof fbToken !== "undefined") {
            fbToken = "";
        }

        const synced = await syncWithExtensionNow({ forceRefresh: true });
        if (!synced) return false;

        if (toolKey === "delete") {
            await hydrateDeletePostToolPageOptions();
            syncDeletePostToolPageSelect();
        }

        return true;
    } catch (_) {
        return false;
    } finally {
        state.authRecoveryInFlight = false;
    }
}

function renderPostToolAuthInvalidState(toolKey, rawErrorMessage = "") {
    const dom = getPostToolDom(toolKey);
    if (!dom.tableContainer) return;

    const buttonId = `${toolKey}PostToolRecoverSessionBtn`;
    const detail = String(rawErrorMessage || "").trim();
    dom.tableContainer.innerHTML = `
        <div class="pending-empty">
            <div style="font-weight:700; margin-bottom:6px;">Session Facebook หมดอายุ</div>
            <div style="margin-bottom:10px;">ระบบพยายามรีเชื่อมอัตโนมัติแล้ว แต่ยังดึงโพสต์ไม่สำเร็จ</div>
            ${detail ? `<div style="font-size:12px;color:#6b7280;margin-bottom:10px;">รายละเอียด: ${escapePostToolHtml(detail)}</div>` : ""}
            <button type="button" class="post-tool-secondary-btn" id="${escapePostToolHtml(buttonId)}">เชื่อม Facebook ใหม่</button>
        </div>
    `;

    const recoverButton = document.getElementById(buttonId);
    if (!recoverButton) return;

    recoverButton.addEventListener("click", async () => {
        recoverButton.disabled = true;
        recoverButton.textContent = "กำลังเชื่อมใหม่...";
        const recovered = await tryRecoverPostToolFacebookSession(toolKey, { manual: true });
        if (recovered) {
            showPostToolStatusToast("เชื่อม Facebook ใหม่แล้ว กำลังโหลดโพสต์...", "success");
            loadPostToolPosts(toolKey);
            loadPostToolJobs(toolKey);
            return;
        }
        recoverButton.disabled = false;
        recoverButton.textContent = "เชื่อม Facebook ใหม่";
        showPostToolStatusToast("ยังเชื่อม Facebook ไม่สำเร็จ ลอง reload extension แล้วกดอีกครั้ง", "error");
    });
}

function getPostToolActivePageId(toolKey) {
    const currentPageId = normalizePageIdCandidate(getCurrentPageId());
    const savedPageId = normalizePageIdCandidate(localStorage.getItem("fewfeed_selectedPageId"));
    const previewPageId = normalizePageIdCandidate(document.getElementById("previewPageId")?.textContent || "");
    const selectedDropdownPageId = normalizePageIdCandidate(document.querySelector(".page-dropdown-item.selected")?.dataset?.pageId || "");
    const fallbackPageId = currentPageId || savedPageId || previewPageId || selectedDropdownPageId;

    if (toolKey === "delete") {
        const dom = getPostToolDom("delete");
        const selected = String(dom.pageSelect?.value || "").trim();
        if (selected) return selected;

        if (fallbackPageId && dom.pageSelect) {
            const hasOption = Array.from(dom.pageSelect.options || []).some((option) => String(option.value || "").trim() === fallbackPageId);
            if (!hasOption) {
                const option = document.createElement("option");
                option.value = fallbackPageId;
                const fallbackName = resolvePostToolPageName(String(
                    document.getElementById("previewPageName")?.textContent
                    || localStorage.getItem("fewfeed_selectedPageName")
                    || `เพจ ${fallbackPageId}`,
                ).trim(), fallbackPageId);
                option.textContent = `${fallbackName} • ${fallbackPageId}`;
                dom.pageSelect.appendChild(option);
            }
            dom.pageSelect.value = fallbackPageId;
            return fallbackPageId;
        }
    }
    return fallbackPageId;
}

function getDeleteToolCachedPagesFromStorage() {
    const currentUserId = String(localStorage.getItem("fewfeed_userId") || "").trim();
    const cacheOwnerId = String(localStorage.getItem("fewfeed_pageCacheUserId") || "").trim();
    if (currentUserId && cacheOwnerId && currentUserId !== cacheOwnerId) {
        return [];
    }

    try {
        const parsed = JSON.parse(localStorage.getItem("fewfeed_pageSummaryMap") || "{}");
        if (!parsed || typeof parsed !== "object") return [];

        return Object.values(parsed)
            .map((row) => {
                const pageId = String(row?.id || "").trim();
                if (!pageId) return null;
                return {
                    id: pageId,
                    name: resolvePostToolPageName(row?.name, pageId),
                    picture: resolvePostToolPagePicture(row?.picture, pageId),
                };
            })
            .filter(Boolean);
    } catch (_) {
        return [];
    }
}

function getDeleteToolPagesFromSidebarDom() {
    const seen = new Set();
    return Array.from(document.querySelectorAll(".page-dropdown-item[data-page-id]"))
        .map((item) => {
            const pageId = normalizePageIdCandidate(item?.dataset?.pageId || "");
            if (!pageId || seen.has(pageId)) return null;
            seen.add(pageId);

            const titleNode = item.querySelector("h4");
            const subtitleNode = item.querySelector("p");
            const avatarNode = item.querySelector("img");
            const titleText = String(titleNode?.textContent || "").trim();
            const subtitleText = String(subtitleNode?.textContent || "").trim();
            const fallbackName = resolvePostToolPageName(subtitleText, pageId);
            const resolvedName = isPostToolGenericPageName(titleText, pageId)
                ? fallbackName
                : titleText;
            const picture = String(avatarNode?.src || "").trim();

            return {
                id: pageId,
                name: resolvePostToolPageName(resolvedName, pageId),
                picture: resolvePostToolPagePicture(picture, pageId),
            };
        })
        .filter(Boolean);
}

async function fetchDeleteToolPagesFromApi(timeoutMs = 1800) {
    const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
    const timeoutHandle = controller
        ? setTimeout(() => controller.abort(), timeoutMs)
        : null;

    try {
        const response = await fetch("/api/pages", {
            cache: "no-store",
            signal: controller?.signal,
        });
        if (!response.ok) return [];
        const data = await response.json().catch(() => null);
        if (!data?.success || !Array.isArray(data.pages)) return [];
        return data.pages;
    } catch (_) {
        return [];
    } finally {
        if (timeoutHandle) clearTimeout(timeoutHandle);
    }
}

async function hydrateDeletePostToolPageOptions() {
    const state = postToolStates.delete;
    const dom = getPostToolDom("delete");
    if (!dom.pageSelect) return;

    const currentValue = String(dom.pageSelect.value || "").trim();
    const optionsById = new Map();
    const pushOption = (id, name, picture = "") => {
        const normalizedId = String(id || "").trim();
        if (!normalizedId) return;

        const resolvedName = resolvePostToolPageName(name, normalizedId);
        const resolvedPicture = resolvePostToolPagePicture(picture, normalizedId);
        const existing = optionsById.get(normalizedId);
        if (!existing) {
            optionsById.set(normalizedId, {
                id: normalizedId,
                name: resolvedName,
                picture: resolvedPicture,
            });
            return;
        }

        const shouldReplaceName = isPostToolGenericPageName(existing.name, normalizedId)
            && !isPostToolGenericPageName(resolvedName, normalizedId);
        if (shouldReplaceName) {
            existing.name = resolvedName;
        }
        if (!existing.picture && resolvedPicture) {
            existing.picture = resolvedPicture;
        }
    };

    const globalPageSelect = document.getElementById("pageSelect");
    if (globalPageSelect) {
        Array.from(globalPageSelect.options || []).forEach((option) => {
            pushOption(option.value, option.textContent);
        });
    }

    const sidebarPages = getDeleteToolPagesFromSidebarDom();
    sidebarPages.forEach((page) => {
        pushOption(page.id, page.name, page.picture);
    });

    const apiPages = await fetchDeleteToolPagesFromApi();
    apiPages.forEach((page) => {
        const pageId = page.id || page.page_id;
        const picture = page?.picture?.data?.url || page?.picture_url || "";
        pushOption(pageId, page.name || page.page_name, picture);
    });

    const cachedPages = getDeleteToolCachedPagesFromStorage();
    cachedPages.forEach((page) => {
        pushOption(page.id, page.name, page.picture);
    });

    const savedPageId = String(localStorage.getItem("fewfeed_selectedPageId") || "").trim();
    const savedPageName = String(localStorage.getItem("fewfeed_selectedPageName") || "").trim();
    const savedPagePicture = String(localStorage.getItem("fewfeed_selectedPagePicture") || "").trim();
    if (savedPageId) {
        pushOption(savedPageId, savedPageName || `เพจ ${savedPageId}`, savedPagePicture);
    }

    const finalCurrentPageId = String(getCurrentPageId() || "").trim();
    if (finalCurrentPageId) {
        pushOption(
            finalCurrentPageId,
            String(document.querySelector(".page-selector-name")?.textContent || "").trim() || `เพจ ${finalCurrentPageId}`,
            String(document.getElementById("previewAvatarImg")?.src || "").trim(),
        );
    }

    const previewPageId = normalizePageIdCandidate(document.getElementById("previewPageId")?.textContent || "");
    if (previewPageId) {
        const previewPageName = String(document.getElementById("previewPageName")?.textContent || "").trim();
        pushOption(
            previewPageId,
            previewPageName || savedPageName || `เพจ ${previewPageId}`,
            String(document.getElementById("previewAvatarImg")?.src || "").trim(),
        );
    }

    const entries = Array.from(optionsById.entries());
    dom.pageSelect.innerHTML = entries.length
        ? `<option value="">-- เลือกเพจ --</option>${entries
            .map(([id, page]) => `<option value="${escapePostToolHtml(id)}">${escapePostToolHtml(`${page.name} • ${id}`)}</option>`)
            .join("")}`
        : '<option value="">-- เลือกเพจ --</option>';

    const preferredValue = currentValue || finalCurrentPageId || savedPageId;
    if (preferredValue && !optionsById.has(preferredValue)) {
        pushOption(
            preferredValue,
            String(document.getElementById("previewPageName")?.textContent || "").trim()
            || savedPageName
            || `เพจ ${preferredValue}`,
            String(document.getElementById("previewAvatarImg")?.src || "").trim(),
        );
        dom.pageSelect.innerHTML = `<option value="">-- เลือกเพจ --</option>${Array.from(optionsById.entries())
            .map(([id, page]) => `<option value="${escapePostToolHtml(id)}">${escapePostToolHtml(`${page.name} • ${id}`)}</option>`)
            .join("")}`;
    }

    if (preferredValue && optionsById.has(preferredValue)) {
        dom.pageSelect.value = preferredValue;
    }

    state.pageMetaById = Object.fromEntries(
        Array.from(optionsById.entries()).map(([id, page]) => [
            id,
            {
                id,
                name: resolvePostToolPageName(page?.name, id),
                picture: resolvePostToolPagePicture(page?.picture, id),
            },
        ]),
    );
    updateDeletePageFilterPreview();
}

function ensureDeletePageFilterPreviewElement() {
    const dom = getPostToolDom("delete");
    if (!dom.pageSelect) return null;

    let preview = dom.panel?.querySelector("#deletePostsPagePreview");
    if (preview) return preview;

    preview = document.createElement("div");
    preview.id = "deletePostsPagePreview";
    preview.style.display = "none";
    preview.style.alignItems = "center";
    preview.style.gap = "8px";
    preview.style.padding = "6px 10px";
    preview.style.border = "1px solid #e5e7eb";
    preview.style.borderRadius = "10px";
    preview.style.background = "#ffffff";
    preview.style.minHeight = "42px";
    preview.style.maxWidth = "340px";
    preview.style.flex = "0 1 auto";

    dom.pageSelect.insertAdjacentElement("afterend", preview);
    return preview;
}

function updateDeletePageFilterPreview() {
    const dom = getPostToolDom("delete");
    if (!dom.pageSelect) return;
    const preview = ensureDeletePageFilterPreviewElement();
    if (!preview) return;

    const selectedPageId = String(dom.pageSelect.value || "").trim();
    const pageMeta = postToolStates.delete.pageMetaById?.[selectedPageId];
    if (!selectedPageId || !pageMeta) {
        preview.style.display = "none";
        preview.innerHTML = "";
        return;
    }

    const displayName = resolvePostToolPageName(pageMeta.name, selectedPageId);
    const pictureUrl = resolvePostToolPagePicture(pageMeta.picture, selectedPageId);
    preview.style.display = "inline-flex";
    preview.innerHTML = `
        <img src="${escapePostToolHtml(pictureUrl)}" alt="${escapePostToolHtml(displayName)}"
             style="width:24px;height:24px;border-radius:50%;object-fit:cover;background:#f3f4f6;flex-shrink:0;" />
        <div style="min-width:0;">
            <div style="font-size:12px;font-weight:700;color:#111827;line-height:1.2;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
                ${escapePostToolHtml(displayName)}
            </div>
            <div style="font-size:11px;color:#6b7280;line-height:1.2;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
                ${escapePostToolHtml(selectedPageId)}
            </div>
        </div>
    `;
}

function syncDeletePostToolPageSelect() {
    const state = postToolStates.delete;
    const dom = getPostToolDom("delete");
    const globalPageSelect = document.getElementById("pageSelect");
    if (!dom.pageSelect || !globalPageSelect) return;

    const isGlobalSelect = String(globalPageSelect.tagName || "").toUpperCase() === "SELECT";
    if (isGlobalSelect) {
        const hasOptions = Array.isArray(globalPageSelect.options) ? globalPageSelect.options.length > 0 : globalPageSelect.options?.length > 0;
        const globalOptionsHtml = globalPageSelect.innerHTML;
        if (hasOptions && globalOptionsHtml && dom.pageSelect.innerHTML !== globalOptionsHtml) {
            dom.pageSelect.innerHTML = globalOptionsHtml;
        }
    }

    const globalValue = String(globalPageSelect.value || "").trim();
    if (globalValue) {
        const hasOption = Array.from(dom.pageSelect.options || []).some((option) => String(option.value || "").trim() === globalValue);
        if (!hasOption) {
            const option = document.createElement("option");
            option.value = globalValue;
            const fallbackName = resolvePostToolPageName(String(
                localStorage.getItem("fewfeed_selectedPageName")
                || document.querySelector(".page-selector-name")?.textContent
                || `เพจ ${globalValue}`,
            ).trim(), globalValue);
            option.textContent = `${fallbackName} • ${globalValue}`;
            dom.pageSelect.appendChild(option);
            state.pageMetaById[globalValue] = {
                id: globalValue,
                name: fallbackName,
                picture: resolvePostToolPagePicture(
                    String(localStorage.getItem("fewfeed_selectedPagePicture") || "").trim(),
                    globalValue,
                ),
            };
        }
        dom.pageSelect.value = globalValue;
    }
    updateDeletePageFilterPreview();
}

function getPostToolCoverageTargetDate(state) {
    if (state.filters.customDate) {
        const range = postToolDateRangeFilterUtils.parseRange(state.filters.customDate);
        const target = postToolDateRangeFilterUtils.createBoundary(range.start, "start");
        return target ? target.getTime() : null;
    }
    if (state.filters.clearBefore) {
        const target = parsePostToolDate(state.filters.clearBefore);
        return target ? target.getTime() : null;
    }

    const today = new Date();
    switch (state.filters.day) {
        case "last7": {
            const target = new Date(today);
            target.setDate(target.getDate() - 6);
            target.setHours(0, 0, 0, 0);
            return target.getTime();
        }
        case "last30": {
            const target = new Date(today);
            target.setDate(target.getDate() - 29);
            target.setHours(0, 0, 0, 0);
            return target.getTime();
        }
        case "thisMonth": {
            const target = new Date(today.getFullYear(), today.getMonth(), 1);
            target.setHours(0, 0, 0, 0);
            return target.getTime();
        }
        case "thisYear": {
            const target = new Date(today.getFullYear(), 0, 1);
            target.setHours(0, 0, 0, 0);
            return target.getTime();
        }
        default:
            break;
    }

    return null;
}

function getPostToolOldestLoadedTime(state) {
    let oldest = null;
    for (const post of state.posts) {
        const date = parsePostToolDate(post.published_at || post.created_at);
        const ts = date ? date.getTime() : null;
        if (ts === null) continue;
        if (oldest === null || ts < oldest) oldest = ts;
    }
    return oldest;
}

async function ensurePostToolDateCoverage(toolKey) {
    const state = postToolStates[toolKey];
    const targetTime = getPostToolCoverageTargetDate(state);
    if (targetTime === null) return;
    if (!state.pagination.hasMore || !state.pagination.nextCursor) return;

    let guard = 0;
    while (guard < 24) {
        const oldestTime = getPostToolOldestLoadedTime(state);
        if (oldestTime !== null && oldestTime <= targetTime) {
            break;
        }
        if (!state.pagination.hasMore || !state.pagination.nextCursor) {
            break;
        }
        // Keep fetching older pages until we reach the selected date window or run out of data.
        await loadPostToolPosts(toolKey, { silent: true, append: true, skipDateCoverage: true });
        guard += 1;
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
    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
    monthStart.setHours(0, 0, 0, 0);
    const yearStart = new Date(today.getFullYear(), 0, 1);
    yearStart.setHours(0, 0, 0, 0);

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
        if (state.filters.customDate) {
            return postToolDateRangeFilterUtils.includes(date, state.filters.customDate);
        }

        const dateKey = getPostToolDateKey(date);

        switch (state.filters.day) {
            case "today":
                return dateKey === todayKey;
            case "last7":
                return date && date >= last7Limit;
            case "last30":
                return date && date >= last30Limit;
            case "thisMonth":
                return date && date >= monthStart;
            case "thisYear":
                return date && date >= yearStart;
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
    const hiddenCount = state.posts.filter((post) => post.is_hidden === true).length;
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

    if (toolKey === "delete") {
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
                <span class="pending-stat-label">วันนี้ / ซ่อนแล้ว</span>
                <span class="pending-stat-value">${todayCount} / ${hiddenCount}</span>
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

    const rangeLabel = postToolDateRangeFilterUtils.getLabel(postToolStates[toolKey].filters.customDate);
    if (rangeLabel) {
        dom.filterMeta.textContent = toolKey === "hide" && filteredCount !== eligibleCount
            ? `${rangeLabel} พบ ${eligibleCount} รายการ (กันไว้ ${filteredCount - eligibleCount})`
            : `${rangeLabel} พบ ${filteredCount} รายการ`;
        return;
    }

    if (toolKey === "hide" && filteredCount !== eligibleCount) {
        dom.filterMeta.textContent = `แสดง ${eligibleCount} / ${totalCount} รายการ (กันไว้ ${filteredCount - eligibleCount})`;
        return;
    }

    if (toolKey === "delete") {
        const hiddenInFiltered = getPostToolFilteredPosts(toolKey).filter((post) => post.is_hidden === true).length;
        const baseText = filteredCount === totalCount
            ? `แสดง ${totalCount} รายการ`
            : `แสดง ${filteredCount} / ${totalCount} รายการ`;
        dom.filterMeta.textContent = hiddenInFiltered > 0
            ? `${baseText} • ซ่อนแล้ว ${hiddenInFiltered} รายการ`
            : baseText;
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
    const hasActionablePage = toolKey !== "delete" || !!getPostToolActivePageId(toolKey);
    dom.runBtn.disabled = selectedCount === 0 || state.loading || !hasActionablePage;
    dom.runBtn.title = hasActionablePage ? "" : "เลือกเพจหลักก่อนลบโพสต์";
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

function renderDeleteBatchPresets() {
    const state = postToolStates.delete;
    const dom = getPostToolDom("delete");
    if (!dom.batchPresets) return;

    const current = normalizeDeleteBatchSize(state.filters.batchSize, DELETE_BATCH_DEFAULT);
    dom.batchPresets.querySelectorAll("[data-batch-size]").forEach((button) => {
        const size = normalizeDeleteBatchSize(button.dataset.batchSize, 0);
        button.classList.toggle("is-active", size === current);
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

function getPostToolJobStatusTone(status) {
    const normalized = String(status || "").trim().toLowerCase();
    if (normalized === "completed") return "completed";
    if (normalized === "failed" || normalized === "cancelled") return "failed";
    if (normalized === "processing" || normalized === "pending") return "processing";
    return "idle";
}

function getPostToolJobStatusLabel(status) {
    const normalized = String(status || "").trim().toLowerCase();
    if (normalized === "completed") return "ลบเสร็จแล้ว";
    if (normalized === "failed") return "ลบไม่สำเร็จ";
    if (normalized === "cancelled") return "ยกเลิกงานแล้ว";
    if (normalized === "processing") return "กำลังลบโพสต์";
    if (normalized === "pending") return "กำลังเตรียมลบโพสต์";
    return "รอสถานะล่าสุด";
}

function renderPostToolExecutionStatus(toolKey) {
    const dom = getPostToolDom(toolKey);
    const state = postToolStates[toolKey];
    if (!dom.statusPanel) return;

    if (toolKey !== "delete") {
        dom.statusPanel.style.display = "none";
        return;
    }

    dom.statusPanel.style.display = "";
    const jobs = Array.isArray(state.jobs) ? state.jobs : [];
    let activeJob = null;
    if (state.activeJobId) {
        activeJob = jobs.find((job) => Number(job.id || 0) === Number(state.activeJobId || 0)) || null;
    }
    if (!activeJob && jobs.length) {
        activeJob = jobs[0];
        state.activeJobId = Number(activeJob.id || 0);
    }

    if (!activeJob) {
        dom.statusPanel.className = "post-tool-run-status is-idle";
        dom.statusPanel.innerHTML = `
            <div class="post-tool-run-status-head">
                <span class="post-tool-run-status-badge is-idle">รอสถานะล่าสุด</span>
            </div>
            <div class="post-tool-run-status-main">ยังไม่มีงานลบล่าสุด</div>
            <div class="post-tool-run-status-sub">เลือกโพสต์แล้วกด "ลบที่เลือก" ระบบจะแสดงผลสำเร็จ/ล้มเหลวของแต่ละโพสต์ให้ทันที</div>
        `;
        return;
    }

    const jobId = Number(activeJob.id || 0);
    const status = String(activeJob.status || "").trim().toLowerCase();
    const tone = getPostToolJobStatusTone(status);
    const label = getPostToolJobStatusLabel(status);
    const total = Number(activeJob.total_count || 0);
    const processed = Number(activeJob.processed_count || 0);
    const success = Number(activeJob.success_count || 0);
    const failed = Number(activeJob.failed_count || 0);
    const createdAt = String(activeJob.created_at || "").trim();
    const createdAtLabel = createdAt
        ? new Date(createdAt).toLocaleString("th-TH", { dateStyle: "short", timeStyle: "short" })
        : "-";
    let mainMessage = `${label} ${processed}/${total || processed} รายการ`;
    if (status === "completed") {
        mainMessage = failed > 0
            ? `ลบเสร็จแล้ว: สำเร็จ ${success} • ไม่สำเร็จ ${failed}`
            : `ลบสำเร็จครบ ${success}/${total || success} รายการ`;
    } else if (status === "failed") {
        mainMessage = `ลบไม่สำเร็จ: สำเร็จ ${success} • ไม่สำเร็จ ${failed}`;
    } else if (status === "cancelled") {
        mainMessage = `ยกเลิกแล้ว: สำเร็จ ${success} • ค้าง/ไม่สำเร็จ ${Math.max(0, total - success)}`;
    }

    dom.statusPanel.className = `post-tool-run-status is-${tone}`;
    dom.statusPanel.innerHTML = `
        <div class="post-tool-run-status-head">
            <span class="post-tool-run-status-badge is-${tone}">${escapePostToolHtml(label)}</span>
            <span class="post-tool-run-status-meta">Job #${jobId} • ${escapePostToolHtml(createdAtLabel)}</span>
        </div>
        <div class="post-tool-run-status-main">${escapePostToolHtml(mainMessage)}</div>
        <div class="post-tool-run-status-sub">สำเร็จ ${success} • ไม่สำเร็จ ${failed} • ทั้งหมด ${total || processed}</div>
        ${failed > 0 ? `<div class="post-tool-run-status-fail-loading">เฟล ${failed} รายการ</div>` : ""}
    `;
}

function maybeNotifyPostToolJobCompletion(toolKey) {
    const state = postToolStates[toolKey];
    if (toolKey !== "delete") return;

    const activeJob = state.jobs.find((job) => Number(job.id || 0) === Number(state.activeJobId || 0));
    if (!activeJob) return;

    const status = String(activeJob.status || "").trim().toLowerCase();
    if (!["completed", "failed", "cancelled"].includes(status)) return;

    const key = [
        activeJob.id,
        status,
        activeJob.processed_count,
        activeJob.success_count,
        activeJob.failed_count,
    ].join(":");
    if (state.lastJobToastKey === key) return;
    state.lastJobToastKey = key;

    const success = Number(activeJob.success_count || 0);
    const failed = Number(activeJob.failed_count || 0);
    if (status === "completed" && failed === 0) {
        showPostToolStatusToast(`ลบโพสต์สำเร็จ ${success} รายการ`, "success");
        return;
    }

    if (status === "cancelled") {
        showPostToolStatusToast(`ยกเลิกงานลบโพสต์ (สำเร็จ ${success} • ไม่สำเร็จ ${failed})`, "error");
        return;
    }

    showPostToolStatusToast(`งานลบจบแล้ว: สำเร็จ ${success} • ลบไม่ได้ ${failed}`, failed > 0 ? "error" : "success");
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

async function reconcilePostToolSuccessfulItems(toolKey) {
    const state = postToolStates[toolKey];
    if (!state.loaded || !state.posts.length || !state.jobs.length) return;

    const terminalStatuses = new Set(["completed", "failed", "cancelled"]);
    const targetJobs = state.jobs.filter((job) => {
        const jobId = Number(job.id || 0);
        if (!jobId) return false;
        if (state.reconciledJobIds.has(jobId)) return false;
        if (!terminalStatuses.has(String(job.status || "").trim())) return false;
        return Number(job.success_count || 0) > 0;
    });

    if (!targetJobs.length) return;

    const removedIds = new Set();
    for (const job of targetJobs) {
        const jobId = Number(job.id || 0);
        if (!jobId) continue;
        let loaded = false;

        try {
            const response = await fetch(`/api/post-action-jobs/${jobId}`);
            const data = await response.json();
            if (data.success && Array.isArray(data.items)) {
                loaded = true;
                data.items
                    .filter((item) => String(item.status || "") === "success")
                    .forEach((item) => {
                        const postId = String(item.post_id || "").trim();
                        if (postId) removedIds.add(postId);
                    });
            }
        } catch (_) {
            // Ignore detail fetch errors and retry in next poll.
            continue;
        }
        if (loaded) {
            state.reconciledJobIds.add(jobId);
        }
    }

    if (!removedIds.size) return;

    removedIds.forEach((postId) => state.localRemovedIds.add(postId));
    state.posts = state.posts.filter((post) => !state.localRemovedIds.has(getPostToolItemId(post)));
    prunePostToolSelection(toolKey);
    renderPostToolTable(toolKey);
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
        if (toolKey === "delete" && post.is_hidden === true) {
            const hiddenBadge = document.createElement("div");
            hiddenBadge.className = "post-tool-protection-badge";
            hiddenBadge.textContent = "ซ่อนจากหน้าเพจแล้ว";
            copyWrap.appendChild(hiddenBadge);
        }
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
        const emptyText = state.loaded
            ? (toolKey === "delete" && !state.pageId
                ? "ไม่พบโพสต์ในประวัติระบบของ workspace นี้"
                : "ไม่พบโพสต์จากเพจนี้")
            : postToolConfigs[toolKey].empty;
        dom.tableContainer.innerHTML = `<div class="pending-empty">${emptyText}</div>`;
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
    postToolDateRangeFilterUtils.syncInputValue(dom.dateInput, state.filters.customDate);
    if (dom.clearBeforeInput) dom.clearBeforeInput.value = state.filters.clearBefore;
    if (dom.batchSizeInput) dom.batchSizeInput.value = String(normalizeDeleteBatchSize(state.filters.batchSize, DELETE_BATCH_DEFAULT));
    if (dom.keepLatestToggle) dom.keepLatestToggle.checked = Boolean(state.safeguards.keepLatestEnabled);
    if (dom.keepLatestInput) dom.keepLatestInput.value = String(getPostToolPositiveInt(state.safeguards.keepLatestCount, 10));
    if (dom.minAgeToggle) dom.minAgeToggle.checked = Boolean(state.safeguards.minAgeEnabled);
    if (dom.minAgeInput) dom.minAgeInput.value = String(getPostToolPositiveInt(state.safeguards.minAgeDays, 7));
    renderPostToolDayFilters(toolKey);
    renderPostToolPagination(toolKey);
    if (toolKey === "delete") renderDeleteBatchPresets();
    if (toolKey === "delete") syncDeletePostToolPageSelect();
    if (toolKey === "delete") updateDeletePageFilterPreview();
}

function autoSelectDeletePostsByRule() {
    const toolKey = "delete";
    const state = postToolStates[toolKey];
    const batchSize = normalizeDeleteBatchSize(state.filters.batchSize, DELETE_BATCH_DEFAULT);
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

async function loadPostToolPosts(toolKey, { silent = false, append = false, skipDateCoverage = false } = {}) {
    const state = postToolStates[toolKey];
    const dom = getPostToolDom(toolKey);
    let pageId = getPostToolActivePageId(toolKey);
    const allowWorkspaceHistoryFallback = toolKey === "delete";

    if (allowWorkspaceHistoryFallback && !pageId) {
        await hydrateDeletePostToolPageOptions();
        syncDeletePostToolPageSelect();
        pageId = getPostToolActivePageId(toolKey);
    }

    if (!pageId && !allowWorkspaceHistoryFallback) {
        state.posts = [];
        state.selectedIds.clear();
        state.loaded = false;
        state.pageId = "";
        resetPostToolStateDefaults(toolKey);
        if (dom.summaryBar) dom.summaryBar.innerHTML = "";
        if (dom.tableContainer) {
            dom.tableContainer.innerHTML = '<div class="pending-empty">กำลังรอเพจหลัก... ถ้ายังไม่ขึ้นให้เลือกเพจที่ sidebar ก่อน</div>';
        }
        renderPostToolSafeguardMeta(toolKey, [], []);
        renderPostToolPagination(toolKey);
        return;
    }

    state.pageResolveAttempts = 0;

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
        if (state.pagination.loadingMore) {
            state.pendingReload = true;
            return;
        }
        if (state.loading) {
            state.pendingReload = true;
            return;
        }
        state.loading = true;
        state.pendingReload = false;
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
        const renderLoadError = (rawMessage = "", { appendMode = false } = {}) => {
            const message = String(rawMessage || "").trim() || "ไม่สามารถโหลดโพสต์ได้ในตอนนี้";
            if (appendMode && dom.loadMoreMeta) {
                dom.loadMoreMeta.textContent = `โหลดเพิ่มไม่สำเร็จ: ${message}`;
                return;
            }
            if (dom.tableContainer) {
                dom.tableContainer.innerHTML = `
                    <div class="pending-empty">
                        โหลดโพสต์ไม่สำเร็จ
                        <div style="margin-top:6px;font-size:12px;color:#6b7280;">${escapePostToolHtml(message)}</div>
                    </div>
                `;
            }
        };

        const handleAuthInvalid = async (payload = {}, rawMessage = "") => {
            const friendlyMessage = String(rawMessage || payload?.error || payload?.message || "").trim();
            const recovered = await tryRecoverPostToolFacebookSession(toolKey);
            if (recovered) {
                showPostToolStatusToast("รีเชื่อม Facebook ใหม่แล้ว กำลังโหลดโพสต์อีกครั้ง...", "success");
                state.pendingReload = true;
                return true;
            }
            if (append && dom.loadMoreMeta) {
                dom.loadMoreMeta.textContent = "Session Facebook หมดอายุ กดเชื่อม Facebook ใหม่แล้วโหลดอีกครั้ง";
                return true;
            }
            renderPostToolAuthInvalidState(toolKey, friendlyMessage);
            return true;
        };

        const auth = getPostToolAuth(pageId);
        let fetchSource = "merged";
        if (toolKey === "delete") {
            // Delete tool must use live Facebook list only to avoid showing stale
            // history rows that were already removed from the page.
            fetchSource = pageId ? "facebook" : "history";
        }
        const response = await fetch("/api/published-posts", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({
                pageId: String(pageId || "").trim(),
                source: fetchSource,
                limit: 100,
                after: append ? state.pagination.nextCursor : "",
                pageToken: auth.postToken,
                accessToken: auth.accessToken,
                cookieData: auth.cookieData,
            }),
        });
        const data = await response.json();

        if (!data.success) {
            if (isPostToolFacebookAuthInvalidError(data)) {
                const handled = await handleAuthInvalid(data, data.error);
                if (handled) return;
            }
            renderLoadError(data.error || "Unknown error", { appendMode: append });
            return;
        }

        const incomingPosts = Array.isArray(data.logs) ? data.logs : [];
        state.authRecoveryTried = false;
        state.posts = append ? mergePostToolPosts(state.posts, incomingPosts) : incomingPosts;
        if (state.localRemovedIds.size) {
            state.posts = state.posts.filter((post) => !state.localRemovedIds.has(getPostToolItemId(post)));
        }
        state.loaded = true;
        state.pagination.nextCursor = String(data.meta?.nextCursor || "").trim();
        state.pagination.hasMore = Boolean(data.meta?.hasMore && state.pagination.nextCursor);
        state.pagination.lastBatchCount = incomingPosts.length;
        prunePostToolSelection(toolKey);
        syncPostToolInputs(toolKey);
        renderPostToolTable(toolKey);
        if (!incomingPosts.length && !append && dom.loadMoreMeta) {
            const sourceLabel = String(data.meta?.source || "").trim();
            if (toolKey === "delete" && !pageId) {
                dom.loadMoreMeta.textContent = "ยังไม่ได้เลือกเพจหลัก แสดงรายการจากประวัติระบบเท่าที่มีอยู่";
            } else if (sourceLabel === "history") {
                dom.loadMoreMeta.textContent = "ไม่พบโพสต์จาก Facebook ตอนนี้ แสดงเฉพาะโพสต์ที่มีในประวัติระบบ";
            }
        }
        if (!skipDateCoverage && !append) {
            await ensurePostToolDateCoverage(toolKey);
            renderPostToolTable(toolKey);
        }
    } catch (error) {
        const message = error?.message || String(error || "");
        if (isPostToolFacebookAuthInvalidError({ error: message })) {
            const handled = await tryRecoverPostToolFacebookSession(toolKey);
            if (handled) {
                showPostToolStatusToast("รีเชื่อม Facebook ใหม่แล้ว กำลังโหลดโพสต์อีกครั้ง...", "success");
                state.pendingReload = true;
            } else if (append && dom.loadMoreMeta) {
                dom.loadMoreMeta.textContent = "Session Facebook หมดอายุ กดเชื่อม Facebook ใหม่แล้วโหลดอีกครั้ง";
            } else {
                renderPostToolAuthInvalidState(toolKey, message);
            }
        } else if (append && dom.loadMoreMeta) {
            dom.loadMoreMeta.textContent = `โหลดเพิ่มไม่สำเร็จ: ${message}`;
        } else if (dom.tableContainer) {
            dom.tableContainer.innerHTML = `
                <div class="pending-empty">
                    โหลดโพสต์ไม่สำเร็จ
                    <div style="margin-top:6px;font-size:12px;color:#6b7280;">${escapePostToolHtml(message)}</div>
                </div>
            `;
        }
    } finally {
        state.loading = false;
        state.pagination.loadingMore = false;
        renderPostToolPagination(toolKey);
        if (state.pendingReload && !state.loading && !state.pagination.loadingMore) {
            state.pendingReload = false;
            loadPostToolPosts(toolKey, { silent: true });
        }
    }
}

function renderPostToolJobs(toolKey) {
    const state = postToolStates[toolKey];
    const dom = getPostToolDom(toolKey);
    if (!dom.jobsContainer) return;

    if (!state.jobs.length) {
        dom.jobsContainer.innerHTML = '<div class="post-tool-empty">ยังไม่มีงานล่าสุด</div>';
        renderPostToolExecutionStatus(toolKey);
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
            state.activeJobId = jobId;

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
            state.activeJobId = jobId;
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
            state.activeJobId = jobId;
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
            state.activeJobId = jobId;
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

    renderPostToolExecutionStatus(toolKey);
}

function updatePostToolPolling(toolKey) {
    const state = postToolStates[toolKey];
    const hasRunningJob = state.jobs.some((job) => job.status === "pending" || job.status === "processing");

    if (hasRunningJob && !state.pollHandle) {
        state.pollHandle = setInterval(async () => {
            await loadPostToolJobs(toolKey);
            if (toolKey !== "delete") {
                await refreshExpandedPostToolJobDetails(toolKey);
            }
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
    const pageId = getPostToolActivePageId(toolKey);
    if (!pageId) {
        state.jobs = [];
        state.jobDetails = {};
        state.expandedJobIds = new Set();
        renderPostToolJobs(toolKey);
        renderPostToolExecutionStatus(toolKey);
        return;
    }

    try {
        const response = await fetch(`/api/post-action-jobs?pageId=${encodeURIComponent(pageId)}&action=${encodeURIComponent(postToolConfigs[toolKey].action)}&limit=8`);
        const data = await response.json();
        state.jobs = data.success && Array.isArray(data.jobs) ? data.jobs : [];
        if (state.activeJobId && !state.jobs.some((job) => Number(job.id || 0) === Number(state.activeJobId))) {
            state.activeJobId = 0;
        }
        if (!state.activeJobId && state.jobs.length > 0) {
            state.activeJobId = Number(state.jobs[0].id || 0);
        }
        await reconcilePostToolSuccessfulItems(toolKey);
        renderPostToolJobs(toolKey);
        maybeNotifyPostToolJobCompletion(toolKey);
        updatePostToolPolling(toolKey);
    } catch (_) {
        state.jobs = [];
        renderPostToolJobs(toolKey);
        renderPostToolExecutionStatus(toolKey);
    }
}

async function runPostToolAction(toolKey) {
    const state = postToolStates[toolKey];
    const eligible = getPostToolEligibleFilteredPosts(toolKey);
    const selectedPosts = eligible.filter((post) => state.selectedIds.has(getPostToolItemId(post)));
    const batchSize = normalizeDeleteBatchSize(state.filters.batchSize, DELETE_BATCH_DEFAULT);

    if (!selectedPosts.length) {
        alert("เลือกโพสต์ก่อน");
        return;
    }

    if (toolKey === "delete" && selectedPosts.length > batchSize) {
        alert(`ตั้งค่าให้ลบทีละ ${batchSize} โพสต์ แต่ตอนนี้เลือกไว้ ${selectedPosts.length} โพสต์\nกรุณาลดจำนวนที่เลือก หรือกด "เลือกตามวันเวลา + จำนวน"`);
        return;
    }

    const pageId = getPostToolActivePageId(toolKey);
    if (toolKey === "delete" && !pageId) {
        alert("เลือกเพจหลักก่อนลบโพสต์");
        return;
    }

    if (!postToolConfigs[toolKey].confirm(selectedPosts.length)) {
        return;
    }

    const auth = getPostToolAuth(pageId);

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

        state.activeJobId = Number(data.jobId || 0);
        if (state.activeJobId) {
            state.expandedJobIds.add(state.activeJobId);
            showPostToolStatusToast(`เริ่มงานลบโพสต์ ${selectedPosts.length} รายการแล้ว`, "success");
        }
        state.selectedIds.clear();
        renderPostToolTable(toolKey);
        await loadPostToolJobs(toolKey);
        if (toolKey !== "delete" && state.activeJobId) {
            await loadPostToolJobDetail(toolKey, state.activeJobId);
        }
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
        if (toolKey === "delete") {
            hydrateDeletePostToolPageOptions()
                .then(() => syncDeletePostToolPageSelect())
                .catch(() => {});
        }
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
        postToolDateRangeFilterUtils.syncInputValue(dom.dateInput, "");
        if (dom.clearBeforeInput) dom.clearBeforeInput.value = "";
        renderPostToolDayFilters(toolKey);
        renderPostToolTable(toolKey);
        loadPostToolPosts(toolKey, { silent: true });
    });

    dom.dateInput?.addEventListener("change", (event) => {
        state.filters.customDate = postToolDateRangeFilterUtils.normalizeValue(event.target.value || "");
        if (state.filters.customDate) {
            state.filters.clearBefore = "";
            if (dom.clearBeforeInput) dom.clearBeforeInput.value = "";
        }
        renderPostToolDayFilters(toolKey);
        renderPostToolTable(toolKey);
        loadPostToolPosts(toolKey, { silent: true });
    });

    dom.pageSelect?.addEventListener("change", () => {
        const globalPageSelect = document.getElementById("pageSelect");
        const nextPageId = String(dom.pageSelect.value || "");
        if (!nextPageId) {
            updateDeletePageFilterPreview();
            return;
        }

        if (globalPageSelect) {
            const currentGlobalValue = String(globalPageSelect.value || "");
            if (currentGlobalValue !== nextPageId) {
                globalPageSelect.value = nextPageId;
                globalPageSelect.dispatchEvent(new Event("change"));
            }
        }

        updateDeletePageFilterPreview();
        loadPostToolPosts(toolKey);
        loadPostToolJobs(toolKey);
    });

    if (toolKey === "delete") {
        const globalPageSelect = document.getElementById("pageSelect");
        if (globalPageSelect && globalPageSelect.dataset.deleteToolSyncBound !== "true") {
            globalPageSelect.dataset.deleteToolSyncBound = "true";
            globalPageSelect.addEventListener("change", async () => {
                await hydrateDeletePostToolPageOptions();
                syncDeletePostToolPageSelect();
                if (dom.panel && dom.panel.style.display !== "none") {
                    loadPostToolPosts("delete");
                    loadPostToolJobs("delete");
                }
            });
        }

        if (dom.panel && dom.panel.dataset.pagesUpdatedBound !== "true") {
            dom.panel.dataset.pagesUpdatedBound = "true";
            window.addEventListener("pubilo:pages-updated", async () => {
                await hydrateDeletePostToolPageOptions();
                syncDeletePostToolPageSelect();
                if (dom.panel.style.display !== "none") {
                    renderPostToolTable("delete");
                }
            });
        }
    }

    dom.clearBeforeInput?.addEventListener("change", (event) => {
        state.filters.clearBefore = event.target.value || "";
        if (state.filters.clearBefore) {
            state.filters.customDate = "";
            state.filters.day = "all";
            postToolDateRangeFilterUtils.syncInputValue(dom.dateInput, "");
        }
        renderPostToolDayFilters(toolKey);
        renderPostToolTable(toolKey);
        loadPostToolPosts(toolKey, { silent: true });
    });

    dom.batchSizeInput?.addEventListener("input", (event) => {
        state.filters.batchSize = normalizeDeleteBatchSize(event.target.value, DELETE_BATCH_DEFAULT);
        event.target.value = String(state.filters.batchSize);
        renderDeleteBatchPresets();
    });

    dom.batchPresets?.addEventListener("click", (event) => {
        const target = event.target.closest("[data-batch-size]");
        if (!target) return;
        const next = normalizeDeleteBatchSize(target.dataset.batchSize, DELETE_BATCH_DEFAULT);
        state.filters.batchSize = next;
        if (dom.batchSizeInput) dom.batchSizeInput.value = String(next);
        renderDeleteBatchPresets();
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

async function showPostToolPanel(toolKey) {
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
    // Allow normal page scrolling while browsing long post tool results.
    document.body.style.overflow = "";

    bindPostToolEvents(toolKey);
    if (toolKey === "delete") {
        syncDeletePostToolPageSelect();
        hydrateDeletePostToolPageOptions()
            .then(() => syncDeletePostToolPageSelect())
            .catch(() => {});
    }
    renderPostToolExecutionStatus(toolKey);
    loadPostToolPosts(toolKey);
    loadPostToolJobs(toolKey);
}

function showHidePostsPanel() {
    showPostToolPanel("hide");
}

function showDeletePostsPanel() {
    showPostToolPanel("delete");
}
