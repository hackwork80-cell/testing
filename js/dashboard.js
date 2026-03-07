// ============================================================
//  dashboard.js — Reservation dashboard logic
// ============================================================

const POLL_INTERVAL = 6000;

const LUNCH_SLOTS = [
    '12:00 PM', '12:15 PM', '12:30 PM', '12:45 PM',
    '1:00 PM', '1:15 PM', '1:30 PM', '1:45 PM',
    '2:00 PM', '2:15 PM', '2:30 PM', '2:45 PM',
    '3:00 PM', '3:15 PM', '3:30 PM', '3:45 PM',
    '4:00 PM'
];
const DINNER_SLOTS = [
    '7:00 PM', '7:15 PM', '7:30 PM', '7:45 PM',
    '8:00 PM', '8:15 PM', '8:30 PM', '8:45 PM',
    '9:00 PM', '9:15 PM', '9:30 PM', '9:45 PM',
    '10:00 PM'
];

let currentShift = 'Lunch';
let selectedDate = getTodayIST(); // From api.js helper
let allLunch = [];   // cache both shifts so we can detect cross-shift bookings
let allDinner = [];
let pollTimer = null;
let sessionUser = null;
let selectedTables = new Set();
// Returns true if it is 3:00 PM IST or later (lunch time has ended for today)
function isLunchOverForToday() {
    const now = new Date();
    const ist = new Date(now.getTime() + 5.5 * 60 * 60 * 1000);
    return ist.getUTCHours() >= 15; // 3 PM = 15:00
}

// Returns true if lunch should be blocked for the currently selected date
function isLunchBlocked() {
    const isToday = selectedDate === getTodayIST();
    return isToday && isLunchOverForToday();
}

// ── Init ─────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    requireAuth();
    sessionUser = getSessionUser();

    document.getElementById('nav-user-name').textContent = sessionUser.name;
    renderDateSelector();

    document.getElementById('btn-logout').addEventListener('click', () => {
        clearSession();
        window.location.href = 'index.html';
    });

    // Nav-level cancel button — cancels ALL of the user's active bookings
    document.getElementById('btn-cancel-nav').addEventListener('click', async () => {
        const myBookings = [...allLunch, ...allDinner].filter(
            b => b.status === 'Occupied' && b.guestName === sessionUser.name
        );
        if (!myBookings.length) {
            showToast('You have no active bookings to cancel.', '');
            return;
        }
        const label = myBookings.map(b => {
            const num = b.tableId.replace(/^[A-Z]/, '');
            return `Table ${num} (${b.shift})`;
        }).join(', ');
        if (!confirm(`Cancel your booking: ${label}?`)) return;

        showLoader(true);

        // Optimistically clear from local state
        clearLocalBookings(myBookings);
        renderCurrentShift();
        updateShiftTabLocks();
        updateNavButtons();
        selectedTables.clear();
        updateBookBar();
        showLoader(false);
        showToast('Your booking has been cancelled.', 'success');

        // 2️⃣ Fire GAS calls in background (poll will confirm)
        for (const b of myBookings) {
            try { await apiCancelBooking(b.tableId, b.shift, b.contact, selectedDate); }
            catch (err) { console.error('Cancel failed:', err); }
        }
    });

    // Nav-level download receipt button
    document.getElementById('btn-download-nav').addEventListener('click', () => {
        const myBookings = [...allLunch, ...allDinner].filter(
            b => b.status === 'Occupied' && b.guestName === sessionUser.name
        );
        if (!myBookings.length) return;

        // Use the first booking for shared metadata (time slot, group size, etc)
        const first = myBookings[0];
        const allTableIds = myBookings.map(b => b.tableId).sort((a, b) => a.localeCompare(b));

        generateTokenReceiptPDF({
            tables: allTableIds,
            shift: first.shift,
            timeSlot: first.timeSlot,
            numPeople: first.numPeople,
            guestName: first.guestName,
            whatsapp: first.contact,
            bookingDateStr: first.bookingDate
        });
    });

    // Shift toggle
    document.querySelectorAll('.shift-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const shift = btn.dataset.shift;
            if (shift === currentShift) return;

            // Block switch if user has a booking in the OTHER shift
            const lockedTo = getLockedShift();
            if (lockedTo && lockedTo !== shift) {
                showToast(`You have an active ${lockedTo} booking. Cancel it first to switch shifts.`, 'error');
                return;
            }

            // Block switching TO lunch if it is disabled or time has passed
            if (shift === 'Lunch' && isLunchBlocked()) {
                showToast('Lunch booking for today is closed. Please select Dinner slot or book for another date.', 'error');
                return;
            }

            currentShift = shift;
            selectedTables.clear();
            updateBookBar();
            document.querySelectorAll('.shift-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            renderCurrentShift();
        });
    });

    // Sticky book bar
    document.getElementById('btn-open-modal').addEventListener('click', openBookingModal);

    // Modal controls
    document.getElementById('modal-cancel').addEventListener('click', closeBookingModal);
    document.getElementById('booking-modal').addEventListener('click', e => {
        if (e.target.id === 'booking-modal') closeBookingModal();
    });
    document.getElementById('modal-confirm').addEventListener('click', handleModalConfirm);

    loadBothShifts();
    pollTimer = setInterval(loadBothShifts, POLL_INTERVAL);

    // Every 60 seconds, re-check if 3PM IST has passed to auto-lock Lunch tab
    setInterval(updateLunchDisabledUI, 60_000);
    updateLunchDisabledUI(); // also check immediately on page load
});

