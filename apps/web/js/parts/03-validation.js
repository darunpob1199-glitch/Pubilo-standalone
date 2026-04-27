// 3. VALIDATION
// ============================================
let linkModeImageReady = false;
let newsModeImageReady = false;
let reelsModeVideoReady = false;
let textModeReady = false;

function applyPublishingStateIfNeeded(mode, buttonEl) {
    if (!buttonEl) return false;
    const inFlight = typeof window.isAnyPublishInFlight === "function"
        && window.isAnyPublishInFlight();
    if (!inFlight) return false;

    buttonEl.disabled = true;
    buttonEl.style.opacity = "1";
    buttonEl.style.cursor = "wait";
    buttonEl.classList.remove("published");
    buttonEl.innerHTML = '<span class="loading"></span><span>กำลังโพสต์...</span>';
    return true;
}

function validateLinkMode() {
    // Determine current mode - default to 'link'
    const currentMode = postMode || 'link';
    
    if (currentMode === 'link') {
        const hasUrl = linkUrl && linkUrl.value.trim().length > 0;
        const linkDescriptionInput = document.getElementById("linkDescriptionInput");
        // Check both hidden input and preview element (in case blur hasn't synced yet)
        const previewDesc = document.getElementById("previewDescription");
        const descValue = linkDescriptionInput?.value?.trim() || description?.value?.trim() || previewDesc?.textContent?.trim() || '';
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
            if (applyPublishingStateIfNeeded("link", publishBtn)) {
                return;
            }
            publishBtn.disabled = !isValid;
            publishBtn.style.opacity = isValid ? '1' : '0.5';
            publishBtn.style.cursor = isValid ? 'pointer' : 'not-allowed';
            
            // Update button text if it was showing success state but now invalid (e.g. cleared image)
            if (!isValid && publishBtn.classList.contains('published')) {
                publishBtn.classList.remove('published');
                publishBtn.textContent = typeof getPrimaryPublishLabel === "function"
                    ? getPrimaryPublishLabel('link')
                    : 'POST NOW';
            }
        }
    } else if (currentMode === "image") {
        const imagePublishBtn = document.getElementById("imagePublishBtn");
        const imageState = modeState?.image || {};
        const hasImage = !!imageState.selectedImage;
        const isValid = hasImage;

        if (imagePublishBtn) {
            if (applyPublishingStateIfNeeded("image", imagePublishBtn)) {
                return;
            }
            imagePublishBtn.disabled = !isValid;
            imagePublishBtn.classList.toggle("disabled", !isValid);
            imagePublishBtn.style.opacity = isValid ? "1" : "0.5";
            imagePublishBtn.style.cursor = isValid ? "pointer" : "not-allowed";

            if (!imagePublishBtn.classList.contains("published")) {
                imagePublishBtn.textContent = typeof getPrimaryPublishLabel === "function"
                    ? getPrimaryPublishLabel("image")
                    : "POST NOW";
            }
        }
    } else {
        // Other modes don't require link URL/Description validation here
        // (They have their own validation or are always enabled for now)
        if (publishBtn) {
            if (applyPublishingStateIfNeeded("link", publishBtn)) {
                return;
            }
            publishBtn.disabled = false;
            publishBtn.style.opacity = '1';
            publishBtn.style.cursor = 'pointer';
        }
    }
}

