// ============================================================
//  admin.js — Admin panel logic
// ============================================================

const ADMIN_PASSWORD = 'admin123';
const POLL_INTERVAL = 20000;

let currentAdminShift = 'Lunch';
let selectedAdminDate = getTodayIST();
let allLunch = [];
let allDinner = [];
let adminTimer = null;
let knownOccupied = new Set();
let isInitialLoad = true;
let confirmedWhatsApp = new Set(JSON.parse(sessionStorage.getItem('confirmedWhatsApp') || '[]'));

function saveConfirmed() {
    sessionStorage.setItem('confirmedWhatsApp', JSON.stringify([...confirmedWhatsApp]));
}

// ── Init ─────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {

    // ── Auth Gate ──────────────────────────────────────────────
    const authGate = document.getElementById('auth-gate');
    const adminApp = document.getElementById('admin-app');
    const authForm = document.getElementById('admin-auth-form');
    const authError = document.getElementById('auth-error');

    if (sessionStorage.getItem('admin_auth') === '1') {
        showAdminApp();
    }

    authForm.addEventListener('submit', e => {
        e.preventDefault();
        const pwd = document.getElementById('admin-password').value;
        if (pwd === ADMIN_PASSWORD) {
            sessionStorage.setItem('admin_auth', '1');
            showAdminApp();
        } else {
            authError.textContent = 'Incorrect password. Try again.';
            authError.hidden = false;
        }
    });

    function showAdminApp() {
        authGate.hidden = true;
        adminApp.hidden = false;
        initAdmin();
    }

    // ── Admin Logout ───────────────────────────────────────────
    document.getElementById('btn-admin-logout').addEventListener('click', () => {
        sessionStorage.removeItem('admin_auth');
        window.location.href = 'index.html';
    });

    // ── Init Sheets ────────────────────────────────────────────
    document.getElementById('btn-init-sheets').addEventListener('click', () => {
        promptAdminPassword(
            'Confirm: Initialise Sheets',
            'Enter the admin password to reset the Bookings sheet with fresh empty rows.',
            async () => {
                showLoader(true);
                try {
                    await apiInitSheets();
                    showToast('Sheets initialised successfully!', 'success');
                    await loadAllBookings();
                } catch (err) {
                    showToast('Init failed: ' + err.message, 'error');
                }
                showLoader(false);
            }
        );
    });
});

// ── Initialise admin dashboard ────────────────────────────────
function initAdmin() {
    renderAdminDateSelector();

    loadAllBookings();
    initBookingToggle();
    adminTimer = setInterval(loadAllBookings, POLL_INTERVAL);
}

// ── Booking Toggle ────────────────────────────────────────────
async function initBookingToggle() {
    const wrap = document.getElementById('admin-booking-toggle-wrap');
    const check = document.getElementById('check-today-disabled');
    if (!wrap || !check) return;

    // The state is already returned in apiGetBothShifts, but we'll fetch it explicitly once
    try {
        const data = await apiGetBothShifts(getTodayIST());
        check.checked = data.todayDisabled === true;
        wrap.hidden = false;
    } catch (err) {
        console.error('Failed to init toggle:', err);
    }

    check.addEventListener('change', async () => {
        const disabled = check.checked;
        const msg = disabled 
            ? 'This will DISABLE all NEW bookings for TODAY. Continue?' 
            : 'This will RE-ENABLE bookings for TODAY. Continue?';
        
        if (!confirm(msg)) {
            check.checked = !disabled;
            return;
        }

        showLoader(true);
        try {
            await apiSetTodayDisabled(disabled);
            showToast(disabled ? 'Today\'s bookings DISABLED' : 'Today\'s bookings ENABLED', 'success');
        } catch (err) {
            showToast('Toggle failed: ' + err.message, 'error');
            check.checked = !disabled;
        }
        showLoader(false);
    });
}

// ── Date Selector ─────────────────────────────────────────────
function renderAdminDateSelector() {
    const container = document.getElementById('admin-date-selector');
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
        btn.className = `date-pill ${dateStr === selectedAdminDate ? 'active' : ''}`;
        btn.textContent = label;
        btn.dataset.date = dateStr;

        btn.addEventListener('click', () => {
            if (selectedAdminDate === dateStr) return;
            selectedAdminDate = dateStr;
            isInitialLoad = true; 
            knownOccupied = new Set(); // Reset known keys for the new date
            document.querySelectorAll('#admin-date-selector .date-pill').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            showLoader(true);
            loadAllBookings().finally(() => showLoader(false));
        });

        container.appendChild(btn);
    }
}

