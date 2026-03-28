// ============================================
// v6.1 - Fixed page switch on #published
// ============================================
// 1. THUMB PREVIEW
// ============================================
const thumbPreviewPopup = document.getElementById("thumbPreviewPopup");
window.showThumbPreview = function (src, e) {
    thumbPreviewPopup.src = src;
    thumbPreviewPopup.style.display = "block";
    window.moveThumbPreview(e);
};
window.moveThumbPreview = function (e) {
    const x = e.clientX + 20;
    const y = e.clientY - 100;
    thumbPreviewPopup.style.left = x + "px";
    thumbPreviewPopup.style.top = Math.max(10, y) + "px";
};
window.hideThumbPreview = function () {
    thumbPreviewPopup.style.display = "none";
};

// ============================================
// 2. DOM ELEMENTS
// ============================================
const fileInput = document.getElementById("fileInput");
const cardImageArea = document.getElementById("cardImageArea");
const uploadPrompt = document.getElementById("uploadPrompt");
const generateOverlay = document.getElementById("generateOverlay");
const generateBtn = document.getElementById("generateBtn");
const refThumbsRow = document.getElementById("refThumbsRow");
const generatedGrid = document.getElementById("generatedGrid");
const fullImageView = document.getElementById("fullImageView");
const publishBtn = document.getElementById("publishBtn");

// Form elements
const linkName = document.getElementById("linkName");
const caption = document.getElementById("caption");
const description = document.getElementById("description");
const linkUrl = document.getElementById("linkUrl");

// ============================================
// 3. VALIDATION
// ============================================
let linkModeImageReady = false;
let newsModeImageReady = false;

function validateLinkMode() {
    // Determine current mode - default to 'link'
    const currentMode = postMode || 'link';

    if (currentMode === 'link') {
        const hasUrl = linkUrl && linkUrl.value.trim().length > 0;
        // Check both hidden input and preview element (in case blur hasn't synced yet)
        const previewDesc = document.getElementById("previewDescription");
        const descValue = description?.value?.trim() || previewDesc?.textContent?.trim() || '';
        const hasDescription = descValue.length > 0;

        // Use linkModeImageReady flag (set by showSingleImage/showFullImage, cleared by delete/regenerate)
        const hasImage = linkModeImageReady;

        const isValid = hasUrl && hasDescription && hasImage;

        console.log('[validateLinkMode]', {
            hasUrl,
            urlLen: linkUrl?.value?.length,
            hasDescription,
            descLen: descValue.length,
            hasImage,
            linkModeImageReady,
            isValid
        });

        if (publishBtn) {
            publishBtn.disabled = !isValid;
            publishBtn.style.opacity = isValid ? '1' : '0.5';
            publishBtn.style.cursor = isValid ? 'pointer' : 'not-allowed';

            // Update button text if it was showing success state but now invalid (e.g. cleared image)
            if (!isValid && publishBtn.classList.contains('published')) {
                publishBtn.classList.remove('published');
                publishBtn.textContent = 'SCHEDULE';
            }
        }
    } else {
        // Other modes don't require link URL/Description validation here
        // (They have their own validation or are always enabled for now)
        if (publishBtn) {
            publishBtn.disabled = false;
            publishBtn.style.opacity = '1';
            publishBtn.style.cursor = 'pointer';
        }
    }
}

function validateNewsMode() {
    const newsUrlInput = document.getElementById("newsUrlInput");
    const newsPreviewDesc = document.getElementById("newsPreviewDescription");
    const newsPublishBtn = document.getElementById("newsPublishBtn");

    const hasUrl = newsUrlInput && newsUrlInput.value.trim().length > 0;
    const hasDescription = newsPreviewDesc && newsPreviewDesc.textContent.trim().length > 0;
    const hasImage = newsModeImageReady;

    const isValid = hasUrl && hasDescription && hasImage;

    if (newsPublishBtn) {
        newsPublishBtn.disabled = !isValid;
        newsPublishBtn.classList.toggle('disabled', !isValid);
        newsPublishBtn.style.opacity = isValid ? '1' : '0.5';
        newsPublishBtn.style.cursor = isValid ? 'pointer' : 'not-allowed';
    }
}

// Listen for link URL changes
if (linkUrl) {
    linkUrl.addEventListener("input", validateLinkMode);
}
// Note: description validation is triggered from setupEditableText blur handler
// and after config loading/form clearing

// Initial validation
setTimeout(validateLinkMode, 500);

// ============================================
// 4. SETTINGS
// ============================================
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

            // Update cache
            cachedPageSettings = {
                pageId,
                autoSchedule: enabled,
                scheduleMinutes: mins,
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
    if (!publishBtn.classList.contains("published")) {
        publishBtn.textContent = "SCHEDULE";
    }
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
const pageTokenInputPanel = document.getElementById("pageTokenInputPanel");

// ============================================
// 6. AUTO-POST
// ============================================
const postModeImage = document.getElementById("postModeImage");
const postModeText = document.getElementById("postModeText");
const postModeAlternate = document.getElementById("postModeAlternate");
let currentPostMode = "image";

// Auto-Hide elements
const autoHideEnabled = document.getElementById("autoHideEnabled");
const hideSharedStory = document.getElementById("hideSharedStory");
const hideMobileStatus = document.getElementById("hideMobileStatus");
const hideAddedPhotos = document.getElementById("hideAddedPhotos");
const autoHideTokenInput = document.getElementById("autoHideTokenInput");
const autoHideTokenGroup = document.getElementById("autoHideTokenGroup");

// Auto-resize textarea function
function autoResizeTextarea(textarea) {
    textarea.style.height = 'auto';
    textarea.style.height = textarea.scrollHeight + 'px';
}

// Add auto-resize listeners
[linkPromptInput, imagePromptInput, newsAnalysisPromptInput, newsGenerationPromptInput].forEach(textarea => {
    if (textarea) {
        textarea.addEventListener('input', () => autoResizeTextarea(textarea));
    }
});

// Helper functions for radio buttons
function getLinkImageSize() {
    const checked = document.querySelector('input[name="linkImageSize"]:checked');
    return checked ? checked.value : "1:1";
}
function setLinkImageSize(value) {
    const radio = document.querySelector(`input[name="linkImageSize"][value="${value}"]`);
    if (radio) radio.checked = true;
}
function getImageImageSize() {
    const checked = document.querySelector('input[name="imageImageSize"]:checked');
    return checked ? checked.value : "1:1";
}
function setImageImageSize(value) {
    const radio = document.querySelector(`input[name="imageImageSize"][value="${value}"]`);
    if (radio) radio.checked = true;
}
function getNewsImageSize() {
    const checked = document.querySelector('input[name="newsImageSize"]:checked');
    return checked ? checked.value : "1:1";
}
function setNewsImageSize(value) {
    const radio = document.querySelector(`input[name="newsImageSize"][value="${value}"]`);
    if (radio) radio.checked = true;
}

// Auto-Post Alternating Functions
function formatAutoPostTime(isoString) {
    if (!isoString) return "-";
    const date = new Date(isoString);
    return date.toLocaleString('th-TH', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
}

function getNextPostType(lastType) {
    if (!lastType) return "Text";
    return lastType === "text" ? "Image" : "Text";
}

function setAutoPostMode(mode) {
    currentPostMode = mode;
    [postModeImage, postModeText, postModeAlternate].forEach(btn => {
        if (btn) btn.classList.remove('active');
    });
    if (mode === 'image' && postModeImage) {
        postModeImage.classList.add('active');
    } else if (mode === 'text' && postModeText) {
        postModeText.classList.add('active');
    } else if (mode === 'alternate' && postModeAlternate) {
        postModeAlternate.classList.add('active');
    }

    // Show colorBg option only for text or alternate mode
    const colorBgGroup = document.getElementById("colorBgGroup");
    const colorBgPresetsGroup = document.getElementById("colorBgPresetsGroup");
    if (colorBgGroup) {
        colorBgGroup.style.display = (mode === 'text' || mode === 'alternate') ? 'flex' : 'none';
    }
    if (colorBgPresetsGroup) {
        const colorBgEnabled = document.getElementById("colorBgEnabled");
        colorBgPresetsGroup.style.display = ((mode === 'text' || mode === 'alternate') && colorBgEnabled?.checked) ? 'block' : 'none';
    }

    // Show share mode only for alternate mode
    if (shareModeGroup) {
        shareModeGroup.style.display = (mode === 'alternate' && shareEnabled?.checked && sharePageSelect?.value) ? 'block' : 'none';
    }
}

async function loadShareScheduleConflicts(targetPageId) {
    const currentPageId = getCurrentPageId();
    const shareScheduleMinutesGrid = document.getElementById("shareScheduleMinutesGrid");
    if (!shareScheduleMinutesGrid || !targetPageId) return;

    // Reset all to default
    shareScheduleMinutesGrid.querySelectorAll('.minute-checkbox').forEach(label => {
        label.classList.remove('used-by-others');
        label.style.removeProperty('--other-color');
        label.title = '';
        const cb = label.querySelector('input');
        if (cb) cb.disabled = false;
    });

    try {
        const res = await fetch(`/api/auto-post-config?targetPageId=${targetPageId}`);
        const data = await res.json();

        // Get current page color
        const pageColorPicker = document.getElementById("pageColorPicker");
        const currentPageColor = pageColorPicker?.value || '#1a1a1a';
        const currentPageName = document.querySelector('.page-selector-name')?.textContent || 'เพจนี้';

        if (data.success && data.configs) {
            const usedMinutes = {};
            data.configs.forEach(config => {
                if (config.page_id === currentPageId) return;
                const mins = (config.share_schedule_minutes || '').split(',').map(m => m.trim()).filter(m => m);
                const color = config.page_color || '#f59e0b';
                const name = config.page_name || config.page_id.slice(-6);
                mins.forEach(m => {
                    if (!usedMinutes[m]) usedMinutes[m] = [];
                    usedMinutes[m].push({ color, name });
                });
            });

            // Update legend with page names
            const legendContainer = document.getElementById("shareLegend");
            if (legendContainer) {
                let legendHtml = `<span><span style="display: inline-block; width: 12px; height: 12px; background: ${currentPageColor}; border-radius: 2px; vertical-align: middle;"></span> ${currentPageName}</span>`;
                const seenPages = new Map();
                data.configs.forEach(config => {
                    if (config.page_id === currentPageId) return;
                    if (seenPages.has(config.page_id)) return;
                    seenPages.set(config.page_id, true);
                    const color = config.page_color || '#f59e0b';
                    const name = config.page_name || config.page_id.slice(-6);
                    legendHtml += `<span><span style="display: inline-block; width: 12px; height: 12px; background: ${color}; border-radius: 2px; vertical-align: middle;"></span> ${name}</span>`;
                });
                legendContainer.innerHTML = legendHtml;
            }

            shareScheduleMinutesGrid.querySelectorAll('input').forEach(cb => {
                const label = cb.closest('.minute-checkbox');
                if (usedMinutes[cb.value]) {
                    const infos = usedMinutes[cb.value];
                    label.classList.add('used-by-others');
                    label.style.setProperty('--other-color', infos[0].color);
                    label.title = `ใช้โดย: ${infos.map(i => i.name).join(', ')}`;
                    if (!cb.checked) {
                        cb.disabled = true;
                    }
                }
            });
        }
    } catch (err) {
        console.error('[Share] Failed to load conflicts:', err);
    }

    // Update next share time display
    updateNextShareDisplay();
}

function updateNextShareDisplay() {
    const shareScheduleMinutesGrid = document.getElementById("shareScheduleMinutesGrid");
    const nextShareInfo = document.getElementById("nextShareInfo");
    const nextShareDisplay = document.getElementById("nextShareDisplay");
    if (!shareScheduleMinutesGrid || !nextShareInfo || !nextShareDisplay) return;

    const checked = shareScheduleMinutesGrid.querySelectorAll('input:checked');
    if (checked.length === 0) {
        nextShareInfo.style.display = 'none';
        return;
    }

    const mins = Array.from(checked).map(cb => parseInt(cb.value)).sort((a, b) => a - b);
    const now = new Date();
    const currentMin = now.getMinutes();
    const currentHour = now.getHours();

    let nextMin = mins.find(m => m > currentMin);
    let nextHour = currentHour;
    if (nextMin === undefined) {
        nextMin = mins[0];
        nextHour = currentHour + 1;
    }

    const nextTime = new Date(now);
    nextTime.setHours(nextHour, nextMin, 0, 0);

    nextShareInfo.style.display = 'block';
    nextShareDisplay.textContent = nextTime.toLocaleString('th-TH');
}

// Share to Page elements (defined early for use in loadAutoPostConfig)
const shareEnabled = document.getElementById("shareEnabled");
const sharePageGroup = document.getElementById("sharePageGroup");
const sharePageSelect = document.getElementById("sharePageSelect");
const shareModeGroup = document.getElementById("shareModeGroup");
const shareImage = document.getElementById("shareImage");
const shareText = document.getElementById("shareText");

function getShareMode() {
    const img = shareImage?.checked;
    const txt = shareText?.checked;
    if (img && txt) return 'both';
    if (img) return 'image';
    if (txt) return 'text';
    return 'none';
}

function setShareMode(mode) {
    if (shareImage) shareImage.checked = mode === 'both' || mode === 'image';
    if (shareText) shareText.checked = mode === 'both' || mode === 'text';
}

async function loadAutoPostConfig() {
    const pageId = getCurrentPageId();
    if (!pageId) return;

    const colorBgEnabled = document.getElementById("colorBgEnabled");
    const colorBgPresetsGroup = document.getElementById("colorBgPresetsGroup");

    try {
        const response = await fetch(`/api/page-settings?pageId=${pageId}`);
        const data = await response.json();
        if (data.success && data.settings) {
            const config = data.settings;
            const mode = config.post_mode;
            setAutoPostMode(mode);
            if (colorBgEnabled) colorBgEnabled.checked = config.color_bg || false;

            // Load presets
            currentPresets = (config.color_bg_presets || '').split(',').filter(s => s.trim());
            renderPresets();

            if (colorBgPresetsGroup) {
                colorBgPresetsGroup.style.display = ((mode === 'text' || mode === 'alternate') && config.color_bg) ? 'block' : 'none';
            }

            // Load share settings
            populateSharePageDropdown();
            if (config.share_page_id) {
                shareEnabled.checked = true;
                sharePageGroup.style.display = "block";
                sharePageSelect.value = config.share_page_id;
                const shareScheduleGroup = document.getElementById("shareScheduleGroup");
                if (shareScheduleGroup) shareScheduleGroup.style.display = "block";
                const shareScheduleMinutesGrid = document.getElementById("shareScheduleMinutesGrid");
                if (shareScheduleMinutesGrid) {
                    const shareMins = (config.share_schedule_minutes || '').split(',').map(s => s.trim()).filter(s => s);
                    shareScheduleMinutesGrid.querySelectorAll('input').forEach(cb => {
                        cb.checked = shareMins.includes(cb.value);
                    });
                }
                await loadShareScheduleConflicts(config.share_page_id);
                const shareModeGroup = document.getElementById("shareModeGroup");
                if (shareModeGroup) {
                    shareModeGroup.style.display = (mode === 'alternate') ? "block" : "none";
                }
                setShareMode(config.share_mode || 'both');
            } else {
                shareEnabled.checked = false;
                sharePageGroup.style.display = "none";
            }
            const pageColorPicker = document.getElementById("pageColorPicker");
            if (pageColorPicker && config.page_color) {
                pageColorPicker.value = config.page_color;
            }
            const shareScheduleMinutesGrid = document.getElementById("shareScheduleMinutesGrid");
            if (shareScheduleMinutesGrid && config.page_color) {
                shareScheduleMinutesGrid.style.setProperty('--page-color', config.page_color);
            }
        }
    } catch (err) {
        console.error("[Auto-Post] Failed to load config:", err);
    }
}

async function saveAutoPostConfig(mode, colorBg, sharePageId, colorBgPresets, shareMode, shareScheduleMinutes, pageColor) {
    const pageId = getCurrentPageId();
    if (!pageId) return;

    const pageName = document.querySelector('.page-selector-name')?.textContent || null;

    const body = { pageId };
    if (mode !== undefined) body.postMode = mode;
    if (colorBg !== undefined) body.colorBg = colorBg;
    if (sharePageId !== undefined) body.sharePageId = sharePageId;
    if (colorBgPresets !== undefined) body.colorBgPresets = colorBgPresets;
    if (shareMode !== undefined) body.shareMode = shareMode;
    if (shareScheduleMinutes !== undefined) body.shareScheduleMinutes = shareScheduleMinutes;
    if (pageColor !== undefined) body.pageColor = pageColor;
    if (pageName) body.pageName = pageName;

    try {
        const response = await fetch('/api/page-settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        const data = await response.json();
        if (data.success) {
            console.log("[Auto-Post] Config saved:", data.settings);
            if (mode !== undefined) setAutoPostMode(mode);
        } else {
            console.error("[Auto-Post] Failed to save config:", data.error);
        }
    } catch (err) {
        console.error("[Auto-Post] Failed to save config:", err);
    }
}

// Auto-Hide Functions
async function loadAutoHideConfig() {
    const pageId = getCurrentPageId();
    console.log("[Auto-Hide] Loading config for page:", pageId);
    if (!pageId) return;

    try {
        const response = await fetch(`/api/auto-hide-config?pageId=${pageId}`);
        const data = await response.json();
        console.log("[Auto-Hide] API response:", data);
        if (data.success && data.config) {
            const enabled = data.config.enabled || false;
            console.log("[Auto-Hide] Setting enabled to:", enabled, "Element:", autoHideEnabled);
            if (autoHideEnabled) {
                autoHideEnabled.checked = enabled;
                console.log("[Auto-Hide] After set, checked =", autoHideEnabled.checked);
            } else {
                console.error("[Auto-Hide] autoHideEnabled element not found!");
            }
            // Load hide types
            const types = (data.config.hide_types || 'shared_story,mobile_status_update,added_photos').split(',');
            if (hideSharedStory) hideSharedStory.checked = types.includes('shared_story');
            if (hideMobileStatus) hideMobileStatus.checked = types.includes('mobile_status_update');
            if (hideAddedPhotos) hideAddedPhotos.checked = types.includes('added_photos');
        }
    } catch (err) {
        console.error("[Auto-Hide] Failed to load config:", err);
    }
}

function getHideTypes() {
    const types = [];
    if (hideSharedStory?.checked) types.push('shared_story');
    if (hideMobileStatus?.checked) types.push('mobile_status_update');
    if (hideAddedPhotos?.checked) types.push('added_photos');
    return types.join(',');
}

async function saveAutoHideConfig() {
    const pageId = getCurrentPageId();
    if (!pageId) return;

    const enabled = autoHideEnabled.checked;
    const hideTypes = getHideTypes();

    // Show/hide token group based on enabled status
    if (autoHideTokenGroup) {
        autoHideTokenGroup.style.display = enabled ? "block" : "none";
    }

    try {
        const response = await fetch('/api/auto-hide-config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ pageId, enabled, hideTypes })
        });
        const data = await response.json();
        if (data.success) {
            console.log("[Auto-Hide] Config saved:", data.config);
        }
    } catch (err) {
        console.error("[Auto-Hide] Failed to save config:", err);
    }
}

// Auto-hide checkbox change handlers
autoHideEnabled.addEventListener("change", saveAutoHideConfig);
if (hideSharedStory) hideSharedStory.addEventListener("change", saveAutoHideConfig);
if (hideMobileStatus) hideMobileStatus.addEventListener("change", saveAutoHideConfig);
if (hideAddedPhotos) hideAddedPhotos.addEventListener("change", saveAutoHideConfig);
if (autoHideTokenInput) autoHideTokenInput.addEventListener("change", saveAutoHideConfig);

// Post mode button handlers - toggle on/off
postModeImage.addEventListener("click", () => {
    const newMode = currentPostMode === 'image' ? null : 'image';
    saveAutoPostConfig(newMode);
});
postModeText.addEventListener("click", () => {
    const newMode = currentPostMode === 'text' ? null : 'text';
    saveAutoPostConfig(newMode);
});
postModeAlternate.addEventListener("click", () => {
    const newMode = currentPostMode === 'alternate' ? null : 'alternate';
    saveAutoPostConfig(newMode);
});

// Page color picker handler
const pageColorPicker = document.getElementById("pageColorPicker");
if (pageColorPicker) {
    pageColorPicker.addEventListener("change", (e) => {
        const color = e.target.value;
        // Update CSS variable
        const shareScheduleMinutesGrid = document.getElementById("shareScheduleMinutesGrid");
        if (shareScheduleMinutesGrid) {
            shareScheduleMinutesGrid.style.setProperty('--page-color', color);
        }
        saveAutoPostConfig(undefined, undefined, undefined, undefined, undefined, undefined, color);
    });
}

// Color Background checkbox handler
const colorBgPresetsGroup = document.getElementById("colorBgPresetsGroup");
const presetsList = document.getElementById("presetsList");
const newPresetInput = document.getElementById("newPresetInput");
const addPresetBtn = document.getElementById("addPresetBtn");
let currentPresets = [];

function renderPresets() {
    presetsList.innerHTML = currentPresets.map((p, i) =>
        `<span style="display: inline-flex; align-items: center; gap: 0.25rem; background: #e5e7eb; padding: 0.25rem 0.5rem; border-radius: 4px; font-size: 0.75rem;">
            ${p}
            <button type="button" data-index="${i}" class="remove-preset-btn" style="background: none; border: none; cursor: pointer; color: #666; font-size: 1rem; line-height: 1;">×</button>
        </span>`
    ).join('');

    // Add event listeners
    presetsList.querySelectorAll('.remove-preset-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const index = parseInt(e.target.dataset.index);
            currentPresets.splice(index, 1);
            renderPresets();
            saveAutoPostConfig(undefined, undefined, undefined, currentPresets.join(','));
        });
    });
}

