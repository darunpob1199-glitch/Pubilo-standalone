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

// News publish handler
const newsPublishBtn = document.getElementById("newsPublishBtn");
if (newsPublishBtn) {
    newsPublishBtn.addEventListener("click", async () => {
        if (newsPublishBtn.disabled) return;
        
        const pageId = getCurrentPageId();
        const pageToken = getPageToken() || document.getElementById("pageTokenInputPanel")?.value?.trim() || "";
        const adsToken = fbToken || localStorage.getItem("fewfeed_accessToken") || localStorage.getItem("fewfeed_token");
        const cookie = fbCookie || localStorage.getItem("fewfeed_cookie");
        const adAccountId = document.getElementById("adAccountSelect")?.value;
        const newsUrlInputEl = document.getElementById("newsUrlInput");
        const newsPrimaryTextEl = document.getElementById("newsPrimaryText");
        const newsPreviewDescEl = document.getElementById("newsPreviewDescription");
        const newsPreviewCaptionEl = document.getElementById("newsPreviewCaption");
        
        if (!pageId) {
            alert("กรุณาเลือกเพจก่อน");
            return;
        }

        if (!pageToken && !adsToken) {
            alert("ไม่มี token สำหรับโพสต์ กรุณา login extension ใหม่ หรือใส่ Page Token ใน Settings");
            return;
        }
        
        const linkUrlValue = newsUrlInputEl?.value?.trim();
        const descriptionText = newsDescriptionInput?.value?.trim() || newsPreviewDescEl?.textContent?.trim() || "";
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
                const uploadRes = await fetch("/api/upload-image", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify({
                        imageBase64: imageData,
                    }),
                });
                const uploadData = await uploadRes.json();

                if (!uploadRes.ok || !uploadData.success || !uploadData.url) {
                    throw new Error(uploadData.error || "Image upload failed");
                }

                imageData = uploadData.url;
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
            
            const response = await fetch("/api/publish", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    pageId,
                    pageToken: pageToken || "",
                    accessToken: adsToken,
                    cookieData: cookie,
                    imageUrl: imageData,
                    linkUrl: linkUrlValue,
                    linkName: descriptionText ? `พิกัด : ${descriptionText}` : "",
                    description: descriptionText,
                    caption: captionText,
                    primaryText,
                    postMode: "news",
                    adAccountId,
                    scheduledTime: scheduledTime
                        ? Math.floor(scheduledTime.getTime() / 1000)
                        : null,
                }),
            });

            const data = await response.json();
            console.log("[News] Publish response:", data);

            if (!response.ok || !data.success) {
                throw new Error(data.error || "Facebook API error");
            }

            const postId = data.postId || data.post_id || data.id;
            if (postId) {
                lastPublishedUrl = `https://www.facebook.com/${postId}`;
            }

            if (postId) {
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
                    if (newsDescriptionInput) newsDescriptionInput.value = "";
                    newsGeneratedImages = [];
                    newsSelectedImages = [];
                    newsModeImageReady = false;
                    
                    const container = document.getElementById("newsFullImageView");
                    if (container) container.style.display = "none";
                    const uploadPrompt = document.getElementById("newsUploadPrompt");
                    if (uploadPrompt) uploadPrompt.style.display = "flex";
                    
                    const baseLabel = typeof getPrimaryPublishLabel === "function"
                        ? getPrimaryPublishLabel()
                        : "SCHEDULE";
                    newsPublishBtn.textContent = baseLabel;
                    newsPublishBtn.classList.remove("published");
                    newsPublishBtn.disabled = true;
                    newsPublishBtn.style.opacity = "0.5";
                    validateNewsMode();
                }, 1000);
            } else {
                throw new Error("Facebook ไม่คืน post id กลับมา");
            }
        } catch (err) {
            console.error("[News] Publish error:", err);
            alert("เกิดข้อผิดพลาด: " + err.message);
            const baseLabel = typeof getPrimaryPublishLabel === "function"
                ? getPrimaryPublishLabel()
                : "SCHEDULE";
            newsPublishBtn.textContent = baseLabel;
            newsPublishBtn.disabled = false;
            newsPublishBtn.classList.remove("published");
            validateNewsMode();
        }
    });
}

// ============================================
