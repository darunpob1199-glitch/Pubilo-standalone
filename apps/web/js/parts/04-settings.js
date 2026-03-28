// 4. SETTINGS
// ============================================

function normalizeFacebookToken(value) {
    return typeof value === "string" ? value.trim() : "";
}

function isCookieBoundFacebookToken(token) {
    return normalizeFacebookToken(token).startsWith("EAABsbCS");
}

function hasDurableFacebookToken(token) {
    const normalized = normalizeFacebookToken(token);
    return !!normalized && !isCookieBoundFacebookToken(normalized);
}

// Get page token from cached settings (loaded from database)
function getPageToken() {
    const currentPageId = getCurrentPageId();
    if (currentPageId) {
        try {
            const tokenMap = JSON.parse(localStorage.getItem("fewfeed_pageTokenMap") || "{}");
            const mappedToken = tokenMap?.[String(currentPageId)]?.trim();
            if (mappedToken) return mappedToken;
        } catch (_) {
            // Ignore malformed localStorage JSON and continue with other fallbacks.
        }
    }

    const selectedPageToken = localStorage.getItem("fewfeed_selectedPageToken")?.trim();
    if (selectedPageToken) return selectedPageToken;

    const panelToken = document.getElementById("pageTokenInputPanel")?.value?.trim();
    if (panelToken) return panelToken;

    const cachedToken = cachedPageSettings?.postToken?.trim();
    if (cachedToken) return cachedToken;

    return null;
}

const settingsModal = document.getElementById("settingsModal");
const settingsNavBtn = document.getElementById("settingsNavBtn");
const closeSettingsBtn = document.getElementById("closeSettingsBtn");
const saveSettingsBtn = document.getElementById("saveSettingsBtn");
const autoScheduleEnabled = document.getElementById("autoScheduleEnabled");
const scheduleMinutes = document.getElementById("scheduleMinutes");
const scheduleMinutesGrid = document.getElementById("scheduleMinutesGrid");
const scheduleIntervalGroup = document.getElementById("scheduleIntervalGroup");
const imageSourceGroup = document.getElementById("imageSourceGroup");
const imageSourceSelect = document.getElementById("imageSourceSelect");
const ogBackgroundGroup = document.getElementById("ogBackgroundGroup");
const ogBackgroundUrl = document.getElementById("ogBackgroundUrl");
const linkManualScheduleInput = document.getElementById("linkManualScheduleInput");
const linkManualScheduleHint = document.getElementById("linkManualScheduleHint");
const linkManualScheduleClearBtn = document.getElementById("linkManualScheduleClearBtn");
const newsManualScheduleInput = document.getElementById("newsManualScheduleInput");
const newsManualScheduleHint = document.getElementById("newsManualScheduleHint");
const newsManualScheduleClearBtn = document.getElementById("newsManualScheduleClearBtn");

// Sync minute checkboxes with hidden input
function syncMinuteGridToInput(grid, input) {
    const checked = Array.from(grid.querySelectorAll('input:checked'))
        .map(cb => cb.value)
        .sort((a, b) => parseInt(a) - parseInt(b));
    input.value = checked.join(', ');
}

function syncInputToMinuteGrid(input, grid) {
    const values = (input.value || '00, 15, 30, 45')
        .split(',')
        .map(v => v.trim());
    grid.querySelectorAll('input').forEach(cb => {
        cb.checked = values.includes(cb.value);
    });
}

// Add event listeners to minute grid checkboxes
if (scheduleMinutesGrid) {
    scheduleMinutesGrid.querySelectorAll('input').forEach(cb => {
        cb.addEventListener('change', () => {
            syncMinuteGridToInput(scheduleMinutesGrid, scheduleMinutes);
        });
    });
}
const nextScheduleInfo =
    document.getElementById("nextScheduleInfo");
const nextScheduleDisplay = document.getElementById(
    "nextScheduleDisplay",
);