addPresetBtn.addEventListener("click", () => {
    const val = newPresetInput.value.trim();
    if (val) {
        currentPresets.push(val);
        newPresetInput.value = '';
        renderPresets();
        saveAutoPostConfig(undefined, undefined, undefined, currentPresets.join(','));
    }
});

document.getElementById("colorBgEnabled").addEventListener("change", (e) => {
    colorBgPresetsGroup.style.display = e.target.checked ? "block" : "none";
    saveAutoPostConfig(undefined, e.target.checked);
});

function updateShareModeVisibility() {
    if (shareModeGroup) {
        shareModeGroup.style.display = (currentPostMode === 'alternate' && shareEnabled.checked && sharePageSelect.value) ? 'block' : 'none';
    }
}

shareEnabled.addEventListener("change", (e) => {
    sharePageGroup.style.display = e.target.checked ? "block" : "none";
    updateShareModeVisibility();
    saveAutoPostConfig(undefined, undefined, e.target.checked ? sharePageSelect.value : null);
});

sharePageSelect.addEventListener("change", async (e) => {
    updateShareModeVisibility();
    const targetPageId = e.target.value;

    // Show share schedule group when page selected
    const shareScheduleGroup = document.getElementById("shareScheduleGroup");
    if (shareScheduleGroup) {
        shareScheduleGroup.style.display = targetPageId ? "block" : "none";
    }

    // Load other pages' share schedules to show conflicts
    if (targetPageId) {
        await loadShareScheduleConflicts(targetPageId);
    }

    if (shareEnabled.checked) {
        saveAutoPostConfig(undefined, undefined, targetPageId || null);
    }
});

// Share mode checkbox handlers
if (shareImage) shareImage.addEventListener('change', () => saveAutoPostConfig(undefined, undefined, undefined, undefined, getShareMode()));
if (shareText) shareText.addEventListener('change', () => saveAutoPostConfig(undefined, undefined, undefined, undefined, getShareMode()));

// Share schedule minutes grid handler
const shareScheduleMinutesGrid = document.getElementById("shareScheduleMinutesGrid");
if (shareScheduleMinutesGrid) {
    shareScheduleMinutesGrid.addEventListener('change', (e) => {
        if (e.target.type === 'checkbox') {
            const selected = [];
            shareScheduleMinutesGrid.querySelectorAll('input:checked:not(:disabled)').forEach(c => selected.push(c.value));
            console.log('[Share] Saving schedule:', selected.join(', '));
            saveAutoPostConfig(undefined, undefined, undefined, undefined, undefined, selected.join(', '));
        }
    });
}

// Populate share page dropdown
function populateSharePageDropdown() {
    const currentPageId = getCurrentPageId();
    sharePageSelect.innerHTML = '<option value="">-- เลือกเพจที่จะแชร์ไป --</option>';
    allPages.forEach(page => {
        if (page.id !== currentPageId) {
            const option = document.createElement("option");
            option.value = page.id;
            option.textContent = page.name;
            sharePageSelect.appendChild(option);
        }
    });
}

// Load settings into the panel
async function loadSettingsPanel() {
    const pageId = getCurrentPageId();
    if (!pageId) {
        console.log("[Settings Panel] No page selected");
        return;
    }

    // Try to load from cache first, otherwise fetch from API
    let settings = null;
    // Always fetch fresh from API for settings panel
    try {
        const response = await fetch(`/api/page-settings?pageId=${pageId}`);
        const data = await response.json();
        if (data.success && data.settings) {
            settings = {
                pageId,
                autoSchedule: data.settings.auto_schedule,
                scheduleMinutes: data.settings.schedule_minutes,
                workingHoursStart: data.settings.working_hours_start,
                workingHoursEnd: data.settings.working_hours_end,
                postToken: data.settings.post_token,
                hideToken: data.settings.hide_token,
                aiModel: data.settings.ai_model,
                aiResolution: data.settings.ai_resolution,
                linkImageSize: data.settings.link_image_size,
                imageImageSize: data.settings.image_image_size,
                newsAnalysisPrompt: data.settings.news_analysis_prompt,
                newsGenerationPrompt: data.settings.news_generation_prompt,
                newsImageSize: data.settings.news_image_size,
                newsVariationCount: data.settings.news_variation_count,
                imageSource: data.settings.image_source,
                ogBackgroundUrl: data.settings.og_background_url,
                ogFont: data.settings.og_font
            };
            // Update cache
            cachedPageSettings = settings;
            console.log("[Settings Panel] Loaded from API:", settings);
        }
    } catch (err) {
        console.error("[Settings Panel] Failed to load settings:", err);
    }

    // Apply settings to panel
    if (settings) {
        autoScheduleEnabledPanel.checked = settings.autoSchedule || false;
        scheduleMinutesPanel.value = settings.scheduleMinutes || "00, 15, 30, 45";
        if (workingHoursStart) workingHoursStart.value = settings.workingHoursStart ?? 6;
        if (workingHoursEnd) workingHoursEnd.value = settings.workingHoursEnd ?? 24;
        imageSourceSelectPanel.value = settings.imageSource || "ai";
        ogBackgroundUrlPanel.value = settings.ogBackgroundUrl || "";
        ogFontSelectPanel.value = settings.ogFont || "noto-sans-thai";
    } else {
        // If no settings, set defaults
        settings = {
            pageId,
            autoSchedule: false,
            scheduleMinutes: "00, 15, 30, 45",
            workingHoursStart: 6,
            workingHoursEnd: 24,
            postToken: "",
            aiModel: "gemini-2.0-flash-exp",
            aiResolution: "2K",
            linkImageSize: "1:1",
            imageImageSize: "1:1",
            newsAnalysisPrompt: "",
            newsGenerationPrompt: "",
            newsImageSize: "1:1",
            newsVariationCount: 4,
            imageSource: "ai",
            ogBackgroundUrl: "",
            ogFont: "noto-sans-thai"
        };
        autoScheduleEnabledPanel.checked = false;
        scheduleMinutesPanel.value = "00, 15, 30, 45";
        if (workingHoursStart) workingHoursStart.value = 6;
        if (workingHoursEnd) workingHoursEnd.value = 24;
        imageSourceSelectPanel.value = "ai";
        ogBackgroundUrlPanel.value = "";
        ogFontSelectPanel.value = "noto-sans-thai";
    }
    // Page Token input - show saved token (manual only)
    if (pageTokenInputPanel) {
        pageTokenInputPanel.value = settings?.postToken || "";
        console.log("[Settings Panel] Loaded postToken:", settings?.postToken ? `${settings.postToken.substring(0, 10)}...` : "(empty)");
    }
    // Hide Token input
    const hideTokenInputPanel = document.getElementById("hideTokenInputPanel");
    if (hideTokenInputPanel) {
        hideTokenInputPanel.value = settings?.hideToken || "";
    }
    // Sync minute grid with hidden input
    if (scheduleMinutesGridPanel) syncInputToMinuteGrid(scheduleMinutesPanel, scheduleMinutesGridPanel);

    // Update visibility
    const enabled = autoScheduleEnabledPanel.checked;
    const isOg = imageSourceSelectPanel.value === "og";
    scheduleIntervalGroupPanel.style.display = enabled ? "block" : "none";
    workingHoursGroupPanel.style.display = enabled ? "block" : "none";
    nextScheduleInfoPanel.style.display = enabled ? "block" : "none";
    imageSourceGroupPanel.style.display = enabled ? "block" : "none";
    ogBackgroundGroupPanel.style.display = (enabled && isOg) ? "block" : "none";
    ogFontGroupPanel.style.display = (enabled && isOg) ? "block" : "none";
    if (enabled) {
        nextScheduleDisplayPanel.textContent = calculateNextScheduleForPanel();
    }

    // Load AI prompts from database
    try {
        const promptsRes = await fetch(`/api/prompts?pageId=${pageId}`);
        const promptsData = await promptsRes.json();
        if (promptsData.success && promptsData.prompts.length > 0) {
            const linkPrompt = promptsData.prompts.find(p => p.prompt_type === 'link_post');
            const imagePrompt = promptsData.prompts.find(p => p.prompt_type === 'image_post');
            linkPromptInput.value = linkPrompt?.prompt_text || "";
            imagePromptInput.value = imagePrompt?.prompt_text || "";
        } else {
            // Try loading default prompts
            const defaultRes = await fetch(`/api/prompts?pageId=_default`);
            const defaultData = await defaultRes.json();
            if (defaultData.success && defaultData.prompts.length > 0) {
                const defaultLinkPrompt = defaultData.prompts.find(p => p.prompt_type === 'link_post');
                const defaultImagePrompt = defaultData.prompts.find(p => p.prompt_type === 'image_post');
                linkPromptInput.value = defaultLinkPrompt?.prompt_text || "";
                imagePromptInput.value = defaultImagePrompt?.prompt_text || "";
            }
        }
    } catch (e) {
        console.error('[Settings] Failed to load prompts from DB:', e);
    }

    // Load image sizes from database
    const savedLinkImageSize = settings?.linkImageSize || settings?.link_image_size || "1:1";
    const savedImageImageSize = settings?.imageImageSize || settings?.image_image_size || "1:1";
    const savedNewsImageSize = settings?.newsImageSize || settings?.news_image_size || "1:1";
    setLinkImageSize(savedLinkImageSize);
    setImageImageSize(savedImageImageSize);
    setNewsImageSize(savedNewsImageSize);

    // Load news prompts
    if (newsAnalysisPromptInput) newsAnalysisPromptInput.value = settings?.newsAnalysisPrompt || "";
    if (newsGenerationPromptInput) newsGenerationPromptInput.value = settings?.newsGenerationPrompt || "";
    if (newsVariationCount) newsVariationCount.value = settings?.newsVariationCount || 4;

    // Auto-resize textareas after loading content
    autoResizeTextarea(linkPromptInput);
    autoResizeTextarea(imagePromptInput);
    if (newsAnalysisPromptInput) autoResizeTextarea(newsAnalysisPromptInput);
    if (newsGenerationPromptInput) autoResizeTextarea(newsGenerationPromptInput);

    // Load AI settings from database
    const savedAiModel = settings?.aiModel || settings?.ai_model || "gemini-2.0-flash-exp";
    const savedAiResolution = settings?.aiResolution || settings?.ai_resolution || "2K";
    aiModelSelect.value = savedAiModel;
    aiResolutionSelect.value = savedAiResolution;

    // Load Auto-Post Alternating config
    await loadAutoPostConfig();

    // Load Auto-Hide config
    await loadAutoHideConfig();
}

// Auto schedule checkbox change handler for panel
autoScheduleEnabledPanel.addEventListener("change", () => {
    const enabled = autoScheduleEnabledPanel.checked;
    const isOg = imageSourceSelectPanel.value === "og";
    scheduleIntervalGroupPanel.style.display = enabled ? "block" : "none";
    workingHoursGroupPanel.style.display = enabled ? "block" : "none";
    nextScheduleInfoPanel.style.display = enabled ? "block" : "none";
    imageSourceGroupPanel.style.display = enabled ? "block" : "none";
    ogBackgroundGroupPanel.style.display = (enabled && isOg) ? "block" : "none";
    ogFontGroupPanel.style.display = (enabled && isOg) ? "block" : "none";
    if (enabled) {
        nextScheduleDisplayPanel.textContent = calculateNextScheduleForPanel();
    }
});

// Image source change handler for panel
imageSourceSelectPanel.addEventListener("change", () => {
    const isOg = imageSourceSelectPanel.value === "og";
    const enabled = autoScheduleEnabledPanel.checked;
    ogBackgroundGroupPanel.style.display = (enabled && isOg) ? "block" : "none";
    ogFontGroupPanel.style.display = (enabled && isOg) ? "block" : "none";
});

// Schedule minutes change handler for panel
scheduleMinutesPanel.addEventListener("input", () => {
    if (autoScheduleEnabledPanel.checked) {
        nextScheduleDisplayPanel.textContent = calculateNextScheduleForPanel();
    }
});

// Save settings panel button handler
saveSettingsPanelBtn.addEventListener("click", async () => {
    const pageId = getCurrentPageId();
    if (!pageId) {
        alert("กรุณาเลือกเพจก่อน");
        return;
    }

    const autoSchedule = autoScheduleEnabledPanel.checked;
    const mins = scheduleMinutesPanel.value || "00, 15, 30, 45";
    const postToken = pageTokenInputPanel?.value?.trim() ?? "";
    console.log("[Settings Panel] Saving postToken:", postToken ? `${postToken.substring(0, 10)}...` : "(empty)");
    const workingStart = parseInt(workingHoursStart.value) || 6;
    const workingEnd = parseInt(workingHoursEnd.value) || 24;
    const linkPrompt = linkPromptInput.value.trim();
    const imagePrompt = imagePromptInput.value.trim();
    const linkImageSize = getLinkImageSize();
    const imageImageSize = getImageImageSize();
    const newsImageSize = getNewsImageSize();
    const newsAnalysisPrompt = newsAnalysisPromptInput?.value?.trim() || "";
    const newsGenerationPrompt = newsGenerationPromptInput?.value?.trim() || "";
    const newsVarCount = parseInt(newsVariationCount?.value) || 4;
    const imageSource = imageSourceSelectPanel.value || "ai";
    const ogBgUrl = ogBackgroundUrlPanel.value || "";
    const ogFont = ogFontSelectPanel.value || "noto-sans-thai";

    // Update cache immediately
    cachedPageSettings = {
        pageId,
        autoSchedule,
        scheduleMinutes: mins,
        workingHoursStart: workingStart,
        workingHoursEnd: workingEnd,
        postToken,
        aiModel: aiModelSelect.value,
        aiResolution: aiResolutionSelect.value,
        linkImageSize,
        imageImageSize,
        newsImageSize,
        newsAnalysisPrompt,
        newsGenerationPrompt,
        newsVariationCount: newsVarCount,
        imageSource,
        ogBackgroundUrl: ogBgUrl,
        ogFont
    };

    // Also update the modal settings (keep in sync)
    autoScheduleEnabled.checked = autoSchedule;
    scheduleMinutes.value = mins;
    if (scheduleMinutesGrid) syncInputToMinuteGrid(scheduleMinutes, scheduleMinutesGrid);
    scheduleIntervalGroup.style.display = autoSchedule ? "block" : "none";
    nextScheduleInfo.style.display = autoSchedule ? "block" : "none";

    // Save to database via API
    try {
        // Save page settings to database
        const requestBody = {
            pageId,
            autoSchedule,
            scheduleMinutes: mins,
            postToken,
            workingHoursStart: workingStart,
            workingHoursEnd: workingEnd,
            aiModel: aiModelSelect.value,
            aiResolution: aiResolutionSelect.value,
            linkImageSize,
            imageImageSize,
            newsImageSize,
            newsAnalysisPrompt,
            newsGenerationPrompt,
            newsVariationCount: newsVarCount,
            imageSource,
            ogBackgroundUrl: ogBgUrl,
            ogFont
        };
        console.log("[Settings Panel] Sending postToken to API:", postToken ? `${postToken.substring(0, 10)}...` : "(empty)");
        console.log("[Settings Panel] Full request body:", { ...requestBody, postToken: postToken ? `${postToken.substring(0, 10)}...` : "(empty)" });

        const response = await fetch('/api/page-settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody)
        });
        const data = await response.json();
        console.log("[Settings Panel] API response:", data);
        console.log("[Settings Panel] API response post_token:", data.settings?.post_token ? `${data.settings.post_token.substring(0, 10)}...` : "(empty/null)");

        // Save prompts to database
        if (linkPrompt) {
            await fetch('/api/prompts', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    pageId,
                    promptType: 'link_post',
                    promptText: linkPrompt
                })
            });
        }
        if (imagePrompt) {
            await fetch('/api/prompts', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    pageId,
                    promptType: 'image_post',
                    promptText: imagePrompt
                })
            });
        }

        // Save Auto-Post Alternating config
        await saveAutoPostConfig();

        if (data.success) {
            console.log("[FEWFEED] Settings and prompts saved to database");
            console.log("[FEWFEED] Saved postToken in response:", data.settings?.post_token ? `${data.settings.post_token.substring(0, 10)}...` : "(empty/null)");

            // Update input field directly from response to preserve token value
            if (pageTokenInputPanel && data.settings?.post_token) {
                pageTokenInputPanel.value = data.settings.post_token;
                console.log("[FEWFEED] Updated pageTokenInputPanel from response");
            } else if (pageTokenInputPanel && !data.settings?.post_token) {
                // If token was cleared (null), keep the input empty
                pageTokenInputPanel.value = "";
                console.log("[FEWFEED] Cleared pageTokenInputPanel (token was null)");
            }

            // Update cache with saved data
            if (data.settings) {
                cachedPageSettings = {
                    ...cachedPageSettings,
                    postToken: data.settings.post_token || ""
                };
            }

            // Update next schedule display since settings may have changed
            updateNextScheduleDisplay();

            // Show success feedback
            saveSettingsPanelBtn.textContent = "บันทึกแล้ว ✓";
            saveSettingsPanelBtn.style.background = "#10b981";
            setTimeout(() => {
                saveSettingsPanelBtn.textContent = "บันทึกการตั้งค่า";
                saveSettingsPanelBtn.style.background = "";
            }, 2000);
        } else {
            console.error("[FEWFEED] Failed to save settings:", data.error);
            alert("บันทึกไม่สำเร็จ: " + data.error);
        }
    } catch (error) {
        console.error("[FEWFEED] API error:", error);
        alert("บันทึกไม่สำเร็จ กรุณาลองใหม่");
    }

    updatePublishButton();
});

