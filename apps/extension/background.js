// Pubilo Token Helper v9.0
// Auto-fetches Ads Token + Cookie from Facebook
// Post Token is now managed manually via Page Settings (not from Extension)

// ============================================
// HOT RELOAD FOR DEVELOPMENT (disabled in production)
// ============================================
(function setupHotReload() {
  // Only enable hot reload if explicitly enabled via localStorage or in dev mode
  // Set localStorage.setItem('PUBILO_DEV_MODE', 'true') to enable
  const DEV_MODE = false; // Set to true during development
  if (!DEV_MODE) return;

  const WS_URL = "ws://localhost:35729";
  let ws = null;
  let reconnectTimer = null;
  let connectionFailed = false;

  function connect() {
    if (connectionFailed) return; // Don't retry after first failure

    try {
      ws = new WebSocket(WS_URL);

      ws.onopen = () => {
        console.log("[HotReload] Connected to dev server");
        connectionFailed = false;
        if (reconnectTimer) {
          clearInterval(reconnectTimer);
          reconnectTimer = null;
        }
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === "reload") {
            console.log(`[HotReload] Reloading... (${data.file} changed)`);
            chrome.runtime.reload();
          }
        } catch (e) {
          // Ignore parse errors (like pong responses)
        }
      };

      ws.onclose = () => {
        ws = null;
        // Only reconnect if we were previously connected
        if (!connectionFailed && !reconnectTimer) {
          reconnectTimer = setInterval(() => {
            connect();
          }, 3000);
        }
      };

      ws.onerror = () => {
        // Mark as failed so we don't keep retrying
        connectionFailed = true;
        if (reconnectTimer) {
          clearInterval(reconnectTimer);
          reconnectTimer = null;
        }
        ws?.close();
      };
    } catch (e) {
      connectionFailed = true;
    }
  }

  // Start connection
  connect();

  // Send keepalive ping every 30 seconds
  setInterval(() => {
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send("ping");
    }
  }, 30000);
})();

// ============================================
// MAIN EXTENSION CODE
// ============================================

// ============================================
// KEEPALIVE - Keep service worker alive
// ============================================
const KEEPALIVE_INTERVAL = 20; // seconds (must be under 30s for Chrome)

// Create keepalive alarm on startup
chrome.alarms.create("keepalive", { periodInMinutes: 0.4 }); // ~24 seconds

// Listen for alarm
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "keepalive") {
    // Just log to keep service worker active
    console.log("[Pubilo] Keepalive ping", new Date().toLocaleTimeString());
  }
});

// Also run on install/update
chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create("keepalive", { periodInMinutes: 0.4 });
  console.log("[Pubilo] Keepalive alarm created");
});

// App URLs - supports both local dev and production
const APP_URLS = [
  "http://localhost:3000/*",
  "http://localhost:3005/*",
  "https://pubilo-web-dev.pages.dev/*",
  "https://*.pubilo-web-dev.pages.dev/*",
  "https://pubilo-web-prod.pages.dev/*",
  "https://*.pubilo-web-prod.pages.dev/*",
  "https://pubilo.lslly.com/*",
  "https://www.pubilo.com/*"
];
const PRODUCTION_URL = "https://pubilo-web-prod.pages.dev/";

// When extension icon is clicked
chrome.action.onClicked.addListener(async () => {
  console.log("[Pubilo] Extension clicked!");

  // Open production URL (use localhost for dev)
  chrome.tabs.create({ url: PRODUCTION_URL });

  // Fetch all tokens in background
  await fetchAllTokensInBackground();
});

// Fetch all tokens in background (Ads Token + Cookie only)
async function fetchAllTokensInBackground() {
  await fetchAndStoreToken();
}

// Extract token from existing Facebook tabs using script injection
async function extractTokenFromExistingTabs() {
  console.log("[FEWFEED] Trying to extract token from existing tabs...");

  // Find Facebook tabs (prioritize Ads Manager)
  const tabUrls = [
    "https://adsmanager.facebook.com/*",
    "https://business.facebook.com/*",
    "https://www.facebook.com/*"
  ];

  for (const urlPattern of tabUrls) {
    const tabs = await chrome.tabs.query({ url: urlPattern });
    if (tabs.length === 0) continue;

    console.log("[FEWFEED] Found tab:", tabs[0].url);

    try {
      // Inject script to extract token from the page
      const results = await chrome.scripting.executeScript({
        target: { tabId: tabs[0].id },
        func: () => {
          const html = document.documentElement.outerHTML;

          // Extract access token
          const tokenPatterns = [
            /__accessToken\s*=\s*"(EA[A-Za-z0-9]+)"/,
            /"__accessToken"\s*:\s*"(EA[A-Za-z0-9]+)"/,
            /__window\.__accessToken="(EA[A-Za-z0-9]+)"/,
            /"accessToken":"(EA[A-Za-z0-9]+)"/,
            /"access_token":"(EA[A-Za-z0-9]+)"/
          ];

          let token = null;
          for (const pattern of tokenPatterns) {
            const match = html.match(pattern);
            if (match) {
              token = match[1];
              break;
            }
          }

          // Also try window.__accessToken directly
          if (!token && typeof window.__accessToken === 'string') {
            token = window.__accessToken;
          }

          // Extract fb_dtsg
          const dtsgPatterns = [
            /"DTSGInitialData"[^}]*"token":"([^"]+)"/,
            /name="fb_dtsg"\s+value="([^"]+)"/,
            /"fb_dtsg":"([^"]+)"/
          ];

          let dtsg = null;
          for (const pattern of dtsgPatterns) {
            const match = html.match(pattern);
            if (match) {
              dtsg = match[1];
              break;
            }
          }

          return { token, dtsg };
        }
      });

      if (results && results[0] && results[0].result) {
        const { token, dtsg } = results[0].result;
        if (token) {
          console.log("[FEWFEED] Extracted token from tab:", token.substring(0, 15) + "...");
          return { token, dtsg };
        }
      }
    } catch (e) {
      console.log("[FEWFEED] Script injection failed for", urlPattern, ":", e.message);
    }
  }

  console.log("[FEWFEED] No token found in existing tabs");
  return null;
}

