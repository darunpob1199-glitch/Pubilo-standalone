// Pubilo Token Helper v9.0 - Content Script
// Runs on localhost and Pubilo dashboard domains - fetches Ads Token + Cookie only
// Post Token is now managed manually via Page Settings (not from Extension)

console.log("[Pubilo Content] Script loaded on", window.location.href);
globalThis.__PUBILO_CONTENT_SCRIPT_ACTIVE__ = true;

async function safeSendMessage(msg, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const result = await chrome.runtime.sendMessage(msg);
      return result;
    } catch (err) {
      const isDisconnected =
        /receiving end does not exist|extension context invalidated|message port closed|message channel closed before a response was received|asynchronous response by returning true/i.test(
          err?.message || ""
        );
      console.warn(`[Pubilo Content] sendMessage attempt ${attempt}/${retries} failed:`, err?.message);
      if (!isDisconnected || attempt === retries) throw err;
      await new Promise((r) => setTimeout(r, 800 * attempt));
    }
  }
}

const PAGE_TOKEN_MAP_KEY = "fewfeed_pageTokenMap";
const PAGE_SUMMARY_MAP_KEY = "fewfeed_pageSummaryMap";
const PAGE_CACHE_USER_ID_KEY = "fewfeed_pageCacheUserId";
const PAGE_SCOPED_LOCAL_KEYS = [
  PAGE_TOKEN_MAP_KEY,
  PAGE_SUMMARY_MAP_KEY,
  PAGE_CACHE_USER_ID_KEY,
  "fewfeed_selectedPageId",
  "fewfeed_selectedPageName",
  "fewfeed_selectedPagePicture",
  "fewfeed_selectedPageToken",
  "fewfeed_selectedAdAccountId",
  "fewfeed_targetPageIds",
];

function pickSessionString(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return "";
}

function shouldPreserveExistingAdsToken(data = {}, existingToken = "", existingUserId = "") {
  const normalizedExistingToken = String(existingToken || "").trim();
  if (!normalizedExistingToken) return false;

  const incomingToken = pickSessionString(
    data?.fewfeed_accessToken,
    data?.fewfeed_token,
    data?.accessToken,
  );
  if (incomingToken) return false;

  const incomingUserId = pickSessionString(data?.fewfeed_userId, data?.userId);
  if (incomingUserId && existingUserId && incomingUserId !== existingUserId) {
    return false;
  }

  const validationStatus = String(data?.fewfeed_accessTokenValidationStatus || "").trim();
  const debugReason = String(data?.debug?.reason || data?.reason || "").trim();
  const hardFailStatuses = new Set(["token_invalid", "token_format_invalid", "invalid"]);
  const hardFailReasons = new Set(["token_invalid", "token_format_invalid"]);
  const softKeepStatuses = new Set([
    "valid",
    "valid_user_mismatch",
    "validation_non_fatal_error",
  ]);
  const softKeepReasons = new Set([
    "timeout",
    "exception",
    "content_exception",
    "network_error",
  ]);

  if (hardFailStatuses.has(validationStatus) || hardFailReasons.has(debugReason)) {
    return false;
  }

  // Keep cached token only for explicitly soft statuses/reasons.
  // When status is "missing"/empty we should clear stale token to avoid
  // poisoning page-list fetches with page-token fallback values.
  if (softKeepStatuses.has(validationStatus)) return true;
  if (softKeepReasons.has(debugReason)) return true;
  return false;
}

function getPageCacheOwnerId() {
  return String(localStorage.getItem(PAGE_CACHE_USER_ID_KEY) || "").trim();
}

function clearPageScopedCache(reason = "") {
  PAGE_SCOPED_LOCAL_KEYS.forEach((key) => localStorage.removeItem(key));
  if (reason) {
    console.log("[Pubilo Content] Cleared page-scoped cache:", reason);
  }
}