// Load settings on page load
loadSettings();

// Nav elements
const dashboardNavItem =
    document.getElementById("dashboardNavItem");
const imageNavItem = document.getElementById("imageNavItem");
const textNavItem = document.getElementById("textNavItem");
const reelsNavItem = document.getElementById("reelsNavItem");
const pendingNavItem = document.getElementById("pendingNavItem");
const publishedNavItem = document.getElementById("publishedNavItem");
const quotesNavItem = document.getElementById("quotesNavItem");
const earningsNavItem = document.getElementById("earningsNavItem");
const pendingBadge = document.getElementById("pendingBadge");
const pendingPanel = document.getElementById("pendingPanel");
const publishedPanel = document.getElementById("publishedPanel");
const publishedTableContainer = document.getElementById("publishedTableContainer");
const quotesPanel = document.getElementById("quotesPanel");
const earningsPanel = document.getElementById("earningsPanel");
const settingsPanel = document.getElementById("settingsPanel");
const pendingTableContainer = document.getElementById(
    "pendingTableContainer",
);
const previewPanel = document.querySelector(".preview-panel");
const formPanel = document.querySelector(".form-panel");
const appLayout = document.querySelector(".app-layout");

// Sort state for pending posts (true = newest first, false = oldest/soonest first)
let sortNewestFirst = true;
const sortToggleBtn = document.getElementById("sortToggleBtn");

function updateSortButton() {
    const icon = sortToggleBtn.querySelector(".sort-icon");
    const label = sortToggleBtn.querySelector(".sort-label");
    if (sortNewestFirst) {
        icon.textContent = "↓";
        label.textContent = "ล่าสุดก่อน";
    } else {
        icon.textContent = "↑";
        label.textContent = "โพสต์เร็วๆนี้ก่อน";
    }
}

if (sortToggleBtn) {
    sortToggleBtn.addEventListener("click", () => {
        sortNewestFirst = !sortNewestFirst;
        updateSortButton();
        // Re-render with new sort order
        const pageId = getCurrentPageId();
        const cachedPosts = getCachedPosts(pageId);
        if (cachedPosts) {
            renderPendingPosts(cachedPosts);
        }
    });
}

// Link-only elements (hidden in Image mode)
const linkOnlyFields = document.getElementById("linkOnlyFields");
const cardButtonGroup = document.getElementById("cardButtonGroup");
const cardLinkInfo = document.getElementById("cardLinkInfo");

// Current post mode: 'link' or 'image'
let postMode = "link";

// State per mode - each mode has independent state
const modeState = {
    link: {
        referenceImages: [],
        generatedImages: [],
        selectedImage: null,
        currentView: "upload",
        lastCaption: "", // Store last used caption for regeneration
    },
    image: {
        referenceImages: [],
        generatedImages: [],
        selectedImage: null,
        currentView: "upload",
        lastCaption: "",
    },
    reels: {
        referenceImages: [],
        generatedImages: [],
        selectedImage: null,
        currentView: "upload",
        lastCaption: "",
    },
};

// Update pending count from Facebook API
async function updatePendingCount() {
    try {
        const scheduledPosts =
            await fetchScheduledPostsFromFacebook();
        const count = scheduledPosts.length;
        pendingBadge.textContent = count;
        pendingBadge.style.display = count > 0 ? "inline" : "none";
    } catch (err) {
        console.error("Failed to fetch pending count:", err);
    }
}

// ============================================
// 9. PENDING POSTS
// ============================================
async function fetchScheduledPostsFromFacebook() {
    const pageId = document.getElementById("pageSelect").value;
    const selectedPageToken = localStorage.getItem("fewfeed_selectedPageToken");

    console.log("[FEWFEED] Fetching scheduled posts:", {
        hasPageId: !!pageId,
        pageId: pageId || "(empty)",
        hasSelectedPageToken: !!selectedPageToken,
        tokenPrefix: selectedPageToken?.substring(0, 15) + "...",
    });

    if (!pageId || !selectedPageToken) {
        console.log(
            "[FEWFEED] Pages not loaded yet - showing skeleton",
        );
        return { loading: true };
    }

    const token = selectedPageToken;

    try {
        const response = await fetch("/api/scheduled-posts", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ pageId, pageToken: token }),
        });
        const data = await response.json();

        console.log("[FEWFEED] Scheduled posts response:", data);

        if (data.success && data.posts) {
            return data.posts;
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
            const pageToken = localStorage.getItem("fewfeed_selectedPageToken");
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
            const pageToken = localStorage.getItem("fewfeed_selectedPageToken");
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

    const pageId = getCurrentPageId() || localStorage.getItem("fewfeed_selectedPageId");
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
    const pageId = getCurrentPageId() || localStorage.getItem("fewfeed_selectedPageId");

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

// Delete published log
async function deletePublishedLog(logId) {
    if (!confirm("ต้องการลบ log นี้?")) return;
    try {
        const response = await fetch(`/api/auto-post-logs?id=${logId}`, { method: 'DELETE' });
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
// 7. QUOTES
// ============================================
const quotesTableContainer = document.getElementById("quotesTableContainer");

let quotesOffset = 0;
let quotesTotal = 0;
let quotesHasMore = false;
let quotesLoading = false;
let quotesFilter = 'unused';

// Tabs click handlers
const quotesTabUnused = document.getElementById("quotesTabUnused");
const quotesTabUsed = document.getElementById("quotesTabUsed");

quotesTabUnused.addEventListener("click", () => {
    quotesFilter = 'unused';
    quotesTabUnused.style.color = '#1877f2';
    quotesTabUnused.style.borderBottom = '2px solid #1877f2';
    quotesTabUsed.style.color = '#666';
    quotesTabUsed.style.borderBottom = '2px solid transparent';
    loadQuotes();
});

quotesTabUsed.addEventListener("click", () => {
    quotesFilter = 'used';
    quotesTabUsed.style.color = '#1877f2';
    quotesTabUsed.style.borderBottom = '2px solid #1877f2';
    quotesTabUnused.style.color = '#666';
    quotesTabUnused.style.borderBottom = '2px solid transparent';
    loadQuotes();
});

// Add Quote Modal
const addQuoteModal = document.getElementById("addQuoteModal");
const addQuoteBtn = document.getElementById("addQuoteBtn");
const closeQuoteModal = document.getElementById("closeQuoteModal");
const cancelQuoteBtn = document.getElementById("cancelQuoteBtn");
const saveQuoteBtn = document.getElementById("saveQuoteBtn");
const newQuoteText = document.getElementById("newQuoteText");

if (addQuoteBtn) {
    addQuoteBtn.addEventListener("click", () => {
        addQuoteModal.style.display = "flex";
        newQuoteText.value = "";
        newQuoteText.focus();
    });
}

if (closeQuoteModal) {
    closeQuoteModal.addEventListener("click", () => {
        addQuoteModal.style.display = "none";
    });
}

if (cancelQuoteBtn) {
    cancelQuoteBtn.addEventListener("click", () => {
        addQuoteModal.style.display = "none";
    });
}

if (addQuoteModal) {
    addQuoteModal.addEventListener("click", (e) => {
        if (e.target === addQuoteModal) {
            addQuoteModal.style.display = "none";
        }
    });
}

if (saveQuoteBtn) {
    saveQuoteBtn.addEventListener("click", async () => {
        const text = newQuoteText.value.trim();
        if (!text) {
            alert("กรุณาพิมพ์คำคม");
            return;
        }

        saveQuoteBtn.disabled = true;
        saveQuoteBtn.textContent = "กำลังบันทึก...";

        try {
            const response = await fetch("/api/quotes", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ quoteText: text })
            });
            const data = await response.json();

            if (data.success) {
                addQuoteModal.style.display = "none";
                loadQuotes();
            } else {
                alert("เกิดข้อผิดพลาด: " + data.error);
            }
        } catch (error) {
            alert("เกิดข้อผิดพลาด: " + error.message);
        } finally {
            saveQuoteBtn.disabled = false;
            saveQuoteBtn.textContent = "บันทึก";
        }
    });
}

// Infinite scroll for quotes (using container scroll)
quotesTableContainer.addEventListener("scroll", () => {
    if (quotesLoading || !quotesHasMore) return;
    const { scrollTop, scrollHeight, clientHeight } = quotesTableContainer;
    // Load more when 200px from bottom
    if (scrollTop + clientHeight >= scrollHeight - 200) {
        loadQuotes(true);
    }
});

async function loadQuotes(append = false) {
    if (quotesLoading) return;
    quotesLoading = true;
    try {
        if (!append) {
            quotesOffset = 0;
            quotesTableContainer.innerHTML = `
                <div class="pending-skeleton">
                  <div class="pending-skeleton-row"><div class="sk-text" style="width: 80%;"></div><div class="sk-date"></div></div>
                  <div class="pending-skeleton-row"><div class="sk-text" style="width: 80%;"></div><div class="sk-date"></div></div>
                  <div class="pending-skeleton-row"><div class="sk-text" style="width: 80%;"></div><div class="sk-date"></div></div>
                </div>
            `;
        }
        const pageId = getCurrentPageId();
        const response = await fetch(`/api/quotes?limit=50&offset=${quotesOffset}&filter=${quotesFilter}${pageId ? '&pageId=' + pageId : ''}`);
        const data = await response.json();
        if (data.success) {
            quotesTotal = data.total;
            quotesHasMore = data.hasMore;
            quotesOffset += data.quotes.length;
            renderQuotes(data.quotes, append);
            // Update counts
            if (data.unusedCount !== undefined) {
                document.getElementById("quotesCountUnused").textContent = data.unusedCount;
            }
            if (data.usedCount !== undefined) {
                document.getElementById("quotesCountUsed").textContent = data.usedCount;
            }
        } else {
            quotesTableContainer.innerHTML = `<div class="pending-empty">${data.error}</div>`;
        }
    } catch (error) {
        console.error("[FEWFEED] Failed to load quotes:", error);
        quotesTableContainer.innerHTML = `<div class="pending-empty">Failed to load quotes</div>`;
    } finally {
        quotesLoading = false;
    }
}

function renderQuotes(quotes, append = false) {
    if (!append) {
        quotesTableContainer.textContent = "";
    }

    if (!quotes || quotes.length === 0) {
        if (!append) {
            const emptyDiv = document.createElement("div");
            emptyDiv.className = "pending-empty";
            emptyDiv.textContent = "ยังไม่มีคำคม";
            quotesTableContainer.appendChild(emptyDiv);
        }
        return;
    }

    let table = quotesTableContainer.querySelector("table");
    let tbody;

    if (!table) {
        table = document.createElement("table");
        table.className = "pending-table";
        table.innerHTML = `
            <thead>
                <tr>
                    <th style="width: 75%;">คำคม</th>
                    <th style="width: 20%;">วันที่</th>
                    <th style="width: 5%;"></th>
                </tr>
            </thead>
        `;
        tbody = document.createElement("tbody");
        table.appendChild(tbody);
        quotesTableContainer.appendChild(table);
    } else {
        tbody = table.querySelector("tbody");
    }

    quotes.forEach(quote => {
        const tr = document.createElement("tr");
        tr.dataset.quoteId = quote.id;
        tr.dataset.quoteText = quote.quote_text; // Store raw text in data attribute
        if (quote.isUsed && quotesFilter === 'used') {
            tr.classList.add("quote-row-used");
        }
        const date = new Date(quote.created_at);
        // Build HTML without extra whitespace in quote cell
        const quoteHtml = escapeHtml(quote.quote_text.trim());
        // Only show badge in "used" tab
        const badgeHtml = (quote.isUsed && quotesFilter === 'used') ? ' <span class="quote-used-badge">ใช้แล้ว</span>' : '';
        tr.innerHTML = `<td class="quote-text-cell" style="white-space: pre-wrap; word-break: break-word;" title="ดับเบิลคลิกเพื่อแก้ไข">${quoteHtml}${badgeHtml}</td><td style="color: #888; font-size: 0.85rem;">${date.toLocaleDateString('th-TH')} ${date.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })}</td><td style="text-align: center;"><button onclick="deleteQuote(${quote.id}, this)" style="background: none; border: none; color: #e74c3c; cursor: pointer; padding: 0.5rem;" title="ลบ"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg></button></td>`;
        // Add double-click handler for editing
        const textCell = tr.querySelector('.quote-text-cell');
        textCell.addEventListener('dblclick', () => startEditQuote(quote.id, textCell));
        tbody.appendChild(tr);
    });
}

function escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
}

