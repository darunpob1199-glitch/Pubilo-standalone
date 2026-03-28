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
