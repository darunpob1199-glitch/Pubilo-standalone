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
        /receiving end does not exist|extension context invalidated|message port closed/i.test(
          err?.message || ""
        );
      console.warn(`[Pubilo Content] sendMessage attempt ${attempt}/${retries} failed:`, err?.message);
      if (!isDisconnected || attempt === retries) throw err;
      await new Promise((r) => setTimeout(r, 800 * attempt));
    }
  }
}

// Main function - request tokens from background and wait for them
async function initializeTokens() {
  console.log("[Pubilo Content] Requesting tokens from background...");

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
    const hasStoredSession = !!(
      data?.accessToken ||
      data?.fewfeed_accessToken ||
      hasStoredPageTokenMap
    );

    // 2) If nothing stored yet, trigger fresh token fetch from background.
    if (!hasStoredSession) {
      data = await safeSendMessage({ action: "fetchToken" });
    }

    // Get existing localStorage values as fallback
    const existingToken = localStorage.getItem("fewfeed_accessToken") || localStorage.getItem("fewfeed_token");
    const existingUserId = localStorage.getItem("fewfeed_userId");
    const existingUserName = localStorage.getItem("fewfeed_userName");
    const existingAvatarUrl = localStorage.getItem("fewfeed_avatarUrl");

    // Use extension payload as source of truth.
    // Do NOT fall back to stale localStorage token/cookie here.
    let finalToken = data?.fewfeed_accessToken || data?.accessToken || "";
    let finalFbDtsg = data?.fewfeed_fbDtsg || data?.fbDtsg || "";
    let finalCookie = data?.fewfeed_cookie || data?.cookie || "";
    let finalUserId = data?.fewfeed_userId || data?.userId || existingUserId || "";
    let finalUserName = data?.fewfeed_userName || data?.userName || existingUserName || "Facebook User";
    let finalAvatarUrl = data?.fewfeed_avatarUrl || data?.avatarUrl || existingAvatarUrl || "";

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
      fromStorage: !!existingToken
    });

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
      if (pageTokenMap && typeof pageTokenMap === "object" && Object.keys(pageTokenMap).length > 0) {
        const simpleMap = {};
        for (const [pageId, entry] of Object.entries(pageTokenMap)) {
          const token = typeof entry === "string" ? entry : entry?.token;
          if (token) simpleMap[pageId] = token;
        }
        if (Object.keys(simpleMap).length > 0) {
          localStorage.setItem("fewfeed_pageTokenMap", JSON.stringify(simpleMap));
          const firstPageId = Object.keys(simpleMap)[0];
          if (!localStorage.getItem("fewfeed_selectedPageToken")) {
            localStorage.setItem("fewfeed_selectedPageToken", simpleMap[firstPageId]);
          }
          console.log("[Pubilo Content] Stored page tokens for", Object.keys(simpleMap).length, "pages from extension");
        }
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
      pageTokenMap: pageTokenMapRaw
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
          initializeTokens();
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

    // Even when background is unreachable, inject whatever localStorage has
    // so the web page can proceed with cached tokens.
    const cachedToken = localStorage.getItem("fewfeed_accessToken") || localStorage.getItem("fewfeed_token") || "";
    const cachedCookie = localStorage.getItem("fewfeed_cookie") || "";
    const cachedUserId = localStorage.getItem("fewfeed_userId") || "";
    const cachedUserName = localStorage.getItem("fewfeed_userName") || "";
    const cachedFbDtsg = localStorage.getItem("fewfeed_fbDtsg") || "";
    const cachedPageTokenMap = localStorage.getItem("fewfeed_pageTokenMap") || "{}";

    if (cachedToken || cachedCookie) {
      console.log("[Pubilo Content] Background unreachable, injecting cached localStorage data");
      window.postMessage({
        type: "FEWFEED_COOKIE_INJECTED",
        cookie: cachedCookie,
        token: cachedToken,
        fbDtsg: cachedFbDtsg,
        userId: cachedUserId,
        userName: cachedUserName,
        pageTokenMap: cachedPageTokenMap
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
        detail: error?.message || String(error)
      }, "*");
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
  const accessToken = localStorage.getItem("fewfeed_accessToken") || localStorage.getItem("fewfeed_token");
  const cookie = localStorage.getItem("fewfeed_cookie");

  if (!accessToken) {
    throw new Error("ไม่พบ Ads Token จาก extension");
  }

  const response = await safeSendMessage({
    action: "fetchPages",
    accessToken,
    cookie
  });

  if (!response?.success || !Array.isArray(response.pages)) {
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
    await initializeTokens();
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
    const response = await safeSendMessage({
      action: "convertLazadaLink",
      productUrl: event.data.productUrl
    });
    window.postMessage({
      type: "FEWFEED_LAZADA_LINK_RESPONSE",
      data: response
    }, "*");
  }

  // Page requesting to convert Lazada URL for News mode
  if (event.data.type === "FEWFEED_CONVERT_NEWS_LAZADA_LINK") {
    console.log("[FEWFEED Content] Converting News Lazada link:", event.data.productUrl);
    const response = await safeSendMessage({
      action: "convertLazadaLink",
      productUrl: event.data.productUrl
    });
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
    initializeTokens();
    sendResponse({ success: true });
    return true;
  }
  return true;
});

// Mark that extension is installed
document.documentElement.setAttribute("data-fewfeed-extension", "true");
window.postMessage({ type: "FEWFEED_EXTENSION_READY" }, "*");
console.log("[Pubilo Content] Extension v9.1.4 ready - stale token validator + temp-tab fallback");
