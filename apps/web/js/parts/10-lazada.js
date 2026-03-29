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
const REELS_V1_MAX_FILE_SIZE = 100 * 1024 * 1024; // 100 MB

// Setup upload button handlers for each mode
function setupUploadHandlers(mode) {
    const els = getModeElements(mode);
    if (!els.uploadFromDevice || !els.uploadFromGemini) return;

    if (mode === "reels") {
        els.uploadFromGemini.disabled = true;
        els.uploadFromGemini.style.opacity = "0.45";
        els.uploadFromGemini.style.cursor = "not-allowed";
        els.uploadFromGemini.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();
            alert("Reels V1 ยังรองรับเฉพาะวิดีโอจากเครื่อง");
        });

        els.uploadFromDevice.addEventListener("click", (e) => {
            e.stopPropagation();
            reelsFileInput?.click();
        });

        if (els.cardImageArea) {
            els.cardImageArea.addEventListener("click", (e) => {
                if (
                    e.target.closest(".back-to-upload") ||
                    e.target.closest(".upload-btn") ||
                    e.target.closest("video")
                ) {
                    return;
                }

                const state = modeState.reels;
                if (state.currentView === "upload") {
                    reelsFileInput?.click();
                }
            });
        }

        return;
    }

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

function resetReelsVideoState(showPrompt = true) {
    const state = modeState.reels;
    const els = getModeElements("reels");

    if (state.selectedVideoUrl?.startsWith("blob:")) {
        URL.revokeObjectURL(state.selectedVideoUrl);
    }

    state.selectedVideoFile = null;
    state.selectedVideoUrl = "";
    state.selectedVideoName = "";
    state.selectedVideoKey = "";
    state.selectedVideoMimeType = "";
    state.selectedVideoSize = 0;
    state.isUploadingVideo = false;
    state.videoUploadError = "";
    state.videoUploadRequestId = "";
    state.selectedImage = null;
    state.currentView = "upload";
    reelsModeVideoReady = false;

    if (els.fullImageView) {
        els.fullImageView.style.display = "none";
        els.fullImageView.textContent = "";
    }

    if (showPrompt && els.uploadPrompt) {
        els.uploadPrompt.style.display = "flex";
    }

    if (els.generateOverlay) els.generateOverlay.style.display = "none";
    if (els.refThumbsRow) els.refThumbsRow.style.display = "none";
    if (els.generatedGrid) els.generatedGrid.style.display = "none";
    if (els.skeletonGrid) els.skeletonGrid.style.display = "none";
    if (els.publishBtn) {
        els.publishBtn.classList.remove("published");
    }
    lastPublishedUrl = null;
    validateReelsMode();
}

function formatReelsVideoMetaLine() {
    const state = modeState.reels;
    const sizeMb = state.selectedVideoSize || state.selectedVideoFile?.size || 0;
    const base = `${state.selectedVideoName || "video"} · ${Math.round((sizeMb / (1024 * 1024)) * 10) / 10} MB`;

    if (state.isUploadingVideo) {
        return `${base} · กำลังอัปขึ้นระบบ...`;
    }

    if (state.videoUploadError) {
        return `${base} · อัปไม่สำเร็จ`;
    }

    if (state.selectedVideoKey) {
        return `${base} · พร้อมโพสต์`;
    }

    return base;
}

function updateReelsVideoMeta() {
    const metaEl = document.getElementById("reelsVideoMeta");
    if (!metaEl) return;
    metaEl.textContent = formatReelsVideoMetaLine();
    metaEl.style.background = modeState.reels.videoUploadError
        ? "rgba(127,29,29,0.78)"
        : "rgba(0,0,0,0.55)";
}

async function uploadReelsVideoToStage(file) {
    const state = modeState.reels;
    const pageId = document.getElementById("pageSelect")?.value?.trim() || "";

    if (!pageId) {
        throw new Error("กรุณาเลือก Page ก่อนอัปโหลดวิดีโอ");
    }

    const requestId = crypto.randomUUID();
    state.videoUploadRequestId = requestId;
    state.isUploadingVideo = true;
    state.videoUploadError = "";
    state.selectedVideoKey = "";
    state.selectedVideoMimeType = file.type || "video/mp4";
    state.selectedVideoSize = file.size;
    updateReelsVideoMeta();
    validateReelsMode();

    const formData = new FormData();
    formData.append("pageId", pageId);
    formData.append("video", file, file.name || "pubilo-reel.mp4");

    const response = await fetch("/api/publish-reel/upload", {
        method: "POST",
        body: formData,
    });

    const data = await response.json();

    if (state.videoUploadRequestId !== requestId) {
        return;
    }

    if (!response.ok || !data.success) {
        state.isUploadingVideo = false;
        state.videoUploadError = data.error || "อัปโหลดวิดีโอไม่สำเร็จ";
        updateReelsVideoMeta();
        validateReelsMode();
        throw new Error(state.videoUploadError);
    }

    state.isUploadingVideo = false;
    state.videoUploadError = "";
    state.selectedVideoKey = String(data.videoKey || "").trim();
    state.selectedVideoMimeType = String(data.mimeType || file.type || "video/mp4").trim();
    state.selectedVideoSize = Number(data.fileSize || file.size || 0);
    state.selectedVideoName = String(data.fileName || file.name || "video").trim();
    updateReelsVideoMeta();
    validateReelsMode();
}

