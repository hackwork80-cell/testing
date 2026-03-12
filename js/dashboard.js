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
let lunchGuests = []; // Store guest list {name, guests}
let dinnerGuests = [];
let lunchTotal = 0;   // Store total guest counts
let dinnerTotal = 0;
let pollTimer = null;
let sessionUser = null;

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
            return `Token ${num} (${b.shift})`;
        }).join(', ');
        if (!confirm(`Cancel your booking: ${label}?`)) return;

        showLoader(true);
        try {
            // Cancel all bookings in parallel for speed
            await Promise.all(myBookings.map(b => 
                apiCancelBooking(b.tableId, b.shift, b.contact, selectedDate)
            ));
            
            showToast('Your booking has been cancelled.', 'success');
        } catch (err) {
            console.error('Cancel failed:', err);
            showToast('Some cancellations failed. Please try again.', 'error');
        } finally {
            await loadBothShifts();
            showLoader(false);
        }
    });

    // Nav-level download receipt button
    document.getElementById('btn-download-nav').addEventListener('click', () => {
        const myBookings = [...allLunch, ...allDinner].filter(
            b => b.status === 'Occupied' && b.guestName === sessionUser.name
        );
        if (!myBookings.length) return;
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

            const lockedTo = getLockedShift();
            if (lockedTo && lockedTo !== shift) {
                showToast(`You have an active ${lockedTo} booking. Cancel it first to switch shifts.`, 'error');
                return;
            }
            if (shift === 'Lunch' && isLunchBlocked()) {
                showToast('Lunch booking for today is closed. Please select Dinner slot or book for another date.', 'error');
                return;
            }

            currentShift = shift;
            document.querySelectorAll('.shift-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            populateTokenSlots();
            updateTokenAvail();
        });
    });

    // Token card confirm button
    document.getElementById('btn-book-token').addEventListener('click', handleTokenBook);

    loadBothShifts();
    pollTimer = setInterval(loadBothShifts, POLL_INTERVAL);

    setInterval(updateLunchDisabledUI, 60_000);
    updateLunchDisabledUI();
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

            showLoader(true);
            loadBothShifts().finally(() => showLoader(false));
        });

        container.appendChild(btn);
    }
}

// ── Fetch BOTH shifts in ONE GAS call ────────────────────────
async function loadBothShifts() {
    try {
        const both = await apiGetBothShifts(selectedDate);
        allLunch = both.lunch;
        allDinner = both.dinner;
        lunchTotal = both.lunchTotalGuests || 0;
        dinnerTotal = both.dinnerTotalGuests || 0;
        lunchGuests = both.lunchGuests || [];
        dinnerGuests = both.dinnerGuests || [];
        window.lunchTotalGuests = both.lunchTotalGuests || 0;
        window.dinnerTotalGuests = both.dinnerTotalGuests || 0;
        window.todayDisabled = both.todayDisabled === true;

        updateLunchDisabledUI();
        updateGlobalDisabledUI();

        // If user has a booking, auto-focus to that shift
        const lockedTo = getLockedShift();
        if (lockedTo && lockedTo !== currentShift) {
            currentShift = lockedTo;
            document.querySelectorAll('.shift-btn').forEach(b => {
                b.classList.toggle('active', b.dataset.shift === currentShift);
            });
        }

        populateTokenSlots();
        updateTokenAvail();
        updateShiftTabLocks();
        updateNavButtons();
    } catch (err) {
        console.error(err);
        showToast('Could not load availability. Check your connection.', 'error');
    }
}

// Helper: returns current shift's booking array
function getCurrentBookings() {
    return currentShift === 'Lunch' ? allLunch : allDinner;
}

// Helper: returns 'Lunch'/'Dinner' if user has an active booking there, else null
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

// ── Token card helpers ────────────────────────────────────────
function populateTokenSlots() {
    const select = document.getElementById('tk-slot');
    if (!select) return;
    select.innerHTML = '';
    const slots = currentShift === 'Lunch' ? LUNCH_SLOTS : DINNER_SLOTS;
    slots.forEach(s => {
        const opt = document.createElement('option');
        opt.value = s; opt.textContent = s;
        select.appendChild(opt);
    });
}

function updateTokenAvail() {
    const bookings = getCurrentBookings();
    const guests = currentShift === 'Lunch' ? lunchGuests : dinnerGuests;
    const total = currentShift === 'Lunch' ? lunchTotal : dinnerTotal;
    const capacity = 40;
    const left = Math.max(0, capacity - total);

    const dot = document.getElementById('token-avail-dot');
    if (dot) {
        dot.className = left > 0 ? 'stat-dot green' : 'stat-dot red';
    }

    const elBadge = document.getElementById('seats-left-badge');
    if (elBadge) {
        elBadge.textContent = `${left} seat${left !== 1 ? 's' : ''} left`;
        elBadge.classList.toggle('low-seats', left <= 5);
    }

    // Community Guest List
    const communitySection = document.getElementById('community-bookings');
    const guestListEl = document.getElementById('community-guest-list');
    if (communitySection && guestListEl) {
        communitySection.hidden = false; // Always show the section structure
        if (guests.length > 0) {
            guestListEl.innerHTML = '';
            guests.forEach(g => {
                const chip = document.createElement('div');
                chip.className = 'guest-chip';
                const isMe = g.name === sessionUser.name;
                chip.innerHTML = `<span class="chip-name">${escapeHtml(g.name)}${isMe ? ' (You)' : ''}</span> — <span class="chip-guest-count">${g.guests} guest${g.guests !== 1 ? 's' : ''}</span>`;
                if (isMe) chip.classList.add('is-me');
                guestListEl.appendChild(chip);
            });
        } else {
            guestListEl.innerHTML = '<p class="empty-community">No other bookings for today yet.</p>';
        }
    }

    // Disable book button if user already has a booking or bookings are globally disabled
    const hasBooking = getLockedShift() !== null;
    const isGloballyDisabled = (selectedDate === getTodayIST() && window.todayDisabled);
    const btn = document.getElementById('btn-book-token');
    if (btn) {
        btn.disabled = hasBooking || isGloballyDisabled;
        if (hasBooking) {
            btn.title = 'You already have an active booking. Cancel it first.';
        } else if (isGloballyDisabled) {
            btn.title = "Today's bookings are currently closed by admin.";
        } else {
            btn.title = '';
        }
    }
}

