// 10. PUBLISH
// ============================================
let lastPublishedUrl = null;
const TEXT_BACKGROUND_STORAGE_KEY_PREFIX = "fewfeed_textBackgroundPreset_";
const WORKSPACE_FACEBOOK_SESSION_MAP_KEY = "fewfeed_workspaceFacebookSessions_v1";
const SHOW_FACEBOOK_CONNECT_BANNER = false;
let hasSeenExtensionReadySignal = false;
let extensionMissingHintShown = false;
const publishSessionRefreshRetryByMode = Object.create(null);
let lastPersistedFacebookSessionSignature = "";
let workspaceFacebookBootstrapPromise = null;

function getHideOnPublishEnabledSnapshot() {
    const input = document.getElementById("hideOnPublishEnabled");
    return !!input?.checked;
}

const DEFAULT_TEXT_BACKGROUND_OPTIONS = [
    {
        id: "1881421442117417",
        label: "ดำ",
        swatch: "linear-gradient(135deg, #0f172a 0%, #111827 100%)",
        preview: "linear-gradient(135deg, #0f172a 0%, #111827 100%)",
        textColor: "#f8fafc",
    },
    {
        id: "145893972683590",
        label: "ม่วงเข้ม",
        swatch: "linear-gradient(135deg, #111827 0%, #312e81 50%, #581c87 100%)",
        preview: "linear-gradient(135deg, #111827 0%, #312e81 50%, #581c87 100%)",
        textColor: "#f8fafc",
    },
    {
        id: "1777259169190672",
        label: "ชมพูนีออน",
        swatch: "linear-gradient(135deg, #6d28d9 0%, #ec4899 55%, #fb7185 100%)",
        preview: "linear-gradient(135deg, #6d28d9 0%, #ec4899 55%, #fb7185 100%)",
        textColor: "#fff7fb",
    },
    {
        id: "688479024672716",
        label: "เขียวฟ้า",
        swatch: "linear-gradient(135deg, #d1fae5 0%, #6ee7b7 45%, #22d3ee 100%)",
        preview: "linear-gradient(135deg, #d1fae5 0%, #6ee7b7 45%, #22d3ee 100%)",
        textColor: "#052e16",
    },
    {
        id: "1941912679424590",
        label: "กราไฟต์",
        swatch: "linear-gradient(135deg, #475569 0%, #1f2937 100%)",
        preview: "linear-gradient(135deg, #475569 0%, #1f2937 100%)",
        textColor: "#f8fafc",
    },
    {
        id: "901751159967576",
        label: "ส้มแดง",
        swatch: "linear-gradient(135deg, #fb923c 0%, #ef4444 100%)",
        preview: "linear-gradient(135deg, #fb923c 0%, #ef4444 100%)",
        textColor: "#fff7ed",
    },
    {
        id: "204187940028597",
        label: "แดงสด",
        swatch: "linear-gradient(135deg, #ef4444 0%, #dc2626 100%)",
        preview: "linear-gradient(135deg, #ef4444 0%, #dc2626 100%)",
        textColor: "#fff7f7",
    },
    {
        id: "301029513638534",
        label: "เขียวมิ้นท์",
        swatch: "linear-gradient(135deg, #99f6e4 0%, #14b8a6 100%)",
        preview: "linear-gradient(135deg, #99f6e4 0%, #14b8a6 100%)",
        textColor: "#042f2e",
    },
    {
        id: "175493843120364",
        label: "ลูกกวาด",
        swatch: "linear-gradient(135deg, #fbcfe8 0%, #fef3c7 50%, #bfdbfe 100%)",
        preview: "linear-gradient(135deg, #fbcfe8 0%, #fef3c7 50%, #bfdbfe 100%)",
        textColor: "#111827",
    },
    {
        id: "177465482945164",
        label: "ม่วงอ่อน",
        swatch: "linear-gradient(135deg, #ddd6fe 0%, #c4b5fd 100%)",
        preview: "linear-gradient(135deg, #ddd6fe 0%, #c4b5fd 100%)",
        textColor: "#312e81",
    },
    {
        id: "518948401838663",
        label: "หัวใจชมพู",
        swatch: "linear-gradient(135deg, #fbcfe8 0%, #f9a8d4 100%)",
        preview: "linear-gradient(135deg, #fbcfe8 0%, #f9a8d4 100%)",
        textColor: "#831843",
    },
    {
        id: "1679248482160767",
        label: "ฟ้าอ่อน",
        swatch: "linear-gradient(135deg, #e0f2fe 0%, #bae6fd 100%)",
        preview: "linear-gradient(135deg, #e0f2fe 0%, #bae6fd 100%)",
        textColor: "#0c4a6e",
    },
    {
        id: "106018623298955",
        label: "ม่วงสด",
        swatch: "linear-gradient(135deg, #7c3aed 0%, #a855f7 100%)",
        preview: "linear-gradient(135deg, #7c3aed 0%, #a855f7 100%)",
        textColor: "#faf5ff",
    },
    {
        id: "365653833956649",
        label: "สวนชมพู",
        swatch: "linear-gradient(135deg, #fbcfe8 0%, #f9a8d4 45%, #c4b5fd 100%)",
        preview: "linear-gradient(135deg, #fbcfe8 0%, #f9a8d4 45%, #c4b5fd 100%)",
        textColor: "#831843",
    },
    {
        id: "618093735238824",
        label: "น้ำตาลอุ่น",
        swatch: "linear-gradient(135deg, #f5d0a9 0%, #d6a97d 100%)",
        preview: "linear-gradient(135deg, #f5d0a9 0%, #d6a97d 100%)",
        textColor: "#422006",
    },
    {
        id: "191761991491375",
        label: "หัวใจ 3D",
        swatch: "linear-gradient(135deg, #fecdd3 0%, #fb7185 100%)",
        preview: "linear-gradient(135deg, #fecdd3 0%, #fb7185 100%)",
        textColor: "#881337",
    },
    {
        id: "2193627793985415",
        label: "อีโมจิหัวใจ",
        swatch: "linear-gradient(135deg, #f9a8d4 0%, #fb7185 50%, #f97316 100%)",
        preview: "linear-gradient(135deg, #f9a8d4 0%, #fb7185 50%, #f97316 100%)",
        textColor: "#fff7ed",
    },
    {
        id: "200521337465306",
        label: "ไฟลุก",
        swatch: "linear-gradient(135deg, #fb923c 0%, #ef4444 60%, #7f1d1d 100%)",
        preview: "linear-gradient(135deg, #fb923c 0%, #ef4444 60%, #7f1d1d 100%)",
        textColor: "#fff7ed",
    },
    {
        id: "1821844087883360",
        label: "เหลืองเดินเล่น",
        swatch: "linear-gradient(135deg, #fde68a 0%, #facc15 100%)",
        preview: "linear-gradient(135deg, #fde68a 0%, #facc15 100%)",
        textColor: "#713f12",
    },
    {
        id: "160419724814650",
        label: "พีชพาสเทล",
        swatch: "linear-gradient(135deg, #fdba74 0%, #fca5a5 100%)",
        preview: "linear-gradient(135deg, #fdba74 0%, #fca5a5 100%)",
        textColor: "#7c2d12",
    },
    {
        id: "248623902401250",
        label: "ยิ้ม 3D",
        swatch: "linear-gradient(135deg, #fde68a 0%, #fb7185 100%)",
        preview: "linear-gradient(135deg, #fde68a 0%, #fb7185 100%)",
        textColor: "#7c2d12",
    },
    {
        id: "1868855943417360",
        label: "ฮา 3D",
        swatch: "linear-gradient(135deg, #fef08a 0%, #f59e0b 55%, #f97316 100%)",
        preview: "linear-gradient(135deg, #fef08a 0%, #f59e0b 55%, #f97316 100%)",
        textColor: "#78350f",
    },
    {
        id: "255989551804163",
        label: "ตาชมพู",
        swatch: "linear-gradient(135deg, #fbcfe8 0%, #f9a8d4 100%)",
        preview: "linear-gradient(135deg, #fbcfe8 0%, #f9a8d4 100%)",
        textColor: "#831843",
    },
    {
        id: "174496469882866",
        label: "เลมอน",
        swatch: "linear-gradient(135deg, #fef9c3 0%, #fde047 100%)",
        preview: "linear-gradient(135deg, #fef9c3 0%, #fde047 100%)",
        textColor: "#713f12",
    },
    {
        id: "862667370603267",
        label: "ไข่ครีม",
        swatch: "linear-gradient(135deg, #fff7ed 0%, #fde68a 100%)",
        preview: "linear-gradient(135deg, #fff7ed 0%, #fde68a 100%)",
        textColor: "#78350f",
    },
    {
        id: "143093446467972",
        label: "เมฆน้ำเงิน",
        swatch: "linear-gradient(135deg, #0f172a 0%, #1d4ed8 100%)",
        preview: "linear-gradient(135deg, #0f172a 0%, #1d4ed8 100%)",
        textColor: "#eff6ff",
    },
    {
        id: "161409924510923",
        label: "จรวดหัวใจ",
        swatch: "linear-gradient(135deg, #0ea5e9 0%, #6366f1 50%, #ec4899 100%)",
        preview: "linear-gradient(135deg, #0ea5e9 0%, #6366f1 50%, #ec4899 100%)",
        textColor: "#f8fafc",
    },
    {
        id: "217761075370932",
        label: "น้ำเงินสด",
        swatch: "linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%)",
        preview: "linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%)",
        textColor: "#eff6ff",
    },
    {
        id: "931584293685988",
        label: "คลื่นน้ำเงิน",
        swatch: "linear-gradient(135deg, #93c5fd 0%, #3b82f6 45%, #312e81 100%)",
        preview: "linear-gradient(135deg, #93c5fd 0%, #3b82f6 45%, #312e81 100%)",
        textColor: "#eff6ff",
    },
    {
        id: "100114277230063",
        label: "ทะเลลึก",
        swatch: "linear-gradient(135deg, #0f172a 0%, #1e3a8a 50%, #0f766e 100%)",
        preview: "linear-gradient(135deg, #0f172a 0%, #1e3a8a 50%, #0f766e 100%)",
        textColor: "#ecfeff",
    },
    {
        id: "643122496026756",
        label: "ชมพูฟุ้ง",
        swatch: "linear-gradient(135deg, #fce7f3 0%, #fbcfe8 100%)",
        preview: "linear-gradient(135deg, #fce7f3 0%, #fbcfe8 100%)",
        textColor: "#831843",
    },
    {
        id: "228164237768720",
        label: "หัวใจเทา",
        swatch: "linear-gradient(135deg, #1f2937 0%, #4b5563 100%)",
        preview: "linear-gradient(135deg, #1f2937 0%, #4b5563 100%)",
        textColor: "#f9fafb",
    },
    {
        id: "249307305544279",
        label: "แดงน้ำเงิน",
        swatch: "linear-gradient(135deg, #ef4444 0%, #3b82f6 100%)",
        preview: "linear-gradient(135deg, #ef4444 0%, #3b82f6 100%)",
        textColor: "#f8fafc",
    },
    {
        id: "219266485227663",
        label: "แมเจนตา",
        swatch: "linear-gradient(135deg, #ec4899 0%, #db2777 100%)",
        preview: "linear-gradient(135deg, #ec4899 0%, #db2777 100%)",
        textColor: "#fff7fb",
    },
    {
        id: "1365883126823705",
        label: "น้ำเงินเข้ม",
        swatch: "linear-gradient(135deg, #1d4ed8 0%, #1e40af 100%)",
        preview: "linear-gradient(135deg, #1d4ed8 0%, #1e40af 100%)",
        textColor: "#eff6ff",
    },
];

function getTextModeState() {
    if (!modeState.text) {
        modeState.text = {
            selectedBackgroundPresetId: "",
            isBackgroundManagerOpen: false,
        };
    }
    return modeState.text;
}

function getTextBackgroundStorageKey(pageId) {
    return `${TEXT_BACKGROUND_STORAGE_KEY_PREFIX}${pageId}`;
}

function hashTextPresetId(value) {
    let hash = 0;
    const input = String(value || "");
    for (let index = 0; index < input.length; index += 1) {
        hash = (hash * 31 + input.charCodeAt(index)) >>> 0;
    }
    return hash;
}

function getTextBackgroundTheme(presetId) {
    const option = DEFAULT_TEXT_BACKGROUND_OPTIONS.find((item) => item.id === String(presetId || "").trim());
    if (option) {
        return {
            swatch: option.swatch,
            preview: option.preview,
            textColor: option.textColor,
        };
    }

    const fallbacks = [
        { swatch: "linear-gradient(135deg, #f7f6ff 0%, #dbeafe 100%)", preview: "linear-gradient(135deg, #f7f6ff 0%, #dbeafe 100%)", textColor: "#111827" },
        { swatch: "linear-gradient(135deg, #dbeafe 0%, #93c5fd 45%, #c4b5fd 100%)", preview: "linear-gradient(135deg, #dbeafe 0%, #93c5fd 45%, #c4b5fd 100%)", textColor: "#111827" },
        { swatch: "linear-gradient(135deg, #fee2e2 0%, #fecdd3 50%, #f9a8d4 100%)", preview: "linear-gradient(135deg, #fee2e2 0%, #fecdd3 50%, #f9a8d4 100%)", textColor: "#111827" },
        { swatch: "linear-gradient(135deg, #0f172a 0%, #1e1b4b 55%, #312e81 100%)", preview: "linear-gradient(135deg, #0f172a 0%, #1e1b4b 55%, #312e81 100%)", textColor: "#f8fafc" },
        { swatch: "linear-gradient(135deg, #fef3c7 0%, #fdba74 100%)", preview: "linear-gradient(135deg, #fef3c7 0%, #fdba74 100%)", textColor: "#111827" },
        { swatch: "linear-gradient(135deg, #d1fae5 0%, #6ee7b7 45%, #34d399 100%)", preview: "linear-gradient(135deg, #d1fae5 0%, #6ee7b7 45%, #34d399 100%)", textColor: "#052e16" },
        { swatch: "linear-gradient(135deg, #f5d0fe 0%, #c4b5fd 45%, #93c5fd 100%)", preview: "linear-gradient(135deg, #f5d0fe 0%, #c4b5fd 45%, #93c5fd 100%)", textColor: "#111827" },
        { swatch: "linear-gradient(135deg, #f1f5f9 0%, #cbd5e1 100%)", preview: "linear-gradient(135deg, #f1f5f9 0%, #cbd5e1 100%)", textColor: "#0f172a" },
        { swatch: "linear-gradient(135deg, #111827 0%, #374151 100%)", preview: "linear-gradient(135deg, #111827 0%, #374151 100%)", textColor: "#f9fafb" },
        { swatch: "linear-gradient(135deg, #ffe4e6 0%, #fef3c7 45%, #d9f99d 100%)", preview: "linear-gradient(135deg, #ffe4e6 0%, #fef3c7 45%, #d9f99d 100%)", textColor: "#111827" },
    ];
    const index = hashTextPresetId(presetId) % fallbacks.length;
    return fallbacks[index];
}