// ── Date Selector ─────────────────────────────────────────────
function renderDateSelector() {
    const container = document.getElementById('date-selector');
    if (!container) return;
    container.innerHTML = '';

    // We offer Today, Tomorrow, Day+2
    for (let i = 0; i < 3; i++) {
        const d = new Date();
        const ist = new Date(d.getTime() + 5.5 * 60 * 60 * 1000);
        ist.setUTCDate(ist.getUTCDate() + i);

        const y = ist.getUTCFullYear();
        const m = String(ist.getUTCMonth() + 1).padStart(2, '0');
        const day = String(ist.getUTCDate()).padStart(2, '0');
        const dateStr = `${y}-${m}-${day}`;

        let label = 'Today';
        if (i === 1) label = 'Tomorrow';
        if (i === 2) {
            const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
            const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
            label = `${days[ist.getUTCDay()]}, ${months[ist.getUTCMonth()]} ${ist.getUTCDate()}`;
        }

        const btn = document.createElement('button');
        btn.className = `date-pill ${dateStr === selectedDate ? 'active' : ''}`;
        btn.textContent = label;
        btn.dataset.date = dateStr;
        btn.dataset.label = label;

        btn.addEventListener('click', () => {
            if (selectedDate === dateStr) return;
            selectedDate = dateStr;
            document.querySelectorAll('.date-pill').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            selectedTables.clear();
            updateBookBar();
            showLoader(true);
            loadBothShifts().finally(() => showLoader(false));
        });

        container.appendChild(btn);
    }
}

// ── Fetch BOTH shifts in ONE GAS call ────────────────────────
async function loadBothShifts() {
    try {
        let both = await apiGetBothShifts(selectedDate); // single spreadsheet read

        if (both.lunch.length < 10 || both.dinner.length < 15) {
            console.warn(`Sheet data incomplete for ${selectedDate} (L:${both.lunch.length}, D:${both.dinner.length}). Run "Initialise Sheets" from admin panel.`);
        }

        allLunch = both.lunch;
        allDinner = both.dinner;

        updateLunchDisabledUI();

        // If user has a booking, auto-focus to that shift
        const lockedTo = getLockedShift();
        if (lockedTo && lockedTo !== currentShift) {
            currentShift = lockedTo;
            document.querySelectorAll('.shift-btn').forEach(b => {
                b.classList.toggle('active', b.dataset.shift === currentShift);
            });
        }

        // Remove selections that are now occupied / in wrong shift
        getCurrentBookings().forEach(b => {
            if (b.status === 'Occupied') selectedTables.delete(b.tableId);
        });

        renderCurrentShift();
        renderStats(getCurrentBookings());
        updateBookBar();
        updateShiftTabLocks();
        updateNavButtons();
    } catch (err) {
        console.error(err);
        showError();
    }
}

// Helper: returns current shift's booking array
function getCurrentBookings() {
    return currentShift === 'Lunch' ? allLunch : allDinner;
}