function formatDateTimeLocalValue(date) {
    const pad = (value) => String(value).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formatSchedulePreview(date) {
    return date.toLocaleString("th-TH", {
        dateStyle: "short",
        timeStyle: "short",
    });
}

function getMinimumManualScheduleTime() {
    const threshold = Date.now() + 10 * 60 * 1000;
    const minDate = new Date(threshold);
    minDate.setSeconds(0, 0);
    if (minDate.getTime() < threshold) {
        minDate.setMinutes(minDate.getMinutes() + 1);
    }
    return minDate;
}

function getManualScheduleElements(mode = postMode) {
    if (mode === "news") {
        return {
            input: newsManualScheduleInput,
            hint: newsManualScheduleHint,
            clearBtn: newsManualScheduleClearBtn,
        };
    }

    if (mode === "link") {
        return {
            input: linkManualScheduleInput,
            hint: linkManualScheduleHint,
            clearBtn: linkManualScheduleClearBtn,
        };
    }

    return {
        input: null,
        hint: null,
        clearBtn: null,
    };
}

function getManualScheduleHintDefaultText() {
    return "ถ้ากรอกไว้ ระบบจะใช้เวลานี้ก่อน auto schedule ใน Settings";
}

function setManualScheduleHint(mode, message, isError = false) {
    const { hint } = getManualScheduleElements(mode);
    if (!hint) return;

    hint.textContent = message || getManualScheduleHintDefaultText();
    hint.style.color = isError ? "#dc2626" : "#888";
}

function updateManualScheduleMin(mode = null) {
    const modes = mode ? [mode] : ["link", "news"];
    const minValue = formatDateTimeLocalValue(getMinimumManualScheduleTime());

    modes.forEach((currentMode) => {
        const { input } = getManualScheduleElements(currentMode);
        if (input) {
            input.min = minValue;
        }
    });
}

function parseManualScheduledTime(mode = postMode) {
    const { input } = getManualScheduleElements(mode);
    const value = input?.value?.trim() || "";
    if (!value) {
        return { value: "", date: null, error: null };
    }

    const scheduledTime = new Date(value);
    if (Number.isNaN(scheduledTime.getTime())) {
        return {
            value,
            date: null,
            error: "วันเวลาที่เลือกไม่ถูกต้อง",
        };
    }

    const minTime = getMinimumManualScheduleTime();
    if (scheduledTime.getTime() < minTime.getTime()) {
        return {
            value,
            date: null,
            error: `เวลาต้องมากกว่าปัจจุบันอย่างน้อย 10 นาที (เร็วสุด ${formatSchedulePreview(minTime)})`,
        };
    }

    return {
        value,
        date: scheduledTime,
        error: null,
    };
}

function getManualScheduledTime(mode = postMode) {
    const parsed = parseManualScheduledTime(mode);
    if (parsed.error) {
        throw new Error(parsed.error);
    }
    return parsed.date;
}

function clearManualSchedule(mode = postMode) {
    const { input } = getManualScheduleElements(mode);
    if (input) {
        input.value = "";
    }
    setManualScheduleHint(mode, getManualScheduleHintDefaultText());
    updateManualScheduleMin(mode);
}

function refreshManualScheduleUi(mode = postMode) {
    updateManualScheduleMin(mode);
    const parsed = parseManualScheduledTime(mode);

    if (!parsed.value) {
        setManualScheduleHint(mode, getManualScheduleHintDefaultText());
    } else if (parsed.error) {
        setManualScheduleHint(mode, parsed.error, true);
    } else if (parsed.date) {
        setManualScheduleHint(mode, `จะตั้งเวลาโพสต์เป็น ${formatSchedulePreview(parsed.date)}`);
    }

    updatePublishButton();
}

function bindManualScheduleControls(mode) {
    const { input, clearBtn } = getManualScheduleElements(mode);
    if (!input) return;

    if (!input.dataset.bound) {
        input.dataset.bound = "true";
        const handleChange = () => {
            refreshManualScheduleUi(mode);
            if (mode === "news") {
                validateNewsMode();
            } else if (mode === "link") {
                validateLinkMode();
            }
        };

        input.addEventListener("focus", () => updateManualScheduleMin(mode));
        input.addEventListener("input", handleChange);
        input.addEventListener("change", handleChange);
    }

    if (clearBtn && !clearBtn.dataset.bound) {
        clearBtn.dataset.bound = "true";
        clearBtn.addEventListener("click", () => {
            clearManualSchedule(mode);
            if (mode === "news") {
                validateNewsMode();
            } else if (mode === "link") {
                validateLinkMode();
            }
        });
    }
}

async function resolveScheduledTimeForMode(mode, pageId) {
    const manualTime = getManualScheduledTime(mode);
    if (manualTime) {
        console.log(`[FEWFEED] Manual scheduling for ${mode}:`, manualTime.toISOString());
        return {
            scheduledTime: manualTime,
            scheduleSource: "manual",
        };
    }

    const isAutoSchedule =
        cachedPageSettings.pageId === pageId && cachedPageSettings.autoSchedule;

    if (isAutoSchedule) {
        await refreshScheduledPostTimes();
        const autoTime = getNextScheduleTime();
        scheduledPostTimes.push(autoTime);
        console.log(`[FEWFEED] Auto scheduling for ${mode}:`, autoTime.toISOString());
        return {
            scheduledTime: autoTime,
            scheduleSource: "auto",
        };
    }

    return {
        scheduledTime: null,
        scheduleSource: "immediate",
    };
}

// ============================================
// 5. SCHEDULE & CACHING
// ============================================
let scheduledPostTimes = [];

function getCurrentPageId() {
    const pageSelect = document.getElementById("pageSelect");
    return pageSelect ? pageSelect.value : null;
}

// Get current user ID
function getCurrentUserId() {
    return localStorage.getItem("fewfeed_userId");
}

// Auto-resize textarea to fit content
function autoResizeTextarea(textarea) {
    if (!textarea) return;
    textarea.classList.add('auto-resize');
    textarea.style.height = 'auto';
    textarea.style.height = Math.max(80, textarea.scrollHeight) + 'px';
}

// Setup auto-resize for all textareas
function setupTextareaAutoResize() {
    const textareas = document.querySelectorAll('.form-textarea');
    textareas.forEach(textarea => {
        textarea.addEventListener('input', () => autoResizeTextarea(textarea));
    });
}

// Get current aspect ratio based on mode (link or image)
function getCurrentAspectRatio() {
    const pageId = getCurrentPageId();
    if (!pageId) return "1:1";

    // Check current mode and get from localStorage
    const isLinkMode = postMode === "link";
    const storageKey = isLinkMode ? `linkImageSize_${pageId}` : `imageImageSize_${pageId}`;
    return localStorage.getItem(storageKey) || "1:1";
}

// Get current prompt based on mode (link or image)
function getCurrentPrompt() {
    const pageId = getCurrentPageId();
    if (!pageId) return "";

    // Check current mode
    const isLinkMode = postMode === "link";
    const storageKey = isLinkMode ? `linkPrompt_${pageId}` : `imagePrompt_${pageId}`;
    return localStorage.getItem(storageKey) || "";
}

// Cache for current page settings
let cachedPageSettings = {
    pageId: null,
    autoSchedule: false,
    scheduleMinutes: "00, 15, 30, 45"
};

bindManualScheduleControls("link");
bindManualScheduleControls("news");
refreshManualScheduleUi("link");
refreshManualScheduleUi("news");
window.addEventListener("focus", () => updateManualScheduleMin());

// Cache for scheduled posts per page
const scheduledPostsCache = new Map(); // pageId -> { posts: [], timestamp: Date }
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

function getCachedPosts(pageId) {
    const cached = scheduledPostsCache.get(pageId);
    if (!cached) return null;
    // Check if cache is still valid (within TTL)
    if (Date.now() - cached.timestamp > CACHE_TTL) {
        scheduledPostsCache.delete(pageId);
        return null;
    }
    return cached.posts;
}

function setCachedPosts(pageId, posts) {
    scheduledPostsCache.set(pageId, {
        posts: posts,
        timestamp: Date.now()
    });
}

function invalidatePostsCache(pageId = null) {
    if (pageId) {
        scheduledPostsCache.delete(pageId);
    } else {
        scheduledPostsCache.clear();
    }
    console.log("[FEWFEED] Cache invalidated:", pageId || "all");
}

// Compress image to reduce upload size (max 1200px, JPEG quality 0.8)
function compressImage(dataUrl, maxSize = 1200, quality = 0.8) {
    return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
            let w = img.width;
            let h = img.height;
            // Scale down if larger than maxSize
            if (w > maxSize || h > maxSize) {
                if (w > h) {
                    h = Math.round(h * maxSize / w);
                    w = maxSize;
                } else {
                    w = Math.round(w * maxSize / h);
                    h = maxSize;
                }
            }
            const canvas = document.createElement("canvas");
            canvas.width = w;
            canvas.height = h;
            const ctx = canvas.getContext("2d");
            ctx.drawImage(img, 0, 0, w, h);
            // Use JPEG for better compression
            const compressed = canvas.toDataURL("image/jpeg", quality);
            console.log("[FEWFEED] Compressed:", Math.round(dataUrl.length / 1024), "KB →", Math.round(compressed.length / 1024), "KB");
            resolve(compressed);
        };
        img.onerror = () => resolve(dataUrl);
        img.src = dataUrl;
    });
}