function escapeTextBackgroundHtml(value) {
    return String(value || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function getDefaultTextBackgroundOptions() {
    return DEFAULT_TEXT_BACKGROUND_OPTIONS.map((option) => ({ ...option }));
}

function getSavedCustomTextBackgroundPresets() {
    const builtInIds = new Set(getDefaultTextBackgroundOptions().map((item) => item.id));
    return Array.isArray(currentPresets)
        ? currentPresets
            .map((preset) => String(preset || "").trim())
            .filter(Boolean)
            .filter((presetId) => !builtInIds.has(presetId))
        : [];
}

function getConfiguredTextBackgroundPresets() {
    const defaults = getDefaultTextBackgroundOptions();
    const customPresets = getSavedCustomTextBackgroundPresets();

    return [
        ...defaults,
        ...customPresets.map((presetId) => ({
            id: presetId,
            label: `พิเศษ ${presetId.slice(-4)}`,
            ...getTextBackgroundTheme(presetId),
            isCustom: true,
        })),
    ];
}

function getTextBackgroundOptionById(presetId) {
    return getConfiguredTextBackgroundPresets().find(
        (option) => option.id === String(presetId || "").trim(),
    ) || null;
}

function getStoredTextBackgroundPresetId(pageId) {
    if (!pageId) return "";
    return localStorage.getItem(getTextBackgroundStorageKey(pageId)) || "";
}

function persistTextBackgroundPresetId(pageId, presetId) {
    if (!pageId) return;
    const key = getTextBackgroundStorageKey(pageId);
    if (presetId) {
        localStorage.setItem(key, presetId);
    } else {
        localStorage.removeItem(key);
    }
}

function getActiveTextBackgroundPresetId() {
    const state = getTextModeState();
    return String(state.selectedBackgroundPresetId || "").trim();
}

function setActiveTextBackgroundPresetId(presetId) {
    const pageId = getCurrentPageId();
    const state = getTextModeState();
    const nextPresetId = String(presetId || "").trim();
    state.selectedBackgroundPresetId = nextPresetId;
    persistTextBackgroundPresetId(pageId, nextPresetId);
}

function syncTextBackgroundSelection() {
    const pageId = getCurrentPageId();
    const state = getTextModeState();
    const presets = getConfiguredTextBackgroundPresets();
    const presetIds = new Set(presets.map((preset) => preset.id));

    if (!presets.length) {
        state.selectedBackgroundPresetId = "";
        return;
    }

    const currentPresetId = String(state.selectedBackgroundPresetId || "").trim();
    if (currentPresetId && presetIds.has(currentPresetId)) {
        return;
    }

    const storedPresetId = getStoredTextBackgroundPresetId(pageId);
    state.selectedBackgroundPresetId = storedPresetId && presetIds.has(storedPresetId) ? storedPresetId : "";
}

async function persistTextBackgroundCatalog(customPresetIds) {
    const pageId = getCurrentPageId();
    if (!pageId) {
        throw new Error("กรุณาเลือกเพจหลักก่อน");
    }

    const normalizedIds = Array.from(
        new Set(
            (customPresetIds || [])
                .map((presetId) => String(presetId || "").trim())
                .filter(Boolean),
        ),
    );

    const pageName = document.querySelector(".page-selector-name")?.textContent?.trim() || undefined;
    const response = await fetch("/api/page-settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            pageId,
            pageName,
            colorBgPresets: normalizedIds.join(","),
        }),
    });
    const data = await response.json();
    if (!response.ok || !data.success) {
        throw new Error(data.error || "บันทึกรหัสพื้นหลังไม่สำเร็จ");
    }

    currentPresets = normalizedIds;
    if (typeof renderPresets === "function") {
        renderPresets();
    }
}

function renderTextBackgroundManager() {
    const manager = document.getElementById("textBackgroundManager");
    const input = document.getElementById("textBackgroundPresetInput");
    const list = document.getElementById("textBackgroundSavedList");
    if (!manager || !input || !list) return;

    const state = getTextModeState();
    manager.hidden = !state.isBackgroundManagerOpen;

    const customPresets = getSavedCustomTextBackgroundPresets();
    if (!customPresets.length) {
        list.innerHTML = '<div class="text-background-empty">ยังไม่มีพื้นหลังเพิ่มเอง</div>';
        return;
    }

    list.innerHTML = customPresets.map((presetId) => `
        <span class="text-background-saved-chip">
            <span>${escapeTextBackgroundHtml(presetId)}</span>
            <button
                type="button"
                class="text-background-saved-remove"
                data-preset-id="${escapeTextBackgroundHtml(presetId)}"
                aria-label="ลบรหัสพื้นหลัง ${escapeTextBackgroundHtml(presetId)}"
            >×</button>
        </span>
    `).join("");
    input.value = "";
}

function renderTextBackgroundPicker() {
    const grid = document.getElementById("textBackgroundGrid");
    const help = document.getElementById("textBackgroundHelp");
    const summary = document.getElementById("textBackgroundSummary");
    const source = document.getElementById("textBackgroundSource");
    if (!grid || !help || !summary || !source) return;

    syncTextBackgroundSelection();

    const presets = getConfiguredTextBackgroundPresets();
    const activePresetId = getActiveTextBackgroundPresetId();
    const activePreset = getTextBackgroundOptionById(activePresetId);
    const builtInCount = getDefaultTextBackgroundOptions().length;
    const customCount = getSavedCustomTextBackgroundPresets().length;
    const totalCount = builtInCount + customCount;

    summary.textContent = activePreset
        ? `เลือกแล้ว: ${activePreset.label}`
        : "โพสต์แบบพื้นหลังปกติ";
    source.textContent = `มีพื้นหลังพร้อมใช้ ${totalCount} แบบ`;
    help.textContent = "แตะการ์ดเพื่อเลือกพื้นหลังได้จากหน้านี้เลย";

    const items = [
        {
            id: "",
            label: "ไม่ใช้พื้นหลัง",
            swatch: "linear-gradient(135deg, #ffffff 0%, #f3f4f6 100%)",
        },
        ...presets.map((preset) => ({
            id: preset.id,
            label: preset.label,
            swatch: preset.swatch,
            isCustom: !!preset.isCustom,
        })),
    ];

    grid.innerHTML = items.map((item) => `
        <button
            type="button"
            class="text-background-option${item.id === activePresetId ? " is-selected" : ""}${!item.id ? " is-neutral" : ""}"
            data-preset-id="${item.id}"
        >
            <span class="text-background-swatch" style="background: ${item.swatch};"></span>
            <span class="text-background-option-check">✓</span>
            <span class="text-background-option-label">${item.label}</span>
        </button>
    `).join("");
}

function renderTextComposerPreview() {
    const preview = document.getElementById("textPreviewContent");
    const surface = document.getElementById("textPreviewSurface");
    const badge = document.getElementById("textBackgroundBadge");
    const textarea = document.getElementById("textPrimaryText");
    if (!preview || !surface || !badge || !textarea) return;

    syncTextBackgroundSelection();

    const value = textarea.value.trim();
    const activePresetId = getActiveTextBackgroundPresetId();
    const activePreset = getTextBackgroundOptionById(activePresetId);
    const theme = activePresetId ? getTextBackgroundTheme(activePresetId) : null;

    preview.textContent = value || "พิมพ์ข้อความในช่องด้านขวาเพื่อดูตัวอย่างโพสต์";
    preview.style.opacity = value ? "1" : "0.72";
    preview.style.color = theme?.textColor || "#111827";

    surface.style.background = theme?.preview || "#ffffff";
    surface.style.color = theme?.textColor || "#111827";
    surface.style.boxShadow = theme
        ? "inset 0 0 0 1px rgba(255,255,255,0.18)"
        : "inset 0 0 0 1px rgba(15, 23, 42, 0.06)";

    badge.textContent = activePreset ? activePreset.label : "ไม่มีพื้นหลัง";
}

function renderTextComposerUi() {
    renderTextBackgroundPicker();
    renderTextComposerPreview();
}

const TEXT_POST_EXPORT_SIZE = 1080;
const TEXT_POST_EXPORT_PADDING = 120;
const TEXT_POST_EXPORT_MAX_LINES = 10;

function buildCanvasGradientFromCss(ctx, cssValue, size) {
    const value = String(cssValue || "").trim();
    if (!value.toLowerCase().includes("linear-gradient(")) {
        return null;
    }

    const stops = [];
    const stopRegex = /(#[0-9a-fA-F]{3,8})(?:\s+([0-9.]+)%?)?/g;
    let stopMatch;
    while ((stopMatch = stopRegex.exec(value)) !== null) {
        stops.push({
            color: stopMatch[1],
            position: Number.isFinite(Number(stopMatch[2]))
                ? Number(stopMatch[2])
                : null,
        });
    }

    if (!stops.length) {
        return null;
    }

    const angleMatch = value.match(/(-?\d+(?:\.\d+)?)deg/i);
    const angleDeg = angleMatch ? Number(angleMatch[1]) : 135;
    const radians = ((angleDeg - 90) * Math.PI) / 180;
    const halfSpan = (size * Math.SQRT2) / 2;
    const center = size / 2;
    const dx = Math.cos(radians) * halfSpan;
    const dy = Math.sin(radians) * halfSpan;
    const gradient = ctx.createLinearGradient(
        center - dx,
        center - dy,
        center + dx,
        center + dy,
    );

    if (stops.length === 1) {
        gradient.addColorStop(0, stops[0].color);
        gradient.addColorStop(1, stops[0].color);
        return gradient;
    }

    const allHasPosition = stops.every((stop) => Number.isFinite(stop.position));
    stops.forEach((stop, index) => {
        const position = allHasPosition
            ? Math.max(0, Math.min(1, Number(stop.position) / 100))
            : index / (stops.length - 1);
        gradient.addColorStop(position, stop.color);
    });

    return gradient;
}

function buildTextLinesForCanvas(ctx, text, maxWidth, fontSizePx) {
    ctx.font = `700 ${fontSizePx}px "Noto Sans Thai", "Prompt", "Sarabun", "Inter", sans-serif`;
    const normalized = String(text || "").replace(/\r\n?/g, "\n");
    const paragraphs = normalized.split("\n");
    const lines = [];

    paragraphs.forEach((paragraphRaw, paragraphIndex) => {
        const paragraph = paragraphRaw.replace(/\s+$/g, "");
        if (!paragraph.trim()) {
            if (paragraphIndex !== paragraphs.length - 1) {
                lines.push("");
            }
            return;
        }

        let current = "";
        Array.from(paragraph).forEach((char) => {
            const candidate = `${current}${char}`;
            if (!current || ctx.measureText(candidate).width <= maxWidth) {
                current = candidate;
                return;
            }

            lines.push(current.replace(/\s+$/g, ""));
            current = char === " " ? "" : char;
        });

        if (current.trim()) {
            lines.push(current.replace(/\s+$/g, ""));
        }
    });

    return lines.length ? lines : [""];
}

function renderTextPostSquareImageDataUrl(text, presetId) {
    const canvas = document.createElement("canvas");
    canvas.width = TEXT_POST_EXPORT_SIZE;
    canvas.height = TEXT_POST_EXPORT_SIZE;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
        throw new Error("ไม่สามารถสร้างภาพสำหรับโพสต์ได้");
    }

    const activePresetId = String(presetId || "").trim();
    const theme = activePresetId
        ? getTextBackgroundTheme(activePresetId)
        : null;
    const backgroundValue = theme?.preview || "#ffffff";
    const gradientFill = buildCanvasGradientFromCss(
        ctx,
        backgroundValue,
        TEXT_POST_EXPORT_SIZE,
    );

    ctx.fillStyle = gradientFill || backgroundValue;
    ctx.fillRect(0, 0, TEXT_POST_EXPORT_SIZE, TEXT_POST_EXPORT_SIZE);

    const content = String(text || "").trim();
    const glyphCount = Array.from(content.replace(/\s+/g, "")).length;
    let fontSize = 88;
    if (glyphCount > 220) fontSize = 42;
    else if (glyphCount > 170) fontSize = 50;
    else if (glyphCount > 130) fontSize = 58;
    else if (glyphCount > 95) fontSize = 66;
    else if (glyphCount > 65) fontSize = 74;
    else if (glyphCount > 40) fontSize = 82;

    const maxWidth = TEXT_POST_EXPORT_SIZE - TEXT_POST_EXPORT_PADDING * 2;
    let lines = [];
    let lineHeight = Math.round(fontSize * 1.24);

    for (let attempt = 0; attempt < 14; attempt += 1) {
        lines = buildTextLinesForCanvas(ctx, content, maxWidth, fontSize);
        lineHeight = Math.round(fontSize * 1.24);
        const totalHeight = lines.length * lineHeight;
        const fitsHeight =
            totalHeight <= TEXT_POST_EXPORT_SIZE - TEXT_POST_EXPORT_PADDING * 2;
        const fitsLineCount = lines.length <= TEXT_POST_EXPORT_MAX_LINES;

        if ((fitsHeight && fitsLineCount) || fontSize <= 34) {
            break;
        }

        fontSize -= 4;
    }

    ctx.font = `700 ${fontSize}px "Noto Sans Thai", "Prompt", "Sarabun", "Inter", sans-serif`;
    ctx.fillStyle = theme?.textColor || "#111827";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    const totalHeight = lines.length * lineHeight;
    let y = (TEXT_POST_EXPORT_SIZE - totalHeight) / 2 + lineHeight / 2;
    lines.forEach((line) => {
        ctx.fillText(line || " ", TEXT_POST_EXPORT_SIZE / 2, y, maxWidth);
        y += lineHeight;
    });

    return canvas.toDataURL("image/jpeg", 0.92);
}

