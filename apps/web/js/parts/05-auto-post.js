// 6. AUTO-POST
// ============================================
const postModeImage = document.getElementById("postModeImage");
const postModeText = document.getElementById("postModeText");
const postModeAlternate = document.getElementById("postModeAlternate");
const pageTokenInputPanel = document.getElementById("pageTokenInputPanel");
const autoFetchPageTokenBtn = document.getElementById("autoFetchPageTokenBtn");
const pageTokenAutoStatus = document.getElementById("pageTokenAutoStatus");
let currentPostMode = "image";

// Auto-Hide elements
const autoHideEnabled = document.getElementById("autoHideEnabled");
const hideTokenInputPanel = document.getElementById("hideTokenInputPanel");
const hideSharedStory = document.getElementById("hideSharedStory");
const hideMobileStatus = document.getElementById("hideMobileStatus");
const hideAddedPhotos = document.getElementById("hideAddedPhotos");

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

function setPageTokenAutoStatus(message, tone = "muted") {
    if (!pageTokenAutoStatus) return;

    const toneColors = {
        muted: "#6b7280",
        loading: "#2563eb",
        success: "#047857",
        error: "#dc2626",
    };

    pageTokenAutoStatus.textContent = message || "";
    pageTokenAutoStatus.style.display = message ? "inline" : "none";
    pageTokenAutoStatus.style.color = toneColors[tone] || toneColors.muted;
}

function getInjectedAccessToken() {
    return (typeof fbToken !== "undefined" && fbToken)
        || localStorage.getItem("fewfeed_accessToken")
        || localStorage.getItem("fewfeed_token")
        || "";
}

function getLoadedPageToken(pageId) {
    if (typeof allPages === "undefined" || !Array.isArray(allPages)) return "";
    const matchedPage = allPages.find((page) => String(page.id) === String(pageId));
    return matchedPage?.access_token || "";
}

function mergeLoadedPageTokens(pages) {
    if (typeof allPages === "undefined" || !Array.isArray(allPages)) return;
    const tokenMap = new Map(
        (pages || [])
            .filter((page) => page?.id && page?.access_token)
            .map((page) => [String(page.id), page.access_token]),
    );

    allPages.forEach((page) => {
        const nextToken = tokenMap.get(String(page.id));
        if (nextToken) {
            page.access_token = nextToken;
        }
    });
}

function requestPagesWithTokens(accessToken) {
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            window.removeEventListener("message", handleMessage);
            reject(new Error("Extension ไม่ตอบกลับ ลองกดใหม่อีกครั้ง"));
        }, 8000);

        function cleanup() {
            clearTimeout(timeout);
            window.removeEventListener("message", handleMessage);
        }

        function handleMessage(event) {
            if (event.source !== window) return;
            if (event.data.type !== "FEWFEED_PAGES_RESPONSE") return;

            cleanup();
            const response = event.data.data;
            if (response?.success && Array.isArray(response.pages)) {
                resolve(response.pages);
                return;
            }

            reject(new Error(response?.error || "ดึงรายชื่อเพจไม่สำเร็จ"));
        }

        window.addEventListener("message", handleMessage);
        window.postMessage(
            {
                type: "FEWFEED_FETCH_PAGES",
                accessToken,
            },
            "*",
        );
    });
}

