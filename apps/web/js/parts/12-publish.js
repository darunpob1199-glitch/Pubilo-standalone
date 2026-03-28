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
            els.publishBtn.textContent =
                typeof getPrimaryPublishLabel === "function"
                    ? getPrimaryPublishLabel(mode)
                    : "POST NOW";
            els.publishBtn.classList.remove("published");
            lastPublishedUrl = null;
            return;
        }

        const hasMedia =
            mode === "reels"
                ? !!state.selectedVideoFile
                : !!state.selectedImage;

        if (!hasMedia) {
            alert(mode === "reels" ? "Please select a video first" : "Please select an image first");
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

            if (mode === "reels") {
                const adsToken =
                    fbToken ||
                    localStorage.getItem("fewfeed_accessToken") ||
                    localStorage.getItem("fewfeed_token") ||
                    "";
                const freshPageToken = adsToken
                    ? await getFreshPageTokenFromExtension(pageId, adsToken)
                    : "";
                const pageToken =
                    freshPageToken ||
                    getPageToken() ||
                    document.getElementById("pageTokenInputPanel")?.value?.trim() ||
                    "";
                const cookie =
                    fbCookie || localStorage.getItem("fewfeed_cookie") || "";
                const fbDtsg =
                    localStorage.getItem("fewfeed_fbDtsg") || "";
                const caption = els.primaryText?.value?.trim() || "";
                const videoFile = state.selectedVideoFile;
                const videoKey = state.selectedVideoKey || "";

                if (!videoFile) {
                    throw new Error("กรุณาเลือกวิดีโอก่อนโพสต์");
                }

                if (state.isUploadingVideo) {
                    throw new Error("กำลังอัปโหลดวิดีโอขึ้นระบบ กรุณารอสักครู่");
                }

                if (!videoKey) {
                    throw new Error("วิดีโอยังไม่พร้อมโพสต์ กรุณาอัปโหลดใหม่อีกครั้ง");
                }

                const formData = new FormData();
                formData.append("pageId", pageId);
                formData.append("postMode", "reels");
                formData.append("caption", caption);
                if (adsToken) formData.append("accessToken", adsToken);
                if (pageToken) formData.append("pageToken", pageToken);
                if (cookie) formData.append("cookieData", cookie);
                if (fbDtsg) formData.append("fbDtsg", fbDtsg);
                formData.append("videoKey", videoKey);
                formData.append("videoFileName", state.selectedVideoName || videoFile.name || "pubilo-reel.mp4");
                if (state.selectedVideoMimeType) {
                    formData.append("videoMimeType", state.selectedVideoMimeType);
                }

                const response = await fetch("/api/publish-reel", {
                    method: "POST",
                    body: formData,
                });

                const data = await response.json();
                console.log("[REELS] Publish response:", data);

                if (!response.ok || !data.success) {
                    throw new Error(data.error || "Failed to publish reel");
                }

                lastPublishedUrl =
                    data.url ||
                    (data.postId
                        ? `https://www.facebook.com/${data.postId}`
                        : null);

                els.publishBtn.textContent = "✓";
                els.publishBtn.classList.add("published");
                els.publishBtn.disabled = false;
                return;
            }

            // ========== IMAGE MODE: Use Graph API directly ==========
            if (mode === "image") {
                const freshPageToken = await getFreshPageTokenFromExtension(pageId, fbToken || localStorage.getItem("fewfeed_accessToken") || localStorage.getItem("fewfeed_token"));
                const pageToken = freshPageToken || getPageToken();
                if (!pageToken) {
                    throw new Error("ไม่มี Page Token กรุณาใส่ใน Settings > 🔑 Page Token");
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

                const { scheduledTime, scheduleSource } =
                    await resolveScheduledTimeForMode(mode, pageId);
                console.log(
                    "[FEWFEED] Image schedule source:",
                    scheduleSource,
                    scheduledTime?.toISOString?.() || null,
                );

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
                        if (typeof clearManualSchedule === "function") {
                            clearManualSchedule(mode);
                        }
                        els.publishBtn.textContent =
                            typeof getPrimaryPublishLabel === "function"
                                ? getPrimaryPublishLabel(mode)
                                : "POST NOW";
                        els.publishBtn.classList.remove("published");

                        // Clear form fields silently (Link URL, Primary Text, Caption/พิกัด)
                        const linkUrlField = document.getElementById("linkUrl");
                        const primaryTextField = document.getElementById("primaryText");
                        const captionField = document.getElementById("caption");
                        const descField = document.getElementById("description");
                        const linkDescField = document.getElementById("linkDescriptionInput");
                        if (linkUrlField) linkUrlField.value = "";
                        if (primaryTextField) primaryTextField.value = "";
                        if (captionField) captionField.value = "";
                        if (descField) descField.value = "";
                        if (linkDescField) linkDescField.value = "";
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
            const freshPageToken = await getFreshPageTokenFromExtension(pageId, adsToken);
            const cookie =
                fbCookie || localStorage.getItem("fewfeed_cookie");
            let adAccountId =
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

            if (!adAccountId && adsToken) {
                adAccountId = await fetchAdAccounts(adsToken);
            }

            if (!adAccountId) {
                throw new Error(
                    "ไม่มี Ad Account กรุณากด extension เพื่อดึง Ads Token ใหม่ แล้วลองอีกครั้ง",
                );
            }

            console.log(
                "[FEWFEED] Publishing with Ads Token only (server fetches Page Token)",
            );

            const { scheduledTime, scheduleSource } =
                await resolveScheduledTimeForMode(mode, pageId);
            console.log(
                "[FEWFEED] Schedule source:",
                scheduleSource,
                scheduledTime?.toISOString?.() || null,
            );

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
            const linkDescriptionInputEl = document.getElementById("linkDescriptionInput");
            const descriptionText = isLinkMode
                ? (linkDescriptionInputEl?.value?.trim() || description?.value?.trim() || previewDescEl?.textContent?.trim() || "")
                : "";
            const captionText = isLinkMode
                ? (caption?.value?.trim() || previewCaptionEl?.textContent?.trim() || "")
                : "";
            if (isLinkMode) {
                description.value = descriptionText;
                if (linkDescriptionInputEl) {
                    linkDescriptionInputEl.value = descriptionText;
                }
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
                    pageToken: freshPageToken || getPageToken() || "",
                    cookieData: cookie,
                    pageId: pageId,
                    adAccountId: adAccountId,
                    callToAction: document.getElementById("cardButton")?.value || "SHOP_NOW",
                    fbDtsg: fbDtsg, // Required for GraphQL scheduling
                    scheduleInSystem: scheduleSource === "manual",
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
                            if (typeof clearManualSchedule === "function") {
                                clearManualSchedule(mode);
                            }
                            els.publishBtn.textContent =
                                typeof getPrimaryPublishLabel === "function"
                                    ? getPrimaryPublishLabel(mode)
                                    : "POST NOW";
                            els.publishBtn.classList.remove("published");

                            // Clear form fields silently (Link URL, Primary Text, Caption/พิกัด)
                            const linkUrlField = document.getElementById("linkUrl");
                            const primaryTextField = document.getElementById("primaryText");
                            const captionField = document.getElementById("caption");
                            const descField = document.getElementById("description");
                            const linkDescField = document.getElementById("linkDescriptionInput");
                            if (linkUrlField) linkUrlField.value = "";
                            if (primaryTextField) primaryTextField.value = "";
                            if (captionField) captionField.value = "";
                            if (descField) descField.value = "";
                            if (linkDescField) linkDescField.value = "";
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
            els.publishBtn.textContent =
                typeof getPrimaryPublishLabel === "function"
                    ? getPrimaryPublishLabel(mode)
                    : "POST NOW";
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

    console.log("[FEWFEED] Selected page:", page.name, "id:", page.id);

    // Save selected page ID and name to localStorage for persistence across refreshes
    localStorage.setItem("fewfeed_selectedPageId", page.id);
    localStorage.setItem("fewfeed_selectedPageName", page.name || "Page");
    const selectedPageToken = typeof page.access_token === "string" ? page.access_token.trim() : "";
    let tokenMap = {};
    try {
        tokenMap = JSON.parse(localStorage.getItem("fewfeed_pageTokenMap") || "{}");
    } catch (_) {
        tokenMap = {};
    }

    const mappedToken = tokenMap?.[String(page.id)]?.trim() || "";
    const effectivePageToken = selectedPageToken || mappedToken;

    if (selectedPageToken) {
        tokenMap[String(page.id)] = selectedPageToken;
        localStorage.setItem("fewfeed_pageTokenMap", JSON.stringify(tokenMap));
    }

    if (effectivePageToken) {
        localStorage.setItem("fewfeed_selectedPageToken", effectivePageToken);
        const tokenInput = document.getElementById("pageTokenInputPanel");
        if (
            tokenInput &&
            !tokenInput.value.trim() &&
            !(typeof isCookieBoundFacebookToken === "function" && isCookieBoundFacebookToken(effectivePageToken))
        ) {
            tokenInput.value = effectivePageToken;
        }
    } else {
        localStorage.removeItem("fewfeed_selectedPageToken");
    }

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
    if (window.location.hash === "#settings" && settingsPanel.style.display === "flex") {
        loadSettingsPanel();
    }

    // If on pending panel, refresh scheduled posts for new page
    if (pendingPanel.style.display === "block") {
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

function requestPagesFromExtension(accessToken) {
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            window.removeEventListener("message", handleMessage);
            reject(new Error("Extension ไม่ตอบกลับรายการเพจ"));
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

function requestAdAccountsFromExtension(accessToken) {
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            window.removeEventListener("message", handleMessage);
            reject(new Error("Extension ไม่ตอบกลับรายการ ad account"));
        }, 8000);

        function cleanup() {
            clearTimeout(timeout);
            window.removeEventListener("message", handleMessage);
        }

        function handleMessage(event) {
            if (event.source !== window) return;
            if (event.data.type !== "FEWFEED_AD_ACCOUNTS_RESPONSE") return;

            cleanup();
            const response = event.data.data;
            if (response?.success && Array.isArray(response.adAccounts)) {
                resolve(response.adAccounts);
                return;
            }

            reject(new Error(response?.error || "ดึง ad account ไม่สำเร็จ"));
        }

        window.addEventListener("message", handleMessage);
        window.postMessage(
            {
                type: "FEWFEED_FETCH_AD_ACCOUNTS",
                accessToken,
            },
            "*",
        );
    });
}

function setSelectedAdAccount(adAccounts) {
    const input = document.getElementById("adAccountSelect");
    if (!input) return "";

    const normalizedAccounts = Array.isArray(adAccounts) ? adAccounts : [];
    const savedId = localStorage.getItem("fewfeed_selectedAdAccountId") || "";
    const preferredAccount =
        normalizedAccounts.find((account) => String(account.account_id) === String(savedId)) ||
        normalizedAccounts.find((account) => Number(account.account_status) === 1) ||
        normalizedAccounts[0];

    const nextId = preferredAccount?.account_id ? String(preferredAccount.account_id) : "";
    input.value = nextId;

    if (nextId) {
        localStorage.setItem("fewfeed_selectedAdAccountId", nextId);
    } else {
        localStorage.removeItem("fewfeed_selectedAdAccountId");
    }

    return nextId;
}

async function fetchAdAccounts(accessToken) {
    const input = document.getElementById("adAccountSelect");
    if (!input) return "";
    if (!accessToken) {
        input.value = "";
        return "";
    }

    try {
        const adAccounts = await requestAdAccountsFromExtension(accessToken);
        const nextId = setSelectedAdAccount(adAccounts);
        console.log("[FEWFEED] Ad accounts loaded from extension:", adAccounts.length, "selected:", nextId);
        return nextId;
    } catch (error) {
        console.warn("[FEWFEED] Failed to fetch ad accounts from extension:", error);
        input.value = "";
        return "";
    }
}

async function getFreshPageTokenFromExtension(pageId, accessToken) {
    if (!pageId || !accessToken) return "";

    try {
        const pages = await requestPagesFromExtension(accessToken);
        if (!Array.isArray(pages) || pages.length === 0) return "";

        const matchedPage = pages.find((page) => String(page.id) === String(pageId));
        const nextToken = typeof matchedPage?.access_token === "string" ? matchedPage.access_token.trim() : "";
        if (!nextToken) return "";

        let tokenMap = {};
        try {
            tokenMap = JSON.parse(localStorage.getItem("fewfeed_pageTokenMap") || "{}");
        } catch (_) {
            tokenMap = {};
        }

        tokenMap[String(pageId)] = nextToken;
        localStorage.setItem("fewfeed_pageTokenMap", JSON.stringify(tokenMap));
        localStorage.setItem("fewfeed_selectedPageToken", nextToken);

        const tokenInput = document.getElementById("pageTokenInputPanel");
        const shouldPersistToSettings =
            !(typeof isCookieBoundFacebookToken === "function" && isCookieBoundFacebookToken(nextToken));

        if (tokenInput && shouldPersistToSettings) {
            tokenInput.value = nextToken;
        }

        if (shouldPersistToSettings) {
            try {
                await fetch("/api/page-settings", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        pageId,
                        postToken: nextToken,
                        pageName: matchedPage?.name || undefined,
                        pictureUrl: matchedPage?.picture?.data?.url || undefined,
                    }),
                });
            } catch (persistError) {
                console.warn("[FEWFEED] Failed to persist fresh page token:", persistError);
            }
        } else {
            console.log("[FEWFEED] Skipping page-settings persist for cookie-bound session token");
        }

        if (typeof mergeLoadedPageTokens === "function") {
            mergeLoadedPageTokens(pages);
        }

        return nextToken;
    } catch (error) {
        console.warn("[FEWFEED] Fresh page token fetch failed:", error);
        return "";
    }
}