// Helper: returns 'Lunch' or 'Dinner' if user has booking there, else null
function getLockedShift() {
    if (allLunch.some(b => b.status === 'Occupied' && b.guestName === sessionUser.name)) return 'Lunch';
    if (allDinner.some(b => b.status === 'Occupied' && b.guestName === sessionUser.name)) return 'Dinner';
    return null;
}

// Visually lock/unlock shift tabs
function updateShiftTabLocks() {
    const lockedTo = getLockedShift();
    document.querySelectorAll('.shift-btn').forEach(btn => {
        const shift = btn.dataset.shift;
        const isLocked = lockedTo && lockedTo !== shift;
        btn.classList.toggle('shift-locked', !!isLocked);
        btn.title = isLocked ? `You have a ${lockedTo} booking — cancel it first` : '';
    });
}

function updateNavButtons() {
    const myBookings = [...allLunch, ...allDinner].filter(
        b => b.status === 'Occupied' && b.guestName === sessionUser.name
    );
    const downloadBtn = document.getElementById('btn-download-nav');
    if (downloadBtn) {
        downloadBtn.style.display = myBookings.length > 0 ? 'inline-block' : 'none';
    }
}

// Update Lunch shift tab UI based on disabled/time-expired state
function updateLunchDisabledUI() {
    const lunchBtn = document.querySelector('.shift-btn[data-shift="Lunch"]');
    if (!lunchBtn) return;

    const blocked = isLunchBlocked();
    lunchBtn.classList.toggle('shift-locked', blocked);
    lunchBtn.title = blocked ? 'Lunch booking is closed for today.' : '';

    // Auto-switch to Dinner if currently on a blocked Lunch tab
    if (blocked && currentShift === 'Lunch') {
        const dinnerBtn = document.querySelector('.shift-btn[data-shift="Dinner"]');
        if (dinnerBtn) {
            currentShift = 'Dinner';
            document.querySelectorAll('.shift-btn').forEach(b => b.classList.remove('active'));
            dinnerBtn.classList.add('active');
            renderCurrentShift();
        }
        showToast('Lunch booking for today is closed. Please select Dinner slot or book for another date.', 'error');
    }
}

// ── Skeleton loading ──────────────────────────────────────────
function showSkeletons() {
    const count = currentShift === 'Lunch' ? 10 : 15;
    const grid = document.getElementById('tables-grid');
    grid.innerHTML = '';
    for (let i = 0; i < count; i++) {
        const div = document.createElement('div');
        div.className = 'table-card skeleton';
        grid.appendChild(div);
    }
}

// ── Render tables ─────────────────────────────────────────────
function renderCurrentShift() {
    renderTables(getCurrentBookings());
    renderStats(getCurrentBookings());
}

function renderTables(bookings) {
    const grid = document.getElementById('tables-grid');
    grid.innerHTML = '';

    // If lunch is disabled/time expired for the selected date, show a full closed screen
    const lunchClosed = currentShift === 'Lunch' && isLunchBlocked();
    if (lunchClosed) {
        grid.innerHTML = `
            <div class="lunch-closed-banner">
                <div class="lunch-closed-icon">🚫</div>
                <h3>Lunch Booking Closed</h3>
                <p>Lunch booking for today has been closed by the restaurant.<br>Please select the <strong>Dinner</strong> slot or book for another date.</p>
            </div>
        `;
        // Clear any selected tables
        selectedTables.clear();
        updateBookBar();
        return;
    }

    bookings.forEach(b => {
        const isOccupied = b.status === 'Occupied';
        const isSelected = selectedTables.has(b.tableId);
        const card = document.createElement('div');
        card.className = `table-card ${isOccupied ? 'occupied' : 'available'}${isSelected ? ' selected' : ''}`;
        card.dataset.id = b.tableId;
        const isMyBooking = (isOccupied && b.guestName === sessionUser.name);

        const num = b.tableId.replace(/^[A-Z]/, '');

        card.innerHTML = `
            <div class="card-icon">${isOccupied ? '🔴' : isSelected ? '✅' : '🟢'}</div>
            <div class="card-number">${num}</div>
            <div class="card-label">${isOccupied ? 'Occupied' : isSelected ? 'Selected' : 'Available'}</div>
            ${isOccupied && b.guestName ? `<div class="card-guest">${escapeHtml(b.guestName)}</div>` : ''}
        `;

        if (!isOccupied) {
            card.addEventListener('click', () => toggleTableSelection(b.tableId));
            card.setAttribute('role', 'button');
            card.setAttribute('tabindex', '0');
            card.setAttribute('aria-label', `${isSelected ? 'Deselect' : 'Select'} table ${num}`);
            card.addEventListener('keydown', e => {
                if (e.key === 'Enter' || e.key === ' ') toggleTableSelection(b.tableId);
            });
        } else {
            card.setAttribute('aria-label', `Table ${num} is occupied`);
        }

        grid.appendChild(card);
    });
}

