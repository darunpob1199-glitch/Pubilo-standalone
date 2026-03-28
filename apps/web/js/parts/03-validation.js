// 3. VALIDATION
// ============================================
let linkModeImageReady = false;
let newsModeImageReady = false;

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
    const newsDescriptionInput = document.getElementById("newsDescriptionInput");
    const newsPreviewDesc = document.getElementById("newsPreviewDescription");
    const newsPublishBtn = document.getElementById("newsPublishBtn");
    
    const hasUrl = newsUrlInput && newsUrlInput.value.trim().length > 0;
    const descriptionValue = newsDescriptionInput?.value?.trim() || newsPreviewDesc?.textContent?.trim() || "";
    const hasDescription = descriptionValue.length > 0;
    const hasImage = newsModeImageReady;
    
    const isValid = hasUrl && hasDescription && hasImage;
    
    if (newsPublishBtn) {
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

// Listen for link URL changes
if (linkUrl) {
    linkUrl.addEventListener("input", validateLinkMode);
}
// Note: description validation is triggered from setupEditableText blur handler
// and after config loading/form clearing

// Initial validation
setTimeout(validateLinkMode, 500);

// ============================================