function validateNewsMode() {
    const newsUrlInput = document.getElementById("newsUrlInput");
    const newsDescriptionInput = document.getElementById("newsDescriptionInput");
    const newsPreviewDesc = document.getElementById("newsPreviewDescription");
    const newsPublishBtn = document.getElementById("newsPublishBtn");
    const newsFullImageView = document.getElementById("newsFullImageView");
    const newsPreviewCaption = document.getElementById("newsPreviewCaption");

    if (newsPreviewCaption && newsUrlInput) {
        try {
            let urlVal = newsUrlInput.value.trim();
            if (urlVal) {
                if (!urlVal.startsWith('http')) urlVal = 'http://' + urlVal;
                let domain = new URL(urlVal).hostname.replace(/^www\./, '').toUpperCase();
                newsPreviewCaption.textContent = domain;
            } else {
                newsPreviewCaption.textContent = "";
            }
        } catch(e) {
            newsPreviewCaption.textContent = "";
        }
    }

    const hasVisibleNewsImageInDom = (() => {
        if (!newsFullImageView) return false;
        const displayStyle = window.getComputedStyle(newsFullImageView).display;
        if (displayStyle === "none") return false;
        const img = newsFullImageView.querySelector("img");
        const canvas = newsFullImageView.querySelector("canvas");
        return !!((img && img.src) || canvas);
    })();
    
    const hasUrl = newsUrlInput && newsUrlInput.value.trim().length > 0;
    const descriptionValue = newsDescriptionInput?.value?.trim() || newsPreviewDesc?.textContent?.trim() || "";
    const hasDescription = descriptionValue.length > 0;
    const hasImage = newsModeImageReady || hasVisibleNewsImageInDom;
    if (hasImage && !newsModeImageReady) {
        newsModeImageReady = true;
    }
    
    const isValid = hasUrl && hasDescription && hasImage;
    
    if (newsPublishBtn) {
        if (applyPublishingStateIfNeeded("news", newsPublishBtn)) {
            return;
        }
        newsPublishBtn.disabled = !isValid;
        newsPublishBtn.classList.toggle('disabled', !isValid);
        newsPublishBtn.style.opacity = isValid ? '1' : '0.5';
        newsPublishBtn.style.cursor = isValid ? 'pointer' : 'not-allowed';
        if (!newsPublishBtn.classList.contains('published')) {
            const baseLabel = typeof getPrimaryPublishLabel === "function"
                ? getPrimaryPublishLabel("news")
                : "POST NOW";
            newsPublishBtn.textContent = baseLabel;
        }
    }
}

function validateReelsMode() {
    const reelsPublishBtn = document.getElementById("reelsPublishBtn");
    const reelsState = modeState?.reels || {};
    const hasVideo = reelsModeVideoReady;
    const hasUploadedVideo = !!reelsState.selectedVideoKey;
    const isUploading = !!reelsState.isUploadingVideo;
    const hasUploadError = !!reelsState.videoUploadError;
    const isValid = hasVideo && hasUploadedVideo && !isUploading && !hasUploadError;

    if (reelsPublishBtn) {
        if (applyPublishingStateIfNeeded("reels", reelsPublishBtn)) {
            return;
        }
        reelsPublishBtn.disabled = !isValid;
        reelsPublishBtn.classList.toggle("disabled", !isValid);
        reelsPublishBtn.style.opacity = isValid ? "1" : "0.5";
        reelsPublishBtn.style.cursor = isValid ? "pointer" : "not-allowed";
        if (!reelsPublishBtn.classList.contains("published")) {
            reelsPublishBtn.textContent = isUploading ? "UPLOADING..." : "PUBLISH";
        }
    }
}

function validateTextMode() {
    const textPublishBtn = document.getElementById("textPublishBtn");
    const textPrimaryText = document.getElementById("textPrimaryText");
    const hasText = !!textPrimaryText?.value?.trim();
    const isValid = hasText;

    textModeReady = isValid;

    if (textPublishBtn) {
        if (applyPublishingStateIfNeeded("text", textPublishBtn)) {
            return;
        }
        textPublishBtn.disabled = !isValid;
        textPublishBtn.classList.toggle("disabled", !isValid);
        textPublishBtn.style.opacity = isValid ? "1" : "0.5";
        textPublishBtn.style.cursor = isValid ? "pointer" : "not-allowed";
        if (!textPublishBtn.classList.contains("published")) {
            textPublishBtn.textContent = typeof getPrimaryPublishLabel === "function"
                ? getPrimaryPublishLabel("text")
                : "POST NOW";
        }
    }
}

// Listen for link URL changes
if (linkUrl) {
    linkUrl.addEventListener("input", validateLinkMode);
}

const textPrimaryText = document.getElementById("textPrimaryText");
if (textPrimaryText) {
    textPrimaryText.addEventListener("input", () => {
        if (typeof renderTextComposerUi === "function") {
            renderTextComposerUi();
        }
        validateTextMode();
    });
}
// Note: description validation is triggered from setupEditableText blur handler
// and after config loading/form clearing

// Initial validation
setTimeout(validateLinkMode, 500);
setTimeout(validateNewsMode, 500);
setTimeout(validateReelsMode, 500);
setTimeout(validateTextMode, 500);

// ============================================