function renderStats(bookings) {
    document.getElementById('count-available').textContent = bookings.filter(b => b.status === 'Available').length;
    document.getElementById('count-occupied').textContent = bookings.filter(b => b.status === 'Occupied').length;
}


// ── Cancel user's own booking ─────────────────────────────────
async function handleCancelBooking(tableId, shift) {
    const num = tableId.replace(/^[A-Z]/, '');
    if (!confirm(`Cancel your booking for Table ${num} (${shift})?`)) return;

    // Update local state
    clearLocalBookings([{ tableId, shift }]);
    renderCurrentShift();
    updateShiftTabLocks();
    selectedTables.delete(tableId);
    updateBookBar();
    showToast(`Table ${num} booking cancelled.`, 'success');

    // Send to GAS (poll will confirm state)
    try {
        const myOriginalBooking = [...allLunch, ...allDinner].find(b => b.tableId === tableId && b.shift === shift);
        const contactToCancel = myOriginalBooking ? myOriginalBooking.contact : sessionUser.contact;
        await apiCancelBooking(tableId, shift, contactToCancel, selectedDate);
    } catch (err) {
        console.error('GAS cancel error:', err);
    }
}

// Helper: mark bookings as Available in the local allLunch/allDinner arrays
function clearLocalBookings(bookings) {
    bookings.forEach(({ tableId, shift }) => {
        const arr = shift === 'Lunch' ? allLunch : allDinner;
        const item = arr.find(b => b.tableId === tableId);
        if (item) {
            item.status = 'Available';
            item.guestName = '';
            item.contact = '';
            item.timeSlot = '';
            item.numPeople = '';
            item.bookingDate = '';
        }
    });
}

// ── Multi-table selection ─────────────────────────────────────
function toggleTableSelection(tableId) {
    if (selectedTables.has(tableId)) {
        selectedTables.delete(tableId);
    } else {
        selectedTables.add(tableId);
    }
    renderTables(getCurrentBookings());
    updateBookBar();
}

function updateBookBar() {
    const bar = document.getElementById('book-bar');
    const countEl = document.getElementById('book-bar-count');
    const count = selectedTables.size;
    if (count > 0) {
        countEl.textContent = `Book ${count} Table${count > 1 ? 's' : ''} →`;
        bar.classList.add('visible');
    } else {
        bar.classList.remove('visible');
    }
}

// ── Modal ─────────────────────────────────────────────────────
function openBookingModal() {
    // Block if user already has a booking in the OTHER shift
    const lockedTo = getLockedShift();
    if (lockedTo && lockedTo !== currentShift) {
        showToast(`You already have a ${lockedTo} booking. Cancel it first.`, 'error');
        return;
    }

    const slotSelect = document.getElementById('modal-slot');
    slotSelect.innerHTML = '';
    const slots = currentShift === 'Lunch' ? LUNCH_SLOTS : DINNER_SLOTS;
    slots.forEach(s => {
        const opt = document.createElement('option');
        opt.value = s; opt.textContent = s;
        slotSelect.appendChild(opt);
    });

    const dateLabel = document.querySelector('.date-pill.active')?.dataset.label || 'Today';
    document.getElementById('modal-date-label').textContent = dateLabel;
    document.getElementById('modal-shift-label').textContent = currentShift;
    document.getElementById('modal-table-count').textContent = selectedTables.size;
    document.getElementById('modal-people').value = '';
    document.getElementById('modal-whatsapp').value = '';
    document.getElementById('modal-error').textContent = '';
    document.getElementById('booking-modal').classList.add('open');
    setTimeout(() => document.getElementById('modal-people').focus(), 100);
}

function closeBookingModal() {
    document.getElementById('booking-modal').classList.remove('open');
}