async function uploadTextPostSquareImage(dataUrl) {
    const uploadRes = await fetch("/api/upload-image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageData: dataUrl }),
    });
    const uploadData = await uploadRes.json();
    if (!uploadRes.ok || !uploadData?.success || !uploadData?.url) {
        throw new Error(uploadData?.error || "อัปโหลดภาพโพสต์ไม่สำเร็จ");
    }
    return uploadData.url;
}

window.renderTextComposerUi = renderTextComposerUi;
let publishToastTimer = null;
const PUBLISH_IN_FLIGHT_STORAGE_KEY = "fewfeed_publishInFlightState";
const PUBLISH_IN_FLIGHT_MAX_AGE_MS = 2 * 60 * 1000;
const publishInFlightByMode = {
    link: false,
    image: false,
    reels: false,
    text: false,
    news: false,
};

function normalizePublishMode(mode) {
    return String(mode || "link").trim().toLowerCase();
}

function resolvePublishButtonForMode(mode) {
    const normalizedMode = normalizePublishMode(mode);
    if (typeof getModeElements === "function") {
        const elements = getModeElements(normalizedMode);
        if (elements?.publishBtn) return elements.publishBtn;
    }

    if (normalizedMode === "link") return document.getElementById("publishBtn");
    return document.getElementById(`${normalizedMode}PublishBtn`);
}

function persistPublishInFlightState() {
    try {
        const payload = {
            updatedAt: Date.now(),
            modes: publishInFlightByMode,
        };
        sessionStorage.setItem(PUBLISH_IN_FLIGHT_STORAGE_KEY, JSON.stringify(payload));
    } catch (_) {
        // Ignore storage errors in private mode/quota issues.
    }
}

function applyPublishInFlightButtonUi(mode) {
    const publishBtn = resolvePublishButtonForMode(mode);
    if (!publishBtn) return;
    publishBtn.disabled = true;
    publishBtn.style.opacity = "1";
    publishBtn.style.cursor = "wait";
    publishBtn.classList.remove("published");
    publishBtn.innerHTML = '<span class="loading"></span><span>กำลังโพสต์...</span>';
}

function isAnyPublishInFlight() {
    return Object.values(publishInFlightByMode).some(Boolean);
}

function syncPublishInFlightUi() {
    const modes = ["news", "link", "image", "reels", "text"];
    const hasAnyInFlight = isAnyPublishInFlight();
    if (!hasAnyInFlight) return;
    modes.forEach((mode) => applyPublishInFlightButtonUi(mode));
}

function hydratePublishInFlightState() {
    try {
        const raw = sessionStorage.getItem(PUBLISH_IN_FLIGHT_STORAGE_KEY);
        if (!raw) return;
        const parsed = JSON.parse(raw);
        const updatedAt = Number(parsed?.updatedAt || 0);
        if (!updatedAt || Date.now() - updatedAt > PUBLISH_IN_FLIGHT_MAX_AGE_MS) {
            sessionStorage.removeItem(PUBLISH_IN_FLIGHT_STORAGE_KEY);
            return;
        }

        const modes = parsed?.modes || {};
        Object.keys(publishInFlightByMode).forEach((mode) => {
            publishInFlightByMode[mode] = !!modes[mode];
        });
    } catch (_) {
        try {
            sessionStorage.removeItem(PUBLISH_IN_FLIGHT_STORAGE_KEY);
        } catch (_) {}
        Object.keys(publishInFlightByMode).forEach((mode) => {
            publishInFlightByMode[mode] = false;
        });
    }
}

function clearPublishInFlightIfExpired() {
    try {
        const raw = sessionStorage.getItem(PUBLISH_IN_FLIGHT_STORAGE_KEY);
        if (!raw) return;
        const parsed = JSON.parse(raw);
        const updatedAt = Number(parsed?.updatedAt || 0);
        const hasAnyInFlight = Object.keys(publishInFlightByMode).some((mode) => !!publishInFlightByMode[mode]);
        if (!hasAnyInFlight) return;
        if (updatedAt && Date.now() - updatedAt <= PUBLISH_IN_FLIGHT_MAX_AGE_MS) return;

        Object.keys(publishInFlightByMode).forEach((mode) => {
            publishInFlightByMode[mode] = false;
        });
        sessionStorage.removeItem(PUBLISH_IN_FLIGHT_STORAGE_KEY);
        if (typeof updatePublishButton === "function") {
            updatePublishButton();
        }
        if (typeof validateCurrentMode === "function") {
            validateCurrentMode();
        }
    } catch (_) {
        // Ignore storage/runtime errors.
    }
}

function setPublishInFlight(mode, inFlight) {
    const normalizedMode = normalizePublishMode(mode);
    publishInFlightByMode[normalizedMode] = !!inFlight;
    persistPublishInFlightState();
    requestAnimationFrame(() => {
        if (publishInFlightByMode[normalizedMode]) {
            applyPublishInFlightButtonUi(normalizedMode);
        }
    });
}

function isPublishInFlight(mode) {
    const normalizedMode = normalizePublishMode(mode);
    return !!publishInFlightByMode[normalizedMode];
}

window.isPublishInFlight = isPublishInFlight;
window.isAnyPublishInFlight = isAnyPublishInFlight;
window.syncPublishInFlightUi = syncPublishInFlightUi;
window.setPublishInFlightState = (mode, inFlight) => setPublishInFlight(mode, inFlight);
hydratePublishInFlightState();
setTimeout(syncPublishInFlightUi, 0);
setTimeout(clearPublishInFlightIfExpired, 100);
document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
        clearPublishInFlightIfExpired();
    }
});

function showPublishToast(message, type = "success") {
    if (!message) return;

    let toast = document.getElementById("publishToast");
    if (!toast) {
        toast = document.createElement("div");
        toast.id = "publishToast";
        toast.className = "publish-toast";
        document.body.appendChild(toast);
    }

    toast.textContent = message;
    toast.classList.remove("is-success", "is-error", "is-visible");
    toast.classList.add(type === "error" ? "is-error" : "is-success");

    requestAnimationFrame(() => {
        toast.classList.add("is-visible");
    });

    if (publishToastTimer) {
        clearTimeout(publishToastTimer);
    }
    publishToastTimer = setTimeout(() => {
        toast.classList.remove("is-visible");
    }, 2200);
}

window.showPublishToast = showPublishToast;

function restorePublishButtonState(mode, publishBtn) {
    if (!publishBtn) return;
    publishBtn.textContent =
        typeof getPrimaryPublishLabel === "function"
            ? getPrimaryPublishLabel(mode)
            : "POST NOW";
    publishBtn.classList.remove("published");
    publishBtn.disabled = false;
}

function focusPrimaryComposerField(mode, els) {
    let targetField = null;

    if (mode === "news") {
        targetField =
            els?.primaryText ||
            document.getElementById("newsPrimaryText") ||
            document.getElementById("newsUrlInput");
    } else if (mode === "link") {
        targetField = document.getElementById("linkUrl");
    } else if (mode === "text") {
        targetField = els?.primaryText || document.getElementById("textPrimaryText");
    } else if (mode === "image") {
        targetField = els?.primaryText || document.getElementById("imagePrimaryText");
    } else if (mode === "reels") {
        targetField = els?.primaryText || document.getElementById("reelsPrimaryText");
    }

    if (targetField && typeof targetField.focus === "function") {
        targetField.focus();
        if (typeof targetField.select === "function" && (targetField.tagName === "INPUT" || targetField.tagName === "TEXTAREA")) {
            targetField.select();
        }
    }
}

function handleImmediatePublishSuccess(mode, els = null) {
    const modeEls = els || (typeof getModeElements === "function" ? getModeElements(mode) : null);
    const publishBtn = modeEls?.publishBtn || document.getElementById(`${mode}PublishBtn`) || null;

    setTimeout(() => {
        restorePublishButtonState(mode, publishBtn);
        focusPrimaryComposerField(mode, modeEls);
    }, 900);
}

window.handleImmediatePublishSuccess = handleImmediatePublishSuccess;

async function postPublishWithNetworkRecovery(payload, options = {}) {
    const timeoutMs = Number(options.timeoutMs || 35000);

    const runAttempt = async (useNativeDirect) => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
            const url = useNativeDirect
                ? `${window.API_BASE}/api/publish`
                : "/api/publish";
            const fetchImpl =
                useNativeDirect && typeof window.__PUBILO_NATIVE_FETCH__ === "function"
                    ? window.__PUBILO_NATIVE_FETCH__
                    : fetch;

            return await fetchImpl(url, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                credentials: "include",
                body: JSON.stringify(payload),
                signal: controller.signal,
            });
        } catch (error) {
            if (error?.name === "AbortError") {
                throw new Error("คำขอโพสต์ใช้เวลานานเกิน 35 วินาที ระบบยกเลิกให้แล้ว ลองอีกครั้ง");
            }
            throw error;
        } finally {
            clearTimeout(timer);
        }
    };

    try {
        return await runAttempt(false);
    } catch (error) {
        const message = String(error?.message || error || "").toLowerCase();
        const isNetworkFetchError =
            message.includes("failed to fetch") ||
            message.includes("networkerror") ||
            message.includes("network request failed") ||
            message.includes("load failed");
        if (!isNetworkFetchError) {
            throw error;
        }

        console.warn("[PUBLISH] Network fetch failed, retrying via native direct API_BASE");
        return await runAttempt(true);
    }
}

