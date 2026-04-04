// 7. QUOTES
// ============================================
const quotesTableContainer = document.getElementById("quotesTableContainer");

let quotesOffset = 0;
let quotesTotal = 0;
let quotesHasMore = false;
let quotesLoading = false;
let quotesFilter = 'unused';

// Tabs click handlers
const quotesTabUnused = document.getElementById("quotesTabUnused");
const quotesTabUsed = document.getElementById("quotesTabUsed");

quotesTabUnused.addEventListener("click", () => {
    quotesFilter = 'unused';
    quotesTabUnused.style.color = '#1877f2';
    quotesTabUnused.style.borderBottom = '2px solid #1877f2';
    quotesTabUsed.style.color = '#666';
    quotesTabUsed.style.borderBottom = '2px solid transparent';
    loadQuotes();
});

quotesTabUsed.addEventListener("click", () => {
    quotesFilter = 'used';
    quotesTabUsed.style.color = '#1877f2';
    quotesTabUsed.style.borderBottom = '2px solid #1877f2';
    quotesTabUnused.style.color = '#666';
    quotesTabUnused.style.borderBottom = '2px solid transparent';
    loadQuotes();
});

// Add Quote Modal
const addQuoteModal = document.getElementById("addQuoteModal");
const addQuoteBtn = document.getElementById("addQuoteBtn");
const closeQuoteModal = document.getElementById("closeQuoteModal");
const cancelQuoteBtn = document.getElementById("cancelQuoteBtn");
const saveQuoteBtn = document.getElementById("saveQuoteBtn");
const newQuoteText = document.getElementById("newQuoteText");

if (addQuoteBtn) {
    addQuoteBtn.addEventListener("click", () => {
        addQuoteModal.style.display = "flex";
        newQuoteText.value = "";
        newQuoteText.focus();
    });
}

if (closeQuoteModal) {
    closeQuoteModal.addEventListener("click", () => {
        addQuoteModal.style.display = "none";
    });
}

if (cancelQuoteBtn) {
    cancelQuoteBtn.addEventListener("click", () => {
        addQuoteModal.style.display = "none";
    });
}

if (addQuoteModal) {
    addQuoteModal.addEventListener("click", (e) => {
        if (e.target === addQuoteModal) {
            addQuoteModal.style.display = "none";
        }
    });
}

if (saveQuoteBtn) {
    saveQuoteBtn.addEventListener("click", async () => {
        const text = newQuoteText.value.trim();
        if (!text) {
            alert("กรุณาพิมพ์คำคม");
            return;
        }

        saveQuoteBtn.disabled = true;
        saveQuoteBtn.textContent = "กำลังบันทึก...";

        try {
            const response = await fetch("/api/quotes", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ quoteText: text })
            });
            const data = await response.json();

            if (data.success) {
                addQuoteModal.style.display = "none";
                loadQuotes();
            } else {
                alert("เกิดข้อผิดพลาด: " + data.error);
            }
        } catch (error) {
            alert("เกิดข้อผิดพลาด: " + error.message);
        } finally {
            saveQuoteBtn.disabled = false;
            saveQuoteBtn.textContent = "บันทึก";
        }
    });
}

// Infinite scroll for quotes (using container scroll)
quotesTableContainer.addEventListener("scroll", () => {
    if (quotesLoading || !quotesHasMore) return;
    const { scrollTop, scrollHeight, clientHeight } = quotesTableContainer;
    // Load more when 200px from bottom
    if (scrollTop + clientHeight >= scrollHeight - 200) {
        loadQuotes(true);
    }
});