async function handleModalConfirm() {
    const timeSlot = document.getElementById('modal-slot').value;
    const numPeople = parseInt(document.getElementById('modal-people').value, 10);
    const whatsappRaw = document.getElementById('modal-whatsapp').value.trim();
    const errEl = document.getElementById('modal-error');

    // Guard: block if lunch is disabled or time has expired (3 PM IST)
    if (currentShift === 'Lunch' && isLunchBlocked()) {
        errEl.textContent = 'Lunch booking for today is closed. Please select Dinner slot or book for another date.';
        return;
    }

    if (!numPeople || numPeople < 1) {
        errEl.textContent = 'Please enter a valid number of people.';
        return;
    }
    if (numPeople > 20) {
        closeBookingModal();
        showBanquetPopup(numPeople, sessionUser.name);
        return;
    }

    // ── Automatic Table Allocation ──────────────────────────────
    const requiredTables = Math.ceil(numPeople / 4);

    // If not enough tables selected, auto-select more contiguous Available tables
    if (selectedTables.size < requiredTables) {
        const needed = requiredTables - selectedTables.size;

        // Find other available tables in the current shift map
        const currentData = currentShift === 'Lunch' ? allLunch : allDinner;
        const availableTables = currentData.filter(t => t.status === 'Available' && !selectedTables.has(t.tableId));

        if (availableTables.length < needed) {
            errEl.textContent = `Not enough available tables. You need ${requiredTables} tables for ${numPeople} guests, but only ${selectedTables.size + availableTables.length} are free.`;
            return;
        }

        // Auto-add the first N needed tables (Ideally we'd sort by proximity, but lexical sort is a good proxy for now)
        availableTables.sort((a, b) => a.tableId.localeCompare(b.tableId));
        for (let i = 0; i < needed; i++) {
            selectedTables.add(availableTables[i].tableId);
        }
    }

    // If too many tables selected, auto-remove the excess
    if (selectedTables.size > requiredTables) {
        const selectedArr = Array.from(selectedTables);
        selectedTables.clear();
        for (let i = 0; i < requiredTables; i++) {
            selectedTables.add(selectedArr[i]);
        }
        // showToast(`Auto-adjusted to ${requiredTables} table(s) for ${numPeople} guests.`, 'success');
    }

    if (!whatsappRaw || !/^\d{10}$/.test(whatsappRaw)) {
        errEl.textContent = 'Please enter a valid 10-digit WhatsApp number.';
        document.getElementById('modal-whatsapp').focus();
        return;
    }
    errEl.textContent = '';

    closeBookingModal();
    showLoader(true);

    const tablesToBook = [...selectedTables];

    // ── Bulk booking: ONE GAS call for all selected tables ──────
    const payload = tablesToBook.map(tableId => ({
        tableId,
        shift: currentShift,
        guestName: sessionUser.name,
        contact: whatsappRaw, // use input whatsapp number instead of login number
        timeSlot,
        numPeople,
        bookingDate: selectedDate
    }));

    let successCount = 0;
    let failCount = 0;
    let lastError = '';

    try {
        const resp = await apiBookTables(payload);
        (resp.results || []).forEach(r => {
            if (r.success) successCount++;
            else { failCount++; lastError = r.error || 'Booking failed'; }
        });
        if (!resp.success && !resp.results) {
            // Whole-request error (e.g. cross-shift guard triggered)
            lastError = resp.error || 'Booking failed';
            failCount = tablesToBook.length;
        }
    } catch (err) {
        console.error('Bulk booking error:', err);
        lastError = err.message;
        failCount = tablesToBook.length;
    }

    selectedTables.clear();
    await loadBothShifts();
    showLoader(false);

    if (failCount === 0) {
        // Show confirmation popup + trigger PDF generation
        const dateLabel = document.querySelector('.date-pill.active')?.dataset.label || 'Today';
        showBookingConfirmPopup({
            tables: tablesToBook,
            shift: currentShift,
            timeSlot,
            numPeople,
            guestName: sessionUser.name,
            whatsapp: whatsappRaw,
            bookingDateStr: dateLabel
        });
    } else if (successCount === 0) {
        showToast(lastError || 'Booking failed.', 'error');
    } else {
        showToast(`${successCount} booked, ${failCount} failed — ${lastError}`, 'error');
    }
}