function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

// ── Update Lunch shift tab UI based on time ───────────────────
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
            populateTokenSlots();
            updateTokenAvail();
        }
        showToast('Lunch booking for today is closed. Please select Dinner slot or book for another date.', 'error');
    }
}

// ── Global Disabled UI ───────────────────────────────────────
function updateGlobalDisabledUI() {
    const isToday = selectedDate === getTodayIST();
    const isDisabled = isToday && window.todayDisabled;
    
    const btn = document.getElementById('btn-book-token');
    const statusText = document.getElementById('booking-status-text');
    
    if (isDisabled) {
        if (btn) btn.disabled = true;
        if (statusText) {
            statusText.textContent = "Today's Online Bookings are currently CLOSED by Admin.";
            statusText.style.color = "var(--red)";
            statusText.hidden = false;
        }
    } else {
        // Only hide if lunch is not blocked either
        if (!isLunchBlocked()) {
            if (statusText) statusText.hidden = true;
        }
    }
}


// ── Token booking confirm ─────────────────────────────────────
async function handleTokenBook() {
    const errEl = document.getElementById('tk-error');
    errEl.textContent = '';

    if (currentShift === 'Lunch' && isLunchBlocked()) {
        errEl.textContent = 'Lunch booking for today is closed. Please select Dinner or another date.';
        return;
    }

    const lockedTo = getLockedShift();
    if (lockedTo) {
        errEl.textContent = `You already have an active ${lockedTo} booking. Cancel it first.`;
        return;
    }

    const timeSlot = document.getElementById('tk-slot').value;
    const numPeople = parseInt(document.getElementById('tk-people').value, 10);
    const whatsappRaw = document.getElementById('tk-whatsapp').value.trim();

    if (!numPeople || numPeople < 1) {
        errEl.textContent = 'Please enter a valid number of guests.';
        return;
    }
    if (numPeople > 20) {
        showBanquetPopup(numPeople, sessionUser.name);
        return;
    }
    if (!whatsappRaw || !/^\d{10}$/.test(whatsappRaw)) {
        errEl.textContent = 'Please enter a valid 10-digit WhatsApp number.';
        return;
    }

    // ── GUEST LIMIT CHECK (SHIFT LEVEL) ─────────────────────────
    const currentShiftTotal = (currentShift === 'Lunch' ? window.lunchTotalGuests : window.dinnerTotalGuests) || 0;
    
    // If shift is full (40 guests or more), reg as persistent request
    if (currentShiftTotal >= 40) {
        showLoader(true);
        try {
            await apiSubmitRequest(sessionUser.name, whatsappRaw, numPeople, selectedDate, currentShift);
            showLoader(false);
            showWaitlistPopup();
            // Clear form
            document.getElementById('tk-people').value = '';
            document.getElementById('tk-whatsapp').value = '';
            return;
        } catch (err) {
            showLoader(false);
            errEl.textContent = 'Failed to submit request: ' + err.message;
            return;
        }
    }

    // Auto-allocate the required tables based on guest count (4 per table)
    const requiredTables = Math.ceil(numPeople / 4);
    const currentData = getCurrentBookings();
    const available = currentData.filter(t => t.status === 'Available');

    if (available.length < requiredTables) {
        errEl.textContent = `Not enough tokens available. Need ${requiredTables} for ${numPeople} guests, only ${available.length} free.`;
        return;
    }

    // Pick the first N available (sorted by tableId for consistency)
    available.sort((a, b) => a.tableId.localeCompare(b.tableId));
    const tablesToBook = available.slice(0, requiredTables).map(t => t.tableId);

    showLoader(true);
    errEl.textContent = '';

    const payload = tablesToBook.map(tableId => ({
        tableId,
        shift: currentShift,
        guestName: sessionUser.name,
        contact: whatsappRaw,
        timeSlot,
        numPeople,
        bookingDate: selectedDate
    }));

    let successCount = 0;
    let lastError = '';

    try {
        const resp = await apiBookTables(payload);
        (resp.results || []).forEach(r => {
            if (r.success) successCount++;
            else lastError = r.error || 'Booking failed';
        });
        if (!resp.success && !resp.results) {
            lastError = resp.error || 'Booking failed';
        }
    } catch (err) {
        console.error('Token booking error:', err);
        lastError = err.message;
    }

    await loadBothShifts();
    showLoader(false);

    if (successCount > 0) {
        // Clear form
        document.getElementById('tk-people').value = '';
        document.getElementById('tk-whatsapp').value = '';

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
    } else {
        errEl.textContent = lastError || 'Booking failed. Please try again.';
    }
}

function showWaitlistPopup() {
    const popup = document.getElementById('waitlist-popup');
    if (popup) popup.hidden = false;
}

function closeWaitlistPopup() {
    const popup = document.getElementById('waitlist-popup');
    if (popup) popup.hidden = true;
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