function setupPublishHandler(mode) {
    const els = getModeElements(mode);
    if (!els.publishBtn) return;

    els.publishBtn.addEventListener("click", async () => {
        console.log('[PUBLISH] Button clicked! Mode:', mode);
        const state = modeState[mode];
        if (isAnyPublishInFlight()) {
            showPublishToast("มีงานโพสต์กำลังทำงานอยู่ รอให้เสร็จก่อนโพสต์ถัดไป", "error");
            return;
        }
        const pageIdAtClick = document.getElementById("pageSelect")?.value || "";
        const targetPageIdsAtClick =
            typeof getSelectedTargetPageIds === "function"
                ? getSelectedTargetPageIds()
                : [];
        const primaryTextAtClick = els.primaryText?.value?.trim() || "";
        const previewDescElAtClick = document.getElementById("previewDescription");
        const previewCaptionElAtClick = document.getElementById("previewCaption");
        const linkDescriptionInputElAtClick = document.getElementById("linkDescriptionInput");
        const ctaConfigAtClick = typeof getCurrentCtaConfig === "function"
            ? getCurrentCtaConfig(mode)
            : {
                label: "Shop Now",
                type: document.getElementById("cardButton")?.value || "SHOP_NOW",
            };
        const publishSnapshot = {
            pageId: pageIdAtClick,
            targetPageIds: targetPageIdsAtClick,
            primaryText: primaryTextAtClick,
            selectedImage: state.selectedImage || null,
            selectedVideoFile: state.selectedVideoFile || null,
            selectedVideoKey: state.selectedVideoKey || "",
            selectedVideoName: state.selectedVideoName || "",
            selectedVideoMimeType: state.selectedVideoMimeType || "",
            linkUrl: linkUrl?.value?.trim() || "",
            caption: caption?.value?.trim() || previewCaptionElAtClick?.textContent?.trim() || "",
            description: linkDescriptionInputElAtClick?.value?.trim()
                || description?.value?.trim()
                || previewDescElAtClick?.textContent?.trim()
                || "",
            callToAction: ctaConfigAtClick,
        };

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

        const requiresMedia = mode === "image" || mode === "reels";
        const hasMedia =
            mode === "reels"
                ? !!state.selectedVideoFile
                : mode === "image"
                    ? !!state.selectedImage
                    : true;

        if (requiresMedia && !hasMedia) {
            alert(mode === "reels" ? "Please select a video first" : "Please select an image first");
            return;
        }

        setPublishInFlight(mode, true);
        const publishBtn = resolvePublishButtonForMode(mode);
        if (publishBtn) {
            publishBtn.disabled = true;
            publishBtn.innerHTML = '<span class="loading"></span><span>กำลังโพสต์...</span>';
            publishBtn.classList.remove("published");
        }
        lastPublishedUrl = null;

        try {
            const pageId = publishSnapshot.pageId;
            const targetPageIds = publishSnapshot.targetPageIds;

            if (!pageId) {
                throw new Error("กรุณาเลือก Page");
            }

            if (mode === "text") {
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
                const primaryText = publishSnapshot.primaryText;
                const textFormatPresetId = getActiveTextBackgroundPresetId();
                const { scheduledTime, scheduleSource } =
                    await resolveScheduledTimeForMode(mode, pageId);

                if (!primaryText) {
                    throw new Error("กรุณาพิมพ์ข้อความก่อนโพสต์");
                }

                const renderedImageDataUrl = renderTextPostSquareImageDataUrl(
                    primaryText,
                    textFormatPresetId,
                );
                const textImageUrl = await uploadTextPostSquareImage(
                    renderedImageDataUrl,
                );

                const response = await postPublishWithNetworkRecovery({
                    pageId,
                    postMode: "text",
                    primaryText: "",
                    message: "",
                    textFormatPresetId: "",
                    imageUrl: textImageUrl,
                    targetPageIds,
                    accessToken: adsToken,
                    pageToken,
                    cookieData: cookie,
                    fbDtsg,
                    hideOnPublish: getHideOnPublishEnabledSnapshot(),
                    scheduleInSystem: scheduleSource === "manual",
                    scheduledTime: scheduledTime
                        ? Math.floor(scheduledTime.getTime() / 1000)
                        : null,
                });

                const data = await response.json();
                console.log("[TEXT] Publish response:", data);

                if (!response.ok || !data.success) {
                    throw new Error(data.error || "Failed to publish text post");
                }
                if (data.warning) {
                    showPublishToast(data.warning, "error");
                }

                lastPublishedUrl =
                    data.url ||
                    (data.postId
                        ? `https://www.facebook.com/${data.postId}`
                        : null);

                els.publishBtn.textContent = "✓";
                els.publishBtn.classList.add("published");
                els.publishBtn.disabled = false;
                const isScheduledTextPost = data.queued || data.needsScheduling;
                showPublishToast(
                    isScheduledTextPost
                        ? "ตั้งเวลาโพสต์สำเร็จแล้ว"
                        : "โพสต์สำเร็จแล้ว",
                );

                if (isScheduledTextPost) {
                    invalidatePostsCache(getCurrentPageId());
                    setTimeout(() => {
                        window.location.hash = "#pending";
                        handleNavigation();
                        if (els.primaryText) {
                            els.primaryText.value = "";
                        }
                        if (typeof clearManualSchedule === "function") {
                            clearManualSchedule(mode);
                        }
                        renderTextComposerUi();
                        validateTextMode();
                    }, 800);
                } else {
                    handleImmediatePublishSuccess(mode, els);
                }

                return;
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
                const caption = publishSnapshot.primaryText;
                const affiliateComment =
                    document.getElementById("reelsAffiliateComment")?.value?.trim() || "";
                const affiliateLink =
                    document.getElementById("reelsAffiliateLink")?.value?.trim() || "";
                const videoFile = publishSnapshot.selectedVideoFile;
                const videoKey = publishSnapshot.selectedVideoKey || "";

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
                formData.append("targetPageIds", JSON.stringify(targetPageIds));
                if (affiliateComment) formData.append("affiliateComment", affiliateComment);
                if (affiliateLink) formData.append("affiliateLink", affiliateLink);
                if (adsToken) formData.append("accessToken", adsToken);
                if (pageToken) formData.append("pageToken", pageToken);
                if (cookie) formData.append("cookieData", cookie);
                if (fbDtsg) formData.append("fbDtsg", fbDtsg);
                formData.append("videoKey", videoKey);
                formData.append("videoFileName", publishSnapshot.selectedVideoName || videoFile.name || "pubilo-reel.mp4");
                if (publishSnapshot.selectedVideoMimeType) {
                    formData.append("videoMimeType", publishSnapshot.selectedVideoMimeType);
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

                if (data.warning) {
                    alert(data.warning);
                }

                lastPublishedUrl =
                    data.url ||
                    (data.postId
                        ? `https://www.facebook.com/${data.postId}`
                        : null);

                els.publishBtn.textContent = "✓";
                els.publishBtn.classList.add("published");
                els.publishBtn.disabled = false;
                showPublishToast("โพสต์สำเร็จแล้ว");
                handleImmediatePublishSuccess(mode, els);
                return;
            }

            // ========== IMAGE MODE: Use unified publish flow ==========
            if (mode === "image") {
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
                const primaryText = publishSnapshot.primaryText;
                let imageUrl = publishSnapshot.selectedImage;

                if (!imageUrl) {
                    throw new Error("กรุณาเลือกภาพก่อนโพสต์");
                }

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

                console.log("[FEWFEED] Publishing image via /api/publish...");

                const response = await postPublishWithNetworkRecovery({
                    pageId,
                    postMode: "image",
                    imageUrl,
                    primaryText,
                    targetPageIds,
                    accessToken: adsToken,
                    pageToken,
                    cookieData: cookie,
                    fbDtsg,
                    hideOnPublish: getHideOnPublishEnabledSnapshot(),
                    scheduleInSystem: scheduleSource === "manual",
                    scheduledTime: scheduledTime
                        ? Math.floor(scheduledTime.getTime() / 1000)
                        : null,
                });

                const data = await response.json();
                console.log("[IMAGE] Publish response:", data);

                if (!response.ok || !data.success) {
                    throw new Error(data.error || "Failed to publish image post");
                }
                if (data.warning) {
                    showPublishToast(data.warning, "error");
                }

                lastPublishedUrl =
                    data.url ||
                    (data.postId
                        ? `https://www.facebook.com/${data.postId}`
                        : null);

                els.publishBtn.textContent = "✓";
                els.publishBtn.classList.add("published");
                els.publishBtn.disabled = false;
                const isScheduledImagePost = data.queued || data.needsScheduling;
                showPublishToast(
                    isScheduledImagePost
                        ? "ตั้งเวลาโพสต์สำเร็จแล้ว"
                        : "โพสต์สำเร็จแล้ว",
                );

                if (isScheduledImagePost) {
                    invalidatePostsCache(getCurrentPageId());
                    setTimeout(() => {
                        window.location.hash = "#pending";
                        handleNavigation();
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
                        if (els.primaryText) els.primaryText.value = "";
                        validateLinkMode();
                    }, 1000);
                } else {
                    handleImmediatePublishSuccess(mode, els);
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
            const cachedPageToken =
                localStorage.getItem("fewfeed_selectedPageToken") ||
                localStorage.getItem("fewfeed_postToken") ||
                "";
            const cookie =
                fbCookie || localStorage.getItem("fewfeed_cookie");
            let adAccountId =
                document.getElementById("adAccountSelect").value;
            if (!adAccountId) {
                adAccountId = String(localStorage.getItem("fewfeed_selectedAdAccountId") || "").trim();
                if (adAccountId) {
                    const adAccountInput = document.getElementById("adAccountSelect");
                    if (adAccountInput) adAccountInput.value = adAccountId;
                }
            }

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
                console.warn("[FEWFEED] No ad account selected on client, backend will auto-resolve from access token");
                window.showPublishToast?.(
                    "ยังไม่เจอ Ad Account บนหน้าเว็บ กำลังให้เซิร์ฟเวอร์ค้นหาให้อัตโนมัติ",
                    "warning",
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
            let imageToUpload = publishSnapshot.selectedImage;
            if (imageToUpload && imageToUpload.startsWith("data:")) {
                imageToUpload = await compressImage(imageToUpload, 1200, 0.8);
            }

            const descriptionText = isLinkMode
                ? publishSnapshot.description
                : "";
            const captionText = isLinkMode
                ? publishSnapshot.caption
                : "";
            if (isLinkMode) {
                description.value = descriptionText;
                const linkDescriptionInputEl = document.getElementById("linkDescriptionInput");
                if (linkDescriptionInputEl) {
                    linkDescriptionInputEl.value = descriptionText;
                }
                caption.value = captionText;
            }
            const linkUrlValue = isLinkMode ? publishSnapshot.linkUrl : "";
            const linkNameValue = isLinkMode
                ? (descriptionText ? `พิกัด : ${descriptionText}` : (linkName?.value?.trim() || ""))
                : "";
            const ctaConfig = publishSnapshot.callToAction;

            if (isLinkMode) {
                console.log("[PUBLISH] === LINK PAYLOAD DEBUG ===");
                console.log("[PUBLISH] linkUrl:", linkUrlValue);
                console.log("[PUBLISH] linkName:", linkNameValue);
                console.log("[PUBLISH] caption:", captionText);
                console.log("[PUBLISH] description:", descriptionText);
                console.log("[PUBLISH] primaryText:", primaryTextEl?.value || "(empty)");
                console.log("[PUBLISH] imageUrl length:", imageToUpload?.length || 0);
                console.log("[PUBLISH] callToAction:", ctaConfig.type, "| label:", ctaConfig.label);
                console.log("[PUBLISH] === END PAYLOAD ===");
            }

            const response = await postPublishWithNetworkRecovery({
                imageUrl: imageToUpload,
                linkUrl: linkUrlValue,
                linkName: linkNameValue,
                caption: captionText,
                description: descriptionText,
                primaryText: publishSnapshot.primaryText || "",
                targetPageIds,
                postMode: mode,
                accessToken: adsToken, // Ads Token (server fetches Page Token from this)
                pageToken: freshPageToken || getPageToken() || cachedPageToken || "",
                cookieData: cookie,
                pageId: pageId,
                adAccountId: adAccountId,
                callToAction: ctaConfig.type,
                callToActionLabel: ctaConfig.label,
                fbDtsg: fbDtsg, // Required for GraphQL scheduling
                hideOnPublish: getHideOnPublishEnabledSnapshot(),
                scheduleInSystem: scheduleSource === "manual",
                scheduledTime: scheduledTime
                    ? Math.floor(scheduledTime.getTime() / 1000)
                    : null, // Unix timestamp
            });

            // All responses are now streaming (both immediate and scheduled)
            let fullLog = "";
            if (response.body && typeof response.body.getReader === "function") {
                const reader = response.body.getReader();
                const decoder = new TextDecoder();
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    const text = decoder.decode(value);
                    fullLog += text;
                    console.log(text);
                }
            } else {
                // Some environments may return non-streaming responses.
                fullLog = await response.text();
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
            const warningMatch = fullLog.match(/"warning":"([^"]+)"/);
            const warningText = warningMatch ? warningMatch[1].replace(/\\"/g, '"') : "";

            if (urlMatch) {
                publishSessionRefreshRetryByMode[mode] = false;
                lastPublishedUrl = urlMatch[1];
                if (warningText) {
                    showPublishToast(warningText, "error");
                }
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
                        showPublishToast("ตั้งเวลาโพสต์สำเร็จแล้ว");
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
                    showPublishToast("โพสต์สำเร็จแล้ว");
                    handleImmediatePublishSuccess(mode, els);
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
            const errMessage = String(err?.message || err || "");
            const isSessionExpiredError =
                /session has been invalidated|error validating access token|facebook session หมดอายุ|errorcode["']?\s*:\s*190/i.test(errMessage);
            if (isSessionExpiredError && !publishSessionRefreshRetryByMode[mode]) {
                publishSessionRefreshRetryByMode[mode] = true;
                try {
                    // Try robust session recovery chain (cache -> get_data -> refresh token).
                    let recovered = false;
                    if (typeof syncWithExtensionNow === "function") {
                        recovered = await syncWithExtensionNow();
                    } else if (typeof refreshFacebookTokensFromExtension === "function") {
                        const refreshResult = await refreshFacebookTokensFromExtension();
                        recovered = !!refreshResult?.success;
                    }

                    if (recovered) {
                        // Prime freshest page token before retrying.
                        try {
                            const latestToken =
                                fbToken ||
                                localStorage.getItem("fewfeed_accessToken") ||
                                localStorage.getItem("fewfeed_token") ||
                                "";
                            if (typeof getFreshPageTokenFromExtension === "function" && pageId && latestToken) {
                                await getFreshPageTokenFromExtension(pageId, latestToken);
                            }
                        } catch (_) {
                            // Best-effort token warm-up; retry can still continue.
                        }

                        showPublishToast("รีเฟรช Facebook session แล้ว กำลังลองโพสต์ให้อีกครั้ง", "warning");
                        els.publishBtn.textContent =
                            typeof getPrimaryPublishLabel === "function"
                                ? getPrimaryPublishLabel(mode)
                                : "POST NOW";
                        els.publishBtn.disabled = false;
                        setTimeout(() => {
                            els.publishBtn.click();
                        }, 180);
                        return;
                    }
                } catch (_) {
                    // Fall through to normal error message.
                }
            }

            publishSessionRefreshRetryByMode[mode] = false;
            console.error("[FEWFEED] Error:", errMessage);
            const isNetworkFetchError =
                /failed to fetch|networkerror|network request failed|load failed/i.test(errMessage);
            if (isNetworkFetchError) {
                alert("เชื่อมต่อ API ไม่สำเร็จ (network) กรุณาลองใหม่อีกครั้ง");
            } else if (isSessionExpiredError) {
                alert("Facebook session หมดอายุ และระบบรีเฟรชอัตโนมัติไม่สำเร็จ\nกรุณา login Facebook ใหม่ แล้วกด extension อีกครั้ง");
            } else {
                alert("Publish failed: " + err.message);
            }
            els.publishBtn.textContent =
                typeof getPrimaryPublishLabel === "function"
                    ? getPrimaryPublishLabel(mode)
                    : "POST NOW";
            els.publishBtn.disabled = false;
        } finally {
            setPublishInFlight(mode, false);
        }
    });
}

// Setup publish handlers for all modes
setupPublishHandler("link");
setupPublishHandler("image");
setupPublishHandler("reels");
setupPublishHandler("text");

// Config loaded from localStorage via extension

// ===== FEWFEED Extension Integration =====
let fbCookie = null;
let fbToken = null; // Ads Token (for creating ad creatives)
let fbPostToken = null; // Post Token from Postcron (for fetching pages)
let allPages = [];
let lastSessionDrivenFetchKey = "";
let selectedPageIndex = 0;
let selectedTargetPageIds = [];
let targetPageSearchQuery = "";
const TARGET_PAGE_STORAGE_KEY = "fewfeed_targetPageIds";
const PAGE_TOKEN_MAP_KEY = "fewfeed_pageTokenMap";
const PAGE_SUMMARY_MAP_KEY = "fewfeed_pageSummaryMap";
const PAGE_CACHE_USER_ID_KEY = "fewfeed_pageCacheUserId";
const PRIMARY_PAGE_PLACEHOLDER_NAME = "เลือกเพจหลัก";
const PRIMARY_PAGE_PLACEHOLDER_ID = "ยังไม่ได้เลือก";

// Page selector elements
const pageSelector = document.getElementById("pageSelector");
const pageDropdown = document.getElementById("pageDropdown");
const multiPageTriggerValue = document.getElementById("pageSelectorTargetSummary");
const multiPageCountBadge = document.getElementById("pageSelectorTargetCount");
const multiPageSelectedMeta = document.getElementById("multiPageSelectedMeta");
const multiPageSearchInput = document.getElementById("multiPageSearchInput");
const multiPageSelectedStrip = document.getElementById("multiPageSelectedStrip");
const multiPageList = document.getElementById("multiPageList");

function getPageCacheOwnerId() {
    return String(localStorage.getItem(PAGE_CACHE_USER_ID_KEY) || "").trim();
}

function normalizePageCacheOwnerId(ownerId = "") {
    return String(
        ownerId ||
        localStorage.getItem("fewfeed_userId") ||
        getPageCacheOwnerId() ||
        "",
    ).trim();
}

function readScopedJsonObject(key, ownerId = "") {
    const normalizedOwnerId = normalizePageCacheOwnerId(ownerId);
    const cacheOwnerId = getPageCacheOwnerId();
    if (cacheOwnerId && normalizedOwnerId && cacheOwnerId !== normalizedOwnerId) {
        return {};
    }

    try {
        const parsed = JSON.parse(localStorage.getItem(key) || "{}");
        return parsed && typeof parsed === "object" ? parsed : {};
    } catch (_) {
        return {};
    }
}

function writeScopedJsonObject(key, value, ownerId = "") {
    const normalizedOwnerId = normalizePageCacheOwnerId(ownerId);
    if (!normalizedOwnerId) return;
    localStorage.setItem(PAGE_CACHE_USER_ID_KEY, normalizedOwnerId);
    localStorage.setItem(key, JSON.stringify(value || {}));
}

function readScopedPageTokenMap(ownerId = "") {
    return readScopedJsonObject(PAGE_TOKEN_MAP_KEY, ownerId);
}

function readScopedPageSummaryMap(ownerId = "") {
    return readScopedJsonObject(PAGE_SUMMARY_MAP_KEY, ownerId);
}

function writeScopedPageTokenMap(tokenMap, ownerId = "") {
    writeScopedJsonObject(PAGE_TOKEN_MAP_KEY, tokenMap, ownerId);
}

function writeScopedPageSummaryMap(summaryMap, ownerId = "") {
    writeScopedJsonObject(PAGE_SUMMARY_MAP_KEY, summaryMap, ownerId);
}

function clearPageScopedCache(reason = "") {
    [
        PAGE_TOKEN_MAP_KEY,
        PAGE_SUMMARY_MAP_KEY,
        PAGE_CACHE_USER_ID_KEY,
        "fewfeed_selectedPageId",
        "fewfeed_selectedPageName",
        "fewfeed_selectedPagePicture",
        "fewfeed_selectedPageToken",
        "fewfeed_selectedAdAccountId",
        TARGET_PAGE_STORAGE_KEY,
    ].forEach((key) => localStorage.removeItem(key));
    selectedTargetPageIds = [];
    if (reason) {
        console.log("[FEWFEED] Cleared page-scoped cache:", reason);
    }
}

function mergeLoadedPageTokens(pages, ownerId = "") {
    const normalizedOwnerId = normalizePageCacheOwnerId(ownerId);
    if (!normalizedOwnerId || !Array.isArray(pages) || pages.length === 0) return;

    const tokenMap = { ...readScopedPageTokenMap(normalizedOwnerId) };
    const summaryMap = { ...readScopedPageSummaryMap(normalizedOwnerId) };

    pages.forEach((page) => {
        const pageId = String(page?.id || "").trim();
        if (!pageId) return;

        const accessToken = typeof page?.access_token === "string" ? page.access_token.trim() : "";
        if (accessToken) {
            tokenMap[pageId] = accessToken;
        }

        summaryMap[pageId] = {
            id: pageId,
            name: String(page?.name || summaryMap[pageId]?.name || "Page"),
            picture: page?.picture?.data?.url || summaryMap[pageId]?.picture || "",
        };
    });

    writeScopedPageTokenMap(tokenMap, normalizedOwnerId);
    writeScopedPageSummaryMap(summaryMap, normalizedOwnerId);
}

function getScopedCachedPages(ownerId = "") {
    const normalizedOwnerId = normalizePageCacheOwnerId(ownerId);
    const summaryMap = readScopedPageSummaryMap(normalizedOwnerId);
    const pages = Object.values(summaryMap)
        .map((page) => {
            const pageId = String(page?.id || "").trim();
            if (!pageId) return null;
            return {
                id: pageId,
                name: String(page?.name || "Page"),
                picture: {
                    data: {
                        url: page?.picture || `https://graph.facebook.com/${pageId}/picture?type=small`,
                    },
                },
                color: "#f59e0b",
            };
        })
        .filter(Boolean);

    return pages;
}

function getPageAvatarUrl(page) {
    return (
        page.picture?.data?.url ||
        `https://graph.facebook.com/${page.id}/picture?type=small`
    );
}

function loadStoredTargetPageIds() {
    try {
        const parsed = JSON.parse(
            localStorage.getItem(TARGET_PAGE_STORAGE_KEY) || "[]",
        );
        return Array.isArray(parsed)
            ? parsed.map((id) => String(id)).filter(Boolean)
            : [];
    } catch (_) {
        return [];
    }
}

function persistTargetPageIds() {
    localStorage.setItem(
        TARGET_PAGE_STORAGE_KEY,
        JSON.stringify(selectedTargetPageIds),
    );
}

function getCurrentSelectedPageId() {
    return document.getElementById("pageSelect")?.value || "";
}

function getSelectableTargetPages() {
    return allPages;
}

function syncSelectedTargetPageIds() {
    const currentPageId = String(getCurrentSelectedPageId() || "");
    const availableIds = new Set(allPages.map((page) => String(page.id)));

    selectedTargetPageIds = selectedTargetPageIds.filter(
        (id) => id !== currentPageId && availableIds.has(String(id)),
    );
    persistTargetPageIds();
}

function getSelectedTargetPages() {
    const currentPageId = String(getCurrentSelectedPageId() || "");
    const selectedSet = new Set(selectedTargetPageIds.map(String));
    return allPages.filter((page) =>
        selectedSet.has(String(page.id)) &&
        String(page.id) !== currentPageId,
    );
}

function getRoutingSelectionSummary(selectedPages, currentPageId) {
    if (!currentPageId) {
        return {
            totalCount: 0,
            triggerText: "เลือกเพจหลักก่อน",
            metaText: "ยังไม่เลือกเพจหลัก",
        };
    }

    const totalCount = 1 + selectedPages.length;

    if (totalCount === 1) {
        return {
            totalCount,
            triggerText: "โพสต์ที่เพจนี้เท่านั้น",
            metaText: "รวม 1 เพจ",
        };
    }

    return {
        totalCount,
        triggerText: `โพสต์พร้อมกัน ${totalCount} เพจ`,
        metaText: `รวม ${totalCount} เพจ`,
    };
}

function getOrderedPagesForPicker(pages, currentPageId) {
    if (!currentPageId) return pages;

    const selectedSet = new Set(selectedTargetPageIds.map(String));
    const primaryPages = [];
    const selectedPages = [];
    const otherPages = [];

    pages.forEach((page) => {
        const pageId = String(page.id);
        if (pageId === currentPageId) {
            primaryPages.push(page);
            return;
        }

        if (selectedSet.has(pageId)) {
            selectedPages.push(page);
            return;
        }

        otherPages.push(page);
    });

    return [...primaryPages, ...selectedPages, ...otherPages];
}

function setPageDropdownOpen(isOpen) {
    if (!pageDropdown || !pageSelector) return;
    pageDropdown.classList.toggle("visible", !!isOpen);
    pageSelector.classList.toggle("open", !!isOpen);
    if (isOpen && multiPageSearchInput) {
        multiPageSearchInput.focus();
        multiPageSearchInput.select();
    }
}

function getEmptyPageAvatarUrl() {
    return "data:image/svg+xml;charset=UTF-8,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 80 80'%3E%3Crect width='80' height='80' rx='40' fill='%23eef2f7'/%3E%3Cpath d='M40 23c6.08 0 11 4.92 11 11s-4.92 11-11 11-11-4.92-11-11 4.92-11 11-11Zm0 28c9.39 0 17 5.37 17 12v2H23v-2c0-6.63 7.61-12 17-12Z' fill='%239ca3af'/%3E%3C/svg%3E";
}

function refreshActivePagePanels() {
    const hash = window.location.hash.slice(1) || "news";

    if (hash === "pending") {
        showPendingPanel();
    } else if (hash === "published") {
        loadPublishedPosts();
    } else if (hash === "earnings") {
        loadEarnings();
    } else if (hash === "settings") {
        loadSettingsPanel();
    }
}

function clearPrimaryPageSelection() {
    const skeleton = document.getElementById("pageSelectorSkeleton");
    const selector = document.getElementById("pageSelector");
    if (skeleton) skeleton.style.display = "none";
    if (selector) {
        selector.style.display = "flex";
        selector.classList.add("is-empty");
    }
    setPageDropdownOpen(false);

    localStorage.removeItem("fewfeed_selectedPageId");
    localStorage.removeItem("fewfeed_selectedPageName");
    localStorage.removeItem("fewfeed_selectedPagePicture");
    localStorage.removeItem("fewfeed_selectedPageToken");
    document.getElementById("pageSelect").value = "";
    selectedPageIndex = -1;

    const previewName = document.getElementById("previewPageName");
    const previewId = document.getElementById("previewPageId");
    const previewImg = document.getElementById("previewAvatarImg");
    if (previewName) previewName.textContent = PRIMARY_PAGE_PLACEHOLDER_NAME;
    if (previewId) previewId.textContent = PRIMARY_PAGE_PLACEHOLDER_ID;
    if (previewImg) {
        previewImg.src = getEmptyPageAvatarUrl();
        previewImg.alt = PRIMARY_PAGE_PLACEHOLDER_NAME;
    }

    document.querySelectorAll(".page-dropdown-item").forEach((item) => {
        item.classList.remove("selected");
    });

    if (typeof loadSettings === "function") {
        loadSettings();
    }
    if (typeof updatePublishButton === "function") {
        updatePublishButton();
    }

    renderMultiPageTargetPicker();
    renderTextComposerUi();
    updatePendingCount();
    refreshActivePagePanels();
}

function setPrimaryPageById(pageId) {
    const index = allPages.findIndex((page) => String(page.id) === String(pageId));
    if (index === -1) return;
    selectPage(index);
}

function removeTargetPage(pageId) {
    selectedTargetPageIds = selectedTargetPageIds.filter(
        (id) => String(id) !== String(pageId),
    );
    persistTargetPageIds();
    renderMultiPageTargetPicker();
}

function toggleTargetPage(pageId) {
    const normalizedPageId = String(pageId);
    const currentPageId = String(getCurrentSelectedPageId() || "");

    if (!currentPageId) {
        setPrimaryPageById(normalizedPageId);
        setPageDropdownOpen(false);
        return;
    }

    if (normalizedPageId === currentPageId) {
        return;
    }

    const isSelected = selectedTargetPageIds.includes(normalizedPageId);

    if (isSelected) {
        selectedTargetPageIds = selectedTargetPageIds.filter(
            (id) => id !== normalizedPageId,
        );
    } else {
        selectedTargetPageIds.push(normalizedPageId);
    }

    persistTargetPageIds();
    renderMultiPageTargetPicker();
}

function renderSelectedTargetStrip(selectedPages) {
    if (!multiPageSelectedStrip) return;
    multiPageSelectedStrip.textContent = "";

    if (!selectedPages.length) {
        multiPageSelectedStrip.style.display = "none";
        return;
    }

    multiPageSelectedStrip.style.display = "flex";

    selectedPages.forEach((page) => {
        const chip = document.createElement("div");
        chip.className = "multi-page-chip";

        const avatar = document.createElement("img");
        avatar.className = "multi-page-chip-avatar";
        avatar.src = getPageAvatarUrl(page);
        avatar.alt = page.name || page.id;

        const label = document.createElement("span");
        label.textContent = page.name || page.id;

        const removeBtn = document.createElement("button");
        removeBtn.type = "button";
        removeBtn.className = "multi-page-chip-remove";
        removeBtn.textContent = "×";
        removeBtn.title = `เอา ${page.name || page.id} ออก`;
        removeBtn.addEventListener("click", (event) => {
            event.stopPropagation();
            removeTargetPage(page.id);
        });

        chip.appendChild(avatar);
        chip.appendChild(label);
        chip.appendChild(removeBtn);
        multiPageSelectedStrip.appendChild(chip);
    });
}

function renderMultiPageListItems() {
    if (!multiPageList) return;
    multiPageList.textContent = "";

    if (!allPages.length) {
        multiPageList.innerHTML = `
            <div class="multi-page-empty">
                <strong>ยังไม่มีเพจให้เลือก</strong>
                รอ extension ดึงรายชื่อเพจ หรือรีเฟรชใหม่อีกครั้ง
            </div>
        `;
        return;
    }

    const query = targetPageSearchQuery.trim().toLowerCase();
    const currentPageId = String(getCurrentSelectedPageId() || "");
    const filteredPages = allPages.filter((page) => {
        if (!query) return true;
        return (
            String(page.name || "").toLowerCase().includes(query) ||
            String(page.id || "").toLowerCase().includes(query)
        );
    });
    const orderedPages = getOrderedPagesForPicker(filteredPages, currentPageId);

    if (!orderedPages.length) {
        multiPageList.innerHTML = `
            <div class="multi-page-empty">
                <strong>ไม่พบเพจที่ค้นหา</strong>
                ลองค้นหาด้วยชื่อเพจหรือ Page ID อีกครั้ง
            </div>
        `;
        return;
    }

    orderedPages.forEach((page) => {
        const normalizedPageId = String(page.id);
        const hasPrimarySelection = !!currentPageId;
        const isPrimary = normalizedPageId === currentPageId;
        const isSelected = !isPrimary && selectedTargetPageIds.includes(normalizedPageId);

        const item = document.createElement("div");
        item.className = `page-dropdown-item multi-page-item${isPrimary ? " selected is-primary" : ""}${isSelected ? " is-selected" : ""}`;
        item.dataset.pageId = normalizedPageId;
        item.addEventListener("click", () => {
            if (!isPrimary) {
                setPrimaryPageById(normalizedPageId);
            } else {
                setPageDropdownOpen(false);
            }
        });

        const avatar = document.createElement("img");
        avatar.className = "multi-page-item-media";
        avatar.src = getPageAvatarUrl(page);
        avatar.alt = page.name || normalizedPageId;

        const copy = document.createElement("div");
        copy.className = "page-dropdown-item-info multi-page-item-copy";

        const title = document.createElement("h4");
        title.textContent = page.name || "Page";

        const subtitle = document.createElement("p");
        subtitle.textContent = normalizedPageId;

        copy.appendChild(title);
        copy.appendChild(subtitle);

        const action = document.createElement("button");
        action.type = "button";
        action.className = "multi-page-item-action";
        action.textContent = isPrimary
            ? "หลัก"
            : !hasPrimarySelection
                ? "หลัก"
                : isSelected
                    ? "×"
                    : "✓";
        action.title = isPrimary
            ? `${page.name || normalizedPageId} คือเพจหลัก`
            : !hasPrimarySelection
                ? `ตั้ง ${page.name || normalizedPageId} เป็นเพจหลัก`
                : isSelected
                    ? `เอา ${page.name || normalizedPageId} ออก`
                    : `เลือก ${page.name || normalizedPageId}`;
        action.addEventListener("click", (event) => {
            event.stopPropagation();

            if (isPrimary) {
                setPageDropdownOpen(false);
                return;
            }

            if (!hasPrimarySelection) {
                setPrimaryPageById(normalizedPageId);
                return;
            }

            toggleTargetPage(normalizedPageId);
        });

        item.appendChild(avatar);
        item.appendChild(copy);
        item.appendChild(action);
        multiPageList.appendChild(item);
    });
}

function renderMultiPageTargetPicker() {
    if (
        !multiPageTriggerValue ||
        !multiPageCountBadge ||
        !multiPageSelectedMeta
    ) {
        return;
    }

    syncSelectedTargetPageIds();
    const selectedPages = getSelectedTargetPages();
    const currentPageId = getCurrentSelectedPageId();
    const routingSummary = getRoutingSelectionSummary(selectedPages, currentPageId);

    multiPageTriggerValue.textContent = routingSummary.triggerText;
    multiPageCountBadge.textContent = String(routingSummary.totalCount);
    multiPageSelectedMeta.textContent = routingSummary.metaText;

    renderSelectedTargetStrip(currentPageId ? selectedPages : []);
    renderMultiPageListItems();
}

window.getSelectedTargetPageIds = function getSelectedTargetPageIds() {
    return [...selectedTargetPageIds];
};

window.clearSelectedTargetPages = function clearSelectedTargetPages() {
    selectedTargetPageIds = [];
    persistTargetPageIds();
    renderMultiPageTargetPicker();
};

// Toggle dropdown
pageSelector.addEventListener("click", (e) => {
    e.stopPropagation();
    setPageDropdownOpen(!pageDropdown.classList.contains("visible"));
});

// Close dropdown when clicking outside
document.addEventListener("click", () => {
    setPageDropdownOpen(false);
});

pageDropdown.addEventListener("click", (event) => {
    event.stopPropagation();
});

const textBackgroundGrid = document.getElementById("textBackgroundGrid");
if (textBackgroundGrid) {
    textBackgroundGrid.addEventListener("click", (event) => {
        const button = event.target.closest(".text-background-option");
        if (!button || button.disabled) return;
        setActiveTextBackgroundPresetId(button.dataset.presetId || "");
        renderTextComposerUi();
    });
}

const textBackgroundManageBtn = document.getElementById("textBackgroundManageBtn");
if (textBackgroundManageBtn) {
    textBackgroundManageBtn.addEventListener("click", () => {
        const state = getTextModeState();
        state.isBackgroundManagerOpen = !state.isBackgroundManagerOpen;
        renderTextComposerUi();
    });
}

const textBackgroundPresetAddBtn = document.getElementById("textBackgroundPresetAddBtn");
if (textBackgroundPresetAddBtn) {
    textBackgroundPresetAddBtn.addEventListener("click", async () => {
        const input = document.getElementById("textBackgroundPresetInput");
        const nextPresetId = String(input?.value || "").trim();
        if (!nextPresetId) {
            alert("ใส่รหัสพื้นหลังที่ต้องการเพิ่มก่อน");
            return;
        }

        const currentCustomPresets = getSavedCustomTextBackgroundPresets();
        if (currentCustomPresets.includes(nextPresetId) || getTextBackgroundOptionById(nextPresetId)) {
            setActiveTextBackgroundPresetId(nextPresetId);
            renderTextComposerUi();
            return;
        }

        try {
            textBackgroundPresetAddBtn.disabled = true;
            textBackgroundPresetAddBtn.textContent = "กำลังเพิ่ม...";
            await persistTextBackgroundCatalog([...currentCustomPresets, nextPresetId]);
            setActiveTextBackgroundPresetId(nextPresetId);
            renderTextComposerUi();
        } catch (error) {
            alert(error instanceof Error ? error.message : "เพิ่มรหัสพื้นหลังไม่สำเร็จ");
        } finally {
            textBackgroundPresetAddBtn.disabled = false;
            textBackgroundPresetAddBtn.textContent = "เพิ่ม";
        }
    });
}

const textBackgroundPresetInput = document.getElementById("textBackgroundPresetInput");
if (textBackgroundPresetInput) {
    textBackgroundPresetInput.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
            event.preventDefault();
            textBackgroundPresetAddBtn?.click();
        }
    });
}

const textBackgroundSavedList = document.getElementById("textBackgroundSavedList");
if (textBackgroundSavedList) {
    textBackgroundSavedList.addEventListener("click", async (event) => {
        const button = event.target.closest(".text-background-saved-remove");
        if (!button) return;

        const presetId = String(button.dataset.presetId || "").trim();
        if (!presetId) return;

        const nextCustomPresets = getSavedCustomTextBackgroundPresets().filter((item) => item !== presetId);
        try {
            await persistTextBackgroundCatalog(nextCustomPresets);
            if (getActiveTextBackgroundPresetId() === presetId) {
                setActiveTextBackgroundPresetId("");
            }
            renderTextComposerUi();
        } catch (error) {
            alert(error instanceof Error ? error.message : "ลบรหัสพื้นหลังไม่สำเร็จ");
        }
    });
}

if (multiPageSearchInput) {
    multiPageSearchInput.addEventListener("input", (event) => {
        targetPageSearchQuery = event.target.value || "";
        renderMultiPageTargetPicker();
    });
}

// Select a page
function selectPage(index) {
    selectedPageIndex = index;
    const page = allPages[index];
    if (!page) return;

    console.log("[FEWFEED] Selected page:", page.name, "id:", page.id);

    // Save selected page ID and name to localStorage for persistence across refreshes
    localStorage.setItem("fewfeed_selectedPageId", page.id);
    localStorage.setItem("fewfeed_selectedPageName", page.name || "Page");
    const imgUrl =
        page.picture?.data?.url ||
        `https://graph.facebook.com/${page.id}/picture?type=small`;
    const selectedPageToken = typeof page.access_token === "string" ? page.access_token.trim() : "";
    const cacheOwnerId = normalizePageCacheOwnerId();
    const tokenMap = readScopedPageTokenMap(cacheOwnerId);
    const summaryMap = readScopedPageSummaryMap(cacheOwnerId);

    const mappedToken = tokenMap?.[String(page.id)]?.trim() || "";
    const effectivePageToken = selectedPageToken || mappedToken;

    if (selectedPageToken) {
        tokenMap[String(page.id)] = selectedPageToken;
        writeScopedPageTokenMap(tokenMap, cacheOwnerId);
    }
    summaryMap[String(page.id)] = {
        id: String(page.id),
        name: page.name || "Page",
        picture: imgUrl || "",
    };
    writeScopedPageSummaryMap(summaryMap, cacheOwnerId);

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
    pageSelector.classList.remove("is-empty");

    // Update content
    document.getElementById("previewPageName").textContent =
        page.name || "Page";
    document.getElementById("previewPageId").textContent = page.id;
    document.getElementById("pageSelect").value = page.id;
    document.getElementById("previewAvatarImg").src = imgUrl;
    localStorage.setItem("fewfeed_selectedPagePicture", imgUrl);

    // Update dropdown selection
    document
        .querySelectorAll(".page-dropdown-item")
        .forEach((item) => {
            const itemPageId = item.dataset.pageId || "";
            item.classList.toggle("selected", itemPageId === String(page.id));
            item.classList.toggle("is-primary", itemPageId === String(page.id));
        });

    syncSelectedTargetPageIds();
    renderMultiPageTargetPicker();

    setPageDropdownOpen(false);

    // Load page-specific settings
    loadSettings();

    // Persist selected page metadata so /api/pages can recover even when extension is unavailable.
    fetch("/api/page-settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            pageId: page.id,
            pageName: page.name || "Page",
            pictureUrl: imgUrl || "",
        }),
    }).catch((err) => {
        console.warn("[FEWFEED] Failed to persist selected page metadata:", err);
    });

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

    renderTextComposerUi();
}