window.deleteQuote = async function (id, btn) {
    try {
        const row = btn.closest("tr");
        // Replace trash icon with spinner
        const originalIcon = btn.innerHTML;
        btn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="animation: spin 1s linear infinite;">
            <circle cx="12" cy="12" r="10" stroke-dasharray="31.4" stroke-dashoffset="10"></circle>
        </svg>`;
        btn.disabled = true;

        const response = await fetch(`/api/quotes?id=${id}`, { method: "DELETE" });
        const data = await response.json();
        if (data.success) {
            if (row) row.remove();
            const tbody = quotesTableContainer.querySelector("tbody");
            if (tbody && tbody.children.length === 0) {
                quotesTableContainer.innerHTML = '<div class="pending-empty">ยังไม่มีคำคม</div>';
            }
        } else {
            btn.innerHTML = originalIcon;
            btn.disabled = false;
            alert("ลบไม่สำเร็จ: " + data.error);
        }
    } catch (error) {
        console.error("[FEWFEED] Failed to delete quote:", error);
        alert("ลบไม่สำเร็จ");
    }
};

// Inline quote editing
function startEditQuote(quoteId, cell) {
    // Skip if already editing
    if (cell.querySelector('textarea')) return;

    // Get original text from data attribute (cleaner than textContent)
    const row = cell.closest('tr');
    const originalText = row.dataset.quoteText || cell.textContent.replace(/ใช้แล้ว$/, '').trim();
    const isUsed = row.classList.contains('quote-row-used');
    const textarea = document.createElement('textarea');
    textarea.value = originalText;
    textarea.style.cssText = `
        width: 100%;
        min-height: 100px;
        max-height: 300px;
        padding: 0.75rem;
        border: 2px solid #9b59b6;
        border-radius: 8px;
        font-size: 0.95rem;
        line-height: 1.5;
        resize: vertical;
        font-family: inherit;
        background: #fff;
        color: #333;
        box-shadow: 0 2px 8px rgba(155, 89, 182, 0.2);
        outline: none;
        box-sizing: border-box;
    `;

    cell.textContent = '';
    cell.appendChild(textarea);
    textarea.focus();

    // Auto-resize textarea to fit content
    textarea.style.height = 'auto';
    textarea.style.height = Math.min(Math.max(textarea.scrollHeight, 100), 300) + 'px';
    textarea.select();

    // Helper to rebuild cell content
    const rebuildCell = (text) => {
        const badgeHtml = isUsed ? ' <span class="quote-used-badge">ใช้แล้ว</span>' : '';
        cell.innerHTML = escapeHtml(text) + badgeHtml;
        row.dataset.quoteText = text;
    };

    // Save on blur or Enter (Shift+Enter for new line)
    const saveEdit = async () => {
        const newText = textarea.value.trim();
        if (!newText) {
            rebuildCell(originalText);
            return;
        }
        if (newText === originalText.trim()) {
            rebuildCell(originalText);
            return;
        }

        textarea.disabled = true;
        textarea.style.opacity = '0.5';

        try {
            const response = await fetch('/api/quotes', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: quoteId, quoteText: newText })
            });
            const data = await response.json();
            if (data.success) {
                rebuildCell(newText);
            } else {
                rebuildCell(originalText);
                alert('แก้ไขไม่สำเร็จ: ' + data.error);
            }
        } catch (error) {
            console.error('[FEWFEED] Failed to update quote:', error);
            rebuildCell(originalText);
            alert('แก้ไขไม่สำเร็จ');
        }
    };

    let saving = false;
    textarea.addEventListener('blur', () => {
        if (!saving) {
            saving = true;
            saveEdit();
        }
    });
    textarea.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            if (!saving) {
                saving = true;
                saveEdit();
            }
        }
        if (e.key === 'Escape') {
            rebuildCell(originalText);
        }
    });
}

// Delete pending item
window.deletePendingItem = async function (id) {
    try {
        await fetch(`/api/queue/${id}`, { method: "DELETE" });
        showPendingPanel(); // Refresh the table
        updatePendingCount();
    } catch (err) {
        console.error("Failed to delete pending item:", err);
    }
};

// Navigate to a specific page (updates URL hash)
function navigateTo(page) {
    window.location.hash = page;
}

// ============================================
// 12. NAVIGATION
// ============================================
function handleNavigation() {
    const hash = window.location.hash.slice(1) || "link";

    document
        .querySelectorAll(".nav-item")
        .forEach((item) => item.classList.remove("active"));

    if (hash === "pending") {
        pendingNavItem.classList.add("active");
        showPendingPanel();
    } else if (hash === "published") {
        publishedNavItem.classList.add("active");
        showPublishedPanel();
    } else if (hash === "quotes") {
        quotesNavItem.classList.add("active");
        showQuotesPanel();
    } else if (hash === "earnings") {
        earningsNavItem.classList.add("active");
        showEarningsPanel();
    } else if (hash === "settings") {
        document.getElementById("settingsNavBtn").classList.add("active");
        showSettingsPanel();
    } else if (hash === "news") {
        document.getElementById("newsNavItem").classList.add("active");
        setPostMode("news");
        showDashboard();
    } else if (hash === "image") {
        imageNavItem.classList.add("active");
        setPostMode("image");
        showDashboard();
    } else if (hash === "reels") {
        reelsNavItem.classList.add("active");
        setPostMode("reels");
        showDashboard();
    } else if (hash === "text") {
        textNavItem.classList.add("active");
        showTextPanel();
    } else {
        // Default: link
        dashboardNavItem.classList.add("active");
        setPostMode("link");
        showDashboard();
    }
    // Re-validate after mode change
    validateLinkMode();
}

// Listen for hash changes (back/forward navigation)
window.addEventListener("hashchange", handleNavigation);

// Handle initial page load
handleNavigation();

// Pending nav item click
pendingNavItem.addEventListener("click", (e) => {
    e.preventDefault();
    navigateTo("pending");
});

// Published nav item click
publishedNavItem.addEventListener("click", (e) => {
    e.preventDefault();
    navigateTo("published");
});

// Quotes nav item click
quotesNavItem.addEventListener("click", (e) => {
    e.preventDefault();
    navigateTo("quotes");
});

// Earnings nav item click
earningsNavItem.addEventListener("click", (e) => {
    e.preventDefault();
    navigateTo("earnings");
});

// Settings nav item click
document.getElementById("settingsNavBtn").addEventListener("click", (e) => {
    e.preventDefault();
    navigateTo("settings");
});

// Link nav item click (Dashboard renamed to Link)
dashboardNavItem.addEventListener("click", (e) => {
    e.preventDefault();
    navigateTo("link");
});

// News nav item click
document.getElementById("newsNavItem").addEventListener("click", (e) => {
    e.preventDefault();
    navigateTo("news");
});

// News mode upload handlers
const newsUploadFromDevice = document.getElementById("newsUploadFromDevice");
const newsFileInput = document.createElement("input");
newsFileInput.type = "file";
newsFileInput.accept = "image/*";
newsFileInput.multiple = true;

let newsSelectedImages = [];
let newsGeneratedImages = [];
let newsIsGenerating = false;

if (newsUploadFromDevice) {
    newsUploadFromDevice.addEventListener("click", () => {
        newsFileInput.click();
    });
}

newsFileInput.addEventListener("change", async (e) => {
    const files = Array.from(e.target.files);
    if (files.length === 0) return;

    const loadPromises = files.map(file => {
        return new Promise((resolve) => {
            const reader = new FileReader();
            reader.onload = (ev) => resolve({
                data: ev.target.result.split(',')[1],
                dataUrl: ev.target.result,
                mimeType: file.type,
                name: file.name
            });
            reader.readAsDataURL(file);
        });
    });

    const newImages = await Promise.all(loadPromises);
    newsSelectedImages.push(...newImages);
    newsFileInput.value = "";

    // Auto generate after selecting images
    await generateNewsImages();
});

async function generateNewsImages() {
    if (newsSelectedImages.length === 0 || newsIsGenerating) return;

    newsIsGenerating = true;
    const container = document.getElementById("newsFullImageView");
    const uploadPrompt = document.getElementById("newsUploadPrompt");

    // Show loading skeleton
    uploadPrompt.style.display = "none";
    container.style.display = "grid";
    container.style.gridTemplateColumns = "repeat(2, 1fr)";
    container.style.gap = "8px";
    container.style.padding = "8px";
    container.innerHTML = `
        <div class="skeleton-card" style="aspect-ratio: 1; background: linear-gradient(90deg, #2a2a2a 25%, #3a3a3a 50%, #2a2a2a 75%); background-size: 200% 100%; animation: shimmer 1.5s infinite; border-radius: 8px;"></div>
        <div class="skeleton-card" style="aspect-ratio: 1; background: linear-gradient(90deg, #2a2a2a 25%, #3a3a3a 50%, #2a2a2a 75%); background-size: 200% 100%; animation: shimmer 1.5s infinite; border-radius: 8px;"></div>
        <div class="skeleton-card" style="aspect-ratio: 1; background: linear-gradient(90deg, #2a2a2a 25%, #3a3a3a 50%, #2a2a2a 75%); background-size: 200% 100%; animation: shimmer 1.5s infinite; border-radius: 8px;"></div>
        <div class="skeleton-card" style="aspect-ratio: 1; background: linear-gradient(90deg, #2a2a2a 25%, #3a3a3a 50%, #2a2a2a 75%); background-size: 200% 100%; animation: shimmer 1.5s infinite; border-radius: 8px;"></div>
        <style>@keyframes shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }</style>
    `;

    try {
        const pageId = getCurrentPageId();

        // Get settings
        const settingsRes = await fetch(`/api/page-settings?pageId=${pageId}`);
        const settingsData = await settingsRes.json();
        const settings = settingsData.settings || {};

        // Prepare reference images (compress first)
        const referenceImages = await Promise.all(newsSelectedImages.map(async img => {
            const compressed = await compressImage(img.dataUrl, 1200, 0.8);
            return {
                data: compressed.split(',')[1],
                mimeType: 'image/jpeg'
            };
        }));

        const payload = {
            referenceImages,
            analysisPrompt: settings.news_analysis_prompt,
            generationPrompt: settings.news_generation_prompt,
            aspectRatio: settings.news_image_size || '1:1',
            variationCount: settings.news_variation_count || 4,
            aiModel: settings.ai_model,
            aiResolution: settings.ai_resolution
        };

        const postGenerateNews = async (url) => {
            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const data = await response.json();
            if (data.success && data.images?.length > 0) return data;
            throw new Error(data.error || 'Failed to generate');
        };

        let data;
        try {
            data = await postGenerateNews('/api/generate-news');
        } catch (primaryErr) {
            const message = primaryErr instanceof Error ? primaryErr.message : String(primaryErr);
            if (!message.includes('GEMINI_API_KEY not configured')) {
                throw primaryErr;
            }

            // Hotfix: fallback to the updated worker when api.pubilo.com still serves old code.
            data = await postGenerateNews('https://pubilo-api-prod.lungnuek.workers.dev/api/generate-news');
        }

        newsGeneratedImages = data.images;
        renderNewsGeneratedGrid();
    } catch (err) {
        console.error('[News] Generate error:', err);
        container.innerHTML = `<div style="text-align: center; color: #ef4444; padding: 20px;">เกิดข้อผิดพลาด: ${err.message}<br><button onclick="retryNewsGenerate()" style="margin-top: 12px; padding: 8px 16px; background: #333333; color: white; border: none; border-radius: 8px; cursor: pointer;">ลองใหม่</button></div>`;
    } finally {
        newsIsGenerating = false;
    }
}

window.retryNewsGenerate = function () {
    generateNewsImages();
};

function renderNewsGeneratedGrid() {
    const container = document.getElementById("newsFullImageView");
    if (!container || newsGeneratedImages.length === 0) return;

    container.style.display = "grid";
    container.style.gridTemplateColumns = "repeat(2, 1fr)";
    container.style.gap = "8px";
    container.style.padding = "8px";
    container.style.alignItems = "stretch";
    container.style.justifyContent = "stretch";

    container.innerHTML = newsGeneratedImages.map((img, i) => `
        <div style="position: relative; cursor: pointer;" onclick="selectNewsImage(${i})">
            <img src="${img}" style="width: 100%; aspect-ratio: 1; object-fit: cover; border-radius: 8px; border: 3px solid ${newsSelectedIndex === i ? '#333333' : 'transparent'};" id="newsGenImg${i}">
        </div>
    `).join("");
}

let newsSelectedIndex = 0;
window.selectNewsImage = function (index) {
    newsSelectedIndex = index;
    newsModeImageReady = true;
    validateNewsMode();

    // Show selected image full size
    const container = document.getElementById("newsFullImageView");
    container.style.display = "flex";
    container.style.flexDirection = "column";
    container.style.alignItems = "center";
    container.style.justifyContent = "center";
    container.style.padding = "0";
    container.innerHTML = `
        <img src="${newsGeneratedImages[index]}" style="width: 100%; height: 100%; object-fit: contain; border-radius: 8px;">
        <button onclick="showNewsImageGrid()" style="position: absolute; top: 12px; left: 12px; background: rgba(0,0,0,0.7); color: white; border: none; border-radius: 8px; padding: 8px 16px; cursor: pointer; display: flex; align-items: center; gap: 6px;">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
            เลือกรูปอื่น
        </button>
    `;
};

window.showNewsImageGrid = function () {
    renderNewsGeneratedGrid();
};

window.removeNewsImage = function (index) {
    newsSelectedImages.splice(index, 1);
    if (newsSelectedImages.length === 0) {
        newsGeneratedImages = [];
        const container = document.getElementById("newsFullImageView");
        container.style.display = "none";
        document.getElementById("newsUploadPrompt").style.display = "flex";
    }
};

// Image nav item click
imageNavItem.addEventListener("click", (e) => {
    e.preventDefault();
    navigateTo("image");
});

reelsNavItem.addEventListener("click", (e) => {
    e.preventDefault();
    navigateTo("reels");
});

// Text nav item click
textNavItem.addEventListener("click", (e) => {
    e.preventDefault();
    navigateTo("text");
});

// Set post mode (link, image, or reels) - toggle mode containers
function setPostMode(mode) {
    postMode = mode;

    // Hide all mode containers
    document.querySelectorAll(".mode-container").forEach((c) => {
        c.classList.remove("active");
    });

    // Show selected mode container
    const containerId = `${mode}ModeContainer`;
    const container = document.getElementById(containerId);
    if (container) {
        container.classList.add("active");
    }

    // Validate link mode when switching modes
    validateLinkMode();
}

// Update pending count on load
updatePendingCount();
// Refresh pending count every 30 seconds
setInterval(updatePendingCount, 30000);

// Preview elements
const previewCaption = document.getElementById("previewCaption");
const previewDescription =
    document.getElementById("previewDescription");
const previewCardButton =
    document.getElementById("previewCardButton");


// Helper to get current mode state
function getState() {
    return modeState[postMode] || modeState.link;
}

// Helper to get mode-specific DOM elements
function getModeElements(mode = postMode) {
    const prefix = mode === "link" ? "" : mode; // Link mode uses original IDs without prefix
    const capitalize = (s) =>
        s.charAt(0).toUpperCase() + s.slice(1);

    if (mode === "link") {
        return {
            cardImageArea: document.getElementById("cardImageArea"),
            uploadPrompt: document.getElementById("uploadPrompt"),
            uploadFromDevice:
                document.getElementById("uploadFromDevice"),
            uploadFromGemini:
                document.getElementById("uploadFromGemini"),
            generateOverlay:
                document.getElementById("generateOverlay"),
            generateBtn: document.getElementById("generateBtn"),
            refThumbsRow: document.getElementById("refThumbsRow"),
            generatedGrid: document.getElementById("generatedGrid"),
            skeletonGrid: document.getElementById("skeletonGrid"),
            fullImageView: document.getElementById("fullImageView"),
            primaryText: document.getElementById("primaryText"),
            publishBtn: document.getElementById("publishBtn"),
        };
    } else {
        return {
            cardImageArea: document.getElementById(
                `${mode}CardImageArea`,
            ),
            uploadPrompt: document.getElementById(
                `${mode}UploadPrompt`,
            ),
            uploadFromDevice: document.getElementById(
                `${mode}UploadFromDevice`,
            ),
            uploadFromGemini: document.getElementById(
                `${mode}UploadFromGemini`,
            ),
            generateOverlay: document.getElementById(
                `${mode}GenerateOverlay`,
            ),
            generateBtn: document.getElementById(
                `${mode}GenerateBtn`,
            ),
            refThumbsRow: document.getElementById(
                `${mode}RefThumbsRow`,
            ),
            generatedGrid: document.getElementById(
                `${mode}GeneratedGrid`,
            ),
            skeletonGrid: document.getElementById(
                `${mode}SkeletonGrid`,
            ),
            fullImageView: document.getElementById(
                `${mode}FullImageView`,
            ),
            primaryText: document.getElementById(
                `${mode}PrimaryText`,
            ),
            publishBtn: document.getElementById(
                `${mode}PublishBtn`,
            ),
        };
    }
}

// ============================================
// LAZADA AFFILIATE LINK CONVERSION (Auto-convert)
// ============================================
const lazadaStatus = document.getElementById("lazadaStatus");
let isConverting = false;

// Check if URL is a Lazada product URL
function isLazadaUrl(url) {
    return (
        url &&
        (url.includes("lazada.co.th/products/") ||
            url.includes("lazada.co.th/products/-"))
    );
}

// Convert Lazada URL to affiliate link
async function convertLazadaLink() {
    if (isConverting) return;

    const url = linkUrl.value.trim();

    if (!url || !isLazadaUrl(url)) {
        return;
    }

    // Show loading state
    isConverting = true;
    lazadaStatus.textContent = "Converting...";
    lazadaStatus.style.color = "#888";

    // Send message to extension
    window.postMessage(
        {
            type: "FEWFEED_CONVERT_LAZADA_LINK",
            productUrl: url,
        },
        "*",
    );
}

// Listen for Lazada conversion response
window.addEventListener("message", (event) => {
    if (event.data.type === "FEWFEED_LAZADA_LINK_RESPONSE") {
        const response = event.data.data;
        isConverting = false;

        if (response.success && response.affiliateLink) {
            // Update the link URL field with affiliate link
            linkUrl.value = response.affiliateLink;
            lazadaStatus.textContent = "";
        } else {
            lazadaStatus.textContent =
                "❌ " + (response.error || "Conversion failed");
            lazadaStatus.style.color = "#ef4444";
        }
    }
});

// Clean Lazada URL - remove query params after .html
function cleanLazadaUrl(url) {
    if (
        url.includes("lazada.co.th/products/") &&
        url.includes(".html")
    ) {
        return url.split(".html")[0] + ".html";
    }
    return url;
}

// Auto-convert Lazada URL on paste
if (linkUrl) linkUrl.addEventListener("paste", (e) => {
    // Wait for the paste to complete
    setTimeout(() => {
        let url = linkUrl.value.trim();
        // Clean up Lazada URL first
        url = cleanLazadaUrl(url);
        linkUrl.value = url;

        if (isLazadaUrl(url) && !url.includes("s.lazada.co.th")) {
            // Auto-convert!
            convertLazadaLink();
        }
    }, 100);
});

// News URL - same Lazada conversion logic
const newsUrlInput = document.getElementById("newsUrlInput");
const newsLazadaStatus = document.getElementById("newsLazadaStatus");
const newsPreviewDescription = document.getElementById("newsPreviewDescription");
let newsIsConverting = false;

async function convertNewsLazadaLink() {
    if (newsIsConverting) return;
    const url = newsUrlInput.value.trim();
    if (!url || !isLazadaUrl(url)) return;

    newsIsConverting = true;
    if (newsLazadaStatus) {
        newsLazadaStatus.textContent = "Converting...";
        newsLazadaStatus.style.color = "#888";
    }

    window.postMessage({ type: "FEWFEED_CONVERT_NEWS_LAZADA_LINK", productUrl: url }, "*");
}

// Listen for news Lazada conversion response
window.addEventListener("message", (event) => {
    if (event.data.type === "FEWFEED_NEWS_LAZADA_LINK_RESPONSE") {
        const response = event.data.data;
        newsIsConverting = false;
        if (response.success && response.affiliateLink) {
            newsUrlInput.value = response.affiliateLink;
            if (newsLazadaStatus) newsLazadaStatus.textContent = "";
        } else {
            if (newsLazadaStatus) {
                newsLazadaStatus.textContent = "❌ " + (response.error || "Conversion failed");
                newsLazadaStatus.style.color = "#ef4444";
            }
        }
    }
});

if (newsUrlInput) {
    newsUrlInput.addEventListener("paste", (e) => {
        setTimeout(() => {
            let url = newsUrlInput.value.trim();
            url = cleanLazadaUrl(url);
            newsUrlInput.value = url;
            if (isLazadaUrl(url) && !url.includes("s.lazada.co.th")) {
                convertNewsLazadaLink();
            }
            validateNewsMode();
        }, 100);
    });
    newsUrlInput.addEventListener("input", validateNewsMode);
}

// Make news description editable (will be setup after setupEditableText is defined)
// See below after setupEditableText function

// ============================================

// Track which upload mode was clicked
let uploadMode = "gemini"; // 'device' or 'gemini'

// Setup upload button handlers for each mode
function setupUploadHandlers(mode) {
    const els = getModeElements(mode);
    if (!els.uploadFromDevice || !els.uploadFromGemini) return;

    els.uploadFromDevice.addEventListener("click", (e) => {
        e.stopPropagation();
        uploadMode = "device";
        fileInput.click();
    });

    els.uploadFromGemini.addEventListener("click", async (e) => {
        e.stopPropagation();
        // Directly trigger generate without needing to upload
        if (els.generateBtn) {
            els.generateBtn.click();
        }
    });

    // Click on card image area (for other areas)
    if (els.cardImageArea) {
        els.cardImageArea.addEventListener("click", (e) => {
            if (
                e.target.closest(".btn-generate") ||
                e.target.closest(".generated-item") ||
                e.target.closest(".back-to-grid") ||
                e.target.closest(".upload-btn")
            ) {
                return;
            }
            const state = modeState[mode];
            if (
                state.currentView === "upload" ||
                state.currentView === "refs"
            ) {
                uploadMode = "gemini";
                fileInput.click();
            }
        });
    }
}

// Setup handlers for all modes
setupUploadHandlers("link");
setupUploadHandlers("image");
setupUploadHandlers("reels");

// File input change - handle both device upload and gemini generation
fileInput.addEventListener("change", async (e) => {
    const files = Array.from(e.target.files);
    if (files.length === 0) return;

    // Get current mode's state and elements
    const state = getState();
    const els = getModeElements();

    if (uploadMode === "device") {
        // Direct upload - just show the image
        const file = files[0]; // Use first file only
        const reader = new FileReader();
        reader.onload = (ev) => {
            state.selectedImage = ev.target.result;
            if (postMode === "link") {
                linkModeImageReady = true;
            }

            // Show image in full view
            state.currentView = "full";
            els.uploadPrompt.style.display = "none";
            els.refThumbsRow.style.display = "none";
            els.generateOverlay.style.display = "none";
            els.generatedGrid.style.display = "none";
            els.skeletonGrid.style.display = "none";

            els.fullImageView.style.display = "block";
            // Create image element
            const imgEl = document.createElement("img");
            imgEl.src = state.selectedImage;
            imgEl.style.cssText =
                "width: 100%; height: 100%; object-fit: contain;";

            const backBtn = document.createElement("button");
            backBtn.className = "back-to-upload";
            backBtn.style.cssText =
                "position: absolute; top: 10px; left: 10px; background: rgba(0,0,0,0.5); border: none; border-radius: 8px; padding: 8px; cursor: pointer; color: white;";
            backBtn.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>`;

            els.fullImageView.textContent = "";
            els.fullImageView.appendChild(imgEl);
            els.fullImageView.appendChild(backBtn);

            // Add click handler for back button (capture current mode)
            const currentMode = postMode;
            backBtn.addEventListener("click", (ev) => {
                ev.stopPropagation();
                const s = modeState[currentMode];
                const e = getModeElements(currentMode);
                s.selectedImage = null;
                s.currentView = "upload";
                e.fullImageView.style.display = "none";
                e.uploadPrompt.style.display = "flex";
                if (currentMode === "link") {
                    linkModeImageReady = false;
                }
                validateLinkMode(); // Re-validate when image is cleared
            });

            // Update preview
            els.publishBtn.classList.remove("published");
            lastPublishedUrl = null;
            validateLinkMode(); // Enable SCHEDULE when image is ready
        };
        reader.readAsDataURL(file);
        fileInput.value = "";
        return;
    }

    // Gemini mode - generate variations
    // Show skeleton grid immediately
    state.currentView = "generating";
    els.uploadPrompt.style.display = "none";
    els.refThumbsRow.style.display = "none";
    els.generateOverlay.style.display = "none";
    els.generatedGrid.style.display = "none";
    els.skeletonGrid.style.display = "grid";
    validateLinkMode(); // Disable SCHEDULE while generating

    // Read all files first
    state.referenceImages = [];
    const readPromises = files.map((file) => {
        return new Promise((resolve) => {
            const reader = new FileReader();
            reader.onload = (ev) => {
                resolve({
                    data: ev.target.result.split(",")[1],
                    mimeType: file.type,
                });
            };
            reader.readAsDataURL(file);
        });
    });

    state.referenceImages = await Promise.all(readPromises);
    fileInput.value = "";

    // Generate immediately with proper quote and prompt
    try {
        const pageId = getCurrentPageId();
        let caption = "";

        // For image mode: fetch quote from DB
        if (postMode === "image" && pageId) {
            const quotesRes = await fetch(`/api/quotes?limit=100&pageId=${pageId}`);
            const quotesData = await quotesRes.json();

            if (quotesData.success && quotesData.quotes.length > 0) {
                let selectedQuote = quotesData.quotes.find(q => !q.isUsed);
                if (!selectedQuote) {
                    selectedQuote = quotesData.quotes.find(
                        (q) => q.id !== state.lastUsedQuoteId,
                    ) || quotesData.quotes[0];
                }

                if (selectedQuote) {
                    caption = selectedQuote.quote_text;
                    if (!selectedQuote.isUsed) {
                        await fetch('/api/quotes', {
                            method: 'PATCH',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ id: selectedQuote.id, pageId })
                        });
                    }
                    state.lastUsedQuoteId = selectedQuote.id;
                    state.lastCaption = caption;
                    console.log('[FEWFEED] Reference upload: Auto-selected quote:', selectedQuote.id);
                }
            }
        }

        // Get prompt from database
        const promptType = postMode === "link" ? "link_post" : "image_post";
        let customPrompt = "";
        try {
            const promptRes = await fetch(`/api/prompts?pageId=${pageId}&promptType=${promptType}`);
            const promptData = await promptRes.json();
            if (promptData.success && promptData.prompts.length > 0) {
                customPrompt = promptData.prompts[0].prompt_text;
            }
        } catch (e) {
            console.warn('[FEWFEED] Failed to load prompt for reference upload');
        }

        const response = await fetch("/api/generate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                referenceImages: state.referenceImages,
                aspectRatio: getCurrentAspectRatio(),
                model: localStorage.getItem("aiModel") || "gemini-2.0-flash-exp",
                caption: caption,
                customPrompt: customPrompt,
                resolution: localStorage.getItem("aiResolution") || "2K",
                pageName: localStorage.getItem("fewfeed_selectedPageName") || "",
            }),
        });

        const data = await response.json();
        if (data.error) throw new Error(data.error);

        state.generatedImages = data.images;
        showGeneratedGrid();
    } catch (err) {
        alert("Generation failed: " + err.message);
        // Reset to upload state
        state.currentView = "upload";
        els.uploadPrompt.style.display = "flex";
        els.generateOverlay.style.display = "none";
        els.skeletonGrid.style.display = "none";
        validateLinkMode(); // Re-validate after generation fails
    }
});