// Main function to fetch ads token from Facebook using cookies
async function fetchAndStoreToken() {
  try {
    // Get all Facebook cookies
    const cookies = await chrome.cookies.getAll({ domain: ".facebook.com" });
    const cUser = cookies.find(c => c.name === "c_user");
    const userId = cUser?.value || "";

    if (!userId) {
      console.log("[FEWFEED] No Facebook login found (no c_user cookie)");
      return;
    }

    // Build cookie string
    const cookieString = cookies.map(c => `${c.name}=${c.value}`).join("; ");
    console.log("[FEWFEED] Found Facebook cookies for user:", userId);

    // Try to fetch token from Facebook endpoints
    let accessToken = null;
    let fbDtsg = null;
    let userName = "Facebook User";

    // NEW Method 0: Try extracting from existing Facebook tabs first (most reliable)
    const tabResult = await extractTokenFromExistingTabs();
    if (tabResult) {
      accessToken = tabResult.token;
      fbDtsg = tabResult.dtsg;
      console.log("[FEWFEED] Got token from existing tab!");
    }

    // Method 1: Try fetching from Ads Manager API (fallback)
    if (!accessToken) {
      const adsResult = await fetchTokenFromAdsManager(cookieString, true);
      if (typeof adsResult === 'object') {
        accessToken = adsResult.token;
        fbDtsg = fbDtsg || adsResult.dtsg;
      } else {
        accessToken = adsResult;
      }
    }

    // Method 2: Try fetching from Business Suite
    if (!accessToken) {
      const bizResult = await fetchTokenFromBusinessSuite(cookieString, true);
      if (typeof bizResult === 'object') {
        accessToken = bizResult.token;
        fbDtsg = fbDtsg || bizResult.dtsg;
      } else {
        accessToken = bizResult;
      }
    }

    // Method 3: Try fetching from regular Facebook
    if (!accessToken) {
      const fbResult = await fetchTokenFromFacebook(cookieString, true);
      if (typeof fbResult === 'object') {
        accessToken = fbResult.token;
        fbDtsg = fbDtsg || fbResult.dtsg;
      } else {
        accessToken = fbResult;
      }
    }

    // Method 4: Try using internal API endpoint
    if (!accessToken) {
      accessToken = await fetchTokenFromInternalAPI(cookieString);
    }

    // If still no fb_dtsg, try fetching from business.facebook.com specifically
    if (!fbDtsg) {
      fbDtsg = await fetchDtsgFromBusiness(cookieString);
    }

    // Fetch user name and avatar from Graph API if we have access token
    let avatarUrl = null;
    if (accessToken && userId) {
      try {
        const nameResponse = await fetch(`https://graph.facebook.com/${userId}?fields=name,picture.width(200).height(200)&access_token=${accessToken}`);
        const userData = await nameResponse.json();
        if (userData.name) {
          userName = userData.name;
          console.log("[FEWFEED] Fetched user name:", userName);
        }
        if (userData.picture?.data?.url) {
          avatarUrl = userData.picture.data.url;
          console.log("[FEWFEED] Fetched avatar URL");
        }
      } catch (e) {
        console.log("[FEWFEED] Could not fetch user info:", e.message);
      }
    }

    console.log("[FEWFEED] Result:", {
      userId,
      userName,
      hasAdsToken: !!accessToken,
      hasDtsg: !!fbDtsg,
      hasCookie: !!cookieString,
      hasAvatar: !!avatarUrl
    });

    // Store for content script
    const storageData = {
      fewfeed_accessToken: accessToken || "",
      fewfeed_fbDtsg: fbDtsg || "",
      fewfeed_userId: userId,
      fewfeed_userName: userName,
      fewfeed_cookie: cookieString,
      fewfeed_ready: true,
      fewfeed_lastFetch: Date.now()
    };
    if (avatarUrl) {
      storageData.fewfeed_avatarUrl = avatarUrl;
    }
    await chrome.storage.local.set(storageData);

    console.log("[FEWFEED] Ads token, fb_dtsg and cookies stored!");

  } catch (error) {
    console.error("[FEWFEED] Error:", error);
  }
}