function hydratePageFromLocalStorageFallback() {
    const currentUserId = String(localStorage.getItem("fewfeed_userId") || "").trim();
    const cacheOwnerId = getPageCacheOwnerId();
    if (cacheOwnerId && currentUserId && cacheOwnerId !== currentUserId) {
        console.warn("[FEWFEED] Skipping local page fallback because cache owner differs from current account");
        return false;
    }

    const savedPageId = localStorage.getItem("fewfeed_selectedPageId") || "";
    if (!savedPageId) return false;

    const summaryMap = readScopedPageSummaryMap(currentUserId || cacheOwnerId);
    const savedSummary = summaryMap[String(savedPageId)] || {};
    const savedPageName = savedSummary.name || localStorage.getItem("fewfeed_selectedPageName") || "Saved Page";
    const savedPicture =
        savedSummary.picture ||
        localStorage.getItem("fewfeed_selectedPagePicture") ||
        `https://graph.facebook.com/${savedPageId}/picture?type=small`;

    renderPagesDropdown([
        {
            id: savedPageId,
            name: savedPageName,
            picture: { data: { url: savedPicture } },
            color: "#f59e0b",
        },
    ]);

    console.log("[FEWFEED] Hydrated page selector from scoped localStorage fallback");
    return true;
}

// Render pages dropdown
function renderPagesDropdown(pages) {
    allPages = pages;
    if (!selectedTargetPageIds.length) {
        selectedTargetPageIds = loadStoredTargetPageIds();
    }

    if (pages.length > 0) {
        const savedPageId = localStorage.getItem("fewfeed_selectedPageId");
        if (savedPageId) {
            const savedIndex = pages.findIndex((page) => String(page.id) === String(savedPageId));
            if (savedIndex !== -1) {
                selectPage(savedIndex);
            } else {
                clearPrimaryPageSelection();
            }
        } else {
            clearPrimaryPageSelection();
        }
    } else {
        clearPrimaryPageSelection();
    }

    renderMultiPageTargetPicker();
    renderTextComposerUi();
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

    const storedAdAccountId = String(localStorage.getItem("fewfeed_selectedAdAccountId") || "").trim();
    if (!input.value && storedAdAccountId) {
        input.value = storedAdAccountId;
    }

    try {
        const adAccounts = await requestAdAccountsFromExtension(accessToken);
        const nextId = setSelectedAdAccount(adAccounts);
        console.log("[FEWFEED] Ad accounts loaded from extension:", adAccounts.length, "selected:", nextId);
        return nextId;
    } catch (error) {
        console.warn("[FEWFEED] Failed to fetch ad accounts from extension:", error);
        const fallbackId = String(input.value || storedAdAccountId || "").trim();
        if (fallbackId) {
            localStorage.setItem("fewfeed_selectedAdAccountId", fallbackId);
            input.value = fallbackId;
            return fallbackId;
        }
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

        const cacheOwnerId = normalizePageCacheOwnerId();
        const tokenMap = readScopedPageTokenMap(cacheOwnerId);
        tokenMap[String(pageId)] = nextToken;
        writeScopedPageTokenMap(tokenMap, cacheOwnerId);
        localStorage.setItem("fewfeed_selectedPageToken", nextToken);

        const tokenInput = document.getElementById("pageTokenInputPanel");
        if (tokenInput) {
            tokenInput.value = nextToken;
        }

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

        mergeLoadedPageTokens(pages, cacheOwnerId);

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

function getActiveWorkspace() {
    return window.PUBILO_CURRENT_WORKSPACE || window.PUBILO_AUTH_STATE?.workspace || null;
}

function getActiveWorkspaceId() {
    return String(getActiveWorkspace()?.id || "").trim();
}

function readWorkspaceFacebookSessionMap() {
    try {
        const raw = localStorage.getItem(WORKSPACE_FACEBOOK_SESSION_MAP_KEY) || "{}";
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === "object" ? parsed : {};
    } catch (_) {
        return {};
    }
}

function writeWorkspaceFacebookSessionMap(sessionMap) {
    localStorage.setItem(WORKSPACE_FACEBOOK_SESSION_MAP_KEY, JSON.stringify(sessionMap || {}));
}

function persistWorkspaceFacebookSessionSnapshot(sessionData) {
    const workspaceId = getActiveWorkspaceId();
    const normalized = normalizeExtensionSessionData(sessionData);
    if (!workspaceId || !hasAnyExtensionSessionData(normalized)) return;

    const sessionMap = readWorkspaceFacebookSessionMap();
    sessionMap[workspaceId] = {
        ...normalized,
        updatedAt: new Date().toISOString(),
    };
    writeWorkspaceFacebookSessionMap(sessionMap);
}

function loadWorkspaceFacebookSessionSnapshot() {
    const workspaceId = getActiveWorkspaceId();
    if (!workspaceId) return null;

    const sessionMap = readWorkspaceFacebookSessionMap();
    return sessionMap[workspaceId] || null;
}

function getFacebookConnectBannerElements() {
    const banner = document.getElementById("pubiloFacebookConnectBanner");
    if (!banner) return null;
    return {
        banner,
        title: banner.querySelector("[data-connect-title]"),
        body: banner.querySelector("[data-connect-body]"),
        primary: banner.querySelector("[data-connect-primary]"),
        secondary: banner.querySelector("[data-connect-secondary]"),
    };
}

function ensureFacebookConnectBanner() {
    if (!SHOW_FACEBOOK_CONNECT_BANNER) {
        document.getElementById("pubiloFacebookConnectBanner")?.remove();
        return null;
    }

    const existing = getFacebookConnectBannerElements();
    if (existing) return existing;

    const banner = document.createElement("section");
    banner.id = "pubiloFacebookConnectBanner";
    banner.className = "pubilo-connect-banner is-hidden";
    banner.innerHTML = `
        <div class="pubilo-connect-copy">
            <span class="pubilo-connect-kicker">Workspace Setup</span>
            <strong data-connect-title>เชื่อม Facebook ให้ workspace นี้ก่อน</strong>
            <p data-connect-body>เปิด Pubilo พร้อม extension แล้วกดดึง credential จาก browser นี้ ระบบจะผูก cookie, fb_dtsg และ Ads Token เข้ากับ workspace ปัจจุบันทันที</p>
        </div>
        <div class="pubilo-connect-actions">
            <button type="button" class="pubilo-primary-btn" data-connect-primary>ดึงจาก Extension</button>
            <button type="button" class="pubilo-connect-secondary" data-connect-secondary>เปิด Token</button>
        </div>
    `;

    const header = document.querySelector("header.header");
    const appLayout = document.querySelector(".app-layout");
    if (header?.parentNode) {
        header.parentNode.insertBefore(banner, appLayout || header.nextSibling);
    } else {
        document.body.prepend(banner);
    }

    const elements = getFacebookConnectBannerElements();
    if (!elements) return null;

    elements.primary?.addEventListener("click", async () => {
        const button = elements.primary;
        if (button) {
            button.disabled = true;
            button.textContent = "กำลังดึงข้อมูล...";
        }

        try {
            const synced = await syncWithExtensionNow();
            if (synced) {
                showPublishToast("เชื่อม Facebook เข้ากับ workspace แล้ว");
            } else {
                showPublishToast("ยังดึงข้อมูลจาก Extension ไม่ได้ ลองเปิด extension แล้วกดอีกครั้ง", "warning");
            }
        } finally {
            if (button) {
                button.disabled = false;
                button.textContent = "ดึงจาก Extension";
            }
        }
    });

    elements.secondary?.addEventListener("click", () => {
        openTokenModal("ads");
    });

    return elements;
}

function updateFacebookConnectBanner(options = {}) {
    if (!SHOW_FACEBOOK_CONNECT_BANNER) {
        document.getElementById("pubiloFacebookConnectBanner")?.remove();
        return;
    }

    const workspaceId = getActiveWorkspaceId();
    const elements = ensureFacebookConnectBanner();
    if (!elements) return;

    if (!workspaceId) {
        elements.banner.classList.add("is-hidden");
        return;
    }

    const connected = !!options.connected;
    const workspaceName = getActiveWorkspace()?.name || "workspace นี้";

    if (connected) {
        elements.banner.classList.add("is-hidden");
        return;
    }

    elements.banner.classList.remove("is-hidden");
    elements.title.textContent = `เชื่อม Facebook ให้ ${workspaceName} ก่อน`;
    elements.body.textContent = options.message || "เปิด extension บนหน้านี้แล้วกดดึง credential เพื่อให้ระบบ import เพจและออก page token ภายใต้ workspace ปัจจุบัน";
  }

function buildFacebookSessionSignature(sessionData) {
    const session = normalizeExtensionSessionData(sessionData);
    return [
        getActiveWorkspaceId(),
        session.userId,
        session.adsToken,
        session.postToken,
        session.cookie,
        session.fbDtsg,
        session.userName,
    ].join("|");
}

async function persistWorkspaceFacebookCredentials(sessionData, source = "extension") {
    const workspaceId = getActiveWorkspaceId();
    const session = normalizeExtensionSessionData(sessionData);

    if (!workspaceId) return false;
    if (!session.userId) return false;
    if (!(session.adsToken || session.cookie || session.fbDtsg)) return false;

    const signature = buildFacebookSessionSignature(session);
    if (signature === lastPersistedFacebookSessionSignature) {
        return true;
    }

    const response = await fetch("/api/tokens", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            userId: session.userId,
            adsToken: session.adsToken || null,
            cookie: session.cookie || null,
            fbDtsg: session.fbDtsg || null,
            userName: session.userName || null,
        }),
    });
    const payload = await response.json().catch(() => ({}));

    if (!response.ok || !payload.success) {
        throw new Error(payload.error || `Persist Facebook credentials failed from ${source}`);
    }

    lastPersistedFacebookSessionSignature = signature;
    updateFacebookConnectBanner({ connected: true });
    return true;
}