function readScopedPageTokenMap(ownerId = "") {
  const normalizedOwnerId = String(ownerId || localStorage.getItem("fewfeed_userId") || "").trim();
  const cacheOwnerId = getPageCacheOwnerId();
  if (cacheOwnerId && normalizedOwnerId && cacheOwnerId !== normalizedOwnerId) {
    return {};
  }

  try {
    const parsed = JSON.parse(localStorage.getItem(PAGE_TOKEN_MAP_KEY) || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (_) {
    return {};
  }
}

function writeScopedPageCache(pageTokenMapRaw, ownerId = "") {
  const normalizedOwnerId = String(ownerId || localStorage.getItem("fewfeed_userId") || "").trim();
  if (!normalizedOwnerId) return { tokenMap: {}, summaryMap: {} };

  const raw = typeof pageTokenMapRaw === "string" ? JSON.parse(pageTokenMapRaw || "{}") : pageTokenMapRaw;
  const tokenMap = {};
  const summaryMap = {};
  if (raw && typeof raw === "object") {
    for (const [pageId, entry] of Object.entries(raw)) {
      const token = typeof entry === "string" ? entry : entry?.token;
      if (!token) continue;
      tokenMap[pageId] = token;
      summaryMap[pageId] = {
        id: pageId,
        name: typeof entry === "object" ? entry?.name || "" : "",
        picture: typeof entry === "object" ? entry?.picture || "" : "",
      };
    }
  }

  localStorage.setItem(PAGE_CACHE_USER_ID_KEY, normalizedOwnerId);
  localStorage.setItem(PAGE_TOKEN_MAP_KEY, JSON.stringify(tokenMap));
  localStorage.setItem(PAGE_SUMMARY_MAP_KEY, JSON.stringify(summaryMap));

  const firstPageId = Object.keys(tokenMap)[0];
  if (firstPageId && !localStorage.getItem("fewfeed_selectedPageToken")) {
    localStorage.setItem("fewfeed_selectedPageToken", tokenMap[firstPageId]);
  }

  console.log("[Pubilo Content] Stored scoped page cache for", Object.keys(tokenMap).length, "pages");
  return { tokenMap, summaryMap };
}

// Main function - request tokens from background and wait for them
async function initializeTokens(options = {}) {
  console.log("[Pubilo Content] Requesting tokens from background...");
  const forceRefresh = !!options.forceRefresh;

  // Show loading indicator
  showLoadingIndicator();

  try {
    // 1) Read stored data first (fast path, avoids waiting on network fetch every reload).
    let data = await safeSendMessage({ action: "getStoredData" });

    const hasStoredPageTokenMap = (() => {
      try {
        const raw = data?.pageTokenMap || "{}";
        const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
        return !!parsed && typeof parsed === "object" && Object.keys(parsed).length > 0;
      } catch (_) {
        return false;
      }
    })();
    const hasStoredAccessToken = !!(
      data?.accessToken ||
      data?.fewfeed_accessToken ||
      data?.fewfeed_token
    );
    const hasStoredCookie = !!(
      data?.cookie ||
      data?.fewfeed_cookie
    );
    const hasStoredSession = !!(
      hasStoredAccessToken ||
      hasStoredCookie ||
      hasStoredPageTokenMap
    );
    const needsAccessTokenRefresh = !!(hasStoredCookie && !hasStoredAccessToken);
    const storedValidationStatus = String(data?.fewfeed_accessTokenValidationStatus || "").trim();
    const mustRefreshInvalidStoredToken = new Set([
      "token_invalid",
      "token_format_invalid",
      "invalid",
      "account_changed",
    ]).has(storedValidationStatus);

    // 2) If nothing stored yet OR cookie exists but token missing, trigger fresh token fetch.
    if (forceRefresh || !hasStoredSession || needsAccessTokenRefresh || mustRefreshInvalidStoredToken) {
      data = await safeSendMessage({ action: "fetchToken" });
      const fetchedAccessToken = String(
        data?.fewfeed_accessToken || data?.fewfeed_token || data?.accessToken || "",
      ).trim();
      const fetchedCookie = String(
        data?.fewfeed_cookie || data?.cookie || "",
      ).trim();
      if (fetchedCookie && !fetchedAccessToken) {
        // A fetch timeout may return before background completes token extraction.
        // Re-read stored data once to pick up the token if it arrives a moment later.
        await new Promise((resolve) => setTimeout(resolve, 1200));
        const retried = await safeSendMessage({ action: "getStoredData" });
        if (retried?.success) {
          data = retried;
        }
      }
    }

    // Get existing localStorage values as fallback
    const existingToken = localStorage.getItem("fewfeed_accessToken") || localStorage.getItem("fewfeed_token");
    const existingFbDtsg = localStorage.getItem("fewfeed_fbDtsg");
    const existingCookie = localStorage.getItem("fewfeed_cookie");
    const existingUserId = localStorage.getItem("fewfeed_userId");
    const existingUserName = localStorage.getItem("fewfeed_userName");
    const existingAvatarUrl = localStorage.getItem("fewfeed_avatarUrl");

    const shouldTrustBackgroundSession = data?.success === true;
    const shouldKeepExistingAdsToken =
      shouldTrustBackgroundSession &&
      shouldPreserveExistingAdsToken(data, existingToken, existingUserId);

    // Only fallback to page localStorage when background messaging fails.
    // If background explicitly returns empty token/cookie, treat that as authoritative
    // so stale invalid tokens don't get rehydrated again.
    let finalToken =
      data?.fewfeed_accessToken || data?.fewfeed_token || data?.accessToken || "";
    let finalFbDtsg = data?.fewfeed_fbDtsg || data?.fbDtsg || "";
    let finalCookie = data?.fewfeed_cookie || data?.cookie || "";

    if (!shouldTrustBackgroundSession || shouldKeepExistingAdsToken) {
      finalToken = finalToken || existingToken || "";
      finalFbDtsg = finalFbDtsg || existingFbDtsg || "";
      finalCookie = finalCookie || existingCookie || "";
    }
    let finalUserId = data?.fewfeed_userId || data?.userId || existingUserId || "";
    const incomingUserName = data?.fewfeed_userName || data?.userName || "";
    const incomingAvatarUrl = data?.fewfeed_avatarUrl || data?.avatarUrl || "";
    const isIdentityChanged = !!(
      finalUserId &&
      existingUserId &&
      String(finalUserId).trim() !== String(existingUserId).trim()
    );
    let finalUserName = isIdentityChanged
      ? incomingUserName || "Facebook User"
      : incomingUserName || existingUserName || "Facebook User";
    let finalAvatarUrl = isIdentityChanged
      ? incomingAvatarUrl || ""
      : incomingAvatarUrl || existingAvatarUrl || "";

    // Fallback: if token fetch timed out, at least try reading cookie snapshot directly.
    if (!finalCookie && !finalToken) {
      try {
        const cookieFallback = await safeSendMessage({ action: "getFacebookCookies" });
        if (cookieFallback?.success && cookieFallback.cookie) {
          finalCookie = cookieFallback.cookie;
          finalUserId = cookieFallback.userId || finalUserId || "";
        }
      } catch (_) {
        // Ignore fallback failure and keep the original diagnostic flow.
      }
    }

    console.log("[Pubilo Content] Data:", {
      hasAdsToken: !!finalToken,
      hasFbDtsg: !!finalFbDtsg,
      hasUserId: !!finalUserId,
      hasCookie: !!finalCookie,
      fromFetch: !!(data?.fewfeed_accessToken || data?.accessToken),
      fromStorage: !!existingToken,
      preservedExistingAdsToken: shouldKeepExistingAdsToken,
      backgroundValidationStatus: data?.fewfeed_accessTokenValidationStatus || "",
      backgroundReason: data?.debug?.reason || data?.reason || "",
    });

    const currentPageCacheOwnerId = getPageCacheOwnerId();
    if (currentPageCacheOwnerId && finalUserId && currentPageCacheOwnerId !== finalUserId) {
      clearPageScopedCache(`owner changed ${currentPageCacheOwnerId} -> ${finalUserId}`);
    }

    // Always overwrite localStorage — clear stale tokens when extension returns empty.
    localStorage.setItem("fewfeed_accessToken", finalToken);
    localStorage.setItem("fewfeed_token", finalToken);
    localStorage.setItem("fewfeed_fbDtsg", finalFbDtsg);
    localStorage.setItem("fewfeed_userId", finalUserId || localStorage.getItem("fewfeed_userId") || "");
    localStorage.setItem("fewfeed_userName", finalUserName || localStorage.getItem("fewfeed_userName") || "");
    localStorage.setItem("fewfeed_cookie", finalCookie);
    localStorage.setItem("fewfeed_avatarUrl", finalAvatarUrl);

    console.log("[Pubilo Content] Data saved to localStorage");
    syncPageUiFromInjectedData({
      accessToken: finalToken,
      fbDtsg: finalFbDtsg,
      cookie: finalCookie,
      userId: finalUserId,
      userName: finalUserName,
    });

    // Also persist page tokens from extension storage into localStorage
    let pageTokenMapRaw = data?.pageTokenMap || "{}";
    try {
      const pageTokenMap = typeof pageTokenMapRaw === "string" ? JSON.parse(pageTokenMapRaw) : pageTokenMapRaw;
      if (pageTokenMap && typeof pageTokenMap === "object" && Object.keys(pageTokenMap).length > 0 && finalUserId) {
        writeScopedPageCache(pageTokenMap, finalUserId);
      }
    } catch (ptErr) {
      console.warn("[Pubilo Content] Failed to parse page token map:", ptErr);
    }

    // Notify the page that data is ready
    window.postMessage({
      type: "FEWFEED_COOKIE_INJECTED",
      cookie: finalCookie,
      token: finalToken,
      fbDtsg: finalFbDtsg,
      userId: finalUserId,
      userName: finalUserName,
      avatarUrl: finalAvatarUrl,
      extensionVersion: data?.extensionVersion || chrome.runtime.getManifest().version,
      pageTokenMap: pageTokenMapRaw,
      pageTokenMapOwnerId: finalUserId || "",
      pageSummaryMap: localStorage.getItem(PAGE_SUMMARY_MAP_KEY) || "{}",
    }, "*");

    if (!finalCookie && !finalToken) {
      window.postMessage({
        type: "FEWFEED_EXTENSION_DIAGNOSTIC",
        reason: data?.debug?.reason || "no_cookie_no_token",
        detail: data?.warning || null
      }, "*");
      if (initializeRetryCount < 3) {
        initializeRetryCount += 1;
        setTimeout(() => {
          initializeTokens({ forceRefresh: true });
        }, 2000);
      }
    } else {
      initializeRetryCount = 0;
    }

    // Hide loading indicator
    hideLoadingIndicator();

    // Dispatch custom event for the page to know data is ready
    window.dispatchEvent(new CustomEvent("fewfeed:ready", {
      detail: {
        hasAdsToken: !!finalToken,
        hasFbDtsg: !!finalFbDtsg,
        hasCookie: !!finalCookie
      }
    }));

    console.log("[Pubilo Content] Token injection complete!");

  } catch (error) {
    console.error("[FEWFEED Content] Error:", error);
    hideLoadingIndicator();
    const errorMessage = String(error?.message || error || "");
    const isTransientMessageChannelError =
      /receiving end does not exist|extension context invalidated|message port closed|message channel closed before a response was received|asynchronous response by returning true/i.test(
        errorMessage
      );

    // Even when background is unreachable, inject whatever localStorage has
    // so the web page can proceed with cached tokens.
    const cachedToken = localStorage.getItem("fewfeed_accessToken") || localStorage.getItem("fewfeed_token") || "";
    const cachedCookie = localStorage.getItem("fewfeed_cookie") || "";
    const cachedUserId = localStorage.getItem("fewfeed_userId") || "";
    const cachedUserName = localStorage.getItem("fewfeed_userName") || "";
    const cachedFbDtsg = localStorage.getItem("fewfeed_fbDtsg") || "";
    const cachedPageTokenMap = localStorage.getItem(PAGE_TOKEN_MAP_KEY) || "{}";
    const cachedPageSummaryMap = localStorage.getItem(PAGE_SUMMARY_MAP_KEY) || "{}";
    const cachedPageTokenMapOwnerId = localStorage.getItem(PAGE_CACHE_USER_ID_KEY) || "";

    if (cachedToken || cachedCookie) {
      console.log("[Pubilo Content] Background unreachable, injecting cached localStorage data");
      window.postMessage({
        type: "FEWFEED_COOKIE_INJECTED",
        cookie: cachedCookie,
        token: cachedToken,
        fbDtsg: cachedFbDtsg,
        userId: cachedUserId,
        userName: cachedUserName,
        extensionVersion: chrome.runtime.getManifest().version,
        pageTokenMap: cachedPageTokenMap,
        pageTokenMapOwnerId: cachedPageTokenMapOwnerId,
        pageSummaryMap: cachedPageSummaryMap,
      }, "*");
      syncPageUiFromInjectedData({
        accessToken: cachedToken,
        fbDtsg: cachedFbDtsg,
        cookie: cachedCookie,
        userId: cachedUserId,
        userName: cachedUserName,
      });
    } else {
      window.postMessage({
        type: "FEWFEED_EXTENSION_DIAGNOSTIC",
        reason: "content_exception",
        detail: errorMessage
      }, "*");
    }

    if (isTransientMessageChannelError && initializeRetryCount < 4) {
      initializeRetryCount += 1;
      setTimeout(() => {
        initializeTokens({ forceRefresh: true });
      }, 900 * initializeRetryCount);
    }
  }
}

// No loading indicator needed - page handles its own skeleton state
function showLoadingIndicator() {
  console.log("[FEWFEED Content] Loading started...");
}

function hideLoadingIndicator() {
  console.log("[FEWFEED Content] Loading complete");
}

function syncPageUiFromInjectedData(session = {}) {
  try {
    const setIndicatorState = (id, isValid) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.classList.remove("valid", "invalid");
      el.classList.add(isValid ? "valid" : "invalid");
    };

    const accessToken = session.accessToken || "";
    const cookie = session.cookie || "";
    const userId = session.userId || "";
    const userName = session.userName || "U";
    const postTokenInputValue = document.getElementById("pageTokenInputPanel")?.value?.trim() || "";
    const storedPostToken = localStorage.getItem("fewfeed_postToken") || "";
    const activePostToken = postTokenInputValue || storedPostToken;
    const hasDurablePostToken = !!activePostToken && !activePostToken.startsWith("EAABsbCS");

    setIndicatorState("tokenIndicator", !!accessToken);
    setIndicatorState("cookieIndicator", !!cookie);
    setIndicatorState("postTokenIndicator", hasDurablePostToken);

    const avatarImg = document.getElementById("headerAvatarImg");
    const avatarInitial = document.getElementById("headerAvatarInitial");
    if (avatarImg && accessToken && userId) {
      avatarImg.src = `https://graph.facebook.com/${userId}/picture?type=normal&width=72&height=72&access_token=${accessToken}`;
      avatarImg.style.display = "block";
      avatarImg.onerror = () => {
        avatarImg.style.display = "none";
        if (avatarInitial) {
          avatarInitial.style.display = "flex";
          avatarInitial.textContent = String(userName || "U").charAt(0).toUpperCase();
        }
      };
      if (avatarInitial) {
        avatarInitial.style.display = "none";
      }
    } else if (avatarInitial) {
      avatarInitial.style.display = "flex";
      avatarInitial.textContent = String(userName || "U").charAt(0).toUpperCase();
    }

    document.documentElement.dataset.fewfeedSession = JSON.stringify({
      accessToken,
      cookie,
      userId,
      userName,
      fbDtsg: session.fbDtsg || "",
    });
  } catch (error) {
    console.warn("[Pubilo Content] Failed to sync page UI from injected data:", error);
  }
}

let lastAutoFilledPageId = null;
let lastAutoTokenAttemptKey = null;
let lastAutoTokenAttemptAt = 0;
let initializeRetryCount = 0;

function getAutoTokenStatusElement() {
  return document.getElementById("pageTokenAutoStatus") || document.getElementById("pubiloAutoFetchPageTokenStatus");
}

function setAutoTokenStatus(message, tone = "muted") {
  const statusEl = getAutoTokenStatusElement();
  if (!statusEl) return;

  const toneColors = {
    muted: "#6b7280",
    loading: "#2563eb",
    success: "#047857",
    error: "#dc2626"
  };

  statusEl.textContent = message || "";
  statusEl.style.display = message ? "inline" : "none";
  statusEl.style.color = toneColors[tone] || toneColors.muted;
}

async function fetchPageTokenFromExtension(pageId) {
  const cachedTokenMap = readScopedPageTokenMap();
  const cachedToken = String(cachedTokenMap[String(pageId)] || "").trim();
  if (cachedToken) {
    return cachedToken;
  }

  let accessToken = localStorage.getItem("fewfeed_accessToken") || localStorage.getItem("fewfeed_token");
  const cookie = localStorage.getItem("fewfeed_cookie");

  if (!accessToken && cookie) {
    try {
      const refreshed = await safeSendMessage({ action: "fetchToken" });
      accessToken = String(
        refreshed?.fewfeed_accessToken ||
        refreshed?.fewfeed_token ||
        refreshed?.accessToken ||
        localStorage.getItem("fewfeed_accessToken") ||
        localStorage.getItem("fewfeed_token") ||
        "",
      ).trim();
    } catch (_) {
      // Keep going with cookie-only fallback.
    }
  }

  const response = await safeSendMessage({
    action: "fetchPages",
    accessToken: accessToken || "",
    cookie
  });

  if (!response?.success || !Array.isArray(response.pages)) {
    if (!accessToken && cookie) {
      throw new Error(response?.error || "มี cookie แต่ดึงรายการเพจไม่สำเร็จ (ลองเปิด adsmanager.facebook.com แล้วลองอีกครั้ง)");
    }
    throw new Error(response?.error || "ดึงรายชื่อเพจไม่สำเร็จ");
  }

  const page = response.pages.find((item) => String(item.id) === String(pageId));
  if (!page?.access_token) {
    throw new Error("ดึง Page Token ไม่ได้ ตรวจสอบสิทธิ์ของเพจนี้อีกครั้ง");
  }

  return page.access_token;
}

async function fillPageTokenInput({ silent = true } = {}) {
  const tokenInput = document.getElementById("pageTokenInputPanel");
  const pageSelect = document.getElementById("pageSelect");
  const pageId = pageSelect?.value;

  if (!tokenInput || !pageId) return false;

  setAutoTokenStatus("กำลังดึง Page Token...", "loading");

  try {
    const pageToken = await fetchPageTokenFromExtension(pageId);
    tokenInput.value = pageToken;
    tokenInput.dispatchEvent(new Event("input", { bubbles: true }));
    tokenInput.dispatchEvent(new Event("change", { bubbles: true }));
    lastAutoFilledPageId = String(pageId);
    setAutoTokenStatus("ดึง token ให้แล้ว กดบันทึกการตั้งค่าอีกครั้ง", "success");
    if (!silent) {
      alert("ดึง Page Token สำเร็จแล้ว กดบันทึกการตั้งค่าอีกครั้ง");
    }
    return true;
  } catch (error) {
    console.error("[Pubilo Content] Auto token fetch failed:", error);
    const message = error instanceof Error ? error.message : "ดึง Page Token ไม่สำเร็จ";
    setAutoTokenStatus(message, "error");
    if (!silent) {
      alert(message);
    }
    return false;
  }
}

function ensureAutoTokenControls() {
  const tokenInput = document.getElementById("pageTokenInputPanel");
  const pageSelect = document.getElementById("pageSelect");
  if (!tokenInput || !pageSelect) return;

  const builtInButton = document.getElementById("autoFetchPageTokenBtn");
  let button = document.getElementById("pubiloAutoFetchPageTokenBtn");
  let status = document.getElementById("pubiloAutoFetchPageTokenStatus");

  if (!builtInButton && !button) {
    const controls = document.createElement("div");
    controls.id = "pubiloAutoFetchPageTokenControls";
    controls.style.display = "flex";
    controls.style.alignItems = "center";
    controls.style.gap = "0.75rem";
    controls.style.marginTop = "0.75rem";
    controls.style.flexWrap = "wrap";

    button = document.createElement("button");
    button.type = "button";
    button.id = "pubiloAutoFetchPageTokenBtn";
    button.className = "btn-save";
    button.textContent = "ดึงอัตโนมัติ";
    button.style.marginTop = "0";
    button.style.padding = "0.6rem 1rem";
    button.style.whiteSpace = "nowrap";

    status = document.createElement("span");
    status.id = "pubiloAutoFetchPageTokenStatus";
    status.className = "setting-desc";
    status.style.margin = "0";
    status.style.display = "none";

    controls.appendChild(button);
    controls.appendChild(status);
    tokenInput.insertAdjacentElement("afterend", controls);
  }

  button = document.getElementById("pubiloAutoFetchPageTokenBtn");
  if (button && !button.dataset.bound) {
    button.dataset.bound = "true";
    button.addEventListener("click", async () => {
      button.disabled = true;
      const originalText = button.textContent;
      button.textContent = "กำลังดึง...";
      try {
        await fillPageTokenInput({ silent: false });
      } finally {
        button.disabled = false;
        button.textContent = originalText || "ดึงอัตโนมัติ";
      }
    });
  }

  const currentPageId = pageSelect.value;
  if (tokenInput.value.trim()) {
    setAutoTokenStatus("พบ token ในช่องแล้ว", "muted");
    return;
  }

  const attemptKey = currentPageId ? String(currentPageId) : null;
  const now = Date.now();
  const shouldRetry = attemptKey && (
    lastAutoTokenAttemptKey !== attemptKey ||
    now - lastAutoTokenAttemptAt > 10000
  );

  if (attemptKey && lastAutoFilledPageId !== attemptKey && shouldRetry) {
    lastAutoTokenAttemptKey = attemptKey;
    lastAutoTokenAttemptAt = now;
    fillPageTokenInput({ silent: true });
  }
}

// Run initialization
initializeTokens();
setTimeout(ensureAutoTokenControls, 1200);
setInterval(ensureAutoTokenControls, 1500);

// Listen for messages from the page
window.addEventListener("message", async (event) => {
  if (event.source !== window) return;

  // Page requesting stored data
  if (event.data.type === "FEWFEED_GET_DATA") {
    let response;
    try {
      response = await safeSendMessage({ action: "getStoredData" });
    } catch (error) {
      response = {
        success: false,
        reason: "content_exception",
        error: error?.message || String(error)
      };
    }
    window.postMessage({
      type: "FEWFEED_DATA_RESPONSE",
      data: response
    }, "*");
  }

  // Page requesting to fetch Pages from Facebook API
  if (event.data.type === "FEWFEED_FETCH_PAGES") {
    const response = await safeSendMessage({
      action: "fetchPages",
      accessToken: event.data.accessToken,
      cookie: localStorage.getItem("fewfeed_cookie")
    });
    window.postMessage({
      type: "FEWFEED_PAGES_RESPONSE",
      data: response
    }, "*");
  }

  // Page requesting to fetch Ad Accounts from Facebook API
  if (event.data.type === "FEWFEED_FETCH_AD_ACCOUNTS") {
    const response = await safeSendMessage({
      action: "fetchAdAccounts",
      accessToken: event.data.accessToken,
      cookie: localStorage.getItem("fewfeed_cookie")
    });
    window.postMessage({
      type: "FEWFEED_AD_ACCOUNTS_RESPONSE",
      data: response
    }, "*");
  }

  // Page requesting to refresh tokens
  if (event.data.type === "FEWFEED_REFRESH_TOKEN") {
    await initializeTokens({ forceRefresh: true });
  }

  // Page requesting to schedule post via GraphQL (extension has Facebook cookies)
  if (event.data.type === "FEWFEED_SCHEDULE_POST_GRAPHQL") {
    console.log("[FEWFEED Content] Scheduling post via GraphQL:", {
      postId: event.data.postId,
      pageId: event.data.pageId,
      hasFbDtsg: !!event.data.fbDtsg,
      fbDtsgPrefix: event.data.fbDtsg?.substring(0, 20),
      scheduledTime: event.data.scheduledTime
    });

    if (!event.data.fbDtsg) {
      console.error("[FEWFEED Content] WARNING: fb_dtsg is empty!");
    }

    const response = await safeSendMessage({
      action: "schedulePostGraphQL",
      postId: event.data.postId,
      pageId: event.data.pageId,
      fbDtsg: event.data.fbDtsg,
      scheduledTime: event.data.scheduledTime
    });
    console.log("[FEWFEED Content] GraphQL response:", response);
    window.postMessage({
      type: "FEWFEED_SCHEDULE_POST_GRAPHQL_RESPONSE",
      data: response
    }, "*");
  }

  // ============================================
  // LAZADA AFFILIATE LINK CONVERSION
  // ============================================

  // Page requesting to convert Lazada URL to affiliate link
  if (event.data.type === "FEWFEED_CONVERT_LAZADA_LINK") {
    console.log("[FEWFEED Content] Converting Lazada link:", event.data.productUrl);
    let response;
    try {
      response = await safeSendMessage({
        action: "convertLazadaLink",
        productUrl: event.data.productUrl
      });
    } catch (error) {
      response = {
        success: false,
        error: error?.message || "convert_lazada_link_failed",
      };
    }
    window.postMessage({
      type: "FEWFEED_LAZADA_LINK_RESPONSE",
      data: response
    }, "*");
  }

  // Page requesting to convert Lazada URL for News mode
  if (event.data.type === "FEWFEED_CONVERT_NEWS_LAZADA_LINK") {
    console.log("[FEWFEED Content] Converting News Lazada link:", event.data.productUrl);
    let response;
    try {
      response = await safeSendMessage({
        action: "convertLazadaLink",
        productUrl: event.data.productUrl
      });
    } catch (error) {
      response = {
        success: false,
        error: error?.message || "convert_news_lazada_link_failed",
      };
    }
    window.postMessage({
      type: "FEWFEED_NEWS_LAZADA_LINK_RESPONSE",
      data: response
    }, "*");
  }

  // Page requesting to check Lazada login status
  if (event.data.type === "FEWFEED_CHECK_LAZADA_LOGIN") {
    const response = await safeSendMessage({ action: "checkLazadaLogin" });
    window.postMessage({
      type: "FEWFEED_LAZADA_LOGIN_STATUS",
      data: response
    }, "*");
  }
});

// Listen for messages from background script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  // Token updated from Facebook page (fb-content.js extracted it)
  if (request.action === "tokenUpdated") {
    console.log("[Pubilo Content] Token updated notification received!");
    // Re-initialize to get the new tokens
    initializeTokens({ forceRefresh: true });
    sendResponse({ success: true });
    return true;
  }
  return true;
});

// Mark that extension is installed
document.documentElement.setAttribute("data-fewfeed-extension", "true");
window.postMessage({ type: "FEWFEED_EXTENSION_READY" }, "*");
console.log("[Pubilo Content] Extension v9.1.7 ready - token validation + root-domain Facebook support");