// Fetch fb_dtsg from Business Facebook
async function fetchDtsgFromBusiness(cookieString) {
  try {
    const response = await fetch("https://business.facebook.com/content_management/", {
      headers: {
        "Cookie": cookieString,
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
      },
      credentials: "include"
    });

    const html = await response.text();
    return extractDtsgFromHTML(html);
  } catch (e) {
    console.log("[FEWFEED] Business dtsg fetch failed:", e.message);
    return null;
  }
}

// Fetch token from Ads Manager page
async function fetchTokenFromAdsManager(cookieString, includeDtsg = false) {
  try {
    const response = await fetch("https://adsmanager.facebook.com/adsmanager/manage/campaigns", {
      headers: {
        "Cookie": cookieString,
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
      },
      credentials: "include"
    });

    const html = await response.text();
    const token = extractTokenFromHTML(html);

    if (includeDtsg) {
      const dtsg = extractDtsgFromHTML(html);
      return { token, dtsg };
    }
    return token;
  } catch (e) {
    console.log("[FEWFEED] Ads Manager fetch failed:", e.message);
    return includeDtsg ? { token: null, dtsg: null } : null;
  }
}

// Fetch token from Business Suite page
async function fetchTokenFromBusinessSuite(cookieString, includeDtsg = false) {
  try {
    const response = await fetch("https://business.facebook.com/", {
      headers: {
        "Cookie": cookieString,
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
      },
      credentials: "include"
    });

    const html = await response.text();
    const token = extractTokenFromHTML(html);

    if (includeDtsg) {
      const dtsg = extractDtsgFromHTML(html);
      return { token, dtsg };
    }
    return token;
  } catch (e) {
    console.log("[FEWFEED] Business Suite fetch failed:", e.message);
    return includeDtsg ? { token: null, dtsg: null } : null;
  }
}

// Fetch token from regular Facebook
async function fetchTokenFromFacebook(cookieString, includeDtsg = false) {
  try {
    const response = await fetch("https://www.facebook.com/", {
      headers: {
        "Cookie": cookieString,
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
      },
      credentials: "include"
    });

    const html = await response.text();
    const token = extractTokenFromHTML(html);

    if (includeDtsg) {
      const dtsg = extractDtsgFromHTML(html);
      return { token, dtsg };
    }
    return token;
  } catch (e) {
    console.log("[FEWFEED] Facebook fetch failed:", e.message);
    return includeDtsg ? { token: null, dtsg: null } : null;
  }
}

// Try internal API endpoint that might return token
async function fetchTokenFromInternalAPI(cookieString) {
  try {
    const response = await fetch("https://www.facebook.com/ajax/bootloader-endpoint/?modules=AdsLWIDescribeCustomersTypedLogger", {
      headers: {
        "Cookie": cookieString,
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
      },
      credentials: "include"
    });

    const text = await response.text();
    return extractTokenFromHTML(text);
  } catch (e) {
    console.log("[FEWFEED] Internal API fetch failed:", e.message);
    return null;
  }
}

// Extract token from HTML/text response
function extractTokenFromHTML(html) {
  const patterns = [
    // __accessToken assignment in HTML
    /__accessToken\s*=\s*"(EA[A-Za-z0-9]+)"/,
    /"__accessToken"\s*:\s*"(EA[A-Za-z0-9]+)"/,
    // NEW: __window.__accessToken format (Facebook 2024+)
    /__window\.__accessToken="(EAABsbCS[A-Za-z0-9]+)"/,
    /__window\.__accessToken="(EA[A-Za-z0-9]+)"/,

    // EAABsbCS format (internal token)
    /"accessToken":\s*"(EAABsbCS[A-Za-z0-9]+)"/,
    /"access_token":\s*"(EAABsbCS[A-Za-z0-9]+)"/,
    /accessToken['"]\s*:\s*['"](EAABsbCS[A-Za-z0-9]+)['"]/,

    // EAAChZC format (OAuth token) - also valid but less preferred
    /"accessToken":\s*"(EA[A-Za-z0-9]+)"/,
    /"access_token":\s*"(EA[A-Za-z0-9]+)"/,
    /access_token=(EA[A-Za-z0-9]+)/,
    /"token":\s*"(EA[A-Za-z0-9]+)"/,
    /accessToken['"]\s*:\s*['"](EA[A-Za-z0-9]+)['"]/,

    // EAAG format
    /"accessToken":\s*"(EAAG[A-Za-z0-9]+)"/
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match) {
      console.log("[FEWFEED] Token found with pattern:", pattern.toString().substring(0, 30));
      return match[1];
    }
  }
  return null;
}