async function hydrateFacebookCredentialsFromWorkspace() {
    const workspaceId = getActiveWorkspaceId();
    if (!workspaceId) return false;

    const response = await fetch("/api/tokens");
    const payload = await response.json().catch(() => ({}));
    const tokens = Array.isArray(payload.tokens) ? payload.tokens : [];

    if (!response.ok || !payload.success || tokens.length === 0) {
        updateFacebookConnectBanner({ connected: false });
        return false;
    }

    const currentUserId = localStorage.getItem("fewfeed_userId") || "";
    const preferred =
        tokens.find((token) => String(token.user_id || "") === currentUserId) ||
        tokens[0];

    if (!preferred) {
        updateFacebookConnectBanner({ connected: false });
        return false;
    }

    applyExtensionSessionData({
        adsToken: preferred.ads_token,
        postToken: preferred.post_token,
        cookie: preferred.cookie,
        fbDtsg: preferred.fb_dtsg,
        userId: preferred.user_id,
        userName: preferred.user_name,
    }, "workspace-backend", { skipPersist: true, fromWorkspace: true });

    updateFacebookConnectBanner({ connected: true });
    return true;
}

function normalizeExtensionSessionData(rawData = {}) {
    const pickString = (...values) => {
        for (const value of values) {
            if (typeof value === "string" && value.trim()) {
                return value.trim();
            }
        }
        return "";
    };

    return {
        adsToken: pickString(
            rawData.adsToken,
            rawData.accessToken,
            rawData.fewfeed_accessToken,
            rawData.token,
        ),
        postToken: pickString(
            rawData.postToken,
            rawData.fewfeed_postToken,
        ),
        cookie: pickString(rawData.cookie, rawData.fewfeed_cookie),
        fbDtsg: pickString(rawData.fbDtsg, rawData.fewfeed_fbDtsg),
        userId: pickString(rawData.userId, rawData.fewfeed_userId),
        userName: pickString(rawData.userName, rawData.fewfeed_userName),
        avatarUrl: pickString(rawData.avatarUrl, rawData.fewfeed_avatarUrl),
        pageTokenMap: rawData.pageTokenMap || rawData.fewfeed_pageTokenMap || null,
        pageTokenMapOwnerId: pickString(rawData.pageTokenMapOwnerId),
        pageSummaryMap: rawData.pageSummaryMap || null,
    };
}

