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

const indexHtml = read(indexHtmlPath);
const configJs = read(configPath);
const navigationJs = read(navigationPath);

mustInclude(indexHtml, 'id="hidePostsNavItem"', indexHtmlPath, "hide posts nav item", errors);
mustInclude(indexHtml, 'id="deletePostsNavItem"', indexHtmlPath, "delete posts nav item", errors);
mustInclude(indexHtml, 'id="hidePostsPanel"', indexHtmlPath, "hide posts panel", errors);
mustInclude(indexHtml, 'id="deletePostsPanel"', indexHtmlPath, "delete posts panel", errors);

mustInclude(navigationJs, 'hash === "hide-posts"', navigationPath, "hide-posts route", errors);
mustInclude(navigationJs, 'hash === "delete-posts"', navigationPath, "delete-posts route", errors);

const hiddenListMatch = configJs.match(/PUBILO_HIDDEN_HASHES\s*=\s*\[([^\]]*)\]/);
const hiddenListRaw = hiddenListMatch ? hiddenListMatch[1] : "";
if (/\bhide-posts\b/.test(hiddenListRaw) || /\bdelete-posts\b/.test(hiddenListRaw)) {
  errors.push(`${configPath}: hide-posts/delete-posts must not be in PUBILO_HIDDEN_HASHES`);
}

if (errors.length) {
  console.error("[verify-web-delete-tools] FAILED");
  errors.forEach((line) => console.error(`- ${line}`));
  process.exit(1);
}

console.log("[verify-web-delete-tools] OK");