// Extract fb_dtsg token from HTML (required for GraphQL scheduling)
function extractDtsgFromHTML(html) {
  const patterns = [
    // DTSGInitialData format
    /"DTSGInitialData"[^}]*"token":"([^"]+)"/,
    // fb_dtsg in form
    /name="fb_dtsg"\s+value="([^"]+)"/,
    // fb_dtsg in JSON
    /"fb_dtsg":\s*"([^"]+)"/,
    /fb_dtsg['"]\s*:\s*['"]([\w:_-]+)['"]/,
    // DTSG token format
    /"dtsg":\s*\{"token":"([^"]+)"/
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match) {
      console.log("[FEWFEED] fb_dtsg found with pattern:", pattern.toString().substring(0, 40));
      return match[1];
    }
  }
  return null;
}

// Listen for messages from content script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  // Token extracted from Facebook page by fb-content.js
  if (request.action === "tokenExtracted") {
    console.log("[FEWFEED] Token received from fb-content.js:", {
      hasToken: !!request.token,
      hasDtsg: !!request.dtsg,
      hasAvatar: !!request.avatarUrl,
      source: request.source
    });

    if (request.token || request.dtsg) {
      // Store the extracted token
      const updates = {};
      if (request.token) {
        updates.fewfeed_accessToken = request.token;
        console.log("[FEWFEED] Storing access token from", request.source);
      }
      if (request.dtsg) {
        updates.fewfeed_fbDtsg = request.dtsg;
      }
      if (request.avatarUrl) {
        updates.fewfeed_avatarUrl = request.avatarUrl;
      }
      updates.fewfeed_ready = true;
      updates.fewfeed_lastFetch = Date.now();

      chrome.storage.local.set(updates);

      // Notify any open app tabs (localhost and production)
      for (const urlPattern of APP_URLS) {
        chrome.tabs.query({ url: urlPattern }).then(tabs => {
          for (const tab of tabs) {
            chrome.tabs.sendMessage(tab.id, {
              action: "tokenUpdated",
              hasToken: !!request.token,
              hasDtsg: !!request.dtsg
            }).catch(() => { });
          }
        });
      }
    }
    return;
  }

  // Get Facebook cookies for popup (checks if logged in)
  if (request.action === "getFacebookCookies") {
    (async () => {
      try {
        // Get Facebook cookies
        const cookies = await chrome.cookies.getAll({ domain: ".facebook.com" });
        const cookieString = cookies.map(c => `${c.name}=${c.value}`).join("; ");

        // Get c_user cookie for userId
        const cUser = cookies.find(c => c.name === "c_user");

        if (cUser && cookieString) {
          sendResponse({
            success: true,
            cookie: cookieString,
            userId: cUser.value
          });
        } else {
          sendResponse({
            success: false,
            error: "Not logged into Facebook"
          });
        }
      } catch (err) {
        sendResponse({
          success: false,
          error: err.message
        });
      }
    })();
    return true;
  }

  if (request.action === "getStoredData") {
    chrome.storage.local.get([
      "fewfeed_accessToken",
      "fewfeed_fbDtsg",
      "fewfeed_userId",
      "fewfeed_userName",
      "fewfeed_cookie",
      "fewfeed_ready"
    ]).then(data => {
      sendResponse({
        accessToken: data.fewfeed_accessToken,
        fbDtsg: data.fewfeed_fbDtsg,
        userId: data.fewfeed_userId,
        userName: data.fewfeed_userName,
        cookie: data.fewfeed_cookie,
        ready: data.fewfeed_ready
      });
    });
    return true;
  }

  // Manually trigger token fetch - waits for completion
  if (request.action === "fetchToken") {
    (async () => {
      await fetchAndStoreToken();
      const data = await chrome.storage.local.get([
        "fewfeed_accessToken",
        "fewfeed_fbDtsg",
        "fewfeed_userId",
        "fewfeed_userName",
        "fewfeed_cookie"
      ]);
      sendResponse(data);
    })();
    return true;
  }

  // Fetch Pages from Facebook API
  if (request.action === "fetchPages") {
    fetchFacebookPages(request.accessToken, request.cookie).then(sendResponse);
    return true;
  }

  // Fetch Ad Accounts from Facebook API
  if (request.action === "fetchAdAccounts") {
    fetchFacebookAdAccounts(request.accessToken, request.cookie).then(sendResponse);
    return true;
  }

  // Convert Lazada URL to affiliate link
  if (request.action === "convertLazadaLink") {
    convertToLazadaAffiliateLink(request.productUrl).then(sendResponse);
    return true;
  }

  // Check Lazada login status
  if (request.action === "checkLazadaLogin") {
    getLazadaCookies().then(sendResponse);
    return true;
  }

  // Schedule post via GraphQL (directly from background with cookies)
  if (request.action === "schedulePostGraphQL") {
    schedulePostViaGraphQL(
      request.postId,
      request.pageId,
      request.fbDtsg,
      request.scheduledTime
    ).then(sendResponse);
    return true;
  }

});