// Update reference thumbnails (uses current mode)
function updateRefThumbs() {
    const state = getState();
    const els = getModeElements();

    els.refThumbsRow.textContent = "";
    state.referenceImages.forEach((img, i) => {
        const thumb = document.createElement("img");
        thumb.className = "ref-thumb";
        thumb.src = `data:${img.mimeType};base64,${img.data}`;
        els.refThumbsRow.appendChild(thumb);
    });

    // Add plus button
    const plus = document.createElement("div");
    plus.className = "ref-thumb";
    plus.innerHTML =
        '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>';
    plus.addEventListener("click", (e) => {
        e.stopPropagation();
        fileInput.click();
    });
    els.refThumbsRow.appendChild(plus);

    els.uploadPrompt.style.display = "none";
    els.refThumbsRow.style.display = "flex";
    els.generateOverlay.style.display = "flex";
}

// ============================================
// 11. IMAGE GENERATION
// ============================================
function setupGenerateHandler(mode) {
    const els = getModeElements(mode);
    if (!els.generateBtn) return;

    els.generateBtn.addEventListener("click", async (e) => {
        e.stopPropagation();
        const state = modeState[mode];

        els.generateBtn.disabled = true;
        els.generateBtn.innerHTML =
            '<span class="loading"></span> Generating...';

        // Show skeleton loading immediately (single card)
        state.currentView = "generating";
        els.uploadPrompt.style.display = "none";
        els.generateOverlay.style.display = "none";
        els.refThumbsRow.style.display = "none";
        els.generatedGrid.style.display = "none";
        els.fullImageView.style.display = "none";

        // Show single skeleton card
        els.skeletonGrid.innerHTML = '<div class="skeleton-card"></div>';
        els.skeletonGrid.classList.add('single');
        els.skeletonGrid.style.display = "grid";

        try {
            const pageId = getCurrentPageId();
            let caption = "";

            // For link mode: check Primary Text first, then fetch quote
            if (mode === "link") {
                const primaryTextField = els.primaryText;
                const userText = primaryTextField ? primaryTextField.value.trim() : "";

                if (userText) {
                    // User entered text - use it directly
                    caption = userText;
                    console.log('[FEWFEED] Using user-entered Primary Text:', caption.substring(0, 50) + '...');
                } else if (pageId) {
                    // Primary Text is empty - fetch unused quote from system
                    const quotesRes = await fetch(`/api/quotes?limit=1&filter=unused&pageId=${pageId}`);
                    const quotesData = await quotesRes.json();

                    if (quotesData.success && quotesData.quotes.length > 0) {
                        const selectedQuote = quotesData.quotes[0];
                        caption = selectedQuote.quote_text;

                        // Mark as used
                        await fetch('/api/quotes', {
                            method: 'PATCH',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ id: selectedQuote.id, pageId })
                        });

                        state.lastUsedQuoteId = selectedQuote.id;
                        console.log('[FEWFEED] Auto-selected quote:', selectedQuote.id);
                    } else {
                        console.log('[FEWFEED] No unused quotes available');
                    }
                }
            } else if (mode === "image") {
                // For image mode: check Primary Text field first, then fetch quote from DB
                const primaryTextField = els.primaryText;
                const userText = primaryTextField ? primaryTextField.value.trim() : "";

                if (userText) {
                    // User entered text - use it directly
                    caption = userText;
                    console.log('[FEWFEED] Image mode: Using user-entered Primary Text:', caption.substring(0, 50) + '...');
                } else if (pageId) {
                    // Primary Text is empty - fetch unused quote from database
                    const quotesRes = await fetch(`/api/quotes?limit=1&filter=unused&pageId=${pageId}`);
                    const quotesData = await quotesRes.json();

                    if (quotesData.success && quotesData.quotes.length > 0) {
                        const selectedQuote = quotesData.quotes[0];
                        caption = selectedQuote.quote_text;

                        // Mark as used
                        await fetch('/api/quotes', {
                            method: 'PATCH',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ id: selectedQuote.id, pageId })
                        });

                        state.lastUsedQuoteId = selectedQuote.id;
                        console.log('[FEWFEED] Image mode: Auto-selected quote:', selectedQuote.id);

                        // Update Primary Text field with the quote for caption use
                        if (primaryTextField) {
                            primaryTextField.value = caption;
                            autoResizeTextarea(primaryTextField);
                            console.log('[FEWFEED] Image mode: Updated Primary Text with quote');
                        }
                    } else {
                        console.log('[FEWFEED] Image mode: No unused quotes available');
                    }
                }
            } else {
                // For other modes (reels, etc.), get caption from field
                const captionField = document.getElementById("caption");
                caption = captionField ? captionField.value : "";
            }

            // Get aspect ratio based on mode
            const storageKey = mode === "link" ? `linkImageSize_${pageId}` : `imageImageSize_${pageId}`;
            const aspectRatio = localStorage.getItem(storageKey) || "1:1";
            console.log('[Generate] Mode:', mode, 'storageKey:', storageKey, 'aspectRatio:', aspectRatio);

            // Get AI settings - load prompt from database with fallback to localStorage
            const promptType = mode === "link" ? "link_post" : "image_post";
            console.log('[Generate] Fetching prompt with promptType:', promptType, 'pageId:', pageId);
            let customPrompt = "";
            try {
                // Try page-specific prompt first
                const promptRes = await fetch(`/api/prompts?pageId=${pageId}&promptType=${promptType}`);
                const promptData = await promptRes.json();
                if (promptData.success && promptData.prompts.length > 0) {
                    customPrompt = promptData.prompts[0].prompt_text;
                } else {
                    // Try default prompt
                    const defaultRes = await fetch(`/api/prompts?pageId=_default&promptType=${promptType}`);
                    const defaultData = await defaultRes.json();
                    if (defaultData.success && defaultData.prompts.length > 0) {
                        customPrompt = defaultData.prompts[0].prompt_text;
                    } else {
                        // Fallback to localStorage
                        const promptKey = mode === "link" ? `linkPrompt_${pageId}` : `imagePrompt_${pageId}`;
                        customPrompt = localStorage.getItem(promptKey) || "";
                    }
                }
            } catch (e) {
                console.warn('[FEWFEED] Failed to load prompt from DB, using localStorage');
                const promptKey = mode === "link" ? `linkPrompt_${pageId}` : `imagePrompt_${pageId}`;
                customPrompt = localStorage.getItem(promptKey) || "";
            }
            console.log('[Generate] Loaded customPrompt (first 100 chars):', customPrompt?.substring(0, 100));
            const pageName = localStorage.getItem("fewfeed_selectedPageName") || "";
            console.log('[Generate] pageName from localStorage:', pageName);
            const resolution = localStorage.getItem("aiResolution") || "2K";

            // Save caption to state for future regeneration
            if (caption) {
                state.lastCaption = caption;
            }

            // Build request body
            const requestBody = {
                aspectRatio: aspectRatio,
                model: localStorage.getItem("aiModel") || "gemini-2.0-flash-exp",
                numberOfImages: 1,
                caption: caption,
                resolution: resolution,
                customPrompt: customPrompt,
                pageName: pageName,
            };
            console.log('[Generate] Request body:', { aspectRatio, pageName, hasPrompt: !!customPrompt, promptType });

            // Add reference images if available
            if (state.referenceImages.length > 0) {
                requestBody.referenceImages = state.referenceImages;
            }

            const response = await fetch("/api/generate", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(requestBody),
            });

            const data = await response.json();
            if (data.error) throw new Error(data.error);

            state.generatedImages = data.images;

            // Show single image full-size directly
            if (data.images && data.images.length === 1) {
                showSingleImage(data.images[0]);
            } else {
                showGeneratedGrid();
            }
        } catch (err) {
            alert("Generation failed: " + err.message);
            // Go back to upload prompt on error
            els.skeletonGrid.style.display = "none";
            els.skeletonGrid.classList.remove('single');
            els.uploadPrompt.style.display = "flex";
            state.currentView = "upload";
        } finally {
            els.generateBtn.disabled = false;
            els.generateBtn.innerHTML =
                '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg> Generate';
        }
    });
}

// Setup generate handlers for all modes
setupGenerateHandler("link");
setupGenerateHandler("image");
setupGenerateHandler("reels");

// Show single generated image full-size
function showSingleImage(imgSrc) {
    const state = getState();
    const els = getModeElements();

    state.currentView = "single";
    state.selectedImage = imgSrc;
    els.uploadPrompt.style.display = "none";
    els.generateOverlay.style.display = "none";
    els.refThumbsRow.style.display = "none";
    els.skeletonGrid.style.display = "none";
    els.skeletonGrid.classList.remove('single');
    els.generatedGrid.style.display = "none";
    els.fullImageView.style.display = "flex";

    // Mark image as ready for link mode validation
    if (postMode === 'link') {
        linkModeImageReady = true;
        console.log('[showSingleImage] Set linkModeImageReady = true');
        validateLinkMode();
    }

    // Build the full image view
    els.fullImageView.textContent = "";
    els.fullImageView.style.cssText = `
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        width: 100%;
        height: 100%;
        background: #1a1a1a;
        position: relative;
    `;

    const imgEl = document.createElement("img");
    imgEl.src = imgSrc;
    imgEl.alt = "Generated Image";
    imgEl.style.cssText = `
        max-width: 100%;
        max-height: 100%;
        object-fit: contain;
        border-radius: 8px;
    `;
    els.fullImageView.appendChild(imgEl);

    // Add buttons at top
    const btnContainer = document.createElement("div");
    btnContainer.style.cssText = `
        position: absolute;
        top: 12px;
        right: 12px;
        display: flex;
        gap: 8px;
        z-index: 10;
    `;

    // Delete button (leftmost)
    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.className = "btn-action delete";
    deleteBtn.title = "ลบรูป";
    const deleteIcon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    deleteIcon.setAttribute("viewBox", "0 0 24 24");
    deleteIcon.setAttribute("fill", "none");
    deleteIcon.setAttribute("stroke", "currentColor");
    deleteIcon.setAttribute("stroke-width", "2");
    deleteIcon.innerHTML = '<path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>';
    deleteBtn.appendChild(deleteIcon);
    deleteBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        state.currentView = "upload";
        state.selectedImage = null;
        els.fullImageView.style.display = "none";
        els.fullImageView.textContent = "";
        els.uploadPrompt.style.display = "flex";
        // Reset image ready flag
        if (postMode === 'link') {
            linkModeImageReady = false;
        }
        validateLinkMode(); // Re-validate when image is deleted
    });
    btnContainer.appendChild(deleteBtn);

    // Regenerate with same text button
    const regenSameBtn = document.createElement("button");
    regenSameBtn.type = "button";
    regenSameBtn.className = "btn-action";
    regenSameBtn.title = "เจนใหม่ข้อความเดิม";
    const regenSameIcon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    regenSameIcon.setAttribute("viewBox", "0 0 24 24");
    regenSameIcon.setAttribute("fill", "none");
    regenSameIcon.setAttribute("stroke", "currentColor");
    regenSameIcon.setAttribute("stroke-width", "2");
    regenSameIcon.innerHTML = '<path d="M23 4v6h-6M1 20v-6h6"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>';
    regenSameBtn.appendChild(regenSameIcon);
    regenSameBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        regenerateImages(false);
    });
    btnContainer.appendChild(regenSameBtn);

    // Regenerate with new text button (plus icon for "new quote")
    const regenNewBtn = document.createElement("button");
    regenNewBtn.type = "button";
    regenNewBtn.id = "regenNewBtn";
    regenNewBtn.className = "btn-action";
    regenNewBtn.title = "เจนใหม่ + Quote ใหม่";
    const regenNewIcon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    regenNewIcon.setAttribute("viewBox", "0 0 24 24");
    regenNewIcon.setAttribute("fill", "none");
    regenNewIcon.setAttribute("stroke", "currentColor");
    regenNewIcon.setAttribute("stroke-width", "2");
    // Plus icon - represents "new content"
    regenNewIcon.innerHTML = '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>';
    regenNewBtn.appendChild(regenNewIcon);
    regenNewBtn.onclick = function (e) {
        console.log('[regenNewBtn] + button ONCLICK fired!');
        e.stopPropagation();
        e.preventDefault();
        regenerateImages(true);
        return false;
    };
    console.log('[showSingleImage] Created regenNewBtn with onclick handler');
    btnContainer.appendChild(regenNewBtn);
    els.fullImageView.appendChild(btnContainer);
    console.log('[showSingleImage] Buttons appended to fullImageView');

    // Validate to enable SCHEDULE button
    validateLinkMode();
}

