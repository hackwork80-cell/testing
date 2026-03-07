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

    // Shift tabs
    document.querySelectorAll('.shift-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            currentAdminShift = tab.dataset.shift;
            document.querySelectorAll('.shift-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            renderAdminShift();
        });
    });

    loadAllBookings();
    adminTimer = setInterval(loadAllBookings, POLL_INTERVAL);
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
            isInitialLoad = true; // prevent popups for existing bookings on the new date
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

        // Sync lunchDisabled state from backend (now removed as logic is pure client-side time based)

        // Detect new bookings
        const currentlyOccupied = [...allLunch, ...allDinner].filter(b => b.status === 'Occupied');
        const newKeys = new Set();

        currentlyOccupied.forEach(b => {
            const key = `${b.tableId}|${b.shift}|${b.bookingDate}`;
            newKeys.add(key);

            // If it's not the initial load and we haven't seen this booking before -> alert
            if (!isInitialLoad && !knownOccupied.has(key)) {
                showBookingNotification(b);
            }
        });

        knownOccupied = newKeys;
        isInitialLoad = false;

        renderAdminShift();
        renderStats();
        renderBookingsList();
    } catch (err) {
        console.error('Admin load failed:', err);
        showToast('Could not load data. Check GAS URL in api.js.', 'error');
    }
}

// ── Render the current shift's cards ─────────────────────────
function renderAdminShift() {
    const bookings = currentAdminShift === 'Lunch' ? allLunch : allDinner;
    const grid = document.getElementById('admin-tables-grid');
    grid.innerHTML = '';

    if (!bookings.length) {
        grid.innerHTML = '<p style="color:var(--text-muted);grid-column:1/-1">No data. Click "⚙ Initialise Sheets" in the nav to seed the sheet.</p>';
        return;
    }

    bookings.forEach(b => {
        const isOccupied = b.status === 'Occupied';
        const num = b.tableId.replace(/^[A-Z]/, '');
        const card = document.createElement('div');
        card.className = `admin-table-card ${isOccupied ? 'occupied' : 'available'}`;
        card.innerHTML = `
      <div class="admin-card-header">
        <span class="admin-table-id">Token ${escapeHtml(num)}</span>
        <span class="status-badge ${isOccupied ? 'occupied' : 'available'}">
          ${isOccupied ? 'Occupied' : 'Free'}
        </span>
      </div>
      <div class="admin-card-guest">
        ${isOccupied
                ? `<div class="guest-name">${escapeHtml(b.guestName || '—')}</div>
             <div class="guest-contact">${escapeHtml(b.contact || '—')}</div>
             ${b.timeSlot ? `<div class="guest-slot">⏰ ${escapeHtml(b.timeSlot)}</div>` : ''}
             ${b.numPeople ? `<div class="guest-slot">👥 ${escapeHtml(String(b.numPeople))} guest${b.numPeople > 1 ? 's' : ''}</div>` : ''}`
                : `<div class="empty-seat">Seat is available</div>`
            }
      </div>
      ${isOccupied ? `<button class="btn-clear" data-id="${b.tableId}" data-shift="${b.shift}">✕ Clear Token</button>` : ''}
    `;
        grid.appendChild(card);
    });

    // Attach clear handlers
    grid.querySelectorAll('.btn-clear').forEach(btn => {
        btn.addEventListener('click', () => handleClear(btn.dataset.id, btn.dataset.shift));
    });
}

