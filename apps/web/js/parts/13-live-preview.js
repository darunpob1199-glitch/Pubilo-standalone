/**
 * 13-live-preview.js
 * Live typing preview for Facebook One Card Link Ad
 * Syncs Primary Text input → fb-preview-text with typewriter cursor
 * Also syncs page avatar + name from sidebar page selector
 */
(function () {
    'use strict';

    // --- Config ---
    const TYPING_DEBOUNCE_MS = 80;
    const CURSOR_HIDE_DELAY_MS = 1500;

    // --- Mapping: input ID → preview text element ID ---
    const TEXT_MAPPINGS = [
        { input: 'newsPrimaryText', preview: 'newsFbPreviewText' },
        { input: 'primaryText', preview: 'linkFbPreviewText' },
        { input: 'imagePrimaryText', preview: 'imageFbPreviewText' },
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
        const cursor = preview.querySelector('.typing-cursor');

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
        // Bind text inputs → preview
        TEXT_MAPPINGS.forEach(({ input, preview }) => {
            const el = document.getElementById(input);
            if (!el) return;

            const handler = debounce(() => {
                updatePreviewText(input, preview);
            }, TYPING_DEBOUNCE_MS);

            el.addEventListener('input', handler);
            el.addEventListener('change', handler);

            // Initial sync
            if (el.value) updatePreviewText(input, preview);
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