// Show generated grid (uses current mode)
function showGeneratedGrid() {
    const state = getState();
    const els = getModeElements();

    state.currentView = "grid";
    els.uploadPrompt.style.display = "none";
    els.generateOverlay.style.display = "none";
    els.refThumbsRow.style.display = "none";
    els.skeletonGrid.style.display = "none";
    els.generatedGrid.style.display = "grid";
    els.fullImageView.style.display = "none";

    els.generatedGrid.textContent = "";

    // Add regenerate button
    const regenBtn = document.createElement("button");
    regenBtn.className = "btn-regenerate";
    regenBtn.innerHTML =
        '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 4v6h-6M1 20v-6h6"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg> เจนใหม่';
    regenBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        regenerateImages();
    });
    els.generatedGrid.appendChild(regenBtn);

    let firstItem = null;
    state.generatedImages.forEach((img, i) => {
        const item = document.createElement("div");
        item.className = "generated-item";
        const numSpan = document.createElement("span");
        numSpan.className = "item-number";
        numSpan.textContent = i + 1;
        const imgEl = document.createElement("img");
        imgEl.src = img;
        imgEl.alt = `Generated ${i + 1}`;
        item.appendChild(numSpan);
        item.appendChild(imgEl);
        item.addEventListener("click", (e) => {
            e.stopPropagation();
            selectImage(img, item);
        });
        els.generatedGrid.appendChild(item);
        if (i === 0) firstItem = { img, item };
    });

    // Auto-select first image if only 1 image generated
    if (state.generatedImages.length === 1 && firstItem) {
        selectImage(firstItem.img, firstItem.item);
    } else {
        validateLinkMode(); // Re-validate after generation complete (still disabled until image selected)
    }
}

// Regenerate images (uses current mode)
// getNewText: true = fetch new quote, false = use current caption
async function regenerateImages(getNewText = false) {
    console.log('[regenerateImages] CALLED with getNewText:', getNewText);
    const state = getState();
    const els = getModeElements();
    const mode = postMode; // Get current mode (link or image)
    const isLinkMode = mode === "link";

    // For image mode, require reference images
    if (!isLinkMode && state.referenceImages.length === 0) {
        fileInput.click();
        return;
    }

    // For link mode without new text, require caption OR already have generated images (regenerating)
    const captionCheck = document.getElementById("caption");
    const hasGeneratedImages = state.generatedImages && state.generatedImages.length > 0;
    if (isLinkMode && !getNewText && !hasGeneratedImages && !state.lastCaption && (!captionCheck || !captionCheck.value.trim())) {
        alert("กรุณาใส่ข้อความก่อนเจนรูป");
        return;
    }

    // Close full image view first
    if (els.fullImageView) {
        els.fullImageView.style.display = "none";
    }

    // Clear selected image
    state.selectedImage = null;

    // Reset image ready flag for link mode
    if (postMode === 'link') {
        linkModeImageReady = false;
    }

    // Show skeleton loading (same as initial generation)
    state.currentView = "generating";
    els.generatedGrid.style.display = "none";
    els.generateOverlay.style.display = "none";
    els.uploadPrompt.style.display = "none";
    els.refThumbsRow.style.display = "none";

    // Show single skeleton card (same style as initial generation)
    els.skeletonGrid.innerHTML = '<div class="skeleton-card"></div>';
    els.skeletonGrid.classList.add('single');
    els.skeletonGrid.style.display = "grid";
    validateLinkMode(); // Disable SCHEDULE while generating

    try {
        console.log('[regenerateImages] Starting try block');
        // Get caption and pageId
        const captionField = document.getElementById("caption");
        let caption = captionField ? captionField.value : "";
        const pageId = document.getElementById("pageSelect")?.value;
        console.log('[regenerateImages] pageId:', pageId, 'caption:', caption?.substring(0, 30));

        if (getNewText && !pageId) {
            throw new Error("กรุณาเลือก Page ก่อนเจนข้อความใหม่");
        }

        // For link mode: check Primary Text first before fetching quotes
        if (isLinkMode) {
            const primaryTextField = els.primaryText;
            const userText = primaryTextField ? primaryTextField.value.trim() : "";

            if (userText) {
                // User entered text - use it directly (skip quote fetching)
                caption = userText;
                console.log('[Regenerate] Using user-entered Primary Text:', caption.substring(0, 50) + '...');
            } else if (state.lastCaption && !getNewText) {
                // Regenerate same text - always use last caption
                caption = state.lastCaption;
                console.log('[Regenerate] Using lastCaption:', caption.substring(0, 50) + '...');
            } else if (getNewText && pageId) {
                // No user text, fetch new quote from database
                const quotesRes = await fetch(`/api/quotes?limit=100&pageId=${pageId}`);
                const quotesData = await quotesRes.json();
                if (quotesData.success && quotesData.quotes.length > 0) {
                    let selectedQuote = quotesData.quotes.find(q => !q.isUsed);
                    if (!selectedQuote) {
                        selectedQuote = quotesData.quotes.find(
                            (q) => q.id !== state.lastUsedQuoteId,
                        ) || quotesData.quotes[0];
                    }
                    if (selectedQuote) {
                        caption = selectedQuote.quote_text;
                        if (!selectedQuote.isUsed) {
                            // Mark as used only if it was unused
                            await fetch('/api/quotes', {
                                method: 'PATCH',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ id: selectedQuote.id, pageId })
                            });
                        }
                        state.lastUsedQuoteId = selectedQuote.id;
                    }
                } else {
                    throw new Error("ไม่พบคำคมในระบบ กรุณาเพิ่มคำคมก่อน");
                }
            }

            const isDefaultCaption = !caption || caption === "S.LAZADA.CO.TH";
            if (isDefaultCaption && state.lastCaption) {
                caption = state.lastCaption;
                console.log('[Regenerate] No new quote found, using lastCaption');
            }
        } else if (getNewText && pageId) {
            // Image mode: fetch new quote if requested
            const quotesRes = await fetch(`/api/quotes?limit=100&pageId=${pageId}`);
            const quotesData = await quotesRes.json();
            if (quotesData.success && quotesData.quotes.length > 0) {
                let selectedQuote = quotesData.quotes.find(q => !q.isUsed);
                if (!selectedQuote) {
                    selectedQuote = quotesData.quotes.find(
                        (q) => q.id !== state.lastUsedQuoteId,
                    ) || quotesData.quotes[0];
                }
                if (selectedQuote) {
                    caption = selectedQuote.quote_text;
                    // Update Primary Text field for image mode (for caption use when posting)
                    if (els.primaryText) {
                        els.primaryText.value = caption;
                        autoResizeTextarea(els.primaryText);
                        console.log('[Regenerate] Image mode: Updated Primary Text with quote');
                    }
                    if (!selectedQuote.isUsed) {
                        // Mark as used only if it was unused
                        await fetch('/api/quotes', {
                            method: 'PATCH',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ id: selectedQuote.id, pageId })
                        });
                    }
                    state.lastUsedQuoteId = selectedQuote.id;
                }
            }
        }

        if (!caption && state.referenceImages.length === 0) {
            if (getNewText) {
                throw new Error("ไม่สามารถหาคำคมใหม่ได้ กรุณาเพิ่มคำคมในระบบ");
            } else {
                throw new Error("ไม่พบข้อความสำหรับเจนรูป กรุณาใส่ Primary Text หรือเพิ่มคำคม");
            }
        }

        // Get custom prompt from database
        const promptType = isLinkMode ? "link_post" : "image_post";
        let customPrompt = "";
        try {
            const promptRes = await fetch(`/api/prompts?pageId=${pageId}&promptType=${promptType}`);
            const promptData = await promptRes.json();
            if (promptData.success && promptData.prompts.length > 0) {
                customPrompt = promptData.prompts[0].prompt_text;
            } else {
                // Try default prompt
                const defaultRes = await fetch(`/api/prompts?pageId=_default&promptType=${promptType}`);
                const defaultData = await defaultRes.json();
                if (defaultData.success && defaultData.prompts.length > 0) {
                    customPrompt = defaultData.prompts[0].prompt_text;
                }
            }
        } catch (e) {
            console.warn('[Regenerate] Failed to load prompt from DB');
        }

        // Save caption to state for future regeneration
        if (caption) {
            state.lastCaption = caption;
        }

        // Build request body
        const requestBody = {
            aspectRatio: getCurrentAspectRatio(),
            model: localStorage.getItem("aiModel") || "gemini-2.0-flash-exp",
            numberOfImages: 1,
            caption: caption,
            resolution: localStorage.getItem("aiResolution") || "2K",
            customPrompt: customPrompt,
            pageName: localStorage.getItem("fewfeed_selectedPageName") || "",
        };

        console.log('[Generate] Sending request with:', {
            aspectRatio: requestBody.aspectRatio,
            pageName: requestBody.pageName,
            hasCustomPrompt: !!requestBody.customPrompt
        });

        // Add reference images if available
        if (state.referenceImages.length > 0) {
            requestBody.referenceImages = state.referenceImages;
        }

        const response = await fetch("/api/generate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(requestBody),
        });

        const data = await response.json();
        console.log('[Generate] Response received:', { success: !data.error, imageCount: data.images?.length });
        if (data.error) throw new Error(data.error);

        state.generatedImages = data.images;

        // Auto-select first image and show full view with action buttons
        if (data.images && data.images.length > 0) {
            console.log('[Generate] Calling showSingleImage with first image');
            state.selectedImage = data.images[0];
            showSingleImage(data.images[0]);
        } else {
            showGeneratedGrid();
        }
    } catch (err) {
        console.error('[Generate] Error:', err.message);
        alert("Generation failed: " + err.message);
        showGeneratedGrid(); // Show previous results
    }
}

// Select an image (uses current mode)
function selectImage(imgSrc, element) {
    const state = getState();
    const els = getModeElements();

    els.generatedGrid
        .querySelectorAll(".generated-item")
        .forEach((el) => el.classList.remove("selected"));
    if (element) element.classList.add("selected");
    state.selectedImage = imgSrc;
    showFullImage(imgSrc);
}

// Show full image (uses current mode)
function showFullImage(imgSrc) {
    console.log('[showFullImage] Called with imgSrc:', imgSrc?.substring(0, 50));
    const state = getState();
    const els = getModeElements();

    state.currentView = "full";
    els.uploadPrompt.style.display = "none";
    els.generateOverlay.style.display = "none";
    els.refThumbsRow.style.display = "none";
    els.generatedGrid.style.display = "none";
    els.skeletonGrid.style.display = "none";
    els.skeletonGrid.classList.remove('single');
    els.fullImageView.style.display = "flex";

    // Mark image as ready for link mode validation
    if (postMode === 'link') {
        linkModeImageReady = true;
        console.log('[showFullImage] Set linkModeImageReady = true');
    }

    // Create elements instead of innerHTML
    els.fullImageView.textContent = "";
    const backBtn = document.createElement("button");
    backBtn.className = "back-to-grid";
    backBtn.innerHTML =
        '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 12H5M12 19l-7-7 7-7"/></svg> Back to grid';
    backBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        showGeneratedGrid();
    });
    const imgEl = document.createElement("img");
    imgEl.src = imgSrc;
    imgEl.alt = "Selected";
    els.fullImageView.appendChild(backBtn);
    els.fullImageView.appendChild(imgEl);
    console.log('[showFullImage] About to call validateLinkMode');
    validateLinkMode(); // Enable SCHEDULE when image is selected
    console.log('[showFullImage] validateLinkMode called, publishBtn.disabled =', publishBtn.disabled);
}

// Update preview on input change
caption.addEventListener(
    "input",
    () => (previewCaption.textContent = caption.value),
);
description.addEventListener(
    "input",
    () => (previewDescription.textContent = description.value),
);

// Double-click to edit preview text
function setupEditableText(previewEl, inputEl) {
    previewEl.addEventListener("dblclick", () => {
        previewEl.contentEditable = "true";
        previewEl.classList.add("editing");
        previewEl.focus();
        // Select all text
        const range = document.createRange();
        range.selectNodeContents(previewEl);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
    });

    previewEl.addEventListener("blur", () => {
        previewEl.contentEditable = "false";
        previewEl.classList.remove("editing");
        inputEl.value = previewEl.textContent;
        // Trigger validation when description changes
        if (inputEl.id === 'description') {
            validateLinkMode();
        }
    });

    previewEl.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            previewEl.blur();
        }
        if (e.key === "Escape") {
            previewEl.textContent = inputEl.value;
            previewEl.blur();
        }
    });

    // Paste as plain text only (no formatting)
    previewEl.addEventListener("paste", (e) => {
        e.preventDefault();
        const text = (e.clipboardData || window.clipboardData).getData("text/plain");
        document.execCommand("insertText", false, text);
    });
}

setupEditableText(previewCaption, caption);
setupEditableText(previewDescription, description);

// Keep hidden inputs in sync while typing in previews
previewCaption.addEventListener("input", () => {
    caption.value = previewCaption.textContent;
});
previewDescription.addEventListener("input", () => {
    description.value = previewDescription.textContent;
    validateLinkMode();
});

// Setup news description editable (same as link mode)
const newsPreviewDesc = document.getElementById("newsPreviewDescription");
if (newsPreviewDesc) {
    const newsDescInput = document.createElement('input');
    newsDescInput.type = 'hidden';
    newsDescInput.id = 'newsDescription';
    document.body.appendChild(newsDescInput);

    setupEditableText(newsPreviewDesc, newsDescInput);

    newsPreviewDesc.addEventListener("input", () => {
        newsDescInput.value = newsPreviewDesc.textContent;
        validateNewsMode();
    });

    newsPreviewDesc.addEventListener("blur", () => {
        validateNewsMode();
    });
}

// News publish handler
const newsPublishBtn = document.getElementById("newsPublishBtn");
if (newsPublishBtn) {
    newsPublishBtn.addEventListener("click", async () => {
        if (newsPublishBtn.disabled) return;

        const pageId = getCurrentPageId();
        const pageToken = localStorage.getItem("fewfeed_selectedPageToken");
        const adsToken = fbToken || localStorage.getItem("fewfeed_accessToken") || localStorage.getItem("fewfeed_token");
        const cookie = fbCookie || localStorage.getItem("fewfeed_cookie");
        const adAccountId = document.getElementById("adAccountSelect")?.value;
        const newsUrlInputEl = document.getElementById("newsUrlInput");
        const newsPrimaryTextEl = document.getElementById("newsPrimaryText");
        const newsPreviewDescEl = document.getElementById("newsPreviewDescription");
        const newsPreviewCaptionEl = document.getElementById("newsPreviewCaption");

        if (!pageId || !adsToken || !cookie) {
            alert("กรุณาเลือกเพจและ login ก่อน");
            return;
        }

        const linkUrlValue = newsUrlInputEl?.value?.trim();
        const descriptionText = newsPreviewDescEl?.textContent?.trim() || "";
        const captionText = newsPreviewCaptionEl?.textContent?.trim() || "S.LAZADA.CO.TH";
        const primaryText = newsPrimaryTextEl?.value?.trim() || "";
        let imageData = newsGeneratedImages[newsSelectedIndex];

        if (!linkUrlValue || !descriptionText || !imageData) {
            alert("กรุณากรอกข้อมูลให้ครบ");
            return;
        }

        newsPublishBtn.disabled = true;
        newsPublishBtn.innerHTML = '<span class="loading"></span>';

        try {
            // Compress image
            if (imageData.startsWith("data:")) {
                imageData = await compressImage(imageData, 1200, 0.8);
            }

            // Check if auto-schedule is enabled
            const isAutoSchedule = cachedPageSettings.pageId === pageId && cachedPageSettings.autoSchedule;
            let scheduledTime = null;
            if (isAutoSchedule) {
                await refreshScheduledPostTimes();
                scheduledTime = getNextScheduleTime();
                scheduledPostTimes.push(scheduledTime);
                console.log("[News] Auto-schedule enabled, scheduledTime:", scheduledTime?.toISOString());
            } else {
                console.log("[News] Auto-schedule NOT enabled", { cachedPageId: cachedPageSettings.pageId, pageId, autoSchedule: cachedPageSettings.autoSchedule });
            }

            const fbDtsg = localStorage.getItem("fewfeed_fbDtsg");

            const response = await fetch("/api/publish", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    pageId,
                    adAccountId,
                    accessToken: adsToken,
                    cookieData: cookie,
                    imageUrl: imageData,
                    linkUrl: linkUrlValue,
                    linkName: descriptionText ? `พิกัด : ${descriptionText}` : captionText,
                    caption: captionText,
                    description: descriptionText,
                    primaryText,
                    callToAction: "SHOP_NOW",
                    scheduledTime: scheduledTime ? Math.floor(scheduledTime.getTime() / 1000) : null,
                    fbDtsg
                })
            });

            // Handle streaming response (same as Link flow)
            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let fullLog = "";
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                fullLog += decoder.decode(value);
            }

            const urlMatch = fullLog.match(/"url":"([^"]+)"/);
            const postIdMatch = fullLog.match(/"postId":"([^"]+)"/);
            const needsSchedulingMatch = fullLog.match(/"needsScheduling":true/);
            const scheduledTimeMatch = fullLog.match(/"scheduledTime":(\d+)/);

            if (urlMatch) {
                const postId = postIdMatch ? postIdMatch[1] : null;

                // Schedule via extension GraphQL if needed
                if (needsSchedulingMatch && postId && scheduledTimeMatch && fbDtsg) {
                    const scheduleTimestamp = parseInt(scheduledTimeMatch[1]);
                    console.log("[News] Scheduling via extension GraphQL, postId:", postId);

                    window.postMessage({
                        type: "FEWFEED_SCHEDULE_POST_GRAPHQL",
                        postId, pageId, fbDtsg,
                        scheduledTime: scheduleTimestamp,
                    }, "*");

                    await new Promise((resolve) => {
                        const handler = (event) => {
                            if (event.data.type === "FEWFEED_SCHEDULE_POST_GRAPHQL_RESPONSE") {
                                window.removeEventListener("message", handler);
                                resolve(event.data.data);
                            }
                        };
                        window.addEventListener("message", handler);
                        setTimeout(() => { window.removeEventListener("message", handler); resolve({ success: false }); }, 30000);
                    });
                }

                newsPublishBtn.textContent = "✓";
                newsPublishBtn.classList.add("published");
                newsPublishBtn.disabled = false;

                if (scheduledTime) {
                    await refreshScheduledPostTimes();
                    updateNextScheduleDisplay();
                }

                setTimeout(() => {
                    window.location.hash = "#pending";
                    handleNavigation();

                    if (newsUrlInputEl) newsUrlInputEl.value = "";
                    if (newsPrimaryTextEl) newsPrimaryTextEl.value = "";
                    if (newsPreviewDescEl) newsPreviewDescEl.textContent = "";
                    newsGeneratedImages = [];
                    newsSelectedImages = [];
                    newsModeImageReady = false;

                    const container = document.getElementById("newsFullImageView");
                    if (container) container.style.display = "none";
                    const uploadPrompt = document.getElementById("newsUploadPrompt");
                    if (uploadPrompt) uploadPrompt.style.display = "flex";

                    newsPublishBtn.textContent = "SCHEDULE";
                    newsPublishBtn.classList.remove("published");
                    newsPublishBtn.disabled = true;
                    newsPublishBtn.style.opacity = "0.5";
                    validateNewsMode();
                }, 1000);
            } else {
                throw new Error("Failed to schedule - no URL in response");
            }
        } catch (err) {
            console.error("[News] Publish error:", err);
            alert("เกิดข้อผิดพลาด: " + err.message);
            newsPublishBtn.textContent = "SCHEDULE";
            newsPublishBtn.disabled = false;
        }
    });
}