async function loadQuotes(append = false) {
    if (quotesLoading) return;
    quotesLoading = true;
    try {
        if (!append) {
            quotesOffset = 0;
            quotesTableContainer.innerHTML = `
                <div class="pending-skeleton">
                  <div class="pending-skeleton-row"><div class="sk-text" style="width: 80%;"></div><div class="sk-date"></div></div>
                  <div class="pending-skeleton-row"><div class="sk-text" style="width: 80%;"></div><div class="sk-date"></div></div>
                  <div class="pending-skeleton-row"><div class="sk-text" style="width: 80%;"></div><div class="sk-date"></div></div>
                </div>
            `;
        }
        const pageId = getCurrentPageId();
        const response = await fetch(`/api/quotes?limit=50&offset=${quotesOffset}&filter=${quotesFilter}${pageId ? '&pageId=' + pageId : ''}`);
        const data = await response.json();
        if (data.success) {
            quotesTotal = data.total;
            quotesHasMore = data.hasMore;
            quotesOffset += data.quotes.length;
            renderQuotes(data.quotes, append);
            // Update counts
            if (data.unusedCount !== undefined) {
                document.getElementById("quotesCountUnused").textContent = data.unusedCount;
            }
            if (data.usedCount !== undefined) {
                document.getElementById("quotesCountUsed").textContent = data.usedCount;
            }
        } else {
            quotesTableContainer.innerHTML = `<div class="pending-empty">${data.error}</div>`;
        }
    } catch (error) {
        console.error("[FEWFEED] Failed to load quotes:", error);
        quotesTableContainer.innerHTML = `<div class="pending-empty">Failed to load quotes</div>`;
    } finally {
        quotesLoading = false;
    }
}

function renderQuotes(quotes, append = false) {
    if (!append) {
        quotesTableContainer.textContent = "";
    }

    if (!quotes || quotes.length === 0) {
        if (!append) {
            const emptyDiv = document.createElement("div");
            emptyDiv.className = "pending-empty";
            emptyDiv.textContent = "ยังไม่มีคำคม";
            quotesTableContainer.appendChild(emptyDiv);
        }
        return;
    }

    let table = quotesTableContainer.querySelector("table");
    let tbody;

    if (!table) {
        table = document.createElement("table");
        table.className = "pending-table";
        table.innerHTML = `
            <thead>
                <tr>
                    <th style="width: 75%;">คำคม</th>
                    <th style="width: 20%;">วันที่</th>
                    <th style="width: 5%;"></th>
                </tr>
            </thead>
        `;
        tbody = document.createElement("tbody");
        table.appendChild(tbody);
        quotesTableContainer.appendChild(table);
    } else {
        tbody = table.querySelector("tbody");
    }

    quotes.forEach(quote => {
        const tr = document.createElement("tr");
        tr.dataset.quoteId = quote.id;
        tr.dataset.quoteText = quote.quote_text; // Store raw text in data attribute
        if (quote.isUsed && quotesFilter === 'used') {
            tr.classList.add("quote-row-used");
        }
        const date = new Date(quote.created_at);
        // Build HTML without extra whitespace in quote cell
        const quoteHtml = escapeHtml(quote.quote_text.trim());
        // Only show badge in "used" tab
        const badgeHtml = (quote.isUsed && quotesFilter === 'used') ? ' <span class="quote-used-badge">ใช้แล้ว</span>' : '';
        tr.innerHTML = `<td class="quote-text-cell" style="white-space: pre-wrap; word-break: break-word;" title="ดับเบิลคลิกเพื่อแก้ไข">${quoteHtml}${badgeHtml}</td><td style="color: #888; font-size: 0.85rem;">${date.toLocaleDateString('th-TH')} ${date.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })}</td><td style="text-align: center;"><button onclick="deleteQuote(${quote.id}, this)" style="background: none; border: none; color: #e74c3c; cursor: pointer; padding: 0.5rem;" title="ลบ"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg></button></td>`;
        // Add double-click handler for editing
        const textCell = tr.querySelector('.quote-text-cell');
        textCell.addEventListener('dblclick', () => startEditQuote(quote.id, textCell));
        tbody.appendChild(tr);
    });
}

function escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
}