// ── Stats row ─────────────────────────────────────────────────
function renderStats() {
    const lunchOccupied = allLunch.filter(b => b.status === 'Occupied').length;
    const dinnerOccupied = allDinner.filter(b => b.status === 'Occupied').length;
    const total = allLunch.length + allDinner.length;
    const totalOccupied = lunchOccupied + dinnerOccupied;

    document.getElementById('stat-lunch-occ').textContent = lunchOccupied + ' / ' + allLunch.length;
    document.getElementById('stat-dinner-occ').textContent = dinnerOccupied + ' / ' + allDinner.length;
    document.getElementById('stat-total-occ').textContent = totalOccupied + ' / ' + total;
    document.getElementById('stat-free').textContent = (total - totalOccupied);
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

    occupied.forEach(b => {
        const num = b.tableId.replace(/^[A-Z]/, '');
        const key = `${b.tableId}|${b.shift}|${b.bookingDate}`;
        const isConfirmed = confirmedWhatsApp.has(key);
        const tr = document.createElement('tr');
        tr.innerHTML = `
      <td class="name-cell">${escapeHtml(b.guestName || '—')}</td>
      <td>${escapeHtml(b.contact || '—')}</td>
      <td class="date-cell">${escapeHtml(b.bookingDate || '—')}</td>
      <td class="table-cell">${escapeHtml(b.tableId)}</td>
      <td>${escapeHtml(b.shift)}</td>
      <td>${escapeHtml(b.timeSlot || '—')}</td>
      <td>${escapeHtml(b.numPeople ? String(b.numPeople) : '—')}</td>
      <td style="display:flex; gap:8px;">
        <button class="btn-wa-confirm" data-id="${b.tableId}" data-shift="${b.shift}" data-date="${b.bookingDate}" ${isConfirmed ? 'disabled style="background-color: #1ebd5a;"' : ''}>${isConfirmed ? 'Confirmed ✅' : 'Confirm 💬'}</button>
        <button class="btn-clear" style="width:auto;padding:6px 14px;font-size:0.78rem"
          data-id="${b.tableId}" data-shift="${b.shift}">Clear</button>
      </td>
    `;
        tbody.appendChild(tr);
    });

    tbody.querySelectorAll('.btn-clear').forEach(btn => {
        btn.addEventListener('click', () => handleClear(btn.dataset.id, btn.dataset.shift));
    });

    tbody.querySelectorAll('.btn-wa-confirm').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const b = occupied.find(x => x.tableId === btn.dataset.id && x.shift === btn.dataset.shift && x.bookingDate === btn.dataset.date);
            if (b) {
                sendWhatsAppConfirmation(b);
                const key = `${b.tableId}|${b.shift}|${b.bookingDate}`;
                confirmedWhatsApp.add(key);
                saveConfirmed();
                e.target.innerHTML = 'Confirmed ✅';
                e.target.style.backgroundColor = '#1ebd5a';
                e.target.disabled = true;
            }
        });
    });
}

// ── Clear a table ─────────────────────────────────────────────
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
function showBookingNotification(b) {
    // Play sound
    const audio = document.getElementById('notification-sound');
    if (audio) {
        audio.currentTime = 0;
        audio.play().catch(e => console.log('Audio autoplay prevented by browser', e));
    }

    // Create popup toast
    const container = document.getElementById('notification-container');
    if (!container) return;

    const num = b.tableId.replace(/^[A-Z]/, '');
    const toast = document.createElement('div');
    toast.className = 'booking-alert';

    toast.innerHTML = `
        <div class="alert-icon">🔔</div>
        <div class="alert-content">
            <h4>New Booking! Token ${escapeHtml(num)}</h4>
            <p><strong>${escapeHtml(b.guestName || '—')}</strong> (${escapeHtml(b.shift)})</p>
            <p class="alert-meta" style="margin-bottom: 10px !important;">
                📅 ${escapeHtml(b.bookingDate || '—')} &nbsp; 
                ${b.timeSlot ? `⏰ ${escapeHtml(b.timeSlot)}` : ''} &nbsp; 
                ${b.numPeople ? `👥 ${escapeHtml(String(b.numPeople))}` : ''}
            </p>
            <button class="btn-wa-confirm">Confirm 💬</button>
        </div>
        <button class="alert-close" aria-label="Close notification">×</button>
    `;

    container.appendChild(toast);

    toast.querySelector('.btn-wa-confirm').addEventListener('click', (e) => {
        sendWhatsAppConfirmation(b);
        const key = `${b.tableId}|${b.shift}|${b.bookingDate}`;
        confirmedWhatsApp.add(key);
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
function sendWhatsAppConfirmation(b) {
    if (!b.contact) {
        showToast('No contact number provided for this booking.', 'error');
        return;
    }
    const phone = '91' + String(b.contact).replace(/\D/g, ''); // Ensure digits and country code
    const num = b.tableId.replace(/^[A-Z]/, '');
    let msg = `✅ *Booking Confirmed – Foothills Retreat*\n\n`;
    msg += `Hello ${b.guestName || 'Guest'}, your table has been successfully booked!\n\n`;
    msg += `🎫 *Token:* ${num}\n`;
    msg += `📅 *Date:* ${b.bookingDate || '—'}\n`;
    msg += `⏰ *Time:* ${b.timeSlot || b.shift}\n`;
    msg += `👥 *Guests:* ${b.numPeople || '—'}\n\n`;
    msg += `We look forward to hosting you! If you need to cancel or modify your booking, please reply to this message.`;

    window.open(`https://api.whatsapp.com/send?phone=${phone}&text=${encodeURIComponent(msg)}`, '_blank', 'noopener,noreferrer');
}