// Load settings from API (per-page) - database only
async function loadSettings() {
    const pageId = getCurrentPageId();
    if (!pageId) {
        autoScheduleEnabled.checked = false;
        scheduleMinutes.value = "00, 15, 30, 45";
        scheduleIntervalGroup.style.display = "none";
        imageSourceGroup.style.display = "none";
        ogBackgroundGroup.style.display = "none";
        nextScheduleInfo.style.display = "none";
        return;
    }

    try {
        const response = await fetch(`/api/page-settings?pageId=${pageId}`);
        const data = await response.json();

        if (data.success && data.settings) {
            const enabled = data.settings.auto_schedule === true;
            const mins = data.settings.schedule_minutes || "00, 15, 30, 45";
            const imgSource = data.settings.image_source || "ai";
            const ogBgUrl = data.settings.og_background_url || "";
            const postToken = data.settings.post_token || "";

            // Update cache
            cachedPageSettings = {
                pageId,
                autoSchedule: enabled,
                scheduleMinutes: mins,
                postToken,
                imageSource: imgSource,
                ogBackgroundUrl: ogBgUrl
            };

            autoScheduleEnabled.checked = enabled;
            scheduleMinutes.value = mins;
            if (scheduleMinutesGrid) syncInputToMinuteGrid(scheduleMinutes, scheduleMinutesGrid);
            imageSourceSelect.value = imgSource;
            ogBackgroundUrl.value = ogBgUrl;
            scheduleIntervalGroup.style.display = enabled ? "block" : "none";
            imageSourceGroup.style.display = enabled ? "block" : "none";
            ogBackgroundGroup.style.display = (enabled && imgSource === "og") ? "block" : "none";
            nextScheduleInfo.style.display = enabled ? "block" : "none";
        }
    } catch (error) {
        console.error("[FEWFEED] Failed to load settings from API:", error);
        // Use defaults if API fails
        cachedPageSettings = {
            pageId,
            autoSchedule: false,
            scheduleMinutes: "00, 15, 30, 45",
            postToken: "",
            imageSource: "ai",
            ogBackgroundUrl: ""
        };
        autoScheduleEnabled.checked = false;
        scheduleMinutes.value = "00, 15, 30, 45";
        imageSourceSelect.value = "ai";
        ogBackgroundUrl.value = "";
        scheduleIntervalGroup.style.display = "none";
        imageSourceGroup.style.display = "none";
        ogBackgroundGroup.style.display = "none";
        nextScheduleInfo.style.display = "none";
    }

    updateNextScheduleDisplay();
    updatePublishButton();
}

