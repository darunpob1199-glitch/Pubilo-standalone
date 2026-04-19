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
    regenNewBtn.onclick = function(e) {
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
const linkDescriptionInput = document.getElementById("linkDescriptionInput");
const newsPreviewCardButtonEl = document.getElementById("newsPreviewCardButton");
const linkPreviewCardButtonEl = document.getElementById("previewCardButton");
const newsCtaTypeSelectEl = document.getElementById("newsCtaTypeSelect");
const cardButtonSelectEl = document.getElementById("cardButton");

const CTA_TYPE_TO_LABEL = {
    SHOP_NOW: "Shop Now",
    LEARN_MORE: "Learn More",
    SIGN_UP: "Sign Up",
    BOOK_NOW: "Book Now",
};

function normalizeCtaType(rawType) {
    const normalized = String(rawType || "").trim().toUpperCase();
    return CTA_TYPE_TO_LABEL[normalized] ? normalized : "SHOP_NOW";
}

function getCtaLabelFromType(rawType) {
    const type = normalizeCtaType(rawType);
    return CTA_TYPE_TO_LABEL[type] || "Shop Now";
}

function applyCtaType(rawType) {
    const type = normalizeCtaType(rawType);
    const label = getCtaLabelFromType(type);

    if (newsPreviewCardButtonEl) {
        newsPreviewCardButtonEl.textContent = label;
    }
    if (linkPreviewCardButtonEl) {
        linkPreviewCardButtonEl.textContent = label;
    }

    if (newsCtaTypeSelectEl && newsCtaTypeSelectEl.value !== type) {
        newsCtaTypeSelectEl.value = type;
    }

    if (cardButtonSelectEl && cardButtonSelectEl.value !== type) {
        cardButtonSelectEl.value = type;
    }

    return { type, label };
}

function getCurrentCtaConfig(mode = postMode) {
    if (mode === "link") {
        return applyCtaType(
            cardButtonSelectEl?.value ||
                newsCtaTypeSelectEl?.value ||
                "SHOP_NOW",
        );
    }
    return applyCtaType(
        newsCtaTypeSelectEl?.value ||
            cardButtonSelectEl?.value ||
            "SHOP_NOW",
    );
}

window.getCurrentCtaConfig = getCurrentCtaConfig;

if (newsCtaTypeSelectEl) {
    newsCtaTypeSelectEl.addEventListener("change", () => {
        applyCtaType(newsCtaTypeSelectEl.value);
    });
}

if (cardButtonSelectEl) {
    cardButtonSelectEl.addEventListener("change", () => {
        applyCtaType(cardButtonSelectEl.value);
    });
}

applyCtaType(
    newsCtaTypeSelectEl?.value ||
        cardButtonSelectEl?.value ||
        "SHOP_NOW",
);

caption.addEventListener(
    "input",
    () => (previewCaption.textContent = caption.value),
);
description.addEventListener(
    "input",
    () => {
        const nextValue = description.value;
        previewDescription.textContent = nextValue;
        if (linkDescriptionInput && linkDescriptionInput.value !== nextValue) {
            linkDescriptionInput.value = nextValue;
        }
    },
);

if (linkDescriptionInput) {
    linkDescriptionInput.addEventListener("input", () => {
        const value = linkDescriptionInput.value;
        description.value = value;
        previewDescription.textContent = value;
        validateLinkMode();
    });
}

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
            if (linkDescriptionInput) {
                linkDescriptionInput.value = previewEl.textContent.trim();
            }
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
    if (linkDescriptionInput) {
        linkDescriptionInput.value = previewDescription.textContent.trim();
    }
    validateLinkMode();
});

// Setup news description editable (same as link mode)
const newsPreviewDesc = document.getElementById("newsPreviewDescription");
const newsDescriptionInput = document.getElementById("newsDescriptionInput");
if (newsPreviewDesc) {
    const newsDescInput = document.createElement('input');
    newsDescInput.type = 'hidden';
    newsDescInput.id = 'newsDescription';
    document.body.appendChild(newsDescInput);
    
    setupEditableText(newsPreviewDesc, newsDescInput);
    
    newsPreviewDesc.addEventListener("input", () => {
        newsDescInput.value = newsPreviewDesc.textContent;
        if (newsDescriptionInput) {
            newsDescriptionInput.value = newsPreviewDesc.textContent.trim();
        }
        validateNewsMode();
    });
    
    newsPreviewDesc.addEventListener("blur", () => {
        if (newsDescriptionInput) {
            newsDescriptionInput.value = newsPreviewDesc.textContent.trim();
        }
        validateNewsMode();
    });
}