// ── Fetch both shifts ─────────────────────────────────────────
async function loadAllBookings() {
    try {
        const both = await apiGetBothShifts(selectedAdminDate);
        allLunch = both.lunch;
        allDinner = both.dinner;
        
        window.lunchTotalGuests = both.lunchTotalGuests || 0;
        window.dinnerTotalGuests = both.dinnerTotalGuests || 0;

        const requests = await apiGetRequests(selectedAdminDate);

        // Detect new bookings (Grouped by Guest)
        const currentlyOccupied = [...allLunch, ...allDinner].filter(b => b.status === 'Occupied');
        
        // Group by: name + contact + shift + date
        const grouped = {};
        currentlyOccupied.forEach(b => {
            const gKey = `${b.guestName}|${b.contact}|${b.shift}|${b.bookingDate}`;
            if (!grouped[gKey]) grouped[gKey] = [];
            grouped[gKey].push(b);
        });

        const newKeys = new Set();
        Object.keys(grouped).forEach(gKey => {
            newKeys.add(gKey);
            if (!isInitialLoad && !knownOccupied.has(gKey)) {
                showBookingNotification(grouped[gKey]);
            }
        });

        knownOccupied = newKeys;
        isInitialLoad = false;

        renderRequests(requests);
        renderStats();
        renderBookingsList();
    } catch (err) {
        console.error('Admin load failed:', err);
        showToast('Could not load data. Check GAS URL in api.js.', 'error');
    }
}