// ── Error state ───────────────────────────────────────────────
function showError() {
    document.getElementById('tables-grid').innerHTML = `
        <div class="state-message" style="grid-column:1/-1">
            <div class="icon">⚠️</div>
            <p>Could not load tables. Check your connection or the GAS web app URL in <code>js/api.js</code>.</p>
            <button class="btn-retry" onclick="loadBothShifts()">Retry</button>
        </div>
    `;
}

// ── Helpers ───────────────────────────────────────────────────
function showLoader(on) {
    document.getElementById('loader').classList.toggle('active', on);
}

function showToast(msg, type = '') {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.className = `toast ${type} show`;
    setTimeout(() => t.classList.remove('show'), 4500);
}

function escapeHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

// Convert GAS time values (e.g. '1899-12-30T07:30:00.000Z') to '7:30 AM'
// Plain strings like '1:00 PM' pass through unchanged.
function formatTimeSlot(ts) {
    if (!ts) return '';
    const s = String(ts);
    if (s.includes('T') && s.includes('Z')) {
        const d = new Date(s);
        if (!isNaN(d)) {
            return d.toLocaleTimeString('en-US', {
                hour: 'numeric', minute: '2-digit', hour12: true,
                timeZone: 'UTC'   // GAS stores the time as UTC fraction
            });
        }
    }
    return s;
}

// ── Booking Confirmation Popup & PDF Receipt ────────────────────────────────
function generateTokenReceiptPDF({ tables, shift, timeSlot, numPeople, guestName, whatsapp, bookingDateStr }) {
    if (!window.jspdf) {
        showToast('PDF generator not available. Please try again.', 'error');
        return;
    }
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({
        unit: 'mm',
        format: [80, 200]
    });

    let y = 10;
    const margin = 5;
    const pageWidth = 80;
    const centerX = pageWidth / 2;

    doc.setFont("helvetica", "bold");
    doc.setFontSize(14);
    doc.text("Foothills Retreat", centerX, y, { align: "center" });
    y += 6;
    doc.setFontSize(10);
    doc.text("Table Booking Confirmation Token", centerX, y, { align: "center" });
    y += 4;
    doc.setLineWidth(0.5);
    doc.line(margin, y, pageWidth - margin, y);
    y += 6;

    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);

    const bookingId = "FR-" + Math.random().toString(36).substr(2, 6).toUpperCase();
    const tokenNums = tables.map(id => "T" + id.replace(/^[A-Z]/, '')).join(', ');

    doc.text(`Token Number : ${tokenNums}`, margin, y); y += 5;
    doc.text(`Booking Date : ${bookingDateStr}`, margin, y); y += 5;
    doc.text(`Booking Time : ${timeSlot}`, margin, y); y += 6;

    doc.line(margin, y, pageWidth - margin, y); y += 6;
    doc.setFont("helvetica", "bold");
    doc.text("Customer Details", centerX, y, { align: "center" }); y += 2;
    doc.line(margin, y, pageWidth - margin, y); y += 6;

    doc.setFont("helvetica", "normal");
    doc.text(`Customer Name     : ${guestName}`, margin, y); y += 5;
    doc.text(`Mobile Number     : ${whatsapp || 'N/A'}`, margin, y); y += 5;
    doc.text(`Number of Guests  : ${numPeople}`, margin, y); y += 6;

    doc.line(margin, y, pageWidth - margin, y); y += 6;
    doc.setFont("helvetica", "bold");
    doc.text("Table Details", centerX, y, { align: "center" }); y += 2;
    doc.line(margin, y, pageWidth - margin, y); y += 6;

    doc.setFont("helvetica", "normal");
    doc.text(`Token Numbers     : ${tokenNums}`, margin, y); y += 5;
    doc.text(`Dining Slot       : ${shift}`, margin, y); y += 6;

    doc.line(margin, y, pageWidth - margin, y); y += 6;
    doc.setFont("helvetica", "bold");
    doc.text("Booking Status", centerX, y, { align: "center" }); y += 2;
    doc.line(margin, y, pageWidth - margin, y); y += 6;

    doc.setFont("helvetica", "normal");
    doc.text(`Status            : Confirmed`, margin, y); y += 5;
    doc.text(`Booking ID        : ${bookingId}`, margin, y); y += 6;

    doc.line(margin, y, pageWidth - margin, y); y += 6;
    doc.setFont("helvetica", "bold");
    doc.text("Important Notes", centerX, y, { align: "center" }); y += 2;
    doc.line(margin, y, pageWidth - margin, y); y += 6;

    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    const notes = [
        "Please arrive 10 minutes before your booking time.",
        "Show this token receipt at the restaurant entrance.",
        "Maximum 4 people allowed per table.",
        "Management reserves the right to adjust tables."
    ];
    notes.forEach(n => {
        const splitNote = doc.splitTextToSize("• " + n, pageWidth - (margin * 2));
        doc.text(splitNote, margin, y);
        y += (4 * splitNote.length);
    });

    y += 2;
    doc.line(margin, y, pageWidth - margin, y); y += 6;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.text("Thank You for Booking With Us!", centerX, y, { align: "center" }); y += 5;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.text("We look forward to serving you.", centerX, y, { align: "center" }); y += 4;
    doc.line(margin, y, pageWidth - margin, y);

    doc.save(`Foothills_Retreat_Token_${bookingId}.pdf`);
}