window.deleteQuote = async function(id, btn) {
    try {
        const row = btn.closest("tr");
        // Replace trash icon with spinner
        const originalIcon = btn.innerHTML;
        btn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="animation: spin 1s linear infinite;">
            <circle cx="12" cy="12" r="10" stroke-dasharray="31.4" stroke-dashoffset="10"></circle>
        </svg>`;
        btn.disabled = true;

        const response = await fetch(`/api/quotes?id=${id}`, { method: "DELETE" });
        const data = await response.json();
        if (data.success) {
            if (row) row.remove();
            const tbody = quotesTableContainer.querySelector("tbody");
            if (tbody && tbody.children.length === 0) {
                quotesTableContainer.innerHTML = '<div class="pending-empty">ยังไม่มีคำคม</div>';
            }
        } else {
            btn.innerHTML = originalIcon;
            btn.disabled = false;
            alert("ลบไม่สำเร็จ: " + data.error);
        }
    } catch (error) {
        console.error("[FEWFEED] Failed to delete quote:", error);
        alert("ลบไม่สำเร็จ");
    }
};

// Inline quote editing
function startEditQuote(quoteId, cell) {
    // Skip if already editing
    if (cell.querySelector('textarea')) return;

    // Get original text from data attribute (cleaner than textContent)
    const row = cell.closest('tr');
    const originalText = row.dataset.quoteText || cell.textContent.replace(/ใช้แล้ว$/, '').trim();
    const isUsed = row.classList.contains('quote-row-used');
    const textarea = document.createElement('textarea');
    textarea.value = originalText;
    textarea.style.cssText = `
        width: 100%;
        min-height: 100px;
        max-height: 300px;
        padding: 0.75rem;
        border: 2px solid #9b59b6;
        border-radius: 8px;
        font-size: 0.95rem;
        line-height: 1.5;
        resize: vertical;
        font-family: inherit;
        background: #fff;
        color: #333;
        box-shadow: 0 2px 8px rgba(155, 89, 182, 0.2);
        outline: none;
        box-sizing: border-box;
    `;

    cell.textContent = '';
    cell.appendChild(textarea);
    textarea.focus();

    // Auto-resize textarea to fit content
    textarea.style.height = 'auto';
    textarea.style.height = Math.min(Math.max(textarea.scrollHeight, 100), 300) + 'px';
    textarea.select();

    // Helper to rebuild cell content
    const rebuildCell = (text) => {
        const badgeHtml = isUsed ? ' <span class="quote-used-badge">ใช้แล้ว</span>' : '';
        cell.innerHTML = escapeHtml(text) + badgeHtml;
        row.dataset.quoteText = text;
    };

    // Save on blur or Enter (Shift+Enter for new line)
    const saveEdit = async () => {
        const newText = textarea.value.trim();
        if (!newText) {
            rebuildCell(originalText);
            return;
        }
        if (newText === originalText.trim()) {
            rebuildCell(originalText);
            return;
        }

        textarea.disabled = true;
        textarea.style.opacity = '0.5';

        try {
            const response = await fetch('/api/quotes', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: quoteId, quoteText: newText })
            });
            const data = await response.json();
            if (data.success) {
                rebuildCell(newText);
            } else {
                rebuildCell(originalText);
                alert('แก้ไขไม่สำเร็จ: ' + data.error);
            }
        } catch (error) {
            console.error('[FEWFEED] Failed to update quote:', error);
            rebuildCell(originalText);
            alert('แก้ไขไม่สำเร็จ');
        }
    };

    let saving = false;
    textarea.addEventListener('blur', () => {
        if (!saving) {
            saving = true;
            saveEdit();
        }
    });
    textarea.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            if (!saving) {
                saving = true;
                saveEdit();
            }
        }
        if (e.key === 'Escape') {
            rebuildCell(originalText);
        }
    });
}

// Delete pending item
window.deletePendingItem = async function (id) {
    try {
        await fetch(`/api/queue/${id}`, { method: "DELETE" });
        showPendingPanel(); // Refresh the table
        updatePendingCount();
    } catch (err) {
        console.error("Failed to delete pending item:", err);
    }
};

// Navigate to a specific page (updates URL hash)
function navigateTo(page) {
    const nextPage = String(page || "").trim();
    if (!nextPage) return;

    if (window.location.hash.slice(1) === nextPage) {
        if (typeof handleNavigation === "function") {
            handleNavigation();
        }
        return;
    }

    window.location.hash = nextPage;
}

// ============================================
