// ============================================================
//  auth.js — Login form logic + sessionStorage persistence
// ============================================================

const SESSION_KEY = 'tableapp_user';

function getSessionUser() {
    const raw = sessionStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
}

function saveSessionUser(name, contact) {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify({ name, contact }));
}

function clearSession() {
    sessionStorage.removeItem(SESSION_KEY);
}

/** Guard: redirects to login if no session */
function requireAuth(redirectTo = 'index.html') {
    if (!getSessionUser()) {
        window.location.href = redirectTo;
    }
}

// ── Login form handler (index.html only) ──────────────────────
document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('login-form');
    if (!form) return;

    // Already logged in → skip to dashboard
    if (getSessionUser()) {
        window.location.href = 'dashboard.html';
        return;
    }

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const name = document.getElementById('input-name').value.trim();
        const contact = document.getElementById('input-contact').value.trim();

        if (!name || !contact) {
            showFormError('Please fill in both fields.');
            return;
        }
        if (!/^\d{10}$/.test(contact)) {
            showFormError('Contact must be a 10-digit number.');
            return;
        }

        const btn = form.querySelector('button[type="submit"]');
        btn.disabled = true;
        btn.textContent = 'Logging in…';

        try {
            await apiAddUser(name, contact);
            saveSessionUser(name, contact);
            window.location.href = 'dashboard.html';
        } catch (err) {
            // Surface the GAS error directly (covers duplicate-number message)
            showFormError(err.message || 'Could not connect to server. Please try again.');
            console.error(err);
            btn.disabled = false;
            btn.textContent = 'Enter Restaurant →';
        }
    });
});

function showFormError(msg) {
    let el = document.getElementById('form-error');
    if (!el) {
        el = document.createElement('p');
        el.id = 'form-error';
        el.className = 'form-error';
        document.getElementById('login-form').appendChild(el);
    }
    el.textContent = msg;
}