function hasAnyExtensionSessionData(session = {}) {
    return !!(
        session.adsToken ||
        session.postToken ||
        session.cookie ||
        session.userId ||
        session.userName
    );
}

function applyExtensionSessionData(sessionData, source = "extension", options = {}) {
    const session = normalizeExtensionSessionData(sessionData);
    if (!hasAnyExtensionSessionData(session)) {
        return false;
    }

    const previousUserId = String(localStorage.getItem("fewfeed_userId") || "").trim();
    const incomingUserId = String(session.userId || session.pageTokenMapOwnerId || "").trim();
    const currentPageCacheOwnerId = getPageCacheOwnerId();
    const ownerChanged = !!(
        incomingUserId &&
        (
            (previousUserId && previousUserId !== incomingUserId) ||
            (currentPageCacheOwnerId && currentPageCacheOwnerId !== incomingUserId)
        )
    );
    if (ownerChanged) {
        clearPageScopedCache(`${currentPageCacheOwnerId || previousUserId} -> ${incomingUserId}`);
        clearPrimaryPageSelection();
    }

    const previousAdsToken =
        localStorage.getItem("fewfeed_accessToken") ||
        localStorage.getItem("fewfeed_token") ||
        fbToken ||
        "";
    const previousPostToken =
        localStorage.getItem("fewfeed_postToken") ||
        fbPostToken ||
        "";

    persistWorkspaceFacebookSessionSnapshot(session);

    // Always overwrite — clear stale tokens so code-190 loops stop.
    localStorage.setItem("fewfeed_accessToken", session.adsToken || "");
    localStorage.setItem("fewfeed_token", session.adsToken || "");
    fbToken = session.adsToken || "";
    if (session.postToken) {
        localStorage.setItem("fewfeed_postToken", session.postToken);
        fbPostToken = session.postToken;
    }
    if (session.cookie) {
        localStorage.setItem("fewfeed_cookie", session.cookie);
        fbCookie = session.cookie;
    }
    if (session.fbDtsg) {
        localStorage.setItem("fewfeed_fbDtsg", session.fbDtsg);
    }
    if (session.userId) {
        localStorage.setItem("fewfeed_userId", session.userId);
    }
    if (session.userName) {
        localStorage.setItem("fewfeed_userName", session.userName);
    }
    if (session.avatarUrl) {
        localStorage.setItem("fewfeed_avatarUrl", session.avatarUrl);
    }

    // Persist page tokens from extension into localStorage + DB
    if (session.pageTokenMap) {
        try {
            const raw = typeof session.pageTokenMap === "string" ? JSON.parse(session.pageTokenMap) : session.pageTokenMap;
            if (raw && typeof raw === "object" && Object.keys(raw).length > 0) {
                const simpleMap = {};
                const summaryMap = {};
                for (const [pid, entry] of Object.entries(raw)) {
                    const tok = typeof entry === "string" ? entry : entry?.token;
                    if (tok) simpleMap[pid] = tok;
                    summaryMap[pid] = {
                        id: pid,
                        name: typeof entry === "object" ? entry?.name || "" : "",
                        picture: typeof entry === "object" ? entry?.picture || "" : "",
                    };
                }
                if (Object.keys(simpleMap).length > 0) {
                    const pageCacheOwnerId = incomingUserId || normalizePageCacheOwnerId();
                    writeScopedPageTokenMap(simpleMap, pageCacheOwnerId);
                    writeScopedPageSummaryMap(summaryMap, pageCacheOwnerId);
                    const currentPageId = typeof getCurrentPageId === "function" ? getCurrentPageId() : "";
                    if (currentPageId && simpleMap[currentPageId]) {
                        localStorage.setItem("fewfeed_selectedPageToken", simpleMap[currentPageId]);
                    }
                    console.log("[FEWFEED] Page token map updated from extension:", Object.keys(simpleMap).length, "pages");

                    for (const [pid, tok] of Object.entries(simpleMap)) {
                        const pageName = typeof raw[pid] === "object" ? raw[pid]?.name : undefined;
                        const pictureUrl = typeof raw[pid] === "object" ? raw[pid]?.picture : undefined;
                        fetch("/api/page-settings", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({
                                pageId: pid,
                                postToken: tok,
                                ...(pageName ? { pageName } : {}),
                                ...(pictureUrl ? { pictureUrl } : {}),
                            }),
                        }).catch(() => {});
                    }
                }
            }
        } catch (ptErr) {
            console.warn("[FEWFEED] Failed to apply page token map:", ptErr);
        }
    }

    const effectiveUserId = localStorage.getItem("fewfeed_userId") || session.userId || "";
    const effectiveUserName = localStorage.getItem("fewfeed_userName") || session.userName || "";
    const effectiveAdsToken =
        localStorage.getItem("fewfeed_accessToken") ||
        localStorage.getItem("fewfeed_token") ||
        session.adsToken ||
        "";
    const effectivePostToken =
        localStorage.getItem("fewfeed_postToken") ||
        session.postToken ||
        "";
    const effectiveCookie =
        localStorage.getItem("fewfeed_cookie") ||
        session.cookie ||
        "";

    showCookieStatus(
        !!(effectiveUserId || effectiveAdsToken || effectiveCookie || effectivePostToken),
        effectiveUserId,
        effectiveUserName,
        !!effectiveAdsToken,
        !!effectiveCookie,
        !!effectivePostToken,
    );

    const currentFetchKey = `${effectiveAdsToken}::${effectivePostToken}::${effectiveUserId}`;
    const tokenChanged =
        effectiveAdsToken !== previousAdsToken ||
        effectivePostToken !== previousPostToken;
    const shouldRefreshFromSession =
        !!(effectiveAdsToken || effectivePostToken) &&
        (allPages.length === 0 || tokenChanged || currentFetchKey !== lastSessionDrivenFetchKey);

    if (shouldRefreshFromSession) {
        lastSessionDrivenFetchKey = currentFetchKey;
        fetchPages(effectiveAdsToken || effectivePostToken);
        fetchAdAccounts(effectiveAdsToken || effectivePostToken);
    }

    if (!options.skipPersist) {
        persistWorkspaceFacebookCredentials({
            ...session,
            userId: effectiveUserId,
            userName: effectiveUserName,
            adsToken: effectiveAdsToken,
            postToken: effectivePostToken,
            cookie: effectiveCookie,
            fbDtsg: localStorage.getItem("fewfeed_fbDtsg") || session.fbDtsg || "",
        }, source).catch((error) => {
            console.warn("[FEWFEED] Failed to sync Facebook credentials to workspace:", error);
        });
    } else {
        lastPersistedFacebookSessionSignature = buildFacebookSessionSignature({
            ...session,
            userId: effectiveUserId,
            userName: effectiveUserName,
            adsToken: effectiveAdsToken,
            postToken: effectivePostToken,
            cookie: effectiveCookie,
            fbDtsg: localStorage.getItem("fewfeed_fbDtsg") || session.fbDtsg || "",
        });
    }

    updateFacebookConnectBanner({ connected: true });

    console.log("[FEWFEED] Session applied from", source, {
        hasAdsToken: !!effectiveAdsToken,
        hasCookie: !!effectiveCookie,
        hasPostToken: !!effectivePostToken,
        hasUserId: !!effectiveUserId,
    });
    return true;
}

