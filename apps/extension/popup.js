// Pubilo Extension - Popup Script

const skeletonLoader = document.getElementById("skeletonLoader");
const userInfoEl = document.getElementById("userInfo");
const userAvatarEl = document.getElementById("userAvatar");
const userNameEl = document.getElementById("userName");
const userIdEl = document.getElementById("userId");
const openBtn = document.getElementById("openBtn");
const loginBtn = document.getElementById("loginBtn");

// Status badges
const tokenBadge = document.getElementById("tokenBadge");
const cookieBadge = document.getElementById("cookieBadge");

let cookieData = null;

function createSvgIcon(type) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");

  if (type === "check") {
    const path1 = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path1.setAttribute("d", "M22 11.08V12a10 10 0 1 1-5.93-9.14");
    const path2 = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
    path2.setAttribute("points", "22 4 12 14.01 9 11.01");
    svg.appendChild(path1);
    svg.appendChild(path2);
  } else if (type === "error") {
    const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    circle.setAttribute("cx", "12");
    circle.setAttribute("cy", "12");
    circle.setAttribute("r", "10");
    const line1 = document.createElementNS("http://www.w3.org/2000/svg", "line");
    line1.setAttribute("x1", "15");
    line1.setAttribute("y1", "9");
    line1.setAttribute("x2", "9");
    line1.setAttribute("y2", "15");
    const line2 = document.createElementNS("http://www.w3.org/2000/svg", "line");
    line2.setAttribute("x1", "9");
    line2.setAttribute("y1", "9");
    line2.setAttribute("x2", "15");
    line2.setAttribute("y2", "15");
    svg.appendChild(circle);
    svg.appendChild(line1);
    svg.appendChild(line2);
  } else {
    const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    circle.setAttribute("cx", "12");
    circle.setAttribute("cy", "12");
    circle.setAttribute("r", "10");
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", "M12 6v6l4 2");
    svg.appendChild(circle);
    svg.appendChild(path);
  }
  return svg;
}

function updateBadge(badge, status, label) {
  badge.className = "status-badge " + status;
  badge.textContent = "";
  const iconType = status === "loading" ? "loading" : status === "" ? "check" : "error";
  badge.appendChild(createSvgIcon(iconType));
  badge.appendChild(document.createTextNode(" " + label));
}

function showUserInfo() {
  skeletonLoader.classList.add("hidden");
  userInfoEl.classList.remove("hidden");
}

function hideUserInfo() {
  skeletonLoader.classList.add("hidden");
  userInfoEl.classList.add("hidden");
}

// Cache intervals
const CACHE_COOKIE_TOKEN = 60 * 60 * 1000; // 1 hour

// Show cached data immediately on load
chrome.storage.local.get(["fewfeed_accessToken", "fewfeed_cookie", "fewfeed_userName", "fewfeed_userId", "fewfeed_avatarUrl"], (data) => {
  if (data.fewfeed_accessToken) {
    // Show badges immediately
    updateBadge(tokenBadge, "", "Token");
    updateBadge(cookieBadge, data.fewfeed_cookie ? "" : "error", "Cookie");

    // Show user info
    userNameEl.textContent = data.fewfeed_userName || "Facebook User";
    userIdEl.textContent = "ID: " + (data.fewfeed_userId || "");
    if (data.fewfeed_avatarUrl) userAvatarEl.src = data.fewfeed_avatarUrl;
    showUserInfo();
    loginBtn.classList.add("hidden");
  }
});

// Check Facebook login status on popup open
async function checkStatus() {
  try {
    // Get cached data first - show immediately
    let tokenResponse = await chrome.runtime.sendMessage({ action: "getStoredData" });
    const { fewfeed_lastFetch, fewfeed_avatarUrl } = await chrome.storage.local.get(["fewfeed_lastFetch", "fewfeed_avatarUrl"]);
    const now = Date.now();

    // Show cached data immediately
    if (tokenResponse?.fewfeed_accessToken) {
      updateBadge(tokenBadge, "", "Token");
      updateBadge(cookieBadge, tokenResponse.fewfeed_cookie ? "" : "error", "Cookie");

      // Show user info from cache
      const data = await chrome.storage.local.get(["fewfeed_userName"]);
      userNameEl.textContent = data.fewfeed_userName || "Facebook User";
      userIdEl.textContent = "ID: " + (tokenResponse.fewfeed_userId || tokenResponse.userId || "");
      if (fewfeed_avatarUrl) userAvatarEl.src = fewfeed_avatarUrl;
      showUserInfo();
      loginBtn.classList.add("hidden");
    }

    // Check if need to refresh in background (1 hour for token/cookie)
    const needRefresh = !tokenResponse?.fewfeed_accessToken || !fewfeed_lastFetch || (now - fewfeed_lastFetch) > CACHE_COOKIE_TOKEN;

    if (needRefresh) {
      tokenResponse = await chrome.runtime.sendMessage({ action: "fetchToken" });
      await chrome.storage.local.set({ fewfeed_lastFetch: now });
    }
    console.log("[Popup] Token data:", tokenResponse);

    // Update token badge
    if (tokenResponse && tokenResponse.fewfeed_accessToken) {
      updateBadge(tokenBadge, "", "Token");
    } else {
      updateBadge(tokenBadge, "error", "Token");
    }

    // Update cookie badge
    if (tokenResponse && tokenResponse.fewfeed_cookie) {
      updateBadge(cookieBadge, "", "Cookie");
    } else {
      updateBadge(cookieBadge, "error", "Cookie");
    }

    const response = await chrome.runtime.sendMessage({ action: "getFacebookCookies" });

    if (response.success) {
      cookieData = response;

      // Get stored data including user name
      const data = await chrome.storage.local.get(["fewfeed_accessToken", "fewfeed_userName", "fewfeed_avatarUrl"]);

      // Set user name
      userNameEl.textContent = data.fewfeed_userName || "Facebook User";
      userIdEl.textContent = "ID: " + response.userId;

      // Use cached avatar URL if available
      if (data.fewfeed_avatarUrl) {
        userAvatarEl.src = data.fewfeed_avatarUrl;
      }

      showUserInfo();
      loginBtn.classList.add("hidden");
    } else {
      hideUserInfo();
      openBtn.classList.add("hidden");
      loginBtn.classList.remove("hidden");
    }
  } catch (error) {
    console.error("[Popup] Error:", error);
    updateBadge(tokenBadge, "error", "Token");
    updateBadge(cookieBadge, "error", "Cookie");
    hideUserInfo();
    loginBtn.classList.remove("hidden");
  }
}

// Open Pubilo with cookie data
openBtn.addEventListener("click", async () => {
  // Get cookie data directly if not cached
  let data = cookieData;
  if (!data) {
    const response = await chrome.runtime.sendMessage({ action: "getFacebookCookies" });
    if (response.success) data = response;
  }

  if (data) {
    await chrome.storage.local.set({
      fewfeed_cookie: data.cookie,
      fewfeed_userId: data.userId,
      fewfeed_ready: true
    });
  }

  // Open Pubilo
  chrome.tabs.create({ url: "https://pubilo-web-prod.pages.dev/" }, () => {
    window.close();
  });
});

// Open Facebook login
loginBtn.addEventListener("click", () => {
  chrome.tabs.create({ url: "https://www.facebook.com/" });
  window.close();
});

// Run on popup open
checkStatus();