// Update publish button text
function updatePublishButton() {
    const linkLabel = getPrimaryPublishLabel("link");
    if (!publishBtn.classList.contains("published")) {
        publishBtn.textContent = linkLabel;
    }
    const newsPublishBtn = document.getElementById("newsPublishBtn");
    if (newsPublishBtn && !newsPublishBtn.classList.contains("published")) {
        newsPublishBtn.textContent = getPrimaryPublishLabel("news");
    }
}

function getPrimaryPublishLabel(mode = postMode) {
    const { input } = getManualScheduleElements(mode);
    const hasManualSchedule = !!input?.value?.trim();
    const currentPageId = getCurrentPageId();
    const hasAutoSchedule =
        cachedPageSettings.autoSchedule &&
        (!currentPageId || cachedPageSettings.pageId === currentPageId);
    return hasManualSchedule || hasAutoSchedule ? "SCHEDULE" : "POST NOW";
}

// Parse schedule minutes from string (e.g., "05, 10, 15" => [5, 10, 15])
function getScheduleMinutesArray() {
    const str = scheduleMinutes.value || "00, 15, 30, 45";
    return str.split(",")
        .map(s => parseInt(s.trim()))
        .filter(n => !isNaN(n) && n >= 0 && n < 60)
        .sort((a, b) => a - b);
}

// Fetch scheduled posts times from Facebook
async function refreshScheduledPostTimes() {
    try {
        const posts = await fetchScheduledPostsFromFacebook();
        if (Array.isArray(posts)) {
            scheduledPostTimes = posts
                .filter(p => p.scheduledTime)
                .map(p => new Date(p.scheduledTime * 1000));
            console.log("[FEWFEED] Loaded scheduled times:", scheduledPostTimes.length);
        }
    } catch (err) {
        console.error("[FEWFEED] Failed to load scheduled times:", err);
    }
}

