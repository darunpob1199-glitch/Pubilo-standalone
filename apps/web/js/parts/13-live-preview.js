/**
 * 13-live-preview.js
 * Live typing preview for Facebook One Card Link Ad
 * Syncs Primary Text input → fb-preview-text with typewriter cursor
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

    // --- Mapping: page selector → fb-preview avatars/names ---
    const AVATAR_MAPPINGS = [
        { avatar: 'newsFbAvatar', name: 'newsFbPageName' },
        { avatar: 'linkFbAvatar', name: 'linkFbPageName' },
        { avatar: 'imageFbAvatar', name: 'imageFbPageName' },
    ];

    let cursorTimers = {};

    /**
     * Update FB preview text with typing cursor
     */
    function updatePreviewText(inputId, previewId) {
        const input = document.getElementById(inputId);
        const preview = document.getElementById(previewId);
        if (!input || !preview) return;

        const text = input.value || '';

        // Set text content, preserving whitespace
        if (text) {
            // Build: textNode + cursor
            preview.innerHTML = '';
            const textNode = document.createTextNode(text);
            preview.appendChild(textNode);
            
            const cursorEl = document.createElement('span');
            cursorEl.className = 'typing-cursor is-active';
            preview.appendChild(cursorEl);

            // Hide cursor after delay
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

        // Color coding
        counter.classList.remove('is-warning', 'is-danger');
        if (len >= MAX_CHARS) {
            counter.classList.add('is-danger');
        } else if (len >= MAX_CHARS * 0.8) {
            counter.classList.add('is-warning');
        }
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
     * Initialize all live-preview bindings
     */
    function init() {
        // Bind text inputs → preview + char counter
        TEXT_MAPPINGS.forEach(({ input, preview, counter }) => {
            const el = document.getElementById(input);
            if (!el) return;

            const handler = debounce(() => {
                updatePreviewText(input, preview);
            }, TYPING_DEBOUNCE_MS);

            // Char counter updates immediately (no debounce)
            const counterHandler = () => {
                updateCharCounter(input, counter);
            };

            el.addEventListener('input', (e) => {
                handler();
                counterHandler();
            });
            el.addEventListener('change', (e) => {
                handler();
                counterHandler();
            });

            // Initial sync
            if (el.value) {
                updatePreviewText(input, preview);
                updateCharCounter(input, counter);
            }
        });

        // Watch for page selector changes (MutationObserver on page name)
        const pageNameEl = document.getElementById('previewPageName');
        if (pageNameEl) {
            const observer = new MutationObserver(() => {
                syncPageInfo();
            });
            observer.observe(pageNameEl, { childList: true, characterData: true, subtree: true });
        }

        // Also watch avatar image src changes
        const avatarImg = document.getElementById('previewAvatarImg');
        if (avatarImg) {
            const observer = new MutationObserver(() => {
                syncPageInfo();
            });
            observer.observe(avatarImg, { attributes: true, attributeFilter: ['src'] });
        }

        // Initial page info sync
        setTimeout(syncPageInfo, 500);

        console.log('[LivePreview] Initialized');
    }

    // Wait for DOM ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        // DOM already loaded, init after a tick to let other scripts run
        setTimeout(init, 100);
    }
})();
