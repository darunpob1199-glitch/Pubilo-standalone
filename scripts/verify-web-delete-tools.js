#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();

function read(relPath) {
  return readFileSync(join(root, relPath), "utf8");
}

function mustInclude(content, needle, filePath, label, errors) {
  if (!content.includes(needle)) {
    errors.push(`${filePath}: missing ${label}`);
  }
}

const errors = [];

const indexHtmlPath = "apps/web/index.html";
const configPath = "apps/web/js/config.js";
const navigationPath = "apps/web/js/parts/09-navigation.js";
const postToolsPath = "apps/web/js/parts/08-post-tools.js";
const apiIndexPath = "apps/api/src/index.ts";
const apiSharePostsPath = "apps/api/src/routes/share-posts.ts";
const apiPublishedPostsPath = "apps/api/src/routes/published-posts.ts";
const webWorkerPath = "apps/web/_worker.js";

const indexHtml = read(indexHtmlPath);
const configJs = read(configPath);
const navigationJs = read(navigationPath);
const postToolsJs = read(postToolsPath);
const apiIndexTs = read(apiIndexPath);
const apiSharePostsTs = read(apiSharePostsPath);
const apiPublishedPostsTs = read(apiPublishedPostsPath);
const webWorkerJs = read(webWorkerPath);

mustInclude(indexHtml, 'id="hidePostsNavItem"', indexHtmlPath, "hide posts nav item", errors);
mustInclude(indexHtml, 'id="deletePostsNavItem"', indexHtmlPath, "delete posts nav item", errors);
mustInclude(indexHtml, 'id="sharePostsNavItem"', indexHtmlPath, "share posts nav item", errors);
mustInclude(indexHtml, 'id="hidePostsPanel"', indexHtmlPath, "hide posts panel", errors);
mustInclude(indexHtml, 'id="deletePostsPanel"', indexHtmlPath, "delete posts panel", errors);
mustInclude(indexHtml, 'id="sharePostsPanel"', indexHtmlPath, "share posts panel", errors);

mustInclude(navigationJs, 'hash === "hide-posts"', navigationPath, "hide-posts route", errors);
mustInclude(navigationJs, 'hash === "delete-posts"', navigationPath, "delete-posts route", errors);
mustInclude(navigationJs, 'hash === "share-posts"', navigationPath, "share-posts route", errors);
mustInclude(postToolsJs, 'fetch("/api/share-posts"', postToolsPath, "share posts API call", errors);
mustInclude(postToolsJs, "runSharePostToolSameOriginFallback", postToolsPath, "share posts same-origin fallback", errors);
mustInclude(postToolsJs, 'allowHistoryFallback = !pageId;', postToolsPath, "share posts disables history fallback when page is selected", errors);
mustInclude(postToolsJs, 'excludeDeleted = true;', postToolsPath, "post tools exclude deleted posts", errors);
mustInclude(apiIndexTs, "app.route('/api/share-posts', sharePostsRouter)", apiIndexPath, "share posts API route", errors);
mustInclude(apiSharePostsTs, "shareOrCopyPostToPage", apiSharePostsPath, "share posts copy fallback", errors);
mustInclude(apiPublishedPostsTs, "function filterDeletedPublishedResult", apiPublishedPostsPath, "published posts deleted filter", errors);
mustInclude(apiPublishedPostsTs, "allowHistoryFallback === false", apiPublishedPostsPath, "published posts history fallback opt-out", errors);
mustInclude(webWorkerJs, 'url.pathname === "/api/share-posts"', webWorkerPath, "share posts web worker route", errors);
mustInclude(webWorkerJs, "shareOrCopyPostToPage", webWorkerPath, "share posts web worker copy fallback", errors);

const hiddenListMatch = configJs.match(/PUBILO_HIDDEN_HASHES\s*=\s*\[([^\]]*)\]/);
const hiddenListRaw = hiddenListMatch ? hiddenListMatch[1] : "";
if (/\bhide-posts\b/.test(hiddenListRaw) || /\bdelete-posts\b/.test(hiddenListRaw) || /\bshare-posts\b/.test(hiddenListRaw)) {
  errors.push(`${configPath}: hide-posts/delete-posts/share-posts must not be in PUBILO_HIDDEN_HASHES`);
}

if (errors.length) {
  console.error("[verify-web-delete-tools] FAILED");
  errors.forEach((line) => console.error(`- ${line}`));
  process.exit(1);
}

console.log("[verify-web-delete-tools] OK");