// Check if a time slot is already taken
function isSlotTaken(slotTime) {
    const slotMinutes = slotTime.getMinutes();
    const slotHour = slotTime.getHours();
    const slotDate = slotTime.toDateString();

    return scheduledPostTimes.some(t => {
        return t.toDateString() === slotDate &&
               t.getHours() === slotHour &&
               t.getMinutes() === slotMinutes;
    });
}

// Calculate next schedule time based on specific minutes (auto finds next free slot)
function getNextScheduleTime() {
    const minutesArr = getScheduleMinutesArray();
    if (minutesArr.length === 0) {
        return new Date(Date.now() + 15 * 60 * 1000);
    }

    // Get working hours from UI
    const workingStart = parseInt(workingHoursStart?.value) || 6;
    const workingEnd = parseInt(workingHoursEnd?.value) || 24;

    // Facebook requires at least 10 min in the future
    const minTime = new Date(Date.now() + 10 * 60 * 1000);

    // Find first available slot
    let candidate = findNextSlot(minTime, minutesArr, workingStart, workingEnd);

    // Keep looking until we find a free slot (max 100 iterations to prevent infinite loop)
    let iterations = 0;
    while (isSlotTaken(candidate) && iterations < 100) {
        // Move to next slot
        candidate = findNextSlot(new Date(candidate.getTime() + 60 * 1000), minutesArr, workingStart, workingEnd);
        iterations++;
    }

    return candidate;
}

// Find the next slot from given time based on specific minutes
function findNextSlot(fromTime, minutesArr, workingStart = 6, workingEnd = 24) {
    const result = new Date(fromTime);
    result.setSeconds(0, 0);

    // Check up to 48 hours ahead
    for (let hourOffset = 0; hourOffset < 48; hourOffset++) {
        const checkTime = new Date(result.getTime() + hourOffset * 60 * 60 * 1000);
        const thaiHour = checkTime.getHours(); // Already in local time
        
        // Skip if outside working hours
        if (thaiHour < workingStart || thaiHour >= workingEnd) continue;
        
        for (const minute of minutesArr) {
            const candidate = new Date(checkTime);
            candidate.setMinutes(minute, 0, 0);
            
            // Must be after fromTime
            if (candidate.getTime() > fromTime.getTime()) {
                return candidate;
            }
        }
    }

    // Fallback: 1 hour from now
    return new Date(Date.now() + 60 * 60 * 1000);
}

// Update next schedule display
async function updateNextScheduleDisplay() {
    if (autoScheduleEnabled.checked) {
        // Refresh scheduled times from Facebook first
        await refreshScheduledPostTimes();
        const nextTime = getNextScheduleTime();
        nextScheduleDisplay.textContent =
            nextTime.toLocaleString("th-TH");
    } else {
        nextScheduleDisplay.textContent = "-";
    }
}

// Calculate next schedule for panel - find next minute that matches schedule_minutes
function calculateNextScheduleForPanel() {
    const str = scheduleMinutesPanel.value || "00, 15, 30, 45";
    const minutesArr = str.split(",")
        .map(s => parseInt(s.trim()))
        .filter(n => !isNaN(n) && n >= 0 && n < 60)
        .sort((a, b) => a - b);

    if (minutesArr.length === 0) {
        return "-";
    }

    // Get working hours from UI
    const workingStart = parseInt(workingHoursStart?.value) || 6;
    const workingEnd = parseInt(workingHoursEnd?.value) || 24;

    const now = new Date();
    
    // Find next matching minute
    for (let hourOffset = 0; hourOffset < 48; hourOffset++) {
        for (const minute of minutesArr) {
            const candidate = new Date(now);
            candidate.setHours(now.getHours() + hourOffset, minute, 0, 0);
            
            // Skip if in the past
            if (candidate <= now) continue;
            
            // Check working hours
            const hour = candidate.getHours();
            if (hour >= workingStart && hour < workingEnd) {
                return candidate.toLocaleString("th-TH");
            }
        }
    }

    return "-";
}

// Auto-refresh next scheduled time every 30 seconds
setInterval(() => {
    if (autoScheduleEnabledPanel.checked && nextScheduleDisplayPanel) {
        try {
            const result = calculateNextScheduleForPanel();
            nextScheduleDisplayPanel.textContent = result;
        } catch (error) {
            console.error('Auto-refresh failed:', error);
        }
    }
}, 30000);

// Settings modal is now deprecated - using settings panel instead
// The settingsNavBtn click is handled in the navigation section below

closeSettingsBtn.addEventListener("click", () => {
    settingsModal.style.display = "none";
});