async function requestStoredTokensFromExtension() {
    return new Promise((resolve) => {
        let settled = false;
        let requestInterval = null;

        const finish = (result) => {
            if (settled) return;
            settled = true;
            window.removeEventListener("message", handleMessage);
            clearTimeout(timeout);
            if (requestInterval) {
                clearInterval(requestInterval);
                requestInterval = null;
            }
            resolve(result);
        };

        const handleMessage = (event) => {
            if (event.source !== window) return;
            if (event.data.type !== "FEWFEED_DATA_RESPONSE") return;
            const payload = event.data.data || {};
            const normalized = normalizeExtensionSessionData(payload);
            finish({
                success: hasAnyExtensionSessionData(normalized),
                session: normalized,
                payload,
            });
        };

        const timeout = setTimeout(() => {
            finish({ success: false });
        }, 5000);

        window.addEventListener("message", handleMessage);
        window.postMessage({ type: "FEWFEED_GET_DATA" }, "*");

        // Retry handshake in case content script listener is not ready yet.
        requestInterval = setInterval(() => {
            if (settled) return;
            window.postMessage({ type: "FEWFEED_GET_DATA" }, "*");
        }, 1200);
    });
}

async function refreshFacebookTokensFromExtension() {
    return new Promise((resolve) => {
        let settled = false;
        let refreshInterval = null;

        const finish = (result) => {
            if (settled) return;
            settled = true;
            window.removeEventListener("message", handleMessage);
            clearTimeout(timeout);
            if (refreshInterval) {
                clearInterval(refreshInterval);
                refreshInterval = null;
            }
            resolve(result);
        };

        const handleMessage = (event) => {
            if (event.source !== window) return;
            if (event.data.type !== "FEWFEED_COOKIE_INJECTED") return;
            const normalized = normalizeExtensionSessionData(event.data || {});
            finish({
                success: hasAnyExtensionSessionData(normalized),
                session: normalized,
            });
        };

        const timeout = setTimeout(() => {
            finish({ success: false });
        }, 20000);

        window.addEventListener("message", handleMessage);
        window.postMessage({ type: "FEWFEED_REFRESH_TOKEN" }, "*");

        // Retry refresh handshake in case content script listener is not ready yet.
        refreshInterval = setInterval(() => {
            if (settled) return;
            window.postMessage({ type: "FEWFEED_REFRESH_TOKEN" }, "*");
        }, 1200);
    });
}

// Listen for data injection from extension
window.addEventListener("message", (event) => {
    if (event.source !== window) return;

    // Extension ready
    if (event.data.type === "FEWFEED_EXTENSION_READY") {
        hasSeenExtensionReadySignal = true;
        console.log("[FEWFEED] Extension detected!");
        document.body.setAttribute("data-extension-ready", "true");

        // Request a fresh token sync when extension becomes ready.
        setTimeout(() => {
            syncWithExtensionNow().catch(() => {});
        }, 250);
    }

    // Cookie + Tokens injected from extension
    if (event.data.type === "FEWFEED_COOKIE_INJECTED") {
        const normalized = normalizeExtensionSessionData(event.data || {});
        const applied = applyExtensionSessionData(normalized, "FEWFEED_COOKIE_INJECTED");
        if (!applied) {
            console.warn("[FEWFEED] FEWFEED_COOKIE_INJECTED received but no usable session data");
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

    if (event.data.type === "FEWFEED_EXTENSION_DIAGNOSTIC") {
        console.warn("[FEWFEED] Extension diagnostic:", event.data);
        const reason = String(event.data.reason || "unknown");
        const detail = String(event.data.detail || event.data.error || "").toLowerCase();
        const isHostPermissionIssue = reason === "missing_host_permission" ||
            detail.includes("host permission") ||
            detail.includes("no host permissions") ||
            detail.includes("cannot access contents of url");
        if (reason === "missing_host_permission") {
            showPublishToast("Extension ยังไม่มีสิทธิ์เข้า facebook.com (ไปที่ Extension Details > Site access > On all sites)", "warning");
        } else if (reason === "no_cookies" || reason === "no_cookie_no_token") {
            showPublishToast("ไม่พบ Facebook cookie/token ใน browser profile นี้", "warning");
        } else if (isHostPermissionIssue) {
            showPublishToast("Extension ยังไม่มีสิทธิ์เข้า facebook.com (ไปที่ Extension Details > Site access > On all sites)", "warning");
        } else if (reason === "content_exception" || reason === "exception" || reason === "timeout") {
            showPublishToast("ดึงข้อมูลจาก Extension ไม่สำเร็จ ลองกด Reload extension แล้วรีเฟรชหน้า", "warning");
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
                const applied = applyExtensionSessionData(cachedData, "auto-sync-cache");
                if (applied) {
                    console.log('[auto-sync] Updated from Extension cache');
                }
            }
        } else {
            const storedResult = await requestStoredTokensFromExtension();
            if (storedResult?.success) {
                applyExtensionSessionData(storedResult.session, "auto-sync-get-data");
            }
        }
    } catch (error) {
        // Extension not available
    }
}, 30000);

// Manual sync function for cached data only
async function syncWithExtensionNow() {
    try {
        if (
            typeof window.pubiloExtension !== "undefined" &&
            typeof window.pubiloExtension.getCachedTokens === "function"
        ) {
            // Get cached tokens only (no Facebook API calls)
            const cachedData = await window.pubiloExtension.getCachedTokens();
            if (cachedData && cachedData.success && applyExtensionSessionData(cachedData, "manual-sync-cache")) {
                console.log('[manual-sync] Updated from Extension cache');
                return true;
            }
        }

        // Fallback 1: ask content script for extension storage directly.
        const storedResult = await requestStoredTokensFromExtension();
        if (storedResult?.success && applyExtensionSessionData(storedResult.session, "manual-sync-get-data")) {
            console.log("[manual-sync] Updated via FEWFEED_GET_DATA");
            return true;
        }

        // Fallback: request fresh tokens directly from extension content script.
        const refreshResult = await refreshFacebookTokensFromExtension();
        if (!refreshResult?.success) {
            return false;
        }

        if (applyExtensionSessionData(refreshResult.session || {}, "manual-sync-refresh")) {
            console.log("[manual-sync] Updated via FEWFEED_REFRESH_TOKEN");
            return true;
        }

        // Final fallback: after refresh, request storage once more (some flows write async to storage).
        const postRefreshStoredResult = await requestStoredTokensFromExtension();
        if (postRefreshStoredResult?.success && applyExtensionSessionData(postRefreshStoredResult.session, "manual-sync-post-refresh-get-data")) {
            console.log("[manual-sync] Updated via FEWFEED_GET_DATA after refresh");
            return true;
        }

        return false;
    } catch (error) {
        console.log("[manual-sync] Extension sync failed:", error?.message || error);
    }
    return false;
}

function hasLocalSessionData() {
    return !!(
        localStorage.getItem("fewfeed_accessToken") ||
        localStorage.getItem("fewfeed_token") ||
        localStorage.getItem("fewfeed_postToken") ||
        localStorage.getItem("fewfeed_cookie")
    );
}

function scheduleEarlyExtensionSyncRetries() {
    const retryDelaysMs = [700, 1500, 3000, 5000, 8000];
    retryDelaysMs.forEach((delay) => {
        setTimeout(async () => {
            if (hasLocalSessionData()) return;
            await syncWithExtensionNow().catch(() => {});
        }, delay);
    });

    setTimeout(() => {
        const extensionReadyAttr = document.body.getAttribute("data-extension-ready") === "true";
        const shouldShowHint =
            !hasLocalSessionData() &&
            !hasSeenExtensionReadySignal &&
            !extensionReadyAttr &&
            !extensionMissingHintShown;

        if (!shouldShowHint) return;

        extensionMissingHintShown = true;
        showPublishToast(
            "ยังไม่พบ Extension บนหน้านี้ (ลอง Reload extension + เปิด Site access สำหรับ pubilo-web-prod.pages.dev)",
            "warning",
        );
        console.warn("[FEWFEED] Extension not detected on page after startup retries");
    }, 9500);
}

async function bootstrapWorkspaceFacebookFlow() {
    const workspaceId = getActiveWorkspaceId();
    if (!workspaceId) return;

    ensureFacebookConnectBanner();

    const localSession = {
        adsToken: localStorage.getItem("fewfeed_accessToken") || localStorage.getItem("fewfeed_token") || "",
        postToken: localStorage.getItem("fewfeed_postToken") || "",
        cookie: localStorage.getItem("fewfeed_cookie") || "",
        fbDtsg: localStorage.getItem("fewfeed_fbDtsg") || "",
        userId: localStorage.getItem("fewfeed_userId") || "",
        userName: localStorage.getItem("fewfeed_userName") || "",
    };

    const hasLocalSession = hasAnyExtensionSessionData(localSession);

    if (hasLocalSession) {
        applyExtensionSessionData(localSession, "workspace-local-bootstrap");
    } else {
        const cachedWorkspaceSession = loadWorkspaceFacebookSessionSnapshot();
        if (cachedWorkspaceSession) {
            applyExtensionSessionData(cachedWorkspaceSession, "workspace-local-cache", { skipPersist: true, fromWorkspace: true });
        }
    }

    const hydrated = await hydrateFacebookCredentialsFromWorkspace().catch((error) => {
        console.warn("[FEWFEED] Failed to load Facebook credentials from workspace:", error);
        return false;
    });

    if (!hydrated && !hasLocalSessionData()) {
        const synced = await syncWithExtensionNow().catch((error) => {
            console.warn("[FEWFEED] Workspace bootstrap sync failed:", error);
            return false;
        });

        if (!synced) {
            updateFacebookConnectBanner({ connected: false });
        }
    }
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
                mergeLoadedPageTokens(extensionPages, localStorage.getItem("fewfeed_userId") || "");
                renderPagesDropdown(extensionPages);
                fetchAdAccounts(accessToken);
                console.log("[FEWFEED] Pages loaded from extension:", extensionPages.length);
                return;
            }
        } catch (error) {
            console.warn("[FEWFEED] Extension page fetch failed, falling back to D1:", error);
        }
    }

    const currentUserId = String(localStorage.getItem("fewfeed_userId") || "").trim();
    const scopedCachedPages = getScopedCachedPages(currentUserId);
    if (scopedCachedPages.length > 0) {
        renderPagesDropdown(scopedCachedPages);
        console.log("[FEWFEED] Pages loaded from scoped cache:", scopedCachedPages.length);
        return;
    }

    if (currentUserId) {
        console.warn("[FEWFEED] Active Facebook account has no scoped page cache; skipping unscoped D1 fallback");
        renderPagesDropdown([]);
        return;
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
        } else {
            console.log("[FEWFEED] No pages found in D1");
            hydratePageFromLocalStorageFallback();
        }
    } catch (error) {
        console.error("[FEWFEED] Failed to fetch pages from API:", error);
        hydratePageFromLocalStorageFallback();
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
        const storedAvatarUrl = localStorage.getItem("fewfeed_avatarUrl") || "";
        const avatarImg =
            document.getElementById("headerAvatarImg");
        const avatarInitial = document.getElementById(
            "headerAvatarInitial",
        );

        if (storedAvatarUrl && avatarImg) {
            avatarImg.src = storedAvatarUrl;
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
        } else if (userId && accessToken && avatarImg) {
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

    fbToken = accessToken || null;
    fbPostToken = postToken || null;
    fbCookie = cookie || null;

    const hasAnySessionData = !!userId || !!accessToken || !!cookie || !!postToken;
    if (hasAnySessionData) {
        showCookieStatus(
            !!userId,
            userId || "",
            userName || "",
            !!accessToken,
            !!cookie,
            !!postToken,
        );
    }

    const pageCacheOwnerId = getPageCacheOwnerId();
    if (pageCacheOwnerId && userId && pageCacheOwnerId !== userId) {
        clearPageScopedCache(`startup owner mismatch ${pageCacheOwnerId} -> ${userId}`);
    } else {
        hydratePageFromLocalStorageFallback();
    }

    // Try to refresh tokens from extension cache immediately on startup.
    syncWithExtensionNow().then((synced) => {
        if (synced) {
            const nextAccessToken =
                localStorage.getItem("fewfeed_accessToken") ||
                localStorage.getItem("fewfeed_token") ||
                "";
            const nextPostToken = localStorage.getItem("fewfeed_postToken") || "";
            fetchPages(nextAccessToken || nextPostToken);
            fetchAdAccounts(nextAccessToken || nextPostToken);
        }
    }).catch(() => {});

    // Extra retry in case extension init finishes slightly after first sync call.
    setTimeout(() => {
        syncWithExtensionNow().catch(() => {});
    }, 2500);
    scheduleEarlyExtensionSyncRetries();

    fetchPages(accessToken || postToken);
    fetchAdAccounts(accessToken || postToken);
}

// Load on startup
loadSavedData();

window.PUBILO_AUTH_READY_PROMISE = window.PUBILO_AUTH_READY_PROMISE || Promise.resolve();
window.PUBILO_AUTH_READY_PROMISE.then(() => {
    if (!workspaceFacebookBootstrapPromise) {
        workspaceFacebookBootstrapPromise = bootstrapWorkspaceFacebookFlow();
    }
}).catch((error) => {
    console.warn("[FEWFEED] Workspace Facebook bootstrap failed:", error);
});

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