// Schedule post via GraphQL - use hidden Facebook window with content script
async function schedulePostViaGraphQL(postId, pageId, fbDtsg, scheduledTime) {
  console.log("[FEWFEED] schedulePostViaGraphQL called:", { postId, pageId, scheduledTime, fbDtsgPrefix: fbDtsg?.substring(0, 20) });

  if (!fbDtsg) {
    return { success: false, error: "fb_dtsg is required for scheduling. Please refresh Facebook login." };
  }

  // Convert post ID to story ID format
  // e.g. "168440993027073_122247104042156951" -> "S:_I168440993027073:122247104042156951"
  const parts = postId.split("_");
  if (parts.length !== 2) {
    return { success: false, error: `Invalid post ID format: ${postId}` };
  }
  const storyId = `S:_I${parts[0]}:${parts[1]}`;
  console.log("[FEWFEED] Story ID:", storyId);

  try {
    // Find existing Facebook tab
    const tabs = await chrome.tabs.query({});
    let fbTab = tabs.find(tab =>
      tab.url && (
        tab.url.includes("www.facebook.com") ||
        tab.url.includes("business.facebook.com")
      )
    );

    let bgWindowId = null;

    if (!fbTab) {
      // Create a minimized background Facebook window (invisible to user)
      console.log("[FEWFEED] No Facebook tab found, creating minimized background window...");
      const bgWindow = await chrome.windows.create({
        url: "https://business.facebook.com/latest/home",
        type: 'popup',
        state: 'minimized',
        focused: false
      });

      fbTab = bgWindow.tabs[0];
      bgWindowId = bgWindow.id;

      // Wait for page to load
      await new Promise((resolve) => {
        const listener = (tabId, changeInfo) => {
          if (tabId === fbTab.id && changeInfo.status === "complete") {
            chrome.tabs.onUpdated.removeListener(listener);
            resolve();
          }
        };
        chrome.tabs.onUpdated.addListener(listener);
        setTimeout(() => {
          chrome.tabs.onUpdated.removeListener(listener);
          resolve();
        }, 10000);
      });

      // Wait for content script to initialize
      await new Promise(r => setTimeout(r, 1500));
    }

    console.log("[FEWFEED] Using Facebook tab:", fbTab.id);

    // Try to send message, inject content script if needed
    let result;
    try {
      result = await chrome.tabs.sendMessage(fbTab.id, {
        action: "schedulePostGraphQL",
        storyId: storyId,
        pageId: pageId,
        fbDtsg: fbDtsg,
        scheduledTime: scheduledTime
      });
    } catch (msgError) {
      console.log("[FEWFEED] Message failed, injecting content script...", msgError.message);

      // Inject content script manually
      await chrome.scripting.executeScript({
        target: { tabId: fbTab.id },
        files: ["fb-content.js"]
      });

      // Wait for script to initialize
      await new Promise(r => setTimeout(r, 500));

      // Retry sending message
      result = await chrome.tabs.sendMessage(fbTab.id, {
        action: "schedulePostGraphQL",
        storyId: storyId,
        pageId: pageId,
        fbDtsg: fbDtsg,
        scheduledTime: scheduledTime
      });
    }

    // Clean up background window immediately after request completes
    if (bgWindowId) {
      chrome.windows.remove(bgWindowId).catch(() => { });
    }

    console.log("[FEWFEED] Schedule result:", result);
    return result || { success: false, error: "No response from content script" };
  } catch (error) {
    console.error("[FEWFEED] Error:", error);
    return { success: false, error: error.message };
  }
}