function showBookingConfirmPopup(bookingData) {
    const popup = document.getElementById('booking-confirm-popup');
    const detailsEl = document.getElementById('popup-details');
    const { tables, shift, timeSlot, numPeople, bookingDateStr } = bookingData;

    // Build detail chips
    const tableNums = tables.map(id => id.replace(/^[A-Z]/, '')).join(', ');
    const chips = [
        { icon: '📅', label: bookingDateStr },
        { icon: '🪑', label: `Token${tables.length > 1 ? 's' : ''} ${tableNums}` },
        { icon: shift === 'Lunch' ? '☀️' : '🌙', label: shift },
        { icon: '⏰', label: timeSlot },
        { icon: '👥', label: `${numPeople} Guest${numPeople > 1 ? 's' : ''}` },
    ];
    detailsEl.innerHTML = chips.map(c =>
        `<span class="popup-chip">${c.icon} ${escapeHtml(String(c.label))}</span>`
    ).join('');

    // Setup Download Receipt button
    const btnDownload = document.getElementById('btn-download-receipt');
    if (btnDownload) {
        // Remove old listeners by cloning
        const newBtn = btnDownload.cloneNode(true);
        btnDownload.parentNode.replaceChild(newBtn, btnDownload);
        newBtn.addEventListener('click', () => {
            generateTokenReceiptPDF(bookingData);
        });
    }

    // Auto trigger generation removed
    // setTimeout(() => {
    //     generateTokenReceiptPDF(bookingData);
    // }, 500);

    // Show popup
    popup.hidden = false;
    requestAnimationFrame(() => requestAnimationFrame(() => popup.style.opacity = '1'));

    function closePopup() {
        popup.hidden = true;
        popup.style.opacity = '';
    }

    // Close on backdrop click
    popup.onclick = e => { if (e.target === popup) closePopup(); };
    const escHandler = e => { if (e.key === 'Escape') { closePopup(); document.removeEventListener('keydown', escHandler); } };
    document.addEventListener('keydown', escHandler);
}

// ── Banquet Popup ───────────────────────────────────────────────
function showBanquetPopup(numPeople, guestName) {
    const popup = document.getElementById('banquet-popup');
    const waBtn = document.getElementById('btn-banquet-wa');

    // Build WhatsApp URL
    const phone = '917008097978';
    const msg = [
        `🎉 *Banquet Booking Enquiry – Foothills Retreat*`,
        ``,
        `👤 Name: ${guestName}`,
        `👥 Guests: ${numPeople}`,
        ``,
        `Hello, I would like to inquire about booking a banquet for ${numPeople} guests.`
    ].join('\n');

    waBtn.href = `https://wa.me/${phone}?text=${encodeURIComponent(msg)}`;

    // Show popup
    popup.hidden = false;
    requestAnimationFrame(() => requestAnimationFrame(() => popup.style.opacity = '1'));

    // Event listeners for closing
    popup.onclick = e => { if (e.target === popup) closeBanquetPopup(); };
    if (waBtn) {
        waBtn.addEventListener('click', () => setTimeout(closeBanquetPopup, 300), { once: true });
    }
    const escHandler = e => { if (e.key === 'Escape') { closeBanquetPopup(); document.removeEventListener('keydown', escHandler); } };
    document.addEventListener('keydown', escHandler);
}

function closeBanquetPopup() {
    const popup = document.getElementById('banquet-popup');
    popup.hidden = true;
    popup.style.opacity = '';
}