function isInvalidFacebookSessionError(data) {
    return Number(data?.errorCode) === 190 ||
        (Number(data?.errorCode) === 1 && data?.errorType === 'OAuthException');
}

async function refreshFacebookTokensFromExtension() {
    return new Promise((resolve) => {
        let settled = false;

        const finish = (result) => {
            if (settled) return;
            settled = true;
            window.removeEventListener("message", handleMessage);
            clearTimeout(timeout);
            resolve(result);
        };

        const handleMessage = (event) => {
            if (event.source !== window) return;
            if (event.data.type !== "FEWFEED_COOKIE_INJECTED") return;
            finish({
                success: true,
                token: event.data.token || "",
                cookie: event.data.cookie || "",
            });
        };

        const timeout = setTimeout(() => {
            finish({ success: false });
        }, 10000);

        window.addEventListener("message", handleMessage);
        window.postMessage({ type: "FEWFEED_REFRESH_TOKEN" }, "*");
    });
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
            !!fbPostToken,
        );

        // Prefer access token from extension so we get the live page list, not stale D1 only.
        if (fbToken || fbPostToken) {
            fetchPages(fbToken || fbPostToken);
            fetchAdAccounts(fbToken || fbPostToken);
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

    // Post token arrived from Postcron OAuth
    if (event.data.type === "FEWFEED_POST_TOKEN_READY") {
        fbPostToken = event.data.postToken;
        console.log("[FEWFEED] Post token received!");
        localStorage.setItem("fewfeed_postToken", fbPostToken);

        // Update UI status
        const userName = localStorage.getItem("fewfeed_userName");
        const userId = localStorage.getItem("fewfeed_userId");
        showCookieStatus(
            true,
            userId,
            userName,
            !!fbToken,
            !!fbCookie,
            !!fbPostToken,
        );

        // If we don't have pages yet, fetch them with the freshest token we have.
        if (allPages.length === 0 && (fbToken || fbPostToken)) {
            fetchPages(fbToken || fbPostToken);
        }
        if (fbToken || fbPostToken) {
            fetchAdAccounts(fbToken || fbPostToken);
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
                        !!cachedData.postToken
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
                    !!cachedData.postToken
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

// Fetch pages, preferring the live list from extension and falling back to D1.
async function fetchPages(accessToken) {
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

    if (accessToken) {
        try {
            const extensionPages = await requestPagesFromExtension(accessToken);
            if (Array.isArray(extensionPages) && extensionPages.length > 0) {
                renderPagesDropdown(extensionPages);
                fetchAdAccounts(accessToken);
                console.log("[FEWFEED] Pages loaded from extension:", extensionPages.length);
                return;
            }
        } catch (error) {
            console.warn("[FEWFEED] Extension page fetch failed, falling back to D1:", error);
        }
    }

    // Fallback: pages from D1 database via Worker API
    try {
        const response = await fetch("/api/pages");
        const data = await response.json();

        if (data.success && data.pages && data.pages.length > 0) {
            console.log("[FEWFEED] Loaded", data.pages.length, "pages from D1");

            // Transform to format expected by renderPagesDropdown
            const pages = data.pages.map(p => ({
                id: p.id,
                name: p.name || 'Unknown Page',
                picture: p.picture || { data: { url: '' } },
                color: p.color || '#f59e0b',
            }));

            renderPagesDropdown(pages);

            // Auto-select first page if none selected
            const pageSelect = document.getElementById("pageSelect");
            if (pageSelect && !pageSelect.value && pages.length > 0) {
                selectPage(0);
            }
        } else {
            console.log("[FEWFEED] No pages found in D1");
        }
    } catch (error) {
        console.error("[FEWFEED] Failed to fetch pages from API:", error);
    }
}

// Helper: Show cookie status with Token/Cookie/PostToken indicators in header
function showCookieStatus(
    connected,
    userId,
    userName,
    hasToken,
    hasCookie,
    hasPostToken = false,
) {
    const localPostToken = localStorage.getItem("fewfeed_postToken") || "";
    const panelPostToken = document.getElementById("pageTokenInputPanel")?.value?.trim() || "";
    const selectedPageToken = typeof getPageToken === "function" ? getPageToken() : "";
    const effectiveHasPostToken =
        hasPostToken ||
        (typeof hasDurableFacebookToken === "function"
            ? hasDurableFacebookToken(localPostToken) ||
              hasDurableFacebookToken(panelPostToken) ||
              hasDurableFacebookToken(selectedPageToken)
            : !!localPostToken || !!panelPostToken || !!selectedPageToken);

    const tokenIndicator =
        document.getElementById("tokenIndicator");
    const cookieIndicator =
        document.getElementById("cookieIndicator");
    const postTokenIndicator =
        document.getElementById("postTokenIndicator");

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

    // Update post token indicator
    if (postTokenIndicator) {
        postTokenIndicator.classList.remove("valid", "invalid");
        postTokenIndicator.classList.add(
            effectiveHasPostToken ? "valid" : "invalid",
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
        effectiveHasPostToken ? "valid" : "invalid",
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
    const fbDtsg = localStorage.getItem("fewfeed_fbDtsg") || "";

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
        adsValue.textContent = adsToken
            ? adsToken.substring(0, 40) + "..."
            : "(No Ads Token)";
        adsValue.className =
            "token-value" + (adsToken ? "" : " empty");
        // Pre-fill textarea with current value
        const manualInput = document.getElementById("manualAdsTokenInput");
        if (manualInput) manualInput.value = adsToken;
        document.getElementById("tokenModalTitle").textContent =
            "🔑 Ads Token";
    } else if (type === "cookie" && cookieItem) {
        cookieItem.style.display = "block";
        const cookieStatus =
            document.getElementById("modalCookieStatus");
        const cookieValue =
            document.getElementById("modalCookieValue");
        cookieStatus.textContent = cookie ? "Valid" : "Invalid";
        cookieStatus.className =
            "token-status " + (cookie ? "valid" : "invalid");
        cookieValue.textContent = cookie
            ? cookie.substring(0, 60) + "..."
            : "(No Cookie)";
        cookieValue.className =
            "token-value" + (cookie ? "" : " empty");
        // Pre-fill textareas
        const manualCookie = document.getElementById("manualCookieInput");
        if (manualCookie) manualCookie.value = cookie;
        const manualDtsg = document.getElementById("manualFbDtsgInput");
        if (manualDtsg) manualDtsg.value = fbDtsg;
        document.getElementById("tokenModalTitle").textContent =
            "🍪 Cookie";
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
        postValue.textContent = postToken
            ? postToken.substring(0, 40) + "..."
            : "(No Post Token)";
        postValue.className =
            "token-value" + (postToken ? "" : " empty");
        document.getElementById("tokenModalTitle").textContent =
            "📮 Post Token";
    }

    modal.classList.add("show");
}

function closeTokenModal() {
    const modal = document.getElementById("tokenModal");
    modal.classList.remove("show");
}

// Save manually entered token/cookie to localStorage + D1
async function saveManualToken(type) {
    try {
        if (type === "ads") {
            const input = document.getElementById("manualAdsTokenInput");
            const value = input?.value?.trim();
            if (!value) {
                alert("กรุณาใส่ Ads Token ก่อน");
                return;
            }
            // Save to localStorage
            localStorage.setItem("fewfeed_accessToken", value);
            localStorage.setItem("fewfeed_token", value);
            // Update in-memory variable
            fbToken = value;

            // Sync to D1
            const userId = localStorage.getItem("fewfeed_userId") || "manual";
            await fetch("/api/tokens", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    userId: userId,
                    adsToken: value,
                    cookie: localStorage.getItem("fewfeed_cookie") || null,
                    fbDtsg: localStorage.getItem("fewfeed_fbDtsg") || null
                })
            });

            // Update UI status
            showCookieStatus(
                true,
                userId,
                localStorage.getItem("fewfeed_userName") || "Manual",
                true,
                !!localStorage.getItem("fewfeed_cookie"),
                !!localStorage.getItem("fewfeed_postToken")
            );

            alert("✅ Ads Token บันทึกแล้ว!");
            closeTokenModal();

        } else if (type === "cookie") {
            const cookieInput = document.getElementById("manualCookieInput");
            const dtsgInput = document.getElementById("manualFbDtsgInput");
            const cookieValue = cookieInput?.value?.trim();
            const dtsgValue = dtsgInput?.value?.trim();

            if (!cookieValue) {
                alert("กรุณาใส่ Cookie ก่อน");
                return;
            }

            // Save to localStorage
            localStorage.setItem("fewfeed_cookie", cookieValue);
            if (dtsgValue) {
                localStorage.setItem("fewfeed_fbDtsg", dtsgValue);
            }
            // Update in-memory variable
            fbCookie = cookieValue;

            // Sync to D1
            const userId = localStorage.getItem("fewfeed_userId") || "manual";
            await fetch("/api/tokens", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    userId: userId,
                    adsToken: localStorage.getItem("fewfeed_accessToken") || null,
                    cookie: cookieValue,
                    fbDtsg: dtsgValue || null
                })
            });

            // Update UI status
            showCookieStatus(
                true,
                userId,
                localStorage.getItem("fewfeed_userName") || "Manual",
                !!localStorage.getItem("fewfeed_accessToken"),
                true,
                !!localStorage.getItem("fewfeed_postToken")
            );

            alert("✅ Cookie บันทึกแล้ว!");
            closeTokenModal();
        }

        console.log("[MANUAL] Token/Cookie saved manually");
    } catch (error) {
        console.error("[MANUAL] Save error:", error);
        alert("❌ Error: " + error.message);
    }
}

