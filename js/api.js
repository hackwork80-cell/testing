// ============================================================
//  api.js — all communication with the GAS Web App
// ============================================================

const GAS_URL = 'https://script.google.com/macros/s/AKfycbyNOldJiOuJ1h8C93h_nrCwTXxtL-F-W5Bh8iQzXJVaW1A0uB2NTbaQJP8p_H-CAAM-dw/exec';

// ── Date helper (YYYY-MM-DD, matches GAS IST logic) ───────────
function getTodayIST() {
  const now = new Date();
  const ist = new Date(now.getTime() + 5.5 * 60 * 60 * 1000);
  const y = ist.getUTCFullYear();
  const m = String(ist.getUTCMonth() + 1).padStart(2, '0');
  const d = String(ist.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// ── GET: both shifts for a given date ─────────────────────────
async function apiGetBothShifts(date) {
  const d = date || getTodayIST();
  const url = `${GAS_URL}?action=getBothShifts&date=${encodeURIComponent(d)}`;
  const res = await fetch(url, { redirect: 'follow' });
  const data = await res.json();
  if (!data.success) throw new Error(data.error || 'Failed to fetch bookings');
  return { lunch: data.lunch, dinner: data.dinner };
}

async function apiGetBookings(shift, date) {
  const d = date || getTodayIST();
  const url = `${GAS_URL}?action=getBookings&shift=${encodeURIComponent(shift)}&date=${encodeURIComponent(d)}`;
  const res = await fetch(url, { redirect: 'follow' });
  const data = await res.json();
  if (!data.success) throw new Error(data.error || 'Failed to fetch bookings');
  return data.bookings;
}

async function apiAddUser(name, contact) {
  const res = await fetch(GAS_URL, {
    method: 'POST', redirect: 'follow',
    headers: { 'Content-Type': 'text/plain' },
    body: JSON.stringify({ action: 'addUser', name, contact })
  });
  const data = await res.json();
  if (!data.success) throw new Error(data.error || 'Failed to register user');
  return data;
}

// ── Bulk book — each table object includes bookingDate ─────────
async function apiBookTables(tables) {
  const res = await fetch(GAS_URL, {
    method: 'POST', redirect: 'follow',
    headers: { 'Content-Type': 'text/plain' },
    body: JSON.stringify({ action: 'bookTables', tables })
  });
  const data = await res.json();
  return data;
}

async function apiBookTable(tableId, shift, guestName, contact, timeSlot, numPeople, bookingDate) {
  const res = await fetch(GAS_URL, {
    method: 'POST', redirect: 'follow',
    headers: { 'Content-Type': 'text/plain' },
    body: JSON.stringify({ action: 'bookTable', tableId, shift, guestName, contact, timeSlot, numPeople, bookingDate })
  });
  const data = await res.json();
  if (!data.success) throw new Error(data.error || 'Booking failed');
  return data;
}

async function apiCancelBooking(tableId, shift, contact, bookingDate) {
  const res = await fetch(GAS_URL, {
    method: 'POST', redirect: 'follow',
    headers: { 'Content-Type': 'text/plain' },
    body: JSON.stringify({ action: 'cancelBooking', tableId, shift, contact, bookingDate })
  });
  const data = await res.json();
  if (!data.success) throw new Error(data.error || 'Cancel failed');
  return data;
}

async function apiClearTable(tableId, shift, bookingDate) {
  const res = await fetch(GAS_URL, {
    method: 'POST', redirect: 'follow',
    headers: { 'Content-Type': 'text/plain' },
    body: JSON.stringify({ action: 'clearTable', tableId, shift, bookingDate })
  });
  const data = await res.json();
  if (!data.success) throw new Error(data.error || 'Clear failed');
  return data;
}

async function apiInitSheets() {
  const res = await fetch(GAS_URL, {
    method: 'POST', redirect: 'follow',
    headers: { 'Content-Type': 'text/plain' },
    body: JSON.stringify({ action: 'initSheets' })
  });
  const data = await res.json();
  if (!data.success) throw new Error(data.error || 'Init failed');
  return data;
}