// ── Render Booking Requests ───────────────────────────────────
function renderRequests(requests) {
    const tbody = document.getElementById('requests-tbody');
    if (!tbody) return;
    tbody.innerHTML = '';

    if (!requests || !requests.length) {
        tbody.innerHTML = '<tr><td colspan="5" style="color:var(--text-muted);text-align:center;padding:24px">No pending requests for this date</td></tr>';
        return;
    }

    requests.forEach(r => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td style="font-weight:500;">${escapeHtml(r.name || '—')}</td>
            <td>${escapeHtml(r.phone || '—')}</td>
            <td>${escapeHtml(String(r.guests || '—'))}</td>
            <td>${escapeHtml(r.shift || '—')}</td>
            <td style="color:var(--text-muted); font-size:0.85rem">${escapeHtml(r.time || '—')}</td>
            <td>
                <button class="btn-resolve" data-name="${escapeHtml(r.name)}" data-contact="${escapeHtml(r.phone)}" data-date="${escapeHtml(selectedAdminDate)}" data-shift="${escapeHtml(r.shift)}">
                    Resolve
                </button>
            </td>
        `;
        tbody.appendChild(tr);
    });

    tbody.querySelectorAll('.btn-resolve').forEach(btn => {
        btn.addEventListener('click', () => handleResolveRequest(btn));
    });
}

// ── Handle Resolve Request ────────────────────────────────────
async function handleResolveRequest(btn) {
    const { name, contact, date, shift } = btn.dataset;
    
    btn.disabled = true;
    btn.textContent = 'Resolving...';

    try {
        await apiDeleteRequest(name, contact, date, shift);
        showToast(`Request for ${name} resolved.`, 'success');
        
        // Find and remove the row from the table
        const tr = btn.closest('tr');
        tr.classList.add('fade-out');
        setTimeout(() => tr.remove(), 300);
        
        // Refresh requests just in case
        await loadAllBookings();
    } catch (err) {
        showToast('Resolve failed: ' + err.message, 'error');
        btn.disabled = false;
        btn.textContent = 'Resolve';
    }
}

// ── Stats row ─────────────────────────────────────────────────
function renderStats() {
    const lunchCap = 40;
    const dinnerCap = 40;

    const lunchVal = (window.lunchTotalGuests || 0);
    const dinnerVal = (window.dinnerTotalGuests || 0);

    document.getElementById('stat-lunch-occ').textContent = `${lunchVal} / ${lunchCap}`;
    document.getElementById('stat-dinner-occ').textContent = `${dinnerVal} / ${dinnerCap}`;
    document.getElementById('stat-total-guests').textContent = lunchVal + dinnerVal;
}

// ── Bookings list table ───────────────────────────────────────
function renderBookingsList() {
    const tbody = document.getElementById('bookings-tbody');
    tbody.innerHTML = '';

    const occupied = [...allLunch, ...allDinner].filter(b => b.status === 'Occupied');

    if (!occupied.length) {
        tbody.innerHTML = `<tr><td colspan="7" style="color:var(--text-muted);text-align:center;padding:24px">No active bookings</td></tr>`;
        return;
    }

    // Group bookings by guest (name + contact) - one row per unique person
    // Use an array of [groupKey, bookingsArray] pairs so we can use closures
    // without storing the key inside HTML attributes (avoids encoding issues).
    const groupMap = new Map();
    occupied.forEach(b => {
        // Normalise key: lowercase name + trimmed contact
        const key = (b.guestName || '').trim().toLowerCase() + '||' + (b.contact || '').trim();
        if (!groupMap.has(key)) groupMap.set(key, []);
        groupMap.get(key).push(b);
    });

    const groupsArray = [...groupMap.values()]; // Array of booking-arrays, one per person

    groupsArray.forEach((bookings) => {
        const first = bookings[0];
        const tableIds  = bookings.map(b => b.tableId).join(', ');
        
        // Correct aggregation: unique bookings by date + shift + slot
        const uniqueInstanceMap = new Map();
        bookings.forEach(b => {
            const bKey = `${b.bookingDate}|${b.shift}|${b.timeSlot}`;
            if (!uniqueInstanceMap.has(bKey)) {
                uniqueInstanceMap.set(bKey, parseInt(b.numPeople) || 0);
            }
        });
        const totalPeople = [...uniqueInstanceMap.values()].reduce((a, b) => a + b, 0);

        // Group is confirmed only when every individual booking is confirmed
        const allConfirmed = bookings.every(b =>
            confirmedWhatsApp.has(`${b.tableId}|${b.shift}|${b.bookingDate}`)
        );

        const tr = document.createElement('tr');
        tr.innerHTML = `
      <td class="name-cell">${escapeHtml(first.guestName || '—')}</td>
      <td>${escapeHtml(first.contact || '—')}</td>
      <td class="table-cell">${escapeHtml(tableIds)}</td>
      <td>${escapeHtml(first.timeSlot || '—')}</td>
      <td>${escapeHtml(totalPeople ? String(totalPeople) : '—')}</td>
      <td style="display:flex; gap:8px; flex-wrap:wrap;">
        <button class="btn-wa-confirm" ${allConfirmed ? 'disabled style="background-color:#1ebd5a;"' : ''}>${allConfirmed ? 'Confirmed ✅' : 'Confirm 💬'}</button>
        <button class="btn-clear-group">
          Clear All tokens
        </button>
      </td>
    `;

        // Attach Confirm button listener via closure so we don't rely on data attributes for the group
        const confirmBtn = tr.querySelector('.btn-wa-confirm');
        confirmBtn.addEventListener('click', () => {
            sendWhatsAppConfirmation(bookings);
            bookings.forEach(b => {
                confirmedWhatsApp.add(`${b.tableId}|${b.shift}|${b.bookingDate}`);
            });
            saveConfirmed();
            confirmBtn.innerHTML = 'Confirmed ✅';
            confirmBtn.style.backgroundColor = '#1ebd5a';
            confirmBtn.disabled = true;
        });

        // Attach Clear Group button listener
        const clearGroupBtn = tr.querySelector('.btn-clear-group');
        clearGroupBtn.addEventListener('click', () => handleClearGroup(bookings));

        tbody.appendChild(tr);
    });
}

// ── Clear a whole booking group ──────────────────────────────
async function handleClearGroup(bookings) {
    if (!bookings || !bookings.length) return;
    const first = bookings[0];
    const numTokens = bookings.length;
    
    if (!confirm(`Clear all ${numTokens} token(s) for ${first.guestName}? This will make them available again.`)) return;

    showLoader(true);
    try {
        await apiClearUserBookings(first.guestName, first.contact, first.shift, first.bookingDate);
        showToast(`Cleared all tokens for ${first.guestName}.`, 'success');
        await loadAllBookings();
    } catch (err) {
        showToast('Clear failed: ' + err.message, 'error');
    }
    showLoader(false);
}

// ── Clear a single table (kept for backward compatibility/notifications) ─────
async function handleClear(tableId, shift) {
    const num = tableId.replace(/^[A-Z]/, '');
    if (!confirm(`Clear Token ${num} (${shift})? This will make it available again.`)) return;

    showLoader(true);
    try {
        await apiClearTable(tableId, shift, selectedAdminDate);
        showToast(`Token ${num} cleared.`, 'success');
        await loadAllBookings();
    } catch (err) {
        showToast('Clear failed: ' + err.message, 'error');
    }
    showLoader(false);
}

// ── Utilities ─────────────────────────────────────────────────
function showLoader(on) {
    document.getElementById('loader').classList.toggle('active', on);
}

function showToast(msg, type = '') {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.className = `toast ${type} show`;
    setTimeout(() => t.classList.remove('show'), 3500);
}

function escapeHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

// ── New Booking Notification ──────────────────────────────────
function showBookingNotification(bookingsOrSingle) {
    const bookings = Array.isArray(bookingsOrSingle) ? bookingsOrSingle : [bookingsOrSingle];
    const b = bookings[0];

    // Play sound
    const audio = document.getElementById('notification-sound');
    if (audio) {
        audio.currentTime = 0;
        audio.play().catch(e => console.log('Audio autoplay prevented by browser', e));
    }

    // Create popup toast
    const container = document.getElementById('notification-container');
    if (!container) return;

    // List all tokens
    const tokens = bookings.map(item => item.tableId.replace(/^[A-Z]/, '')).join(', ');
    const toast = document.createElement('div');
    toast.className = 'booking-alert';

    toast.innerHTML = `
        <div class="alert-icon">🔔</div>
        <div class="alert-content">
            <h4>New Booking! Token${bookings.length > 1 ? 's' : ''} ${escapeHtml(tokens)}</h4>
            <p><strong>${escapeHtml(b.guestName || '—')}</strong> (${escapeHtml(b.shift)})</p>
            <p class="alert-meta" style="margin-bottom: 10px !important;">
                ${b.bookingDate ? `📅 ${escapeHtml(b.bookingDate)} &nbsp;` : ''} 
                ${b.timeSlot ? `⏰ ${escapeHtml(b.timeSlot)}` : ''} &nbsp; 
                ${b.numPeople ? `👥 ${escapeHtml(String(b.numPeople))}` : ''}
            </p>
            <button class="btn-wa-confirm">Confirm 💬</button>
        </div>
        <button class="alert-close" aria-label="Close notification">×</button>
    `;

    container.appendChild(toast);

    toast.querySelector('.btn-wa-confirm').addEventListener('click', (e) => {
        sendWhatsAppConfirmation(bookings);
        bookings.forEach(item => {
            const key = `${item.tableId}|${item.shift}|${item.bookingDate}`;
            confirmedWhatsApp.add(key);
        });
        saveConfirmed();
        e.target.innerHTML = 'Confirmed ✅';
        e.target.style.backgroundColor = '#1ebd5a';
        e.target.disabled = true;
    });

    // Auto-remove after 10s
    const removeTimer = setTimeout(() => {
        toast.classList.add('fade-out');
        setTimeout(() => toast.remove(), 300);
    }, 10000);

    toast.querySelector('.alert-close').addEventListener('click', () => {
        clearTimeout(removeTimer);
        toast.classList.add('fade-out');
        setTimeout(() => toast.remove(), 300);
    });
}

// ── Admin Password Modal ───────────────────────────────────────
// Shows a lightweight inline modal asking for the admin password.
// onSuccess() is called only when the correct password is entered.
function promptAdminPassword(title, message, onSuccess) {
    // Remove any existing modal
    const existing = document.getElementById('init-pwd-modal');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'init-pwd-modal';
    overlay.style.cssText = [
        'position:fixed', 'inset:0', 'z-index:9999',
        'display:flex', 'align-items:center', 'justify-content:center',
        'background:rgba(0,0,0,0.65)', 'backdrop-filter:blur(4px)'
    ].join(';');

    overlay.innerHTML = `
        <div style="
            background:var(--surface,#1e1e2e);
            border:1px solid var(--border,#333);
            border-radius:14px;
            padding:32px 28px;
            width:min(90vw,360px);
            box-shadow:0 20px 60px rgba(0,0,0,.5);
            display:flex;flex-direction:column;gap:16px;
        ">
            <div style="display:flex;align-items:center;gap:10px">
                <span style="font-size:1.4rem">🔐</span>
                <h3 style="margin:0;font-size:1rem;color:var(--text,#fff)">${escapeHtml(title)}</h3>
            </div>
            <p style="margin:0;font-size:.85rem;color:var(--text-muted,#aaa)">${escapeHtml(message)}</p>
            <input
                id="init-pwd-input"
                type="password"
                placeholder="Admin password"
                autocomplete="current-password"
                style="
                    width:100%;box-sizing:border-box;
                    padding:10px 14px;border-radius:8px;
                    border:1px solid var(--border,#444);
                    background:var(--input-bg,#111);
                    color:var(--text,#fff);font-size:.95rem;
                "
            />
            <p id="init-pwd-error" style="margin:0;font-size:.82rem;color:#e55;display:none">Incorrect password. Try again.</p>
            <div style="display:flex;gap:10px;justify-content:flex-end">
                <button id="init-pwd-cancel" style="
                    padding:8px 18px;border-radius:8px;
                    border:1px solid var(--border,#555);
                    background:transparent;color:var(--text,#fff);
                    cursor:pointer;font-size:.9rem;
                ">Cancel</button>
                <button id="init-pwd-confirm" style="
                    padding:8px 20px;border-radius:8px;
                    border:none;background:var(--accent,#d4a017);
                    color:#000;font-weight:700;cursor:pointer;font-size:.9rem;
                ">Confirm</button>
            </div>
        </div>
    `;

    document.body.appendChild(overlay);

    const input = overlay.querySelector('#init-pwd-input');
    const errMsg = overlay.querySelector('#init-pwd-error');
    const btnOk = overlay.querySelector('#init-pwd-confirm');
    const btnCancel = overlay.querySelector('#init-pwd-cancel');

    // Auto-focus
    setTimeout(() => input.focus(), 50);

    function closeModal() { overlay.remove(); }

    btnCancel.addEventListener('click', closeModal);
    overlay.addEventListener('click', e => { if (e.target === overlay) closeModal(); });

    function attempt() {
        if (input.value === ADMIN_PASSWORD) {
            closeModal();
            onSuccess();
        } else {
            errMsg.style.display = 'block';
            input.value = '';
            input.focus();
        }
    }

    btnOk.addEventListener('click', attempt);
    input.addEventListener('keydown', e => { if (e.key === 'Enter') attempt(); });
}

// ── Send WhatsApp Confirmation ────────────────────────────────
// Accepts either a single booking object or an array of booking objects
// (all belonging to the same guest). When multiple bookings are grouped,
// all their tokens are listed in a single message.
function sendWhatsAppConfirmation(bookingsOrSingle) {
    const bookings = Array.isArray(bookingsOrSingle) ? bookingsOrSingle : [bookingsOrSingle];
    const first = bookings[0];

    if (!first.contact) {
        showToast('No contact number provided for this booking.', 'error');
        return;
    }

    const phone = '91' + String(first.contact).replace(/\D/g, '');
    const tokens = bookings.map(b => b.tableId.replace(/^[A-Z]/, '')).join(', ');
    const totalPeople = first.numPeople || 0; // Each row stores the total party size for the group

    let msg = `✅ *Booking Confirmed – Foothills Retreat*\n\n`;
    msg += `Hello ${first.guestName || 'Guest'}, your table${bookings.length > 1 ? 's have' : ' has'} been successfully booked!\n\n`;
    msg += `🎫 *Token${bookings.length > 1 ? 's' : ''}:* ${tokens}\n`;
    msg += `📅 *Date:* ${first.bookingDate || '—'}\n`;
    msg += `⏰ *Time:* ${first.timeSlot || first.shift}\n`;
    msg += `👥 *Guests:* ${totalPeople || first.numPeople || '—'}\n\n`;
    msg += `We look forward to hosting you! If you need to cancel or modify your booking, please reply to this message.`;

    window.open(`https://api.whatsapp.com/send?phone=${phone}&text=${encodeURIComponent(msg)}`, '_blank', 'noopener,noreferrer');
}