async function autoFetchPageToken({ silent = false } = {}) {
    const pageId = getCurrentPageId();
    if (!pageId) {
        if (!silent) alert("กรุณาเลือก Page ก่อน");
        setPageTokenAutoStatus("กรุณาเลือกเพจก่อน", "error");
        return null;
    }

    const tokenInput = document.getElementById("pageTokenInputPanel");
    if (!tokenInput) return null;

    const originalButtonText = autoFetchPageTokenBtn?.textContent || "";
    if (autoFetchPageTokenBtn) {
        autoFetchPageTokenBtn.disabled = true;
        autoFetchPageTokenBtn.textContent = "กำลังดึง...";
    }
    setPageTokenAutoStatus("กำลังดึง Page Token...", "loading");

    try {
        let postToken = getLoadedPageToken(pageId);

        if (!postToken) {
            const accessToken = getInjectedAccessToken();
            if (!accessToken) {
                throw new Error("ไม่พบ Ads Token จาก extension กรุณา login Facebook แล้วกด extension อีกครั้ง");
            }

            const pages = await requestPagesWithTokens(accessToken);
            mergeLoadedPageTokens(pages);
            const matchedPage = pages.find((page) => String(page.id) === String(pageId));
            postToken = matchedPage?.access_token || "";
        }

        if (!postToken) {
            throw new Error("ดึง Page Token ไม่ได้ ตรวจสอบว่า account นี้เป็นแอดมินเพจและมีสิทธิ์โพสต์");
        }

        tokenInput.value = postToken;
        tokenInput.dispatchEvent(new Event("input", { bubbles: true }));
        tokenInput.dispatchEvent(new Event("change", { bubbles: true }));

        cachedPageSettings = {
            ...cachedPageSettings,
            pageId,
            postToken,
        };

        setPageTokenAutoStatus("ดึง token ให้แล้ว กดบันทึกการตั้งค่าอีกครั้ง", "success");
        if (!silent) {
            alert("ดึง Page Token สำเร็จแล้ว กดบันทึกการตั้งค่าอีกครั้ง");
        }
        return postToken;
    } catch (error) {
        console.error("[Token] Auto fetch failed:", error);
        const message = error instanceof Error ? error.message : "ดึง Page Token ไม่สำเร็จ";
        setPageTokenAutoStatus(message, "error");
        if (!silent) {
            alert(message);
        }
        return null;
    } finally {
        if (autoFetchPageTokenBtn) {
            autoFetchPageTokenBtn.disabled = false;
            autoFetchPageTokenBtn.textContent = originalButtonText || "ดึงอัตโนมัติ";
        }
    }
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
    console.log("[Auto-Post] loadAutoPostConfig called, pageId:", pageId);
    if (!pageId) return;

    const colorBgEnabled = document.getElementById("colorBgEnabled");
    const colorBgPresetsGroup = document.getElementById("colorBgPresetsGroup");

    try {
        const response = await fetch(`/api/page-settings?pageId=${pageId}`);
        const data = await response.json();
        console.log("[Auto-Post] API response share_page_id:", data.settings?.share_page_id);
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
            await populateSharePageDropdown();
            console.log("[Auto-Post] share_page_id:", config.share_page_id, "shareEnabled element:", shareEnabled);
            if (config.share_page_id) {
                console.log("[Auto-Post] Setting shareEnabled to true");
                shareEnabled.checked = true;
                sharePageGroup.style.display = "block";
                sharePageSelect.value = config.share_page_id;
                console.log("[Auto-Post] shareEnabled.checked:", shareEnabled.checked, "sharePageSelect.value:", sharePageSelect.value);
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
    console.log("[Auto-Hide] loadAutoHideConfig called, pageId:", pageId);
    if (!pageId) return;

    try {
        const response = await fetch(`/api/auto-hide-config?pageId=${pageId}`);
        const data = await response.json();
        console.log("[Auto-Hide] API response:", data);
        if (data.success && data.config) {
            const enabled = data.config.enabled || false;
            console.log("[Auto-Hide] Setting checkbox to:", enabled);
            if (autoHideEnabled) {
                autoHideEnabled.checked = enabled;
                console.log("[Auto-Hide] Checkbox now:", autoHideEnabled.checked);
            } else {
                console.error("[Auto-Hide] autoHideEnabled element NOT FOUND!");
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

// Populate share page dropdown from database
async function populateSharePageDropdown() {
    const currentPageId = getCurrentPageId();
    sharePageSelect.innerHTML = '<option value="">-- เลือกเพจที่จะแชร์ไป --</option>';

    try {
        // Fetch all pages from database
        const response = await fetch('/api/pages');
        const data = await response.json();

        if (data.success && data.pages) {
            console.log("[Share] Got", data.pages.length, "pages from database");
            data.pages.forEach(page => {
                // API returns 'id' and 'name' instead of 'page_id' and 'page_name'
                const pageId = page.id || page.page_id;
                const pageName = page.name || page.page_name;
                if (pageId !== currentPageId) {
                    const option = document.createElement("option");
                    option.value = pageId;
                    option.textContent = pageName || `เพจ ${pageId}`;
                    sharePageSelect.appendChild(option);
                }
            });
        }
    } catch (err) {
        console.error("[Share] Failed to fetch pages:", err);
    }
}

// Load settings into the panel
async function loadSettingsPanel() {
    const pageId = getCurrentPageId();
    if (!pageId) {
        console.log("[LOAD] No page selected");
        return;
    }

    console.log("[LOAD] Loading settings for page:", pageId);

    try {
        const response = await fetch(`/api/page-settings?pageId=${pageId}`);
        const data = await response.json();

        if (data.success && data.settings) {
            const s = data.settings;
            console.log("[LOAD] Got settings from API, post_token:", s.post_token ? s.post_token.substring(0, 20) + "..." : "(null)");

            // Apply ALL settings to form
            autoScheduleEnabledPanel.checked = s.auto_schedule || false;
            scheduleMinutesPanel.value = s.schedule_minutes || "00, 15, 30, 45";
            if (workingHoursStart) workingHoursStart.value = s.working_hours_start ?? 6;
            if (workingHoursEnd) workingHoursEnd.value = s.working_hours_end ?? 24;
            imageSourceSelectPanel.value = s.image_source || "ai";
            ogBackgroundUrlPanel.value = s.og_background_url || "";
            ogFontSelectPanel.value = s.og_font || "noto-sans-thai";

            // Load token into input
            const tokenInput = document.getElementById("pageTokenInputPanel");
            if (tokenInput) {
                tokenInput.value = s.post_token || "";
                console.log("[LOAD] Set token input to:", s.post_token ? s.post_token.substring(0, 20) + "..." : "(empty)");
                setPageTokenAutoStatus(
                    s.post_token
                        ? "พบ token ที่บันทึกไว้แล้ว"
                        : "ยังไม่มี token กดดึงอัตโนมัติได้",
                    s.post_token ? "muted" : "loading",
                );
            }

            // Load hide token into input
            if (hideTokenInputPanel) {
                hideTokenInputPanel.value = s.hide_token || "";
            }

            // Update cache
            cachedPageSettings = {
                pageId,
                autoSchedule: s.auto_schedule,
                scheduleMinutes: s.schedule_minutes,
                postToken: s.post_token,
                workingHoursStart: s.working_hours_start,
                workingHoursEnd: s.working_hours_end,
                aiModel: s.ai_model,
                aiResolution: s.ai_resolution,
                linkImageSize: s.link_image_size,
                imageImageSize: s.image_image_size,
                newsAnalysisPrompt: s.news_analysis_prompt,
                newsGenerationPrompt: s.news_generation_prompt,
                newsImageSize: s.news_image_size,
                newsVariationCount: s.news_variation_count,
                imageSource: s.image_source,
                ogBackgroundUrl: s.og_background_url,
                ogFont: s.og_font
            };
        } else {
            // No settings yet, use defaults
            autoScheduleEnabledPanel.checked = false;
            scheduleMinutesPanel.value = "00, 15, 30, 45";
            if (workingHoursStart) workingHoursStart.value = 6;
            if (workingHoursEnd) workingHoursEnd.value = 24;
            imageSourceSelectPanel.value = "ai";
            ogBackgroundUrlPanel.value = "";
            ogFontSelectPanel.value = "noto-sans-thai";

            const tokenInput = document.getElementById("pageTokenInputPanel");
            if (tokenInput) tokenInput.value = "";
            setPageTokenAutoStatus("ยังไม่มี token กดดึงอัตโนมัติได้", "loading");
        }
    } catch (err) {
        console.error("[LOAD] Failed to load settings:", err);
    }

    if (!pageTokenInputPanel?.value?.trim()) {
        await autoFetchPageToken({ silent: true });
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

    // Load image sizes from database (use cachedPageSettings)
    const savedLinkImageSize = cachedPageSettings?.linkImageSize || cachedPageSettings?.link_image_size || "1:1";
    const savedImageImageSize = cachedPageSettings?.imageImageSize || cachedPageSettings?.image_image_size || "1:1";
    const savedNewsImageSize = cachedPageSettings?.newsImageSize || cachedPageSettings?.news_image_size || "1:1";
    setLinkImageSize(savedLinkImageSize);
    setImageImageSize(savedImageImageSize);
    setNewsImageSize(savedNewsImageSize);

    // Load news prompts
    if (newsAnalysisPromptInput) newsAnalysisPromptInput.value = cachedPageSettings?.newsAnalysisPrompt || "";
    if (newsGenerationPromptInput) newsGenerationPromptInput.value = cachedPageSettings?.newsGenerationPrompt || "";
    if (newsVariationCount) newsVariationCount.value = cachedPageSettings?.newsVariationCount || 4;

    // Auto-resize textareas after loading content
    autoResizeTextarea(linkPromptInput);
    autoResizeTextarea(imagePromptInput);
    if (newsAnalysisPromptInput) autoResizeTextarea(newsAnalysisPromptInput);
    if (newsGenerationPromptInput) autoResizeTextarea(newsGenerationPromptInput);

    // Load AI settings from database
    const savedAiModel = cachedPageSettings?.aiModel || cachedPageSettings?.ai_model || "gemini-2.0-flash-exp";
    const savedAiResolution = cachedPageSettings?.aiResolution || cachedPageSettings?.ai_resolution || "2K";
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

    // Show loading state with spinner
    const originalText = saveSettingsPanelBtn.textContent;
    saveSettingsPanelBtn.innerHTML = '<span class="spinner"></span>กำลังบันทึก...';
    saveSettingsPanelBtn.disabled = true;
    saveSettingsPanelBtn.classList.add('btn-loading');

    // Get token value FIRST before anything else
    const pageTokenInput = document.getElementById("pageTokenInputPanel");
    const postToken = pageTokenInput ? pageTokenInput.value.trim() : "";
    console.log("[SAVE] Token from input:", postToken ? postToken.substring(0, 20) + "..." : "(empty)");

    const autoSchedule = autoScheduleEnabledPanel.checked;
    const mins = scheduleMinutesPanel.value || "00, 15, 30, 45";
    const workingStart = workingHoursStart.value !== "" ? parseInt(workingHoursStart.value) : 6;
    const workingEnd = workingHoursEnd.value !== "" ? parseInt(workingHoursEnd.value) : 24;
    console.log("[SAVE] scheduleMinutes:", mins);
    console.log("[SAVE] workingHoursStart:", workingStart, "workingHoursEnd:", workingEnd);
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

    // Get auto-post mode config
    const colorBgEnabled = document.getElementById("colorBgEnabled");
    const postModeButtons = document.querySelectorAll('.post-mode-btn.active');
    const currentPostMode = postModeButtons[0]?.dataset?.mode || 'image';
    const sharePageSelect = document.getElementById("sharePageSelect");
    const shareEnabled = document.getElementById("shareEnabled");
    const pageColorPicker = document.getElementById("pageColorPicker");

    // Build ONE complete request with ALL settings including token
    // Get hide token (separate from post token)
    const hideToken = hideTokenInputPanel ? hideTokenInputPanel.value.trim() : "";

    const requestBody = {
        pageId,
        postToken,  // TOKEN MUST BE INCLUDED
        hideToken,  // Separate token for auto-hide (optional)
        autoSchedule,
        scheduleMinutes: mins,
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
        ogFont,
        // Include auto-post config in same request
        postMode: currentPostMode,
        colorBg: colorBgEnabled?.checked || false,
        sharePageId: (shareEnabled?.checked && sharePageSelect?.value) ? sharePageSelect.value : null,
        colorBgPresets: currentPresets.join(','),
        shareMode: getShareMode(),
        pageColor: pageColorPicker?.value || '#1a1a1a'
    };

    // Only send pageName if it's a real name (not ID or empty)
    const pageNameElement = document.querySelector('.page-selector-name');
    const pageNameText = pageNameElement?.textContent?.trim();
    if (pageNameText && !pageNameText.match(/^\d+$/) && !pageNameText.startsWith('เพจ ')) {
        requestBody.pageName = pageNameText;
    }

    // Get share schedule minutes
    const shareScheduleGrid = document.getElementById("shareScheduleMinutesGrid");
    if (shareScheduleGrid) {
        const selected = Array.from(shareScheduleGrid.querySelectorAll('input:checked')).map(cb => cb.value);
        requestBody.shareScheduleMinutes = selected.join(', ');
    }

    console.log("[SAVE] Request body postToken:", requestBody.postToken ? requestBody.postToken.substring(0, 20) + "..." : "(empty)");

    try {
        // Save ALL settings in ONE request
        const response = await fetch('/api/page-settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody)
        });
        const data = await response.json();
        console.log("[SAVE] API response:", data.success ? "SUCCESS" : "FAILED");
        console.log("[SAVE] Saved token:", data.settings?.post_token ? data.settings.post_token.substring(0, 20) + "..." : "(null)");

        // Save prompts separately (they use different table)
        if (linkPrompt) {
            await fetch('/api/prompts', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ pageId, promptType: 'link_post', promptText: linkPrompt })
            });
        }
        if (imagePrompt) {
            await fetch('/api/prompts', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ pageId, promptType: 'image_post', promptText: imagePrompt })
            });
        }

        // Save Auto-Hide config (uses different table)
        await saveAutoHideConfig();

        if (data.success) {
            cachedPageSettings = {
                ...cachedPageSettings,
                pageId,
                autoSchedule,
                scheduleMinutes: mins,
                postToken,
                workingHoursStart: workingStart,
                workingHoursEnd: workingEnd,
                newsAnalysisPrompt,
                newsGenerationPrompt,
                newsImageSize,
                newsVariationCount: newsVarCount,
                imageSource,
                ogBackgroundUrl: ogBgUrl,
                ogFont,
            };

            // Update UI mode
            if (currentPostMode) setAutoPostMode(currentPostMode);

            // Show success
            saveSettingsPanelBtn.innerHTML = "✓ บันทึกแล้ว!";
            saveSettingsPanelBtn.classList.remove('btn-loading');
            saveSettingsPanelBtn.classList.add('btn-success');
            setTimeout(() => {
                saveSettingsPanelBtn.innerHTML = "บันทึกการตั้งค่า";
                saveSettingsPanelBtn.classList.remove('btn-success');
                saveSettingsPanelBtn.disabled = false;
            }, 2000);
        } else {
            saveSettingsPanelBtn.innerHTML = "❌ บันทึกไม่สำเร็จ";
            saveSettingsPanelBtn.classList.remove('btn-loading');
            saveSettingsPanelBtn.classList.add('btn-error');
            setTimeout(() => {
                saveSettingsPanelBtn.innerHTML = "บันทึกการตั้งค่า";
                saveSettingsPanelBtn.classList.remove('btn-error');
                saveSettingsPanelBtn.disabled = false;
            }, 2000);
            alert("บันทึกไม่สำเร็จ: " + data.error);
        }
    } catch (error) {
        console.error("[SAVE] Error:", error);
        saveSettingsPanelBtn.innerHTML = "❌ Error";
        saveSettingsPanelBtn.classList.remove('btn-loading');
        saveSettingsPanelBtn.classList.add('btn-error');
        setTimeout(() => {
            saveSettingsPanelBtn.innerHTML = "บันทึกการตั้งค่า";
            saveSettingsPanelBtn.classList.remove('btn-error');
            saveSettingsPanelBtn.disabled = false;
        }, 2000);
        alert("บันทึกไม่สำเร็จ กรุณาลองใหม่");
    }

    updatePublishButton();
});

if (autoFetchPageTokenBtn) {
    autoFetchPageTokenBtn.addEventListener("click", async () => {
        await autoFetchPageToken({ silent: false });
    });
}

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
