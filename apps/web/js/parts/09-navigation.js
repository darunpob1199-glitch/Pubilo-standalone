// 12. NAVIGATION
// ============================================
function getAllowedHash(rawHash) {
    const fallbackMap = {
        quotes: "pending",
        earnings: "news",
        "hide-posts": "published",
    };
    const hiddenHashes = Array.isArray(window.PUBILO_HIDDEN_HASHES) ? window.PUBILO_HIDDEN_HASHES : [];
    const disabledHashes = Array.isArray(window.PUBILO_DISABLED_HASHES) ? window.PUBILO_DISABLED_HASHES : [];

    if (
        rawHash === "link"
        || rawHash === "earnings"
    ) {
        return "news";
    }

    if (disabledHashes.includes(rawHash)) {
        return fallbackMap[rawHash] || "news";
    }

    if (
        window.PUBILO_WEB_ONLY_MODE &&
        hiddenHashes.includes(rawHash)
    ) {
        return fallbackMap[rawHash] || "news";
    }

    return rawHash;
}

function handleNavigation() {
    const requestedHash = window.location.hash.slice(1) || "news";
    const hash = getAllowedHash(requestedHash);

    if (hash !== requestedHash) {
        window.location.hash = hash;
        return;
    }

    document
        .querySelectorAll(".nav-item")
        .forEach((item) => item.classList.remove("active"));

    if (hash === "pending") {
        pendingNavItem.classList.add("active");
        showPendingPanel(false, "posts");
    } else if (hash === "published") {
        publishedNavItem.classList.add("active");
        showPublishedPanel();
    } else if (hash === "hide-posts") {
        if (typeof hidePostsNavItem !== "undefined" && hidePostsNavItem) {
            hidePostsNavItem.classList.add("active");
        }
        if (typeof showHidePostsPanel === "function") {
            showHidePostsPanel();
        } else {
            showPendingPanel(false, "posts");
        }
    } else if (hash === "delete-posts") {
        if (typeof deletePostsNavItem !== "undefined" && deletePostsNavItem) {
            deletePostsNavItem.classList.add("active");
        }
        if (typeof showDeletePostsPanel === "function") {
            showDeletePostsPanel();
        } else {
            showPendingPanel(false, "posts");
        }
    } else if (hash === "quotes") {
        pendingNavItem.classList.add("active");
        showQuotesPanel();
    } else if (hash === "settings") {
        document.getElementById("settingsNavBtn").classList.add("active");
        showSettingsPanel();
    } else if (hash === "billing") {
        const billingNav = document.getElementById("billingNavBtn");
        if (billingNav) billingNav.classList.add("active");
        showBillingPanel();
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
        setPostMode("text");
        showDashboard();
    } else {
        // Default: news
        document.getElementById("newsNavItem").classList.add("active");
        setPostMode("news");
        showDashboard();
    }
    // Re-validate after mode change
    validateLinkMode();
    if (typeof window.syncPublishInFlightUi === "function") {
        window.syncPublishInFlightUi();
    }
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

// Hide posts nav click
if (typeof hidePostsNavItem !== "undefined" && hidePostsNavItem) {
    hidePostsNavItem.addEventListener("click", (e) => {
        e.preventDefault();
        navigateTo("hide-posts");
    });
}

// Delete posts nav click
if (typeof deletePostsNavItem !== "undefined" && deletePostsNavItem) {
    deletePostsNavItem.addEventListener("click", (e) => {
        e.preventDefault();
        navigateTo("delete-posts");
    });
}

// Settings nav item click
document.getElementById("settingsNavBtn").addEventListener("click", (e) => {
    e.preventDefault();
    navigateTo("settings");
});

// Billing nav item click
const billingNavBtn = document.getElementById("billingNavBtn");
if (billingNavBtn) {
    billingNavBtn.addEventListener("click", (e) => {
        e.preventDefault();
        navigateTo("billing");
    });
}

// showBillingPanel function
function showSettingsPanel() {
    document.querySelectorAll(".mode-container").forEach((c) => {
        c.classList.remove("active");
        c.style.display = "none";
    });
    pendingPanel.style.display = "none";
    publishedPanel.style.display = "none";
    if (typeof quotesPanel !== "undefined" && quotesPanel) quotesPanel.style.display = "none";
    if (typeof earningsPanel !== "undefined" && earningsPanel) earningsPanel.style.display = "none";
    const bp = document.getElementById("billingPanel");
    if (bp) bp.style.display = "none";
    const tp = document.getElementById("textPanel");
    if (tp) tp.style.display = "none";
    const textModePanel = document.getElementById("textModePanel");
    if (textModePanel) textModePanel.style.display = "none";
    
    // Hide post tool panels
    const hp = document.getElementById("hidePostsPanel");
    if (hp) hp.style.display = "none";
    const dp = document.getElementById("deletePostsPanel");
    if (dp) dp.style.display = "none";
    
    settingsPanel.style.display = "flex";
    appLayout.classList.add("pending-mode");
    document.body.style.overflow = "";
    if (typeof loadSettingsPanel === "function") {
        loadSettingsPanel();
    }
}

function showBillingPanel() {
    document.querySelectorAll(".mode-container").forEach((c) => {
        c.classList.remove("active");
        c.style.display = "none";
    });
    pendingPanel.style.display = "none";
    publishedPanel.style.display = "none";
    if (typeof quotesPanel !== 'undefined' && quotesPanel) quotesPanel.style.display = "none";
    if (typeof earningsPanel !== 'undefined' && earningsPanel) earningsPanel.style.display = "none";
    settingsPanel.style.display = "none";
    const tp = document.getElementById("textPanel");
    if (tp) tp.style.display = "none";
    const textModePanel = document.getElementById("textModePanel");
    if (textModePanel) textModePanel.style.display = "none";
    
    // Hide post tool panels
    const hp = document.getElementById("hidePostsPanel");
    if (hp) hp.style.display = "none";
    const dp = document.getElementById("deletePostsPanel");
    if (dp) dp.style.display = "none";
    
    const bp = document.getElementById("billingPanel");
    if (bp) bp.style.display = "flex";
    appLayout.classList.add("pending-mode");
    document.body.style.overflow = "";
}

// News nav item click
document.getElementById("newsNavItem").addEventListener("click", (e) => {
    e.preventDefault();
    navigateTo("news");
});

// News mode upload handlers
const newsUploadFromDevice = document.getElementById("newsUploadFromDevice");
const newsUploadFromGemini = document.getElementById("newsUploadFromGemini");
const newsFileInput = document.createElement("input");
newsFileInput.type = "file";
newsFileInput.accept = "image/*";
newsFileInput.multiple = true;

let newsSelectedImages = [];
let newsGeneratedImages = [];
let newsIsGenerating = false;
let newsUploadMode = "device";

if (newsUploadFromDevice) {
    newsUploadFromDevice.addEventListener("click", () => {
        newsUploadMode = "device";
        newsFileInput.click();
    });
}

if (newsUploadFromGemini) {
    newsUploadFromGemini.addEventListener("click", () => {
        newsUploadMode = "gemini";
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
    newsFileInput.value = "";

    if (newsUploadMode === "gemini") {
        newsSelectedImages = [...newImages];
        newsGeneratedImages = [];
        newsModeImageReady = false;
        validateNewsMode();
        await generateNewsImages();
        return;
    }

    useUploadedNewsImages(newImages);
});

function useUploadedNewsImages(images) {
    newsSelectedImages = [...images];
    newsGeneratedImages = images.map((img) => img.dataUrl);
    newsSelectedIndex = 0;
    newsModeImageReady = newsGeneratedImages.length > 0;
    validateNewsMode();

    if (!newsGeneratedImages.length) return;
    const uploadPrompt = document.getElementById("newsUploadPrompt");
    if (uploadPrompt) uploadPrompt.style.display = "none";
    window.selectNewsImage(0);
}

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

window.retryNewsGenerate = function() {
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
window.selectNewsImage = function(index) {
    newsSelectedIndex = index;
    newsModeImageReady = true;
    validateNewsMode();
    
    // Show selected image full size
    const container = document.getElementById("newsFullImageView");
    const uploadPrompt = document.getElementById("newsUploadPrompt");
    if (uploadPrompt) uploadPrompt.style.display = "none";
    container.style.display = "flex";
    container.style.flexDirection = "column";
    container.style.alignItems = "center";
    container.style.justifyContent = "center";
    container.style.padding = "0";
    container.style.position = "relative";
    container.innerHTML = `
        <img src="${newsGeneratedImages[index]}" style="width: 100%; height: 100%; object-fit: contain; border-radius: 8px;">
        <button onclick="removeNewsImage(${index})" style="position: absolute; top: 12px; right: 12px; background: rgba(127,29,29,0.85); color: white; border: none; border-radius: 999px; width: 34px; height: 34px; cursor: pointer; font-size: 18px; font-weight: 700; line-height: 1;">
            ×
        </button>
    `;
};

window.showNewsImageGrid = function() {
    renderNewsGeneratedGrid();
};

window.removeNewsImage = function(index) {
    newsSelectedImages.splice(index, 1);
    newsGeneratedImages.splice(index, 1);
    if (newsSelectedImages.length === 0) {
        newsGeneratedImages = [];
        newsModeImageReady = false;
        validateNewsMode();
        const container = document.getElementById("newsFullImageView");
        container.style.display = "none";
        document.getElementById("newsUploadPrompt").style.display = "flex";
        return;
    }

    newsSelectedIndex = Math.max(0, Math.min(newsSelectedIndex, newsGeneratedImages.length - 1));
    window.selectNewsImage(newsSelectedIndex);
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

    // Validate mode-specific publish button when switching modes
    validateLinkMode();
    if (mode === "news") validateNewsMode();
    if (mode === "reels") validateReelsMode();
    if (mode === "text" && typeof validateTextMode === "function") validateTextMode();
    if (mode === "text" && typeof renderTextComposerUi === "function") renderTextComposerUi();
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