function showSelectedReelsVideo(file) {
    const state = modeState.reels;
    const els = getModeElements("reels");

    if (!file || !els.fullImageView) return;

    if (state.selectedVideoUrl?.startsWith("blob:")) {
        URL.revokeObjectURL(state.selectedVideoUrl);
    }

    const objectUrl = URL.createObjectURL(file);
    state.selectedVideoFile = file;
    state.selectedVideoUrl = objectUrl;
    state.selectedVideoName = file.name || "video";
    state.selectedVideoKey = "";
    state.selectedVideoMimeType = file.type || "video/mp4";
    state.selectedVideoSize = file.size || 0;
    state.isUploadingVideo = false;
    state.videoUploadError = "";
    state.videoUploadRequestId = "";
    state.selectedImage = null;
    state.currentView = "full";

    if (els.uploadPrompt) els.uploadPrompt.style.display = "none";
    if (els.generateOverlay) els.generateOverlay.style.display = "none";
    if (els.refThumbsRow) els.refThumbsRow.style.display = "none";
    if (els.generatedGrid) els.generatedGrid.style.display = "none";
    if (els.skeletonGrid) els.skeletonGrid.style.display = "none";

    els.fullImageView.style.display = "flex";
    els.fullImageView.style.flexDirection = "column";
    els.fullImageView.style.alignItems = "center";
    els.fullImageView.style.justifyContent = "center";
    els.fullImageView.style.background = "#111";
    els.fullImageView.style.position = "relative";
    els.fullImageView.textContent = "";

    const videoEl = document.createElement("video");
    videoEl.src = objectUrl;
    videoEl.controls = true;
    videoEl.preload = "metadata";
    videoEl.playsInline = true;
    videoEl.style.cssText =
        "width: 100%; height: 100%; object-fit: contain; border-radius: 8px; background: #000;";

    const backBtn = document.createElement("button");
    backBtn.className = "back-to-upload";
    backBtn.style.cssText =
        "position: absolute; top: 10px; left: 10px; background: rgba(0,0,0,0.5); border: none; border-radius: 8px; padding: 8px; cursor: pointer; color: white; z-index: 2;";
    backBtn.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>`;
    backBtn.addEventListener("click", (ev) => {
        ev.stopPropagation();
        resetReelsVideoState(true);
    });

    const metaEl = document.createElement("div");
    metaEl.id = "reelsVideoMeta";
    metaEl.style.cssText =
        "position: absolute; left: 12px; right: 12px; bottom: 12px; padding: 8px 10px; border-radius: 10px; background: rgba(0,0,0,0.55); color: #fff; font-size: 0.82rem; line-height: 1.4; z-index: 2;";
    metaEl.textContent = formatReelsVideoMetaLine();

    els.fullImageView.appendChild(videoEl);
    els.fullImageView.appendChild(backBtn);
    els.fullImageView.appendChild(metaEl);

    reelsModeVideoReady = true;
    if (els.publishBtn) {
        els.publishBtn.classList.remove("published");
    }
    lastPublishedUrl = null;
    validateReelsMode();
}

if (reelsFileInput) {
    reelsFileInput.addEventListener("change", async (e) => {
        const file = e.target.files?.[0];
        reelsFileInput.value = "";

        if (!file) return;

        if (!file.type.startsWith("video/")) {
            alert("กรุณาเลือกไฟล์วิดีโอ");
            return;
        }

        if (file.size > REELS_V1_MAX_FILE_SIZE) {
            alert("Reels V1 รองรับวิดีโอไม่เกิน 100 MB");
            return;
        }

        showSelectedReelsVideo(file);

        try {
            await uploadReelsVideoToStage(file);
        } catch (error) {
            console.error("[REELS] Stage upload failed:", error);
            alert(error instanceof Error ? error.message : String(error));
        }
    });
}

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