// ============================================
// 10. PUBLISH
// ============================================
let lastPublishedUrl = null;

function setupPublishHandler(mode) {
    const els = getModeElements(mode);
    if (!els.publishBtn) return;

    els.publishBtn.addEventListener("click", async () => {
        console.log('[PUBLISH] Button clicked! Mode:', mode);
        const state = modeState[mode];

        // If already published, open the URL in background
        if (
            lastPublishedUrl &&
            els.publishBtn.classList.contains("published")
        ) {
            // Reset button after viewing
            els.publishBtn.textContent = "SCHEDULE";
            els.publishBtn.classList.remove("published");
            lastPublishedUrl = null;
            return;
        }

        if (!state.selectedImage) {
            alert("Please select an image first");
            return;
        }

        els.publishBtn.disabled = true;
        els.publishBtn.innerHTML = '<span class="loading"></span>';
        els.publishBtn.classList.remove("published");
        lastPublishedUrl = null;

        try {
            const pageId =
                document.getElementById("pageSelect").value;

            if (!pageId) {
                throw new Error("กรุณาเลือก Page");
            }

            // ========== IMAGE MODE: Use Graph API directly ==========
            if (mode === "image") {
                const pageToken = localStorage.getItem("fewfeed_selectedPageToken");
                if (!pageToken) {
                    throw new Error("ไม่มี Page Token กรุณาเลือก Page ใหม่");
                }

                const message = els.primaryText?.value || "";
                let imageUrl = state.selectedImage;

                // Compress and upload base64 image
                if (imageUrl.startsWith("data:")) {
                    console.log("[FEWFEED] Compressing image...");
                    imageUrl = await compressImage(imageUrl, 1200, 0.8);
                    console.log("[FEWFEED] Uploading compressed image...");
                    const uploadRes = await fetch("/api/upload-image", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ imageData: imageUrl }),
                    });
                    const uploadData = await uploadRes.json();
                    if (!uploadData.success) {
                        throw new Error(uploadData.error || "Image upload failed");
                    }
                    imageUrl = uploadData.url;
                    console.log("[FEWFEED] Image uploaded:", imageUrl);
                }

                // Check if auto-schedule is enabled (use cached settings from database)
                const isAutoSchedule = cachedPageSettings.pageId === pageId && cachedPageSettings.autoSchedule;
                let scheduledTime = null;
                if (isAutoSchedule) {
                    // Refresh scheduled times from Facebook to avoid duplicates
                    await refreshScheduledPostTimes();
                    scheduledTime = getNextScheduleTime();
                    // Add to local cache immediately to prevent duplicates in rapid succession
                    scheduledPostTimes.push(scheduledTime);
                    console.log("[FEWFEED] Image scheduling for:", scheduledTime.toISOString());
                }

                console.log("[FEWFEED] Publishing image via Graph API...");

                // Build form data for Graph API
                const formData = new FormData();
                formData.append("url", imageUrl);
                if (message) formData.append("message", message);
                formData.append("access_token", pageToken);

                // If scheduling, set published=false and scheduled_publish_time
                if (scheduledTime) {
                    formData.append("published", "false");
                    formData.append("scheduled_publish_time", Math.floor(scheduledTime.getTime() / 1000));
                }

                const response = await fetch(`https://graph.facebook.com/v21.0/${pageId}/photos`, {
                    method: "POST",
                    body: formData,
                });

                const data = await response.json();
                console.log("[FEWFEED] Graph API response:", data);

                if (data.error) {
                    throw new Error(data.error.message);
                }

                // Success!
                const postId = data.post_id || data.id;
                lastPublishedUrl = `https://www.facebook.com/${postId}`;

                els.publishBtn.textContent = "✓";
                els.publishBtn.classList.add("published");
                els.publishBtn.disabled = false;

                // Refresh scheduled times from Facebook
                if (scheduledTime) {
                    await refreshScheduledPostTimes();
                    updateNextScheduleDisplay();

                    // Navigate to pending page after 1 second, then clear image silently
                    setTimeout(() => {
                        window.location.hash = "#pending";
                        handleNavigation();
                        // Clear the uploaded image after navigation
                        state.selectedImage = null;
                        state.currentView = "upload";
                        linkModeImageReady = false;
                        if (els.fullImageView) els.fullImageView.style.display = "none";
                        if (els.uploadPrompt) els.uploadPrompt.style.display = "flex";
                        els.publishBtn.textContent = "SCHEDULE";
                        els.publishBtn.classList.remove("published");

                        // Clear form fields silently (Link URL, Primary Text, Caption/พิกัด)
                        const linkUrlField = document.getElementById("linkUrl");
                        const primaryTextField = document.getElementById("primaryText");
                        const captionField = document.getElementById("caption");
                        const descField = document.getElementById("description");
                        if (linkUrlField) linkUrlField.value = "";
                        if (primaryTextField) primaryTextField.value = "";
                        if (captionField) captionField.value = "";
                        if (descField) descField.value = "";
                        // Clear the preview description (พิกัด) - but keep domain display
                        const previewDesc = document.getElementById("previewDescription");
                        if (previewDesc) previewDesc.textContent = "";
                        // Re-validate after clearing
                        validateLinkMode();
                    }, 1000);
                }

                return; // Exit early for image mode
            }

            // ========== LINK MODE: Use Ads API ==========
            // Get credentials - Only Ads Token + Cookie needed
            // Server fetches Page Token directly from Ads Token (no Postcron needed)
            const adsToken =
                fbToken ||
                localStorage.getItem("fewfeed_accessToken") ||
                localStorage.getItem("fewfeed_token");
            const cookie =
                fbCookie || localStorage.getItem("fewfeed_cookie");
            const adAccountId =
                document.getElementById("adAccountSelect").value;

            if (!adsToken) {
                throw new Error(
                    "ไม่มี Ads Token กรุณาคลิก icon extension เพื่อ login",
                );
            }

            if (!cookie) {
                throw new Error(
                    "ไม่มี Cookie กรุณาคลิก icon extension เพื่อ login",
                );
            }

            console.log(
                "[FEWFEED] Publishing with Ads Token only (server fetches Page Token)",
            );

            // Check if auto-schedule is enabled (use cached settings from database)
            const isAutoSchedule = cachedPageSettings.pageId === pageId && cachedPageSettings.autoSchedule;
            let scheduledTime = null;
            if (isAutoSchedule) {
                // Refresh scheduled times from Facebook to avoid duplicates
                await refreshScheduledPostTimes();
                scheduledTime = getNextScheduleTime();
                // Add to local cache immediately to prevent duplicates in rapid succession
                scheduledPostTimes.push(scheduledTime);
                console.log(
                    "[FEWFEED] Scheduling for:",
                    scheduledTime.toISOString(),
                );
            }

            // Get fb_dtsg for GraphQL scheduling
            const fbDtsg = localStorage.getItem("fewfeed_fbDtsg");

            // Get mode-specific form values
            const primaryTextEl = els.primaryText;
            const isLinkMode = mode === "link";

            // Compress image before upload to avoid 413 error
            let imageToUpload = state.selectedImage;
            if (imageToUpload && imageToUpload.startsWith("data:")) {
                imageToUpload = await compressImage(imageToUpload, 1200, 0.8);
            }

            const previewDescEl = document.getElementById("previewDescription");
            const previewCaptionEl = document.getElementById("previewCaption");
            const descriptionText = isLinkMode
                ? (description?.value?.trim() || previewDescEl?.textContent?.trim() || "")
                : "";
            const captionText = isLinkMode
                ? (caption?.value?.trim() || previewCaptionEl?.textContent?.trim() || "")
                : "";
            if (isLinkMode) {
                description.value = descriptionText;
                caption.value = captionText;
            }
            const linkUrlValue = isLinkMode ? linkUrl.value.trim() : "";
            const linkNameValue = isLinkMode
                ? (descriptionText ? `พิกัด : ${descriptionText}` : (linkName?.value?.trim() || ""))
                : "";

            if (isLinkMode) {
                console.log("[PUBLISH] === LINK PAYLOAD DEBUG ===");
                console.log("[PUBLISH] linkUrl:", linkUrlValue);
                console.log("[PUBLISH] linkName:", linkNameValue);
                console.log("[PUBLISH] caption:", captionText);
                console.log("[PUBLISH] description:", descriptionText);
                console.log("[PUBLISH] primaryText:", primaryTextEl?.value || "(empty)");
                console.log("[PUBLISH] imageUrl length:", imageToUpload?.length || 0);
                console.log("[PUBLISH] === END PAYLOAD ===");
            }

            const response = await fetch("/api/publish", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    imageUrl: imageToUpload,
                    linkUrl: linkUrlValue,
                    linkName: linkNameValue,
                    caption: captionText,
                    description: descriptionText,
                    primaryText: primaryTextEl
                        ? primaryTextEl.value
                        : "",
                    postMode: mode,
                    accessToken: adsToken, // Ads Token (server fetches Page Token from this)
                    cookieData: cookie,
                    pageId: pageId,
                    adAccountId: adAccountId,
                    fbDtsg: fbDtsg, // Required for GraphQL scheduling
                    scheduledTime: scheduledTime
                        ? Math.floor(scheduledTime.getTime() / 1000)
                        : null, // Unix timestamp
                }),
            });

            // All responses are now streaming (both immediate and scheduled)
            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let fullLog = "";

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                const text = decoder.decode(value);
                fullLog += text;
                console.log(text);
            }

            // Parse result from log
            const urlMatch = fullLog.match(/"url":"([^"]+)"/);
            const postIdMatch = fullLog.match(/"postId":"([^"]+)"/);
            const needsSchedulingMatch = fullLog.match(
                /"needsScheduling":true/,
            );
            const scheduledTimeMatch = fullLog.match(
                /"scheduledTime":(\d+)/,
            );

            if (urlMatch) {
                lastPublishedUrl = urlMatch[1];
                const postId = postIdMatch ? postIdMatch[1] : null;

                if (
                    needsSchedulingMatch &&
                    postId &&
                    scheduledTimeMatch
                ) {
                    // Server created post, now schedule via extension GraphQL
                    const scheduleTimestamp = parseInt(
                        scheduledTimeMatch[1],
                    );
                    console.log(
                        "[FEWFEED] Post created, scheduling via extension GraphQL...",
                    );
                    console.log(
                        "[FEWFEED] Post ID:",
                        postId,
                        "Schedule time:",
                        scheduleTimestamp,
                    );
                    console.log(
                        "[FEWFEED] fb_dtsg:",
                        fbDtsg
                            ? fbDtsg.substring(0, 20) + "..."
                            : "(empty)",
                    );

                    if (!fbDtsg) {
                        throw new Error(
                            "fb_dtsg is required for scheduling. Please refresh your Facebook login.",
                        );
                    }


                    // Call extension to schedule via GraphQL
                    window.postMessage(
                        {
                            type: "FEWFEED_SCHEDULE_POST_GRAPHQL",
                            postId: postId,
                            pageId: pageId,
                            fbDtsg: fbDtsg,
                            scheduledTime: scheduleTimestamp,
                        },
                        "*",
                    );

                    // Wait for response from extension
                    const scheduleResult = await new Promise(
                        (resolve) => {
                            const handler = (event) => {
                                if (
                                    event.data.type ===
                                    "FEWFEED_SCHEDULE_POST_GRAPHQL_RESPONSE"
                                ) {
                                    window.removeEventListener(
                                        "message",
                                        handler,
                                    );
                                    resolve(event.data.data);
                                }
                            };
                            window.addEventListener(
                                "message",
                                handler,
                            );
                            // Timeout after 30s
                            setTimeout(() => {
                                window.removeEventListener(
                                    "message",
                                    handler,
                                );
                                resolve({
                                    success: false,
                                    error: "Extension scheduling timeout",
                                });
                            }, 30000);
                        },
                    );

                    if (scheduleResult.success) {
                        els.publishBtn.textContent = "✓";
                        els.publishBtn.classList.add("published");
                        els.publishBtn.disabled = false;
                        console.log(
                            "[FEWFEED] Post scheduled via GraphQL:",
                            lastPublishedUrl,
                        );

                        // Invalidate cache after successful schedule
                        invalidatePostsCache(getCurrentPageId());

                        // Refresh scheduled times after posting
                        if (scheduledTime) {
                            await refreshScheduledPostTimes();
                            updateNextScheduleDisplay();
                        }

                        // Navigate to pending page after 1 second, then clear image silently
                        setTimeout(() => {
                            window.location.hash = "#pending";
                            handleNavigation();
                            // Clear the uploaded image after navigation
                            state.selectedImage = null;
                            state.currentView = "upload";
                            linkModeImageReady = false;
                            if (els.fullImageView) els.fullImageView.style.display = "none";
                            if (els.uploadPrompt) els.uploadPrompt.style.display = "flex";
                            els.publishBtn.textContent = "SCHEDULE";
                            els.publishBtn.classList.remove("published");

                            // Clear form fields silently (Link URL, Primary Text, Caption/พิกัด)
                            const linkUrlField = document.getElementById("linkUrl");
                            const primaryTextField = document.getElementById("primaryText");
                            const captionField = document.getElementById("caption");
                            const descField = document.getElementById("description");
                            if (linkUrlField) linkUrlField.value = "";
                            if (primaryTextField) primaryTextField.value = "";
                            if (captionField) captionField.value = "";
                            if (descField) descField.value = "";
                            // Clear the preview description (พิกัด) - but keep domain display
                            const previewDesc = document.getElementById("previewDescription");
                            if (previewDesc) previewDesc.textContent = "";
                            // Re-validate after clearing
                            validateLinkMode();
                        }, 1000);
                    } else {
                        throw new Error(
                            `GraphQL scheduling failed: ${scheduleResult.error}`,
                        );
                    }
                } else {
                    // Immediate publish success
                    els.publishBtn.textContent = "✓";
                    els.publishBtn.classList.add("published");
                    els.publishBtn.disabled = false;
                    console.log(
                        "[FEWFEED] Published successfully:",
                        lastPublishedUrl,
                    );
                }
            } else if (fullLog.includes('"success":false')) {
                // Extract error message from response - show the actual error
                const errorMatch =
                    fullLog.match(/"error":"([^"]+)"/);
                const errorMsg = errorMatch
                    ? errorMatch[1]
                    : "Unknown error";
                console.error("[FEWFEED] Full error log:", fullLog);
                throw new Error(errorMsg);
            } else {
                // No success or error found - unexpected response
                console.error(
                    "[FEWFEED] Unexpected response:",
                    fullLog,
                );
                throw new Error("Unexpected response from server");
            }
        } catch (err) {
            console.error("[FEWFEED] Error:", err.message);
            alert("Publish failed: " + err.message);
            els.publishBtn.textContent = "SCHEDULE";
            els.publishBtn.disabled = false;
        }
    });
}

// Setup publish handlers for all modes
setupPublishHandler("link");
setupPublishHandler("image");
setupPublishHandler("reels");

// Config loaded from localStorage via extension

// ===== FEWFEED Extension Integration =====
let fbCookie = null;
let fbToken = null; // Ads Token (for creating ad creatives)
let fbPostToken = null; // Post Token from Postcron (for fetching pages)
let allPages = [];
let selectedPageIndex = 0;

// Page selector elements
const pageSelector = document.getElementById("pageSelector");
const pageDropdown = document.getElementById("pageDropdown");

// Toggle dropdown
pageSelector.addEventListener("click", (e) => {
    e.stopPropagation();
    pageDropdown.classList.toggle("visible");
});

// Close dropdown when clicking outside
document.addEventListener("click", () => {
    pageDropdown.classList.remove("visible");
});

// Select a page
function selectPage(index) {
    selectedPageIndex = index;
    const page = allPages[index];
    if (!page) return;

    console.log(
        "[FEWFEED] Selected page:",
        page.name,
        "id:",
        page.id,
        "hasPageToken:",
        !!page.access_token,
    );

    // Store Page Access Token for this specific page (for scheduled posts API)
    if (page.access_token) {
        localStorage.setItem(
            "fewfeed_selectedPageToken",
            page.access_token,
        );
        console.log(
            "[FEWFEED] Stored Page Access Token for scheduled posts",
        );
    }

    // Save selected page ID and name to localStorage for persistence across refreshes
    localStorage.setItem("fewfeed_selectedPageId", page.id);
    localStorage.setItem("fewfeed_selectedPageName", page.name || "Page");

    // Hide skeleton, show real selector
    const skeleton = document.getElementById(
        "pageSelectorSkeleton",
    );
    const pageSelector = document.getElementById("pageSelector");
    if (skeleton) skeleton.style.display = "none";
    pageSelector.style.display = "flex";

    // Update content
    document.getElementById("previewPageName").textContent =
        page.name || "Page";
    document.getElementById("previewPageId").textContent = page.id;
    document.getElementById("pageSelect").value = page.id;

    const imgUrl =
        page.picture?.data?.url ||
        `https://graph.facebook.com/${page.id}/picture?type=small`;
    document.getElementById("previewAvatarImg").src = imgUrl;

    // Update dropdown selection
    document
        .querySelectorAll(".page-dropdown-item")
        .forEach((item, i) => {
            item.classList.toggle("selected", i === index);
        });

    pageDropdown.classList.remove("visible");

    // Load page-specific settings
    loadSettings();

    // If on settings page, reload settings panel
    if (window.location.hash === "#settings") {
        loadSettingsPanel();
    }

    // If on pending panel, refresh scheduled posts for new page
    if (window.location.hash === "#pending") {
        showPendingPanel();
    }

    // If on published panel, refresh published posts for new page
    if (window.location.hash === "#published") {
        loadPublishedPosts();
    }
}

