/**
 * 13-live-preview.js
 * Live typing preview for Facebook One Card Link Ad
 * Syncs: Primary Text → preview, URL → domain, พิกัด → description
 * Also syncs page avatar + name from sidebar page selector
 * Includes character counter (0/220)
 */
(function () {
    'use strict';

    // --- Config ---
    const TYPING_DEBOUNCE_MS = 80;
    const CURSOR_HIDE_DELAY_MS = 1500;
    const MAX_CHARS = 220;

    // --- Mapping: input ID → preview text element ID + char counter ID ---
    const TEXT_MAPPINGS = [
        { input: 'newsPrimaryText', preview: 'newsFbPreviewText', counter: 'newsCharCounter' },
        { input: 'primaryText', preview: 'linkFbPreviewText', counter: 'linkCharCounter' },
        { input: 'imagePrimaryText', preview: 'imageFbPreviewText', counter: 'imageCharCounter' },
    ];

    // --- Mapping: URL input → domain display in card link info ---
    const URL_MAPPINGS = [
        { input: 'newsUrlInput', caption: 'newsPreviewCaption' },
        { input: 'linkUrl', caption: 'previewCaption' },
    ];

    // --- Mapping: พิกัด input → description display in card link info ---
    const DESC_MAPPINGS = [
        { input: 'newsDescriptionInput', desc: 'newsPreviewDescription' },
        { input: 'linkDescriptionInput', desc: 'previewDescription' },
    ];

    // --- Mapping: page selector → fb-preview avatars/names ---
    const AVATAR_MAPPINGS = [
        { avatar: 'newsFbAvatar', name: 'newsFbPageName' },
        { avatar: 'linkFbAvatar', name: 'linkFbPageName' },
        { avatar: 'imageFbAvatar', name: 'imageFbPageName' },
    ];

    let cursorTimers = {};

    /**
     * Extract domain from URL string
     */
    function extractDomain(url) {
        if (!url) return '';
        try {
            // Add protocol if missing
            let u = url.trim();
            if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
            const hostname = new URL(u).hostname;
            return hostname.toUpperCase().replace(/^WWW\./, '');
        } catch (e) {
            // Fallback: just uppercase the input
            return url.toUpperCase().replace(/^https?:\/\//i, '').replace(/\/.*$/, '').replace(/^WWW\./, '');
        }
    }

    /**
     * Update FB preview text with typing cursor
     */
    function updatePreviewText(inputId, previewId) {
        const input = document.getElementById(inputId);
        const preview = document.getElementById(previewId);
        if (!input || !preview) return;

        const text = input.value || '';

        if (text) {
            preview.innerHTML = '';
            const textNode = document.createTextNode(text);
            preview.appendChild(textNode);
            
            const cursorEl = document.createElement('span');
            cursorEl.className = 'typing-cursor is-active';
            preview.appendChild(cursorEl);

            if (cursorTimers[previewId]) clearTimeout(cursorTimers[previewId]);
            cursorTimers[previewId] = setTimeout(() => {
                cursorEl.classList.remove('is-active');
            }, CURSOR_HIDE_DELAY_MS);
        } else {
            preview.innerHTML = '<span class="typing-cursor"></span>';
        }
    }

    /**
     * Update character counter
     */
    function updateCharCounter(inputId, counterId) {
        const input = document.getElementById(inputId);
        const counter = document.getElementById(counterId);
        if (!input || !counter) return;

        const len = (input.value || '').length;
        counter.textContent = len + '/' + MAX_CHARS;

        counter.classList.remove('is-warning', 'is-danger');
        if (len >= MAX_CHARS) {
            counter.classList.add('is-danger');
        } else if (len >= MAX_CHARS * 0.8) {
            counter.classList.add('is-warning');
        }
    }

    /**
     * Update domain display from URL input
     */
    function updateDomainPreview(inputId, captionId) {
        const input = document.getElementById(inputId);
        const caption = document.getElementById(captionId);
        if (!input || !caption) return;

        const domain = extractDomain(input.value);
        caption.textContent = domain || 'DOMAIN.COM';
    }

    /**
     * Update description display from พิกัด input
     */
    function updateDescPreview(inputId, descId) {
        const input = document.getElementById(inputId);
        const desc = document.getElementById(descId);
        if (!input || !desc) return;

        desc.textContent = input.value || '';
    }

    /**
     * Sync page avatar + name from sidebar to all FB preview headers
     */
    function syncPageInfo() {
        const avatarImg = document.getElementById('previewAvatarImg');
        const pageName = document.getElementById('previewPageName');

        const avatarSrc = avatarImg ? avatarImg.src : '';
        const nameText = pageName ? pageName.textContent : 'Page Name';

        AVATAR_MAPPINGS.forEach(({ avatar, name }) => {
            const avatarEl = document.getElementById(avatar);
            const nameEl = document.getElementById(name);

            if (avatarEl && avatarSrc) {
                avatarEl.src = avatarSrc;
                avatarEl.style.display = 'block';
            }
            if (nameEl) {
                nameEl.textContent = nameText || 'Page Name';
            }
        });
    }

    /**
     * Create debounced version of a function
     */
    function debounce(fn, ms) {
        let timer;
        return function (...args) {
            clearTimeout(timer);
            timer = setTimeout(() => fn.apply(this, args), ms);
        };
    }

    /**
     * Bind input → handler with input + change events
     */
    function bindInput(inputId, handler) {
        const el = document.getElementById(inputId);
        if (!el) return;
        el.addEventListener('input', handler);
        el.addEventListener('change', handler);
        // Initial sync
        if (el.value) handler();
    }

    /**
     * Initialize all live-preview bindings
     */
    function init() {
        // 1. Primary Text → preview + char counter
        TEXT_MAPPINGS.forEach(({ input, preview, counter }) => {
            const handler = debounce(() => updatePreviewText(input, preview), TYPING_DEBOUNCE_MS);
            const counterHandler = () => updateCharCounter(input, counter);

            const el = document.getElementById(input);
            if (!el) return;

            el.addEventListener('input', () => { handler(); counterHandler(); });
            el.addEventListener('change', () => { handler(); counterHandler(); });

            if (el.value) {
                updatePreviewText(input, preview);
                updateCharCounter(input, counter);
            }
        });

        // 2. URL → domain display
        URL_MAPPINGS.forEach(({ input, caption }) => {
            bindInput(input, () => updateDomainPreview(input, caption));
        });

        // 3. พิกัด → description display
        DESC_MAPPINGS.forEach(({ input, desc }) => {
            bindInput(input, () => updateDescPreview(input, desc));
        });

        // 4. Page selector sync (MutationObserver)
        const pageNameEl = document.getElementById('previewPageName');
        if (pageNameEl) {
            const observer = new MutationObserver(() => syncPageInfo());
            observer.observe(pageNameEl, { childList: true, characterData: true, subtree: true });
        }

        const avatarImg = document.getElementById('previewAvatarImg');
        if (avatarImg) {
            const observer = new MutationObserver(() => syncPageInfo());
            observer.observe(avatarImg, { attributes: true, attributeFilter: ['src'] });
        }

        setTimeout(syncPageInfo, 500);

        console.log('[LivePreview] Initialized — text + URL + พิกัด + avatar');
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        setTimeout(init, 100);
    }
})();