// Fetch Pages from Facebook Graph API with cookie fallback
async function fetchFacebookPages(accessToken, cookie) {
  try {
    const headers = {
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    };

    if (cookie) {
      headers["Cookie"] = cookie;
    }

    const response = await fetch(
      `https://graph.facebook.com/v21.0/me/accounts?access_token=${accessToken}&fields=id,name,access_token,picture,is_published&limit=100`,
      { headers }
    );
    const data = await response.json();

    if (data.error) {
      return { success: false, error: data.error.message };
    }

    return { success: true, pages: data.data || [] };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// Fetch Ad Accounts from Facebook Graph API with cookie fallback
async function fetchFacebookAdAccounts(accessToken, cookie) {
  try {
    const headers = {
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    };

    if (cookie) {
      headers["Cookie"] = cookie;
    }

    const response = await fetch(
      `https://graph.facebook.com/v21.0/me/adaccounts?access_token=${accessToken}&fields=account_id,account_status,name`,
      { headers }
    );
    const data = await response.json();

    if (data.error) {
      return { success: false, error: data.error.message };
    }

    return { success: true, adAccounts: data.data || [] };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// ============================================
// LAZADA AFFILIATE LINK GENERATION (mtop API)
// ============================================

// Convert Lazada URL to affiliate link using mtop API (for s.lazada.co.th format)
async function convertToLazadaAffiliateLink(productUrl) {
  console.log("[FEWFEED] Converting Lazada URL:", productUrl);

  // Get Lazada cookies first
  const cookies = await chrome.cookies.getAll({ domain: ".lazada.co.th" });
  if (cookies.length === 0) {
    return { success: false, error: "กรุณา login Lazada ในเบราว์เซอร์ก่อน" };
  }

  const cookieString = cookies.map(c => `${c.name}=${c.value}`).join("; ");

  // Get _m_h5_tk token for mtop API signature
  const h5tkCookie = cookies.find(c => c.name === "_m_h5_tk");
  const h5tk = h5tkCookie?.value?.split("_")[0] || "";

  if (!h5tk) {
    console.log("[FEWFEED] No _m_h5_tk cookie - need to visit Lazada first");
    return { success: false, error: "กรุณาเปิด lazada.co.th ในเบราว์เซอร์ก่อน" };
  }

  try {
    // Prepare mtop API request (same params as Link Tool page)
    const timestamp = Date.now().toString();
    const api = "mtop.lazada.affiliate.lania.offer.getPromotionLinkFromJumpUrl";
    const v = "1.1";
    const appKey = "24677475";

    // Data payload
    const data = JSON.stringify({ jumpUrl: productUrl });

    // Generate mtop sign: md5(token + "&" + timestamp + "&" + appKey + "&" + data)
    const signStr = h5tk + "&" + timestamp + "&" + appKey + "&" + data;
    const sign = md5(signStr);

    // Build URL with all required params
    const params = new URLSearchParams({
      jsv: "2.6.1",
      appKey: appKey,
      t: timestamp,
      sign: sign,
      api: api,
      v: v,
      type: "originaljson",
      isSec: "1",
      AntiCreep: "true",
      timeout: "5000",
      needLogin: "true",
      dataType: "json",
      sessionOption: "AutoLoginOnly",
      "x-i18n-language": "th",
      "x-i18n-regionID": "TH",
      data: data
    });

    const url = `https://acs-m.lazada.co.th/h5/${api}/${v}/?${params.toString()}`;

    console.log("[FEWFEED] Calling mtop API for s.lazada link...");

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': 'https://pages.lazada.co.th/'
      },
      credentials: 'include'
    });

    const result = await response.json();
    console.log("[FEWFEED] mtop API response:", JSON.stringify(result));

    // Check for s.lazada link in response - try multiple paths
    const dataObj = result.data || {};

    // Try to find the short link (s.lazada format)
    const shortLink = dataObj.shortLink || dataObj.short_link || dataObj.sLink;
    if (shortLink) {
      console.log("[FEWFEED] Found shortLink:", shortLink);
      return {
        success: true,
        affiliateLink: shortLink,
        productName: dataObj.productName || dataObj.product_name || '',
        commissionRate: dataObj.commissionRate || dataObj.commission_rate || ''
      };
    }

    // Try promotion link
    const promoLink = dataObj.promotionLink || dataObj.promotion_link || dataObj.link || dataObj.url;
    if (promoLink) {
      console.log("[FEWFEED] Found promotionLink:", promoLink);
      return {
        success: true,
        affiliateLink: promoLink,
        productName: dataObj.productName || dataObj.product_name || '',
        commissionRate: dataObj.commissionRate || dataObj.commission_rate || ''
      };
    }

    // Check if link is in the result directly
    if (result.shortLink || result.promotionLink) {
      const link = result.shortLink || result.promotionLink;
      console.log("[FEWFEED] Found link in result:", link);
      return {
        success: true,
        affiliateLink: link,
        productName: result.productName || '',
        commissionRate: result.commissionRate || ''
      };
    }

    // Check ret array - might contain SUCCESS but link is elsewhere
    if (result.ret && result.ret.length > 0) {
      const retStr = result.ret.join(', ');
      console.log("[FEWFEED] ret:", retStr);

      // If SUCCESS, look harder for the link
      if (retStr.includes('SUCCESS')) {
        // Search entire result object for s.lazada URL
        const jsonStr = JSON.stringify(result);
        const sLinkMatch = jsonStr.match(/https?:\/\/s\.lazada\.co\.th\/s\.[A-Za-z0-9]+/);
        if (sLinkMatch) {
          console.log("[FEWFEED] Found s.lazada in response:", sLinkMatch[0]);
          return {
            success: true,
            affiliateLink: sLinkMatch[0],
            productName: dataObj.productName || ''
          };
        }

        // Search for any lazada tracking URL
        const cLinkMatch = jsonStr.match(/https?:\/\/c\.lazada\.co\.th\/[^\s"]+/);
        if (cLinkMatch) {
          console.log("[FEWFEED] Found c.lazada in response:", cLinkMatch[0]);
          return {
            success: true,
            affiliateLink: cLinkMatch[0],
            productName: dataObj.productName || ''
          };
        }
      }

      // Session error - need to re-login
      if (retStr.includes('SESSION_EXPIRED') || retStr.includes('FAIL_SYS_SESSION')) {
        return { success: false, error: "Session หมดอายุ กรุณา refresh หน้า Lazada แล้วลองใหม่" };
      }

      // Other error
      if (!retStr.includes('SUCCESS')) {
        return { success: false, error: retStr };
      }
    }

    // Last resort - return full response for debugging
    return { success: false, error: "ไม่พบลิ้ง - Response: " + JSON.stringify(result).substring(0, 200) };

  } catch (e) {
    console.error("[FEWFEED] mtop API error:", e);
    return { success: false, error: e.message };
  }
}

// MD5 implementation for mtop signature (WebCrypto doesn't support MD5)
function md5(string) {
  function rotateLeft(x, n) {
    return (x << n) | (x >>> (32 - n));
  }

  function addUnsigned(x, y) {
    const x8 = x & 0x80000000;
    const y8 = y & 0x80000000;
    const x4 = x & 0x40000000;
    const y4 = y & 0x40000000;
    const result = (x & 0x3FFFFFFF) + (y & 0x3FFFFFFF);
    if (x4 & y4) return result ^ 0x80000000 ^ x8 ^ y8;
    if (x4 | y4) {
      if (result & 0x40000000) return result ^ 0xC0000000 ^ x8 ^ y8;
      return result ^ 0x40000000 ^ x8 ^ y8;
    }
    return result ^ x8 ^ y8;
  }

  function f(x, y, z) { return (x & y) | (~x & z); }
  function g(x, y, z) { return (x & z) | (y & ~z); }
  function h(x, y, z) { return x ^ y ^ z; }
  function i(x, y, z) { return y ^ (x | ~z); }

  function ff(a, b, c, d, x, s, ac) {
    a = addUnsigned(a, addUnsigned(addUnsigned(f(b, c, d), x), ac));
    return addUnsigned(rotateLeft(a, s), b);
  }
  function gg(a, b, c, d, x, s, ac) {
    a = addUnsigned(a, addUnsigned(addUnsigned(g(b, c, d), x), ac));
    return addUnsigned(rotateLeft(a, s), b);
  }
  function hh(a, b, c, d, x, s, ac) {
    a = addUnsigned(a, addUnsigned(addUnsigned(h(b, c, d), x), ac));
    return addUnsigned(rotateLeft(a, s), b);
  }
  function ii(a, b, c, d, x, s, ac) {
    a = addUnsigned(a, addUnsigned(addUnsigned(i(b, c, d), x), ac));
    return addUnsigned(rotateLeft(a, s), b);
  }

  function convertToWordArray(str) {
    let wordCount;
    const msgLen = str.length;
    const temp1 = msgLen + 8;
    const temp2 = (temp1 - (temp1 % 64)) / 64;
    const numWords = (temp2 + 1) * 16;
    const wordArray = Array(numWords - 1);
    let bytePos = 0;
    let byteCount = 0;
    while (byteCount < msgLen) {
      wordCount = (byteCount - (byteCount % 4)) / 4;
      bytePos = (byteCount % 4) * 8;
      wordArray[wordCount] = wordArray[wordCount] | (str.charCodeAt(byteCount) << bytePos);
      byteCount++;
    }
    wordCount = (byteCount - (byteCount % 4)) / 4;
    bytePos = (byteCount % 4) * 8;
    wordArray[wordCount] = wordArray[wordCount] | (0x80 << bytePos);
    wordArray[numWords - 2] = msgLen << 3;
    wordArray[numWords - 1] = msgLen >>> 29;
    return wordArray;
  }

  function wordToHex(value) {
    let hex = "", temp, byte;
    for (let count = 0; count <= 3; count++) {
      byte = (value >>> (count * 8)) & 255;
      temp = "0" + byte.toString(16);
      hex += temp.substr(temp.length - 2, 2);
    }
    return hex;
  }

  const x = convertToWordArray(string);
  let a = 0x67452301, b = 0xEFCDAB89, c = 0x98BADCFE, d = 0x10325476;
  const S11 = 7, S12 = 12, S13 = 17, S14 = 22;
  const S21 = 5, S22 = 9, S23 = 14, S24 = 20;
  const S31 = 4, S32 = 11, S33 = 16, S34 = 23;
  const S41 = 6, S42 = 10, S43 = 15, S44 = 21;

  for (let k = 0; k < x.length; k += 16) {
    const AA = a, BB = b, CC = c, DD = d;
    a = ff(a, b, c, d, x[k + 0], S11, 0xD76AA478);
    d = ff(d, a, b, c, x[k + 1], S12, 0xE8C7B756);
    c = ff(c, d, a, b, x[k + 2], S13, 0x242070DB);
    b = ff(b, c, d, a, x[k + 3], S14, 0xC1BDCEEE);
    a = ff(a, b, c, d, x[k + 4], S11, 0xF57C0FAF);
    d = ff(d, a, b, c, x[k + 5], S12, 0x4787C62A);
    c = ff(c, d, a, b, x[k + 6], S13, 0xA8304613);
    b = ff(b, c, d, a, x[k + 7], S14, 0xFD469501);
    a = ff(a, b, c, d, x[k + 8], S11, 0x698098D8);
    d = ff(d, a, b, c, x[k + 9], S12, 0x8B44F7AF);
    c = ff(c, d, a, b, x[k + 10], S13, 0xFFFF5BB1);
    b = ff(b, c, d, a, x[k + 11], S14, 0x895CD7BE);
    a = ff(a, b, c, d, x[k + 12], S11, 0x6B901122);
    d = ff(d, a, b, c, x[k + 13], S12, 0xFD987193);
    c = ff(c, d, a, b, x[k + 14], S13, 0xA679438E);
    b = ff(b, c, d, a, x[k + 15], S14, 0x49B40821);
    a = gg(a, b, c, d, x[k + 1], S21, 0xF61E2562);
    d = gg(d, a, b, c, x[k + 6], S22, 0xC040B340);
    c = gg(c, d, a, b, x[k + 11], S23, 0x265E5A51);
    b = gg(b, c, d, a, x[k + 0], S24, 0xE9B6C7AA);
    a = gg(a, b, c, d, x[k + 5], S21, 0xD62F105D);
    d = gg(d, a, b, c, x[k + 10], S22, 0x2441453);
    c = gg(c, d, a, b, x[k + 15], S23, 0xD8A1E681);
    b = gg(b, c, d, a, x[k + 4], S24, 0xE7D3FBC8);
    a = gg(a, b, c, d, x[k + 9], S21, 0x21E1CDE6);
    d = gg(d, a, b, c, x[k + 14], S22, 0xC33707D6);
    c = gg(c, d, a, b, x[k + 3], S23, 0xF4D50D87);
    b = gg(b, c, d, a, x[k + 8], S24, 0x455A14ED);
    a = gg(a, b, c, d, x[k + 13], S21, 0xA9E3E905);
    d = gg(d, a, b, c, x[k + 2], S22, 0xFCEFA3F8);
    c = gg(c, d, a, b, x[k + 7], S23, 0x676F02D9);
    b = gg(b, c, d, a, x[k + 12], S24, 0x8D2A4C8A);
    a = hh(a, b, c, d, x[k + 5], S31, 0xFFFA3942);
    d = hh(d, a, b, c, x[k + 8], S32, 0x8771F681);
    c = hh(c, d, a, b, x[k + 11], S33, 0x6D9D6122);
    b = hh(b, c, d, a, x[k + 14], S34, 0xFDE5380C);
    a = hh(a, b, c, d, x[k + 1], S31, 0xA4BEEA44);
    d = hh(d, a, b, c, x[k + 4], S32, 0x4BDECFA9);
    c = hh(c, d, a, b, x[k + 7], S33, 0xF6BB4B60);
    b = hh(b, c, d, a, x[k + 10], S34, 0xBEBFBC70);
    a = hh(a, b, c, d, x[k + 13], S31, 0x289B7EC6);
    d = hh(d, a, b, c, x[k + 0], S32, 0xEAA127FA);
    c = hh(c, d, a, b, x[k + 3], S33, 0xD4EF3085);
    b = hh(b, c, d, a, x[k + 6], S34, 0x4881D05);
    a = hh(a, b, c, d, x[k + 9], S31, 0xD9D4D039);
    d = hh(d, a, b, c, x[k + 12], S32, 0xE6DB99E5);
    c = hh(c, d, a, b, x[k + 15], S33, 0x1FA27CF8);
    b = hh(b, c, d, a, x[k + 2], S34, 0xC4AC5665);
    a = ii(a, b, c, d, x[k + 0], S41, 0xF4292244);
    d = ii(d, a, b, c, x[k + 7], S42, 0x432AFF97);
    c = ii(c, d, a, b, x[k + 14], S43, 0xAB9423A7);
    b = ii(b, c, d, a, x[k + 5], S44, 0xFC93A039);
    a = ii(a, b, c, d, x[k + 12], S41, 0x655B59C3);
    d = ii(d, a, b, c, x[k + 3], S42, 0x8F0CCC92);
    c = ii(c, d, a, b, x[k + 10], S43, 0xFFEFF47D);
    b = ii(b, c, d, a, x[k + 1], S44, 0x85845DD1);
    a = ii(a, b, c, d, x[k + 8], S41, 0x6FA87E4F);
    d = ii(d, a, b, c, x[k + 15], S42, 0xFE2CE6E0);
    c = ii(c, d, a, b, x[k + 6], S43, 0xA3014314);
    b = ii(b, c, d, a, x[k + 13], S44, 0x4E0811A1);
    a = ii(a, b, c, d, x[k + 4], S41, 0xF7537E82);
    d = ii(d, a, b, c, x[k + 11], S42, 0xBD3AF235);
    c = ii(c, d, a, b, x[k + 2], S43, 0x2AD7D2BB);
    b = ii(b, c, d, a, x[k + 9], S44, 0xEB86D391);
    a = addUnsigned(a, AA);
    b = addUnsigned(b, BB);
    c = addUnsigned(c, CC);
    d = addUnsigned(d, DD);
  }
  return (wordToHex(a) + wordToHex(b) + wordToHex(c) + wordToHex(d)).toLowerCase();
}

// Note: Open Platform API removed - using only mtop API for s.lazada links

// Get Lazada cookies (for future use if needed)
async function getLazadaCookies() {
  try {
    const cookies = await chrome.cookies.getAll({ domain: ".lazada.co.th" });
    if (cookies.length === 0) {
      return { success: false, error: "Not logged in to Lazada" };
    }
    const cookieString = cookies.map(c => `${c.name}=${c.value}`).join("; ");
    return { success: true, cookies: cookieString };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// ============================================
// END LAZADA SECTION
// ============================================

console.log("[Pubilo] Background v9.0 loaded - Ads Token + Cookie only (Post Token removed)");