// Clear token/cookie
async function clearManualToken(type) {
    if (!confirm(`ต้องการลบ ${type === 'ads' ? 'Ads Token' : 'Cookie'} ใช่ไหม?`)) return;

    try {
        if (type === "ads") {
            localStorage.removeItem("fewfeed_accessToken");
            localStorage.removeItem("fewfeed_token");
            fbToken = null;
        } else if (type === "cookie") {
            localStorage.removeItem("fewfeed_cookie");
            localStorage.removeItem("fewfeed_fbDtsg");
            fbCookie = null;
        }

        // Update UI status
        const userId = localStorage.getItem("fewfeed_userId") || "";
        showCookieStatus(
            !!userId,
            userId,
            localStorage.getItem("fewfeed_userName") || "",
            !!localStorage.getItem("fewfeed_accessToken"),
            !!localStorage.getItem("fewfeed_cookie"),
            !!localStorage.getItem("fewfeed_postToken")
        );

        alert(`🗑️ ${type === 'ads' ? 'Ads Token' : 'Cookie'} ลบแล้ว!`);
        closeTokenModal();
        console.log(`[MANUAL] ${type} cleared`);
    } catch (error) {
        console.error("[MANUAL] Clear error:", error);
    }
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

    console.log("[FEWFEED] Loaded saved data from localStorage");

    if (userId) {
        fbToken = accessToken;
        fbPostToken = postToken;
        fbCookie = cookie;
        showCookieStatus(
            true,
            userId,
            userName,
            !!accessToken,
            !!cookie,
            !!postToken,
        );
    }

    fetchPages(accessToken || postToken);
    fetchAdAccounts(accessToken || postToken);
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