if (newsDescriptionInput && newsPreviewDesc) {
    newsDescriptionInput.addEventListener("input", () => {
        const value = newsDescriptionInput.value;
        newsPreviewDesc.textContent = value;
        const hiddenNewsDescription = document.getElementById("newsDescription");
        if (hiddenNewsDescription) {
            hiddenNewsDescription.value = value;
        }
        validateNewsMode();
    });
}

function publishNewsViaExtensionDirect(payload = {}, timeoutMs = 70000) {
    const requestId = `news-direct-${Date.now()}-${Math.random().toString(16).slice(2)}`;

    return new Promise((resolve, reject) => {
        let finished = false;
        const cleanup = () => {
            if (finished) return;
            finished = true;
            window.removeEventListener("message", handleMessage);
            clearTimeout(timeoutId);
        };

        const handleMessage = (event) => {
            if (event.source !== window) return;
            if (event.data?.type !== "FEWFEED_PUBLISH_NEWS_DIRECT_RESPONSE") return;
            if (String(event.data?.requestId || "") !== requestId) return;
            cleanup();
            resolve(event.data?.data || { success: false, error: "no_response_payload" });
        };

        const timeoutId = setTimeout(() => {
            cleanup();
            reject(new Error("Extension direct publish timeout"));
        }, Math.max(5000, Number(timeoutMs || 25000)));

        window.addEventListener("message", handleMessage);
        window.postMessage({
            type: "FEWFEED_PUBLISH_NEWS_DIRECT",
            requestId,
            ...payload,
        }, "*");
    });
}