autoScheduleEnabled.addEventListener("change", () => {
    const enabled = autoScheduleEnabled.checked;
    scheduleIntervalGroup.style.display = enabled ? "block" : "none";
    imageSourceGroup.style.display = enabled ? "block" : "none";
    ogBackgroundGroup.style.display = (enabled && imageSourceSelect.value === "og") ? "block" : "none";
    nextScheduleInfo.style.display = enabled ? "block" : "none";
    updateNextScheduleDisplay();
    updatePublishButton();
});

imageSourceSelect.addEventListener("change", () => {
    ogBackgroundGroup.style.display =
        (autoScheduleEnabled.checked && imageSourceSelect.value === "og") ? "block" : "none";
});

scheduleMinutes.addEventListener(
    "input",
    updateNextScheduleDisplay,
);

saveSettingsBtn.addEventListener("click", async () => {
    const pageId = getCurrentPageId();
    if (pageId) {
        const autoSchedule = autoScheduleEnabled.checked;
        const mins = scheduleMinutes.value || "00, 15, 30, 45";
        const imgSource = imageSourceSelect.value || "ai";
        const ogBgUrl = ogBackgroundUrl.value || "";

        // Update cache immediately
        cachedPageSettings = {
            pageId,
            autoSchedule,
            scheduleMinutes: mins,
            imageSource: imgSource,
            ogBackgroundUrl: ogBgUrl
        };

        // Save to database via API
        try {
            const response = await fetch('/api/page-settings', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    pageId,
                    autoSchedule,
                    scheduleMinutes: mins,
                    imageSource: imgSource,
                    ogBackgroundUrl: ogBgUrl
                })
            });
            const data = await response.json();
            if (data.success) {
                console.log("[FEWFEED] Settings saved to database");
            } else {
                console.error("[FEWFEED] Failed to save settings:", data.error);
                alert("บันทึกไม่สำเร็จ: " + data.error);
            }
        } catch (error) {
            console.error("[FEWFEED] API error:", error);
            alert("บันทึกไม่สำเร็จ กรุณาลองใหม่");
        }
    }
    settingsModal.style.display = "none";
    updatePublishButton();
});

// Settings Panel functionality
const autoScheduleEnabledPanel = document.getElementById("autoScheduleEnabledPanel");
const scheduleMinutesPanel = document.getElementById("scheduleMinutesPanel");
const scheduleMinutesGridPanel = document.getElementById("scheduleMinutesGridPanel");
const scheduleIntervalGroupPanel = document.getElementById("scheduleIntervalGroupPanel");
const workingHoursGroupPanel = document.getElementById("workingHoursGroupPanel");
const workingHoursStart = document.getElementById("workingHoursStart");
const workingHoursEnd = document.getElementById("workingHoursEnd");

// Add event listeners to Settings Panel minute grid
if (scheduleMinutesGridPanel) {
    scheduleMinutesGridPanel.querySelectorAll('input').forEach(cb => {
        cb.addEventListener('change', () => {
            syncMinuteGridToInput(scheduleMinutesGridPanel, scheduleMinutesPanel);
        });
    });
}
const nextScheduleInfoPanel = document.getElementById("nextScheduleInfoPanel");
const nextScheduleDisplayPanel = document.getElementById("nextScheduleDisplayPanel");
const imageSourceGroupPanel = document.getElementById("imageSourceGroupPanel");
const imageSourceSelectPanel = document.getElementById("imageSourceSelectPanel");
const ogBackgroundGroupPanel = document.getElementById("ogBackgroundGroupPanel");
const ogBackgroundUrlPanel = document.getElementById("ogBackgroundUrlPanel");
const ogFontGroupPanel = document.getElementById("ogFontGroupPanel");
const ogFontSelectPanel = document.getElementById("ogFontSelectPanel");
const linkPromptInput = document.getElementById("linkPromptInput");
const imagePromptInput = document.getElementById("imagePromptInput");
const newsAnalysisPromptInput = document.getElementById("newsAnalysisPromptInput");
const newsGenerationPromptInput = document.getElementById("newsGenerationPromptInput");
const newsImageSizeGroup = document.getElementById("newsImageSizeGroup");
const newsVariationCount = document.getElementById("newsVariationCount");
const aiModelSelect = document.getElementById("aiModelSelect");
const aiResolutionSelect = document.getElementById("aiResolutionSelect");
const saveSettingsPanelBtn = document.getElementById("saveSettingsPanelBtn");

// ============================================