// Render pages dropdown
function renderPagesDropdown(pages) {
    allPages = pages;
    pageDropdown.textContent = "";

    pages.forEach((page, i) => {
        const item = document.createElement("div");
        item.className =
            "page-dropdown-item" +
            (i === selectedPageIndex ? " selected" : "");

        const img = document.createElement("img");
        img.src =
            page.picture?.data?.url ||
            `https://graph.facebook.com/${page.id}/picture?type=small`;
        img.alt = page.name;

        const info = document.createElement("div");
        info.className = "page-dropdown-item-info";

        const name = document.createElement("h4");
        name.textContent = page.name || "Page";

        const id = document.createElement("p");
        id.textContent = page.id;

        info.appendChild(name);
        info.appendChild(id);
        item.appendChild(img);
        item.appendChild(info);

        item.addEventListener("click", () => selectPage(i));
        pageDropdown.appendChild(item);
    });

    // Auto-select saved page or first page
    if (pages.length > 0) {
        const savedPageId = localStorage.getItem("fewfeed_selectedPageId");
        let indexToSelect = 0;

        if (savedPageId) {
            const savedIndex = pages.findIndex(p => p.id === savedPageId);
            if (savedIndex !== -1) {
                indexToSelect = savedIndex;
            }
        }

        selectPage(indexToSelect);
    }
}

// Listen for data injection from extension
window.addEventListener("message", (event) => {
    if (event.source !== window) return;

    // Extension ready
    if (event.data.type === "FEWFEED_EXTENSION_READY") {
        console.log("[FEWFEED] Extension detected!");
        document.body.setAttribute("data-extension-ready", "true");
    }

    // Cookie + Tokens injected from extension
    if (event.data.type === "FEWFEED_COOKIE_INJECTED") {
        fbCookie = event.data.cookie;
        fbToken = event.data.token;
        fbPostToken = event.data.postToken;
        const userId = event.data.userId;
        const userName = event.data.userName;

        console.log("[FEWFEED] Data received:", {
            userId: userId,
            userName: userName,
            hasAdsToken: !!fbToken,
            hasPostToken: !!fbPostToken,
            hasCookie: !!fbCookie,
        });

        // Show status with token/cookie indicators
        showCookieStatus(
            true,
            userId,
            userName,
            !!fbToken,
            !!fbCookie,
        );

        // Fetch pages - prefer Post Token (works better for me/accounts), fallback to Ads Token
        if (fbPostToken || fbToken) {
            fetchPages(fbPostToken || fbToken);
        }
    }

    // Pages response from extension
    if (event.data.type === "FEWFEED_PAGES_RESPONSE") {
        const response = event.data.data;
        if (
            response.success &&
            response.pages &&
            response.pages.length > 0
        ) {
            renderPagesDropdown(response.pages);
            console.log(
                "[FEWFEED] Pages loaded:",
                response.pages.length,
            );
            // Re-trigger navigation in case we landed on #pending before pages were loaded
            if (window.location.hash === "#pending") {
                handleNavigation();
            }
        }
    }

});

// Auto-sync with Extension cached data every 30 seconds
setInterval(async () => {
    try {
        if (typeof window.pubiloExtension !== 'undefined') {
            // Get cached tokens (no Facebook API calls)
            const cachedData = await window.pubiloExtension.getCachedTokens();
            if (cachedData && cachedData.success) {
                const currentUserId = localStorage.getItem("fewfeed_userId");

                // Update if Extension has different cached data
                if (cachedData.userId && cachedData.userId !== currentUserId) {
                    localStorage.setItem("fewfeed_userId", cachedData.userId);
                    localStorage.setItem("fewfeed_userName", cachedData.userName || '');
                    localStorage.setItem("fewfeed_accessToken", cachedData.adsToken || '');
                    localStorage.setItem("fewfeed_postToken", cachedData.postToken || '');
                    localStorage.setItem("fewfeed_cookie", cachedData.cookie || '');

                    showCookieStatus(
                        true,
                        cachedData.userId,
                        cachedData.userName,
                        !!cachedData.adsToken,
                        !!cachedData.cookie,
                    );

                    console.log('[auto-sync] Updated from Extension cache');
                }
            }
        }
    } catch (error) {
        // Extension not available
    }
}, 30000);

// Manual sync function for cached data only
async function syncWithExtensionNow() {
    try {
        if (typeof window.pubiloExtension !== 'undefined') {
            // Get cached tokens only (no Facebook API calls)
            const cachedData = await window.pubiloExtension.getCachedTokens();
            if (cachedData && cachedData.success) {
                localStorage.setItem("fewfeed_userId", cachedData.userId || '');
                localStorage.setItem("fewfeed_userName", cachedData.userName || '');
                localStorage.setItem("fewfeed_accessToken", cachedData.adsToken || '');
                localStorage.setItem("fewfeed_postToken", cachedData.postToken || '');
                localStorage.setItem("fewfeed_cookie", cachedData.cookie || '');

                showCookieStatus(
                    true,
                    cachedData.userId,
                    cachedData.userName,
                    !!cachedData.adsToken,
                    !!cachedData.cookie,
                );

                console.log('[manual-sync] Updated from Extension cache');
                return true;
            }
        }
    } catch (error) {
        console.log('[manual-sync] Extension cache not available');
    }
    return false;
}

// Sync when page becomes visible (user switches back to tab)
document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
        syncWithExtensionNow();
    }
});

// Fetch pages from Facebook API via extension or direct call
function fetchPages(accessToken) {
    // Determine if this is Post Token (starts with EAAChZC from Postcron) or Ads Token (starts with EAABsbCS)
    const tokenType = accessToken?.startsWith("EAAChZC")
        ? "POST_TOKEN"
        : accessToken?.startsWith("EAABsbCS")
            ? "ADS_TOKEN"
            : "UNKNOWN";
    console.log(
        "[FEWFEED] fetchPages called with:",
        tokenType,
        "token starts with:",
        accessToken?.substring(0, 10) + "...",
    );

    // Try extension first
    window.postMessage(
        {
            type: "FEWFEED_FETCH_PAGES",
            accessToken: accessToken,
        },
        "*",
    );

    // Also try direct API call as fallback (must include access_token field to get Page Tokens)
    fetch(
        `https://graph.facebook.com/v21.0/me/accounts?access_token=${accessToken}&fields=access_token,id,name,picture,is_published&limit=100`,
    )
        .then((res) => res.json())
        .then((data) => {
            if (data.data && data.data.length > 0) {
                renderPagesDropdown(data.data);
                console.log(
                    "[FEWFEED] Pages loaded (direct):",
                    data.data.length,
                );
            }
        })
        .catch((err) =>
            console.log(
                "[FEWFEED] Direct API failed:",
                err.message,
            ),
        );
}

// Helper: Show cookie status with Token/Cookie indicators in header
function showCookieStatus(
    connected,
    userId,
    userName,
    hasToken,
    hasCookie,
) {
    const tokenIndicator =
        document.getElementById("tokenIndicator");
    const cookieIndicator =
        document.getElementById("cookieIndicator");

    // Update token indicator (Ads Token)
    if (tokenIndicator) {
        tokenIndicator.classList.remove("valid", "invalid");
        tokenIndicator.classList.add(
            hasToken ? "valid" : "invalid",
        );
    }

    // Update cookie indicator
    if (cookieIndicator) {
        cookieIndicator.classList.remove("valid", "invalid");
        cookieIndicator.classList.add(
            hasCookie ? "valid" : "invalid",
        );
    }

    // Update header avatar with user photo or initial
    if (connected) {
        const userId = localStorage.getItem("fewfeed_userId");
        const accessToken = localStorage.getItem(
            "fewfeed_accessToken",
        );
        const avatarImg =
            document.getElementById("headerAvatarImg");
        const avatarInitial = document.getElementById(
            "headerAvatarInitial",
        );

        if (userId && accessToken && avatarImg) {
            const avatarUrl = `https://graph.facebook.com/${userId}/picture?type=normal&width=72&height=72&access_token=${accessToken}`;
            avatarImg.src = avatarUrl;
            avatarImg.onload = () => {
                avatarImg.style.display = "block";
                if (avatarInitial)
                    avatarInitial.style.display = "none";
            };
            avatarImg.onerror = () => {
                avatarImg.style.display = "none";
                if (avatarInitial) {
                    avatarInitial.style.display = "flex";
                    avatarInitial.textContent = (userName || "U")
                        .charAt(0)
                        .toUpperCase();
                }
            };
        } else if (avatarInitial) {
            avatarInitial.textContent = (userName || "U")
                .charAt(0)
                .toUpperCase();
        }
    }

    console.log(
        "[FEWFEED] Status updated - AdsToken:",
        hasToken ? "valid" : "invalid",
        "Cookie:",
        hasCookie ? "valid" : "invalid",
        "PostToken:",
        hasPostToken ? "valid" : "invalid",
    );
}

// Token Modal Functions
function openTokenModal(type) {
    const modal = document.getElementById("tokenModal");
    const adsToken =
        localStorage.getItem("fewfeed_accessToken") ||
        localStorage.getItem("fewfeed_token") ||
        "";
    const cookie = localStorage.getItem("fewfeed_cookie") || "";
    const postToken =
        localStorage.getItem("fewfeed_postToken") || "";

    // Get all token items
    const adsItem = document.getElementById("modalAdsItem");
    const cookieItem = document.getElementById("modalCookieItem");
    const postItem = document.getElementById("modalPostItem");

    // Hide all first
    if (adsItem) adsItem.style.display = "none";
    if (cookieItem) cookieItem.style.display = "none";
    if (postItem) postItem.style.display = "none";

    // Show only the requested type
    if (type === "ads" && adsItem) {
        adsItem.style.display = "block";
        const adsStatus = document.getElementById(
            "modalAdsTokenStatus",
        );
        const adsValue =
            document.getElementById("modalAdsTokenValue");
        adsStatus.textContent = adsToken ? "Valid" : "Invalid";
        adsStatus.className =
            "token-status " + (adsToken ? "valid" : "invalid");
        adsValue.textContent = adsToken || "(No Ads Token)";
        adsValue.className =
            "token-value" + (adsToken ? "" : " empty");
        document.getElementById("tokenModalTitle").textContent =
            "Ads Token";
    } else if (type === "cookie" && cookieItem) {
        cookieItem.style.display = "block";
        const cookieStatus =
            document.getElementById("modalCookieStatus");
        const cookieValue =
            document.getElementById("modalCookieValue");
        cookieStatus.textContent = cookie ? "Valid" : "Invalid";
        cookieStatus.className =
            "token-status " + (cookie ? "valid" : "invalid");
        cookieValue.textContent = cookie || "(No Cookie)";
        cookieValue.className =
            "token-value" + (cookie ? "" : " empty");
        document.getElementById("tokenModalTitle").textContent =
            "Cookie";
    } else if (type === "post" && postItem) {
        postItem.style.display = "block";
        const postStatus = document.getElementById(
            "modalPostTokenStatus",
        );
        const postValue = document.getElementById(
            "modalPostTokenValue",
        );
        postStatus.textContent = postToken ? "Valid" : "Invalid";
        postStatus.className =
            "token-status " + (postToken ? "valid" : "invalid");
        postValue.textContent = postToken || "(No Post Token)";
        postValue.className =
            "token-value" + (postToken ? "" : " empty");
        document.getElementById("tokenModalTitle").textContent =
            "Post Token";
    }

    modal.classList.add("show");
}

function closeTokenModal() {
    const modal = document.getElementById("tokenModal");
    modal.classList.remove("show");
}

function copyToken(type) {
    let value = "";
    let name = "";
    if (type === "ads") {
        value =
            localStorage.getItem("fewfeed_accessToken") ||
            localStorage.getItem("fewfeed_token") ||
            "";
        name = "Ads Token";
    } else if (type === "cookie") {
        value = localStorage.getItem("fewfeed_cookie") || "";
        name = "Cookie";
    } else if (type === "post") {
        value = localStorage.getItem("fewfeed_postToken") || "";
        name = "Post Token";
    }

    if (value) {
        navigator.clipboard
            .writeText(value)
            .then(() => {
                alert(name + " copied!");
            })
            .catch((err) => {
                console.error("Failed to copy:", err);
                // Fallback for older browsers
                const textarea = document.createElement("textarea");
                textarea.value = value;
                document.body.appendChild(textarea);
                textarea.select();
                document.execCommand("copy");
                document.body.removeChild(textarea);
                alert(name + " copied!");
            });
    } else {
        alert("No " + name + " available");
    }
}

// Setup click handlers for status indicators
function setupTokenModalHandlers() {
    const tokenIndicator =
        document.getElementById("tokenIndicator");
    const cookieIndicator =
        document.getElementById("cookieIndicator");
    const postTokenIndicator =
        document.getElementById("postTokenIndicator");
    const modalOverlay = document.getElementById("tokenModal");

    if (tokenIndicator)
        tokenIndicator.addEventListener("click", () =>
            openTokenModal("ads"),
        );
    if (cookieIndicator)
        cookieIndicator.addEventListener("click", () =>
            openTokenModal("cookie"),
        );
    if (postTokenIndicator)
        postTokenIndicator.addEventListener("click", () =>
            openTokenModal("post"),
        );

    // Close modal when clicking outside
    if (modalOverlay) {
        modalOverlay.addEventListener("click", (e) => {
            if (e.target === modalOverlay) closeTokenModal();
        });
    }

    // Close modal with Escape key
    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape") closeTokenModal();
        if (e.key === "Escape") closeApiKeyModal();
    });
}

// API Key Modal Functions
async function openApiKeyModal() {
    const modal = document.getElementById("apiKeyModal");
    const input = document.getElementById("apiKeyModalInput");
    const status = document.getElementById("apiKeyStatus");

    modal.classList.add("show");

    // Load current API key from database
    try {
        const response = await fetch('/api/global-settings?key=gemini_api_key');
        const data = await response.json();
        if (data.success && data.value) {
            input.value = data.value;
            status.textContent = "Valid";
            status.className = "token-status valid";
        } else {
            input.value = "";
            status.textContent = "Not Set";
            status.className = "token-status invalid";
        }
    } catch (e) {
        console.error('Failed to load API key:', e);
        status.textContent = "Error";
        status.className = "token-status invalid";
    }
}

function closeApiKeyModal() {
    const modal = document.getElementById("apiKeyModal");
    modal.classList.remove("show");
}

function toggleApiKeyModalVisibility() {
    const input = document.getElementById("apiKeyModalInput");
    const toggle = document.getElementById("apiKeyModalToggle");
    const isPassword = input.type === "password";
    input.type = isPassword ? "text" : "password";
    toggle.textContent = isPassword ? "Hide" : "Show";
}

async function saveApiKeyModal() {
    const input = document.getElementById("apiKeyModalInput");
    const status = document.getElementById("apiKeyStatus");
    const value = input.value.trim();

    if (!value) {
        alert("กรุณาใส่ API Key");
        return;
    }

    try {
        const response = await fetch('/api/global-settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                key: 'gemini_api_key',
                value: value
            })
        });
        const data = await response.json();

        if (data.success) {
            status.textContent = "Saved!";
            status.className = "token-status valid";
            // Update the indicator
            const indicator = document.getElementById("apiKeyIndicator");
            if (indicator) {
                indicator.classList.remove("invalid");
                indicator.classList.add("valid");
            }
            setTimeout(() => {
                closeApiKeyModal();
            }, 1000);
        } else {
            alert("บันทึกไม่สำเร็จ: " + data.error);
        }
    } catch (e) {
        console.error('Failed to save API key:', e);
        alert("บันทึกไม่สำเร็จ กรุณาลองใหม่");
    }
}

// Setup API Key modal click handler
function setupApiKeyModalHandler() {
    const apiKeyIndicator = document.getElementById("apiKeyIndicator");
    if (apiKeyIndicator) {
        apiKeyIndicator.addEventListener("click", openApiKeyModal);
    }

    // Close modal when clicking outside
    const modalOverlay = document.getElementById("apiKeyModal");
    if (modalOverlay) {
        modalOverlay.addEventListener("click", (e) => {
            if (e.target === modalOverlay) closeApiKeyModal();
        });
    }

    // Update indicator status on load
    updateApiKeyIndicator();
}

async function updateApiKeyIndicator() {
    const indicator = document.getElementById("apiKeyIndicator");
    if (!indicator) return;

    try {
        const response = await fetch('/api/global-settings?key=gemini_api_key');
        const data = await response.json();
        if (data.success && data.value) {
            indicator.classList.remove("invalid");
            indicator.classList.add("valid");
        } else {
            indicator.classList.remove("valid");
            indicator.classList.add("invalid");
        }
    } catch (e) {
        indicator.classList.remove("valid");
        indicator.classList.add("invalid");
    }
}

// Initialize modal handlers when DOM is ready
if (document.readyState === "loading") {
    document.addEventListener(
        "DOMContentLoaded",
        setupTokenModalHandlers,
    );
    document.addEventListener(
        "DOMContentLoaded",
        setupApiKeyModalHandler,
    );
} else {
    setupTokenModalHandlers();
    setupApiKeyModalHandler();
}

// Load saved data from localStorage on page load
function loadSavedData() {
    const accessToken =
        localStorage.getItem("fewfeed_accessToken") ||
        localStorage.getItem("fewfeed_token");
    const postToken = localStorage.getItem("fewfeed_postToken");
    const cookie = localStorage.getItem("fewfeed_cookie");
    const userId = localStorage.getItem("fewfeed_userId");
    const userName = localStorage.getItem("fewfeed_userName");

    if (userId) {
        console.log(
            "[FEWFEED] Loaded saved data from localStorage",
        );
        fbToken = accessToken;
        fbPostToken = postToken;
        fbCookie = cookie;
        showCookieStatus(
            true,
            userId,
            userName,
            !!accessToken,
            !!cookie,
        );

        // Fetch pages using Ads Token
        if (accessToken) {
            fetchPages(accessToken);
        }
    }
}

// Load on startup
loadSavedData();

// Lightbox functionality - get elements on demand since they're after the script
window.showLightbox = function (src) {
    const lightboxOverlay = document.getElementById("lightboxOverlay");
    const lightboxImage = document.getElementById("lightboxImage");
    if (lightboxImage && lightboxOverlay) {
        lightboxImage.src = src;
        lightboxOverlay.classList.add("show");
    }
};

window.closeLightbox = function () {
    const lightboxOverlay = document.getElementById("lightboxOverlay");
    if (lightboxOverlay) {
        lightboxOverlay.classList.remove("show");
    }
};

// Setup lightbox event listeners after DOM ready
document.addEventListener("DOMContentLoaded", () => {
    const lightboxOverlay = document.getElementById("lightboxOverlay");
    if (lightboxOverlay) {
        lightboxOverlay.addEventListener("click", (e) => {
            if (e.target === lightboxOverlay) {
                closeLightbox();
            }
        });
    }

    // Setup auto-resize for textareas
    setupTextareaAutoResize();
});

document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
        closeLightbox();
    }
});