// News publish handler
const newsPublishBtn = document.getElementById("newsPublishBtn");
if (newsPublishBtn) {
    newsPublishBtn.addEventListener("click", async () => {
        if (typeof window.isAnyPublishInFlight === "function" && window.isAnyPublishInFlight()) {
            window.showPublishToast?.("มีงานโพสต์กำลังทำงานอยู่ รอให้เสร็จก่อนโพสต์ถัดไป", "error");
            return;
        }
        if (newsPublishBtn.disabled) return;

        const baseLabel = typeof getPrimaryPublishLabel === "function"
            ? getPrimaryPublishLabel("news")
            : "POST NOW";
        const publishTimeoutMs = Number(window.__PUBILO_PUBLISH_TIMEOUT_MS || 120000);
        window.__PUBILO_PUBLISH_TIMEOUT_MS = publishTimeoutMs;
        const resetNewsButtonIdle = () => {
            newsPublishBtn.textContent = baseLabel;
            newsPublishBtn.disabled = false;
            newsPublishBtn.classList.remove("published");
            validateNewsMode();
        };
        const createPublishTimeoutError = (timeoutMs) => {
            const timeoutSeconds = Math.max(1, Math.round(Number(timeoutMs) / 1000));
            const error = new Error(
                `ระบบใช้เวลาตรวจสถานะโพสต์นานกว่า ${timeoutSeconds} วินาที\nโพสต์อาจสำเร็จไปแล้ว กรุณาตรวจที่หน้า Published หรือบนหน้าเพจก่อนกดโพสต์ซ้ำ`,
            );
            error.name = "PublishRequestTimeoutError";
            error.code = "PUBLISH_TIMEOUT";
            return error;
        };
        const isPublishTimeoutError = (error) =>
            error?.name === "PublishRequestTimeoutError" || error?.code === "PUBLISH_TIMEOUT";
        const withTimeout = async (promise, ms, fallbackValue = null) => {
            let timeoutId;
            const timeoutPromise = new Promise((resolve) => {
                timeoutId = setTimeout(() => resolve(fallbackValue), ms);
            });
            try {
                return await Promise.race([promise, timeoutPromise]);
            } finally {
                clearTimeout(timeoutId);
            }
        };
        const isSessionExpiredErrorMessage = (value) =>
            /session has been invalidated|error validating access token|facebook session หมดอายุ|errorcode["']?\s*:\s*190/i.test(
                String(value || ""),
            );
        const shouldAutoResetPubiloState = (value) =>
            /session has been invalidated|error validating access token|facebook session หมดอายุ|invalid oauth access token|extension context invalidated/i.test(
                String(value || ""),
            );
        const attemptNewsSessionRecovery = async () => {
            let recovered = false;
            const latestTokenFromLocal = () =>
                String(
                    fbToken ||
                    localStorage.getItem("fewfeed_accessToken") ||
                    localStorage.getItem("fewfeed_token") ||
                    "",
                ).trim();
            const latestCookieFromLocal = () =>
                String(
                    fbCookie ||
                    localStorage.getItem("fewfeed_cookie") ||
                    "",
                ).trim();
            const beforeSnapshot = {
                token: latestTokenFromLocal(),
                cookie: latestCookieFromLocal(),
                userId: String(localStorage.getItem("fewfeed_userId") || "").trim(),
                selectedPageToken: String(localStorage.getItem("fewfeed_selectedPageToken") || "").trim(),
                pageTokenMapRaw: String(localStorage.getItem(PAGE_TOKEN_MAP_KEY) || "{}"),
            };
            const hasSessionAdvanced = () => {
                const afterToken = latestTokenFromLocal();
                const afterCookie = latestCookieFromLocal();
                const afterUserId = String(localStorage.getItem("fewfeed_userId") || "").trim();
                const afterSelectedPageToken = String(localStorage.getItem("fewfeed_selectedPageToken") || "").trim();
                const afterPageTokenMapRaw = String(localStorage.getItem(PAGE_TOKEN_MAP_KEY) || "{}");
                return !!(
                    (afterToken && afterToken !== beforeSnapshot.token) ||
                    (afterCookie && afterCookie !== beforeSnapshot.cookie) ||
                    (afterUserId && afterUserId !== beforeSnapshot.userId) ||
                    (!beforeSnapshot.token && afterToken) ||
                    (!beforeSnapshot.cookie && afterCookie) ||
                    (afterSelectedPageToken && afterSelectedPageToken !== beforeSnapshot.selectedPageToken) ||
                    (afterPageTokenMapRaw !== beforeSnapshot.pageTokenMapRaw)
                );
            };
            const selectBackendSessionRow = (tokens = []) => {
                const localUserId = String(localStorage.getItem("fewfeed_userId") || "").trim();
                const localCookie = latestCookieFromLocal();
                const cookieUserId = typeof extractFacebookUserIdFromCookie === "function"
                    ? String(extractFacebookUserIdFromCookie(localCookie) || "").trim()
                    : "";
                const preferred =
                    tokens.find((token) => String(token?.user_id || "").trim() === cookieUserId) ||
                    tokens.find((token) => String(token?.user_id || "").trim() === localUserId) ||
                    null;
                if (preferred) return preferred;
                if (cookieUserId || localUserId) return null;
                return (
                    tokens.find((token) => String(token?.ads_token || "").trim()) ||
                    tokens.find((token) => String(token?.cookie || "").trim()) ||
                    tokens[0] ||
                    null
                );
            };
            const refreshFromBackendTokens = async () => {
                const response = await fetch("/api/tokens?refreshFromCookie=1");
                const payload = await response.json().catch(() => ({}));
                const tokens = Array.isArray(payload?.tokens) ? payload.tokens : [];
                if (tokens.length === 0) return false;

                const selected = selectBackendSessionRow(tokens);
                if (!selected) return false;

                const rawAdsToken = String(selected?.ads_token || "").trim();
                const nextAdsToken =
                    typeof isAcceptableAdsTokenCandidate === "function"
                        ? (isAcceptableAdsTokenCandidate(rawAdsToken) ? rawAdsToken : "")
                        : rawAdsToken;
                const nextCookie = String(selected?.cookie || latestCookieFromLocal() || "").trim();
                const nextSession = {
                    adsToken: nextAdsToken,
                    cookie: nextCookie,
                    fbDtsg: selected?.fb_dtsg || localStorage.getItem("fewfeed_fbDtsg") || "",
                    userId: selected?.user_id || localStorage.getItem("fewfeed_userId") || "",
                    userName: selected?.user_name || localStorage.getItem("fewfeed_userName") || "",
                    avatarUrl: selected?.avatar_url || localStorage.getItem("fewfeed_avatarUrl") || "",
                };

                if (typeof applyExtensionSessionData === "function") {
                    applyExtensionSessionData(nextSession, "news-session-recovery-backend");
                } else {
                    if (nextSession.adsToken) {
                        localStorage.setItem("fewfeed_accessToken", nextSession.adsToken);
                        localStorage.setItem("fewfeed_token", nextSession.adsToken);
                    }
                    if (nextSession.cookie) {
                        localStorage.setItem("fewfeed_cookie", nextSession.cookie);
                    }
                    if (nextSession.userId) {
                        localStorage.setItem("fewfeed_userId", nextSession.userId);
                    }
                    if (nextSession.userName) {
                        localStorage.setItem("fewfeed_userName", nextSession.userName);
                    }
                    if (nextSession.avatarUrl) {
                        localStorage.setItem("fewfeed_avatarUrl", nextSession.avatarUrl);
                    }
                    if (nextSession.fbDtsg) {
                        localStorage.setItem("fewfeed_fbDtsg", nextSession.fbDtsg);
                    }
                }
                return !!(nextSession.adsToken || nextSession.cookie);
            };

            try {
                if (typeof syncWithExtensionNow === "function") {
                    recovered = !!(await withTimeout(
                        syncWithExtensionNow({ forceRefresh: true, requireAdsToken: false }),
                        20000,
                        false,
                    ));
                }
            } catch (_) {
                // Ignore and continue next recovery strategy.
            }
            if (!recovered) {
                recovered = hasSessionAdvanced();
            }

            if (!recovered) {
                try {
                    if (typeof refreshFacebookTokensFromExtension === "function") {
                        const refreshResult = await withTimeout(
                            refreshFacebookTokensFromExtension(),
                            15000,
                            { success: false },
                        );
                        recovered = !!refreshResult?.success;
                    }
                } catch (_) {
                    // Ignore and continue next recovery strategy.
                }
            }
            if (!recovered) {
                recovered = hasSessionAdvanced();
            }

            try {
                if (typeof syncLocalCookieTokenToWorkspace === "function") {
                    await withTimeout(
                        syncLocalCookieTokenToWorkspace({ preferLocalToken: false }),
                        7000,
                        null,
                    );
                }
            } catch (_) {
                // Workspace sync is best-effort only.
            }

            if (!recovered) {
                try {
                    recovered = !!(await withTimeout(
                        refreshFromBackendTokens(),
                        9000,
                        false,
                    ));
                } catch (_) {
                    // Ignore backend refresh errors and keep normal flow.
                }
            }

            if (!recovered) {
                recovered = hasSessionAdvanced();
            }

            try {
                const warmToken = latestTokenFromLocal();
                if (pageId && typeof getFreshPageTokenFromExtension === "function") {
                    const freshPageToken = await withTimeout(
                        getFreshPageTokenFromExtension(pageId, warmToken, { skipWorkspaceFallback: false }),
                        9000,
                        "",
                    );
                    if (freshPageToken) {
                        recovered = true;
                    }
                }
            } catch (_) {
                // Token warm-up is best-effort only.
            }

            return recovered;
        };

        // Show immediate feedback so click is never silent.
        newsPublishBtn.disabled = true;
        newsPublishBtn.innerHTML = '<span class="loading"></span><span>กำลังเตรียมโพสต์...</span>';

        const pageId = getCurrentPageId();
        const adsToken = fbToken || localStorage.getItem("fewfeed_accessToken") || localStorage.getItem("fewfeed_token");
        const cookie = fbCookie || localStorage.getItem("fewfeed_cookie");
        const freshPageToken = typeof getFreshPageTokenFromExtension === "function"
            ? await withTimeout(
                getFreshPageTokenFromExtension(pageId, adsToken, { skipWorkspaceFallback: false }),
                9000,
                "",
            )
            : "";
        const manualPageToken = document.getElementById("pageTokenInputPanel")?.value?.trim() || "";
        const cachedPageToken =
            !adsToken && !cookie
                ? (getPageToken() || localStorage.getItem("fewfeed_selectedPageToken") || localStorage.getItem("fewfeed_postToken") || "")
                : "";
        const pageToken = freshPageToken || manualPageToken || cachedPageToken || "";
        let adAccountId =
            (typeof getVerifiedSelectedAdAccountId === "function"
                ? getVerifiedSelectedAdAccountId()
                : (typeof getSelectedAdAccountId === "function"
                    ? getSelectedAdAccountId()
                    : "")) ||
            (typeof getSelectedAdAccountId === "function"
                ? (() => {
                    const currentSelected = String(getSelectedAdAccountId() || "").trim();
                    const adAccountSelect = document.getElementById("newsAdAccountSelect") || document.getElementById("adAccountSelect");
                    if (!currentSelected || !adAccountSelect) return "";
                    const hasMatchingOption = Array.from(adAccountSelect.options || []).some((option) => {
                        const optionValue = String(option.value || "").trim();
                        return optionValue && optionValue === currentSelected;
                    });
                    return hasMatchingOption ? currentSelected : "";
                })()
                : "") ||
            document.getElementById("newsAdAccountSelect")?.value ||
            document.getElementById("adAccountSelect")?.value ||
            "";
        const newsUrlInputEl = document.getElementById("newsUrlInput");
        const newsPrimaryTextEl = document.getElementById("newsPrimaryText");
        const newsPreviewDescEl = document.getElementById("newsPreviewDescription");
        const newsPreviewCaptionEl = document.getElementById("newsPreviewCaption");
        const ctaConfig = getCurrentCtaConfig("news");
        
        if (!pageId) {
            alert("กรุณาเลือกเพจก่อน");
            resetNewsButtonIdle();
            return;
        }

        if (!pageToken && !adsToken && !cookie) {
            alert("ไม่มี token สำหรับโพสต์ กรุณา login extension ใหม่ หรือใส่ Page Token ใน Settings");
            resetNewsButtonIdle();
            return;
        }

        if (!adAccountId && adsToken && typeof fetchAdAccounts === "function") {
            adAccountId = await withTimeout(fetchAdAccounts(adsToken), 9000, "");
        }

        if (!adAccountId) {
            window.showPublishToast?.(
                "ยังไม่เจอ Ad Account บนหน้าเว็บ กำลังให้เซิร์ฟเวอร์ค้นหาให้อัตโนมัติ",
                "warning",
            );
        }
        
        const linkUrlValue = newsUrlInputEl?.value?.trim();
        const descriptionText = newsDescriptionInput?.value?.trim() || newsPreviewDescEl?.textContent?.trim() || "";
        const captionText = newsPreviewCaptionEl?.textContent?.trim() || "S.LAZADA.CO.TH";
        const primaryText = newsPrimaryTextEl?.value?.trim() || "";
        let imageData = newsGeneratedImages[newsSelectedIndex];
        
        if (!linkUrlValue || !descriptionText || !imageData) {
            alert("กรุณากรอกข้อมูลให้ครบ");
            resetNewsButtonIdle();
            return;
        }
        
        if (typeof window.setPublishInFlightState === "function") {
            window.setPublishInFlightState("news", true);
        } else {
            newsPublishBtn.disabled = true;
            newsPublishBtn.innerHTML =
                '<span class="loading"></span><span>กำลังโพสต์...</span>';
        }
        
        try {
            // Compress image and keep data URL for direct Facebook multipart upload.
            if (imageData.startsWith("data:")) {
                imageData = await compressImage(imageData, 1200, 0.8);
            }
            
            const scheduleResult = await withTimeout(
                resolveScheduledTimeForMode("news", pageId),
                8000,
                { scheduledTime: null, scheduleSource: "immediate" },
            );
            const { scheduledTime, scheduleSource } = scheduleResult || {
                scheduledTime: null,
                scheduleSource: "immediate",
            };
            console.log("[News] Schedule source:", scheduleSource, scheduledTime?.toISOString?.() || null);
            
            const buildPublishRequest = async () => {
                const latestAdsToken = fbToken || localStorage.getItem("fewfeed_accessToken") || localStorage.getItem("fewfeed_token");
                const latestCookie = fbCookie || localStorage.getItem("fewfeed_cookie");
                const latestPageToken = typeof getFreshPageTokenFromExtension === "function"
                    ? await withTimeout(
                        getFreshPageTokenFromExtension(pageId, latestAdsToken, { skipWorkspaceFallback: false }),
                        9000,
                        "",
                    )
                    : "";
                const manualPageToken = document.getElementById("pageTokenInputPanel")?.value?.trim() || "";
                const cachedPageToken =
                    !latestAdsToken && !latestCookie
                        ? (
                            localStorage.getItem("fewfeed_selectedPageToken") ||
                            localStorage.getItem("fewfeed_postToken") ||
                            ""
                        )
                        : "";

                return {
                    pageId,
                    pageToken: latestPageToken || manualPageToken || cachedPageToken || "",
                    accessToken: latestAdsToken,
                    cookieData: latestCookie,
                    targetPageIds:
                        typeof getSelectedTargetPageIds === "function"
                            ? getSelectedTargetPageIds()
                            : [],
                    imageUrl: imageData,
                    linkUrl: linkUrlValue,
                    linkName: descriptionText ? `พิกัด : ${descriptionText}` : "",
                    description: descriptionText,
                    caption: captionText,
                    primaryText,
                    postMode: "news",
                    adAccountId,
                    callToAction: ctaConfig.type,
                    callToActionLabel: ctaConfig.label,
                    // Rich link card mode depends on the creative flow.
                    // The API only allows materialization for immediate posts
                    // and cleans up the transient ad object after story creation.
                    allowAdCreativePublish: true,
                    scheduleInSystem: scheduleSource === "manual",
                    scheduledTime: scheduledTime
                        ? Math.floor(scheduledTime.getTime() / 1000)
                        : null,
                };
            };

            const sendPublishRequest = async () => {
                const payload = await buildPublishRequest();
                const normalizedApiBase = String(window.API_BASE || "https://api.pubilo.com").replace(/\/+$/, "");

                const runAttempt = async (url, useNativeDirect = false) => {
                    const controller = new AbortController();
                    const timeout = setTimeout(() => controller.abort(), publishTimeoutMs);
                    try {
                        const fetchImpl =
                            useNativeDirect && typeof window.__PUBILO_NATIVE_FETCH__ === "function"
                                ? window.__PUBILO_NATIVE_FETCH__
                                : fetch;
                        const response = await fetchImpl(url, {
                            method: "POST",
                            headers: {
                                "Content-Type": "application/json",
                            },
                            credentials: "include",
                            body: JSON.stringify(payload),
                            signal: controller.signal,
                        });
                        const data = await response.json().catch(() => ({
                            success: false,
                            error: `Publish API returned non-JSON response (status ${response.status})`,
                        }));
                        return { response, data };
                    } catch (error) {
                        if (error?.name === "AbortError") {
                            throw createPublishTimeoutError(publishTimeoutMs);
                        }
                        throw error;
                    } finally {
                        clearTimeout(timeout);
                    }
                };

                const shouldRetryViaApiBase = (attemptResult) => {
                    const status = Number(attemptResult?.response?.status || 0);
                    const errorText = String(attemptResult?.data?.error || "").toLowerCase();
                    if ([404, 405, 502, 503, 504].includes(status)) return true;
                    if (status >= 500) return true;
                    if (errorText.includes("publish api returned non-json response")) return true;
                    if (errorText.includes("invalid request") || errorText.includes("invalid parameter")) return true;
                    return false;
                };

                const primaryResult = await runAttempt("/api/publish");
                const fallbackUrl = `${normalizedApiBase}/api/publish`;
                const shouldUseFallback =
                    !!normalizedApiBase &&
                    fallbackUrl !== "/api/publish" &&
                    shouldRetryViaApiBase(primaryResult);

                if (!shouldUseFallback) {
                    return primaryResult;
                }

                console.warn("[News] Primary /api/publish failed, retrying via API_BASE endpoint:", fallbackUrl, primaryResult?.data?.error || "");
                return await runAttempt(fallbackUrl, true);
            };

            let { response, data } = await sendPublishRequest();
            let didSessionAutoRetry = false;

            if (
                typeof isInvalidFacebookSessionError === "function" &&
                isInvalidFacebookSessionError(data)
            ) {
                const recovered = await attemptNewsSessionRecovery();
                if (recovered) {
                    didSessionAutoRetry = true;
                    window.showPublishToast?.(
                        "รีเฟรช Facebook session แล้ว กำลังลองโพสต์ให้อีกครั้ง",
                        "warning",
                    );
                    ({ response, data } = await sendPublishRequest());
                }
            }

            const shouldTryExtensionDirectFallback = (() => {
                const errorMessage = String(data?.error || "").toLowerCase();
                const errorCode = Number(data?.errorCode || 0);
                return (
                    (!response?.ok || !data?.success) &&
                    (
                        errorCode === 1 ||
                        errorMessage.includes("invalid request") ||
                        (
                            typeof isInvalidFacebookSessionError === "function" &&
                            isInvalidFacebookSessionError(data)
                        ) ||
                        errorMessage.includes("error validating access token") ||
                        errorMessage.includes("session has been invalidated") ||
                        errorMessage.includes("invalid oauth access token")
                    )
                );
            })();

            if (shouldTryExtensionDirectFallback) {
                window.showPublishToast?.(
                    "เซิร์ฟเวอร์โพสต์ไม่ผ่าน กำลังลองโพสต์ผ่าน Extension ตรงจากเครื่องนี้...",
                    "warning",
                );

                try {
                    const directPayload = await buildPublishRequest();
                    const previewLinkUrl = String(data?._debug?.previewUrl || "").trim();
                    if (previewLinkUrl) {
                        directPayload.previewLinkUrl = previewLinkUrl;
                    }
                    const directResult = await publishNewsViaExtensionDirect(directPayload, 70000);
                    if (directResult?.success && (directResult?.postId || directResult?.id)) {
                        response = { ok: true, status: 200 };
                        data = {
                            success: true,
                            postId: directResult.postId || directResult.id,
                            url: directResult.url || "",
                            warning: directResult.warning || "โพสต์ผ่าน Extension direct fallback สำเร็จ",
                            _debug: {
                                flow: "extension-direct-fallback",
                            },
                        };
                    } else if (directResult?.error) {
                        const directDebug = directResult?.debug && typeof directResult.debug === "object"
                            ? directResult.debug
                            : {};
                        data = {
                            ...(data || {}),
                            _debug: {
                                ...(data?._debug || {}),
                                extensionDirectError: directResult.error,
                                extensionDirectCode: directResult.errorCode || 0,
                                extensionDirectPhase: directDebug.phase || "",
                                extensionDirectStrategy: directDebug.strategy || "",
                            },
                        };
                    }
                } catch (directError) {
                    data = {
                        ...(data || {}),
                        _debug: {
                            ...(data?._debug || {}),
                            extensionDirectError: directError?.message || String(directError || ""),
                        },
                    };
                }
            }

            console.log("[News] Publish response:", data);

            if (!response.ok || !data.success) {
                console.error("[News] Publish FAILED:", JSON.stringify(data, null, 2));
                const meta = [];
                if (data.errorCode) meta.push(`code ${data.errorCode}`);
                if (data.errorSubcode) meta.push(`subcode ${data.errorSubcode}`);
                if (data._debug) {
                    if (typeof data._debug.candidateCount === "number") {
                        meta.push(`candidates:${data._debug.candidateCount}`);
                    }
                    const endpointTag = data._debug.isNewsLinkPost
                        ? "news"
                        : (data._debug.postMode || data._debug.flow || "");
                    if (endpointTag) {
                        meta.push(`endpoint:${endpointTag}`);
                    }
                    if (data._debug.extensionDirectError) {
                        const normalizedExtError = String(data._debug.extensionDirectError || "")
                            .replace(/\s+/g, " ")
                            .trim()
                            .slice(0, 80);
                        if (normalizedExtError) {
                            meta.push(`ext:${normalizedExtError}`);
                        }
                    }
                    if (data._debug.extensionDirectPhase) {
                        meta.push(`extPhase:${String(data._debug.extensionDirectPhase).slice(0, 24)}`);
                    }
                    if (data._debug.extensionDirectStrategy) {
                        meta.push(`extMode:${String(data._debug.extensionDirectStrategy).slice(0, 28)}`);
                    }
                    if (data._debug.hostedImageUrl) meta.push('hasHostedImg');
                    if (data._debug.fbError?.fbtrace_id) meta.push(`trace:${data._debug.fbError.fbtrace_id}`);
                }
                const detail = meta.length > 0 ? ` (${meta.join(", ")})` : "";
                let message = (data.error || "Facebook API error") + detail;
                if (typeof isInvalidFacebookSessionError === "function" && isInvalidFacebookSessionError(data)) {
                    message = didSessionAutoRetry
                        ? "Facebook session หมดอายุ แม้ระบบลองรีเฟรชอัตโนมัติแล้ว กรุณา login Facebook ใหม่ แล้วกด extension อีกครั้ง" + detail
                        : "Facebook session หมดอายุ กรุณา login Facebook ใหม่ แล้วกด extension อีกครั้ง" + detail;
                }
                throw new Error(message);
            }
            if (data.warning) {
                window.showPublishToast?.(data.warning, "error");
            }

            const postId = data.postId || data.post_id || data.id;
            const isQueuedPost = typeof postId === "string" && postId.startsWith("queue:");
            if (data.url) {
                lastPublishedUrl = data.url;
            } else if (postId && !isQueuedPost) {
                lastPublishedUrl = `https://www.facebook.com/${postId}`;
            }

            if (postId || data.queued) {
                newsPublishBtn.textContent = "✓";
                newsPublishBtn.classList.add("published");
                newsPublishBtn.disabled = false;
                const isScheduledNewsPost =
                    !!scheduledTime || data.queued || data.needsScheduling;
                window.showPublishToast?.(
                    isScheduledNewsPost
                        ? "ตั้งเวลาโพสต์สำเร็จแล้ว"
                        : "โพสต์สำเร็จแล้ว",
                );

                if (isScheduledNewsPost && scheduledTime) {
                    await refreshScheduledPostTimes();
                    updateNextScheduleDisplay();
                }

                if (isScheduledNewsPost) {
                    setTimeout(() => {
                        window.location.hash = "#pending";
                        handleNavigation();

                        if (newsUrlInputEl) newsUrlInputEl.value = "";
                        if (newsPrimaryTextEl) newsPrimaryTextEl.value = "";
                        if (newsPreviewDescEl) newsPreviewDescEl.textContent = "";
                        if (newsDescriptionInput) newsDescriptionInput.value = "";
                        if (typeof clearManualSchedule === "function") {
                            clearManualSchedule("news");
                        }
                        newsGeneratedImages = [];
                        newsSelectedImages = [];
                        newsModeImageReady = false;

                        const container = document.getElementById("newsFullImageView");
                        if (container) container.style.display = "none";
                        const uploadPrompt = document.getElementById("newsUploadPrompt");
                        if (uploadPrompt) uploadPrompt.style.display = "flex";

                        const baseLabel = typeof getPrimaryPublishLabel === "function"
                            ? getPrimaryPublishLabel("news")
                            : "POST NOW";
                        newsPublishBtn.textContent = baseLabel;
                        newsPublishBtn.classList.remove("published");
                        newsPublishBtn.disabled = true;
                        newsPublishBtn.style.opacity = "0.5";
                        validateNewsMode();
                    }, 1000);
                } else {
                    window.handleImmediatePublishSuccess?.("news", {
                        publishBtn: newsPublishBtn,
                        primaryText: newsPrimaryTextEl,
                    });
                }
            } else {
                throw new Error("Facebook ไม่คืน post id กลับมา");
            }
        } catch (err) {
            console.error("[News] Publish error:", err);
            const isPublishTimeout = isPublishTimeoutError(err);
            const errMessage = String(err?.message || err || "");
            const isSessionExpiredError = isSessionExpiredErrorMessage(errMessage);
            const willAutoResetPubiloState =
                shouldAutoResetPubiloState(errMessage) &&
                typeof window.autoResetPubiloBrowserState === "function";
            if (isPublishTimeout) {
                window.showPublishToast?.("คำขอโพสต์นานกว่าปกติ โพสต์อาจสำเร็จไปแล้ว กรุณาตรวจที่หน้า Published ก่อนกดซ้ำ", "warning");
                if (typeof window.showPubiloBlockingMessage === "function") {
                    await window.showPubiloBlockingMessage(String(errMessage || "คำขอโพสต์ใช้เวลานานกว่าปกติ"));
                } else {
                    alert(String(errMessage || "คำขอโพสต์ใช้เวลานานกว่าปกติ"));
                }
            } else if (isSessionExpiredError) {
                const sessionMessage = willAutoResetPubiloState
                    ? "Facebook session หมดอายุ และระบบรีเฟรชอัตโนมัติไม่สำเร็จ\nระบบจะรีเซ็ต state ของ Pubilo ให้อัตโนมัติหลังปิด popup นี้\nกรุณา login Facebook ใหม่ แล้วกด extension อีกครั้ง"
                    : "Facebook session หมดอายุ และระบบรีเฟรชอัตโนมัติไม่สำเร็จ\nกรุณา login Facebook ใหม่ แล้วกด extension อีกครั้ง";
                if (typeof window.showPubiloBlockingMessage === "function") {
                    await window.showPubiloBlockingMessage(sessionMessage);
                } else {
                    alert(sessionMessage);
                }
            } else {
                const genericMessage = willAutoResetPubiloState
                    ? `เกิดข้อผิดพลาด: ${errMessage}\n\nระบบจะรีเซ็ต state ของ Pubilo ให้อัตโนมัติหลังปิด popup นี้`
                    : "เกิดข้อผิดพลาด: " + errMessage;
                if (typeof window.showPubiloBlockingMessage === "function") {
                    await window.showPubiloBlockingMessage(genericMessage);
                } else {
                    alert(genericMessage);
                }
            }
            if (willAutoResetPubiloState) {
                setTimeout(() => {
                    withTimeout(
                        Promise.resolve(window.autoResetPubiloBrowserState("news-publish-failed")),
                        7000,
                        false,
                    ).catch(() => false);
                }, 0);
            }
            const baseLabel = typeof getPrimaryPublishLabel === "function"
                ? getPrimaryPublishLabel("news")
                : "POST NOW";
            newsPublishBtn.textContent = baseLabel;
            newsPublishBtn.disabled = false;
            newsPublishBtn.classList.remove("published");
            validateNewsMode();
        } finally {
            if (typeof window.setPublishInFlightState === "function") {
                window.setPublishInFlightState("news", false);
            }
        }
    });
}

// ============================================
