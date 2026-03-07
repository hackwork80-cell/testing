// ============================================================
//  Restaurant Table Booking — Google Apps Script Web App
//  Deploy as: Execute as "Me" | Access: "Anyone"
// ============================================================

var SPREADSHEET_ID  = '12YRBb_Tj9KiESQi2408KARmfMppjQdhAHuEqeMaosio';
var BOOKINGS_SHEET  = 'Bookings';
var USERS_SHEET     = 'Users';
var CUSTOMERS_SHEET = 'Customers';
var SESSION_HOURS   = 8;
var ADVANCE_DAYS    = 2;

// ── Date helper ───────────────────────────────────────────────
// Returns YYYY-MM-DD string for a date offset by `offset` days from today (IST)
function dateString(offset) {
  var now = new Date();
  // Adjust to IST (UTC+5:30)
  var ist = new Date(now.getTime() + (5.5 * 60 * 60 * 1000));
  ist.setUTCDate(ist.getUTCDate() + (offset || 0));
  var y = ist.getUTCFullYear();
  var m = String(ist.getUTCMonth() + 1).padStart(2, '0');
  var d = String(ist.getUTCDate()).padStart(2, '0');
  return y + '-' + m + '-' + d;
}

function todayString() { return dateString(0); }

// ── CORS headers helper ───────────────────────────────────────
function jsonResponse(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

// ── Entry points ──────────────────────────────────────────────
function doGet(e) {
  var action = e.parameter.action;
  try {
    if (action === 'getBookings')       return getBookings(e.parameter.shift, e.parameter.date);
    if (action === 'getBothShifts')     return getBothShifts(e.parameter.date);
    if (action === 'initSheets')        return initSheets();
    if (action === 'cleanupSessions')   return cleanupExpiredSessions();
    if (action === 'cleanupPast')       return cleanupPastBookings();
    return jsonResponse({ error: 'Unknown action: ' + action });
  } catch (err) {
    return jsonResponse({ error: err.message });
  }
}

function doPost(e) {
  var data   = JSON.parse(e.postData.contents);
  var action = data.action;
  try {
    if (action === 'addUser')         return addUser(data);
    if (action === 'bookTable')       return bookTable(data);
    if (action === 'bookTables')      return bookTables(data);
    if (action === 'clearTable')      return clearTable(data);
    if (action === 'cancelBooking')   return cancelBooking(data);
    if (action === 'initSheets')      return initSheets();
    return jsonResponse({ error: 'Unknown action: ' + action });
  } catch (err) {
    return jsonResponse({ error: err.message });
  }
}

// ── getBothShifts(date) ───────────────────────────────────────
// Columns: [0]TableID [1]Shift [2]Status [3]GuestName [4]Contact
//          [5]TimeSlot [6]BookingDate [7]NumPeople
function getBothShifts(date) {
  var filterDate = date || todayString();
  var ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sheet = ss.getSheetByName(BOOKINGS_SHEET);
  var rows  = sheet.getDataRange().getDisplayValues();
  var lunch   = [];
  var dinner  = [];

  for (var i = 1; i < rows.length; i++) {
    var row = rows[i];
    if (String(row[6]) !== filterDate) continue;
    var obj = {
      tableId:     row[0],
      shift:       row[1],
      status:      row[2],
      guestName:   row[3],
      contact:     row[4],
      timeSlot:    row[5] || '',
      bookingDate: row[6] || '',
      numPeople:   row[7] || '',
      rowIndex:    i + 1
    };
    if (row[1] === 'Lunch')  lunch.push(obj);
    if (row[1] === 'Dinner') dinner.push(obj);
  }
  return jsonResponse({ success: true, lunch: lunch, dinner: dinner });
}

// ── getBookings(shift, date) ──────────────────────────────────
function getBookings(shift, date) {
  var filterDate = date || todayString();
  var ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sheet = ss.getSheetByName(BOOKINGS_SHEET);
  var rows  = sheet.getDataRange().getDisplayValues();
  var result = [];

  for (var i = 1; i < rows.length; i++) {
    var row = rows[i];
    if (row[1] === shift && String(row[6]) === filterDate) {
      result.push({
        tableId:     row[0],
        shift:       row[1],
        status:      row[2],
        guestName:   row[3],
        contact:     row[4],
        timeSlot:    row[5] || '',
        bookingDate: row[6] || '',
        numPeople:   row[7] || '',
        rowIndex:    i + 1
      });
    }
  }
  return jsonResponse({ success: true, bookings: result });
}

// ── addUser(data) ─────────────────────────────────────────────
function addUser(data) {
  var ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sheet = ss.getSheetByName(USERS_SHEET);
  var rows  = sheet.getDataRange().getValues();
  var timestamp = new Date().toISOString();

  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][1]) === String(data.contact)) {
      var storedName = String(rows[i][0]).trim().toLowerCase();
      var givenName  = String(data.name).trim().toLowerCase();
      if (storedName !== givenName) {
        return jsonResponse({
          success: false,
          error: 'Name does not match our records for this number. Please enter the same name you registered with.'
        });
      }
      sheet.getRange(i + 1, 3).setValue(timestamp);
      return jsonResponse({ success: true });
    }
  }
  sheet.appendRow([data.name, data.contact, timestamp]);
  return jsonResponse({ success: true });
}

// ── saveCustomer(name, whatsapp) ──────────────────────────────
// Stores customer info in the Customers sheet.
// Only saves if the WhatsApp number is not already recorded.
function saveCustomer(name, whatsapp) {
  if (!whatsapp) return;
  var ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sheet = ss.getSheetByName(CUSTOMERS_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(CUSTOMERS_SHEET);
    sheet.appendRow(['Name', 'WhatsApp Number', 'First Booking Date']);
  }
  var rows = sheet.getDataRange().getDisplayValues();
  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][1]).trim() === String(whatsapp).trim()) {
      // Already exists — skip
      return;
    }
  }
  // New customer — append
  sheet.appendRow([name, whatsapp, todayString()]);
}

// ── bookTable(data) ───────────────────────────────────────────
function bookTable(data) {
  var bookDate = data.bookingDate || todayString();

  var ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sheet = ss.getSheetByName(BOOKINGS_SHEET);
  var rows  = sheet.getDataRange().getDisplayValues();

  for (var j = 1; j < rows.length; j++) {
    if (String(rows[j][4]) === String(data.contact) &&
        rows[j][2] === 'Occupied' &&
        rows[j][1] !== data.shift &&
        String(rows[j][6]) === bookDate) {
      return jsonResponse({
        success: false,
        error: 'You already have a booking in ' + rows[j][1] + ' on this date.'
      });
    }
  }

  for (var i = 1; i < rows.length; i++) {
    var row = rows[i];
    if (String(row[0]) === String(data.tableId) &&
        row[1] === data.shift &&
        String(row[6]) === bookDate) {
      if (row[2] === 'Occupied') {
        return jsonResponse({ success: false, error: 'Table already booked for this date.' });
      }
      // [2]Status [3]GuestName [4]Contact [5]TimeSlot [6]BookingDate [7]NumPeople
      sheet.getRange(i + 1, 3, 1, 6).setValues([[
        'Occupied', data.guestName, data.contact,
        data.timeSlot || '', bookDate, data.numPeople || ''
      ]]);
      // Save customer to Customers registry
      saveCustomer(data.guestName, data.contact);
      return jsonResponse({ success: true });
    }
  }
  return jsonResponse({ success: false, error: 'Table not found for this date.' });
}

// ── bookTables(data) ──────────────────────────────────────────
function bookTables(data) {
  var ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sheet = ss.getSheetByName(BOOKINGS_SHEET);
  var rows  = sheet.getDataRange().getDisplayValues();

  var tables   = data.tables || [];
  var contact  = tables.length ? tables[0].contact  : '';
  var shift    = tables.length ? tables[0].shift    : '';
  var bookDate = tables.length ? (tables[0].bookingDate || todayString()) : todayString();

  // Guard: no cross-shift on same date
  for (var j = 1; j < rows.length; j++) {
    if (String(rows[j][4]) === String(contact) &&
        rows[j][2] === 'Occupied' &&
        rows[j][1] !== shift &&
        String(rows[j][6]) === bookDate) {
      return jsonResponse({
        success: false,
        error: 'You already have a booking in ' + rows[j][1] + ' on this date.'
      });
    }
  }

  // Build map: "tableId|shift|date" → row index
  var rowMap = {};
  for (var i = 1; i < rows.length; i++) {
    var key = rows[i][0] + '|' + rows[i][1] + '|' + rows[i][6];
    rowMap[key] = i;
  }

  var results = [];
  for (var t = 0; t < tables.length; t++) {
    var td  = tables[t];
    var bdt = td.bookingDate || todayString();
    var key2 = td.tableId + '|' + td.shift + '|' + bdt;
    var idx  = rowMap[key2];
    if (idx === undefined) {
      results.push({ tableId: td.tableId, success: false, error: 'Table not found for this date.' });
      continue;
    }
    if (rows[idx][2] === 'Occupied') {
      results.push({ tableId: td.tableId, success: false, error: 'Table already booked.' });
      continue;
    }
    sheet.getRange(idx + 1, 3, 1, 6).setValues([[
      'Occupied', td.guestName, td.contact,
      td.timeSlot || '', bdt, td.numPeople || ''
    ]]);
    rows[idx][2] = 'Occupied';
    // Save customer to Customers registry
    saveCustomer(td.guestName, td.contact);
    results.push({ tableId: td.tableId, success: true });
  }

  var anySuccess = results.some(function(r) { return r.success; });
  return jsonResponse({ success: anySuccess, results: results });
}

// ── cancelBooking(data) ───────────────────────────────────────
function cancelBooking(data) {
  var bookDate = data.bookingDate || todayString();
  var ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sheet = ss.getSheetByName(BOOKINGS_SHEET);
  var rows  = sheet.getDataRange().getDisplayValues();

  for (var i = 1; i < rows.length; i++) {
    var row = rows[i];
    if (String(row[0]) === String(data.tableId) &&
        row[1] === data.shift &&
        String(row[6]) === bookDate) {
      sheet.getRange(i + 1, 3, 1, 6).setValues([['Available', '', '', '', bookDate, '']]);
      return jsonResponse({ success: true });
    }
  }
  return jsonResponse({ success: false, error: 'Booking not found.' });
}

// ── clearTable(data) ──────────────────────────────────────────
function clearTable(data) {
  var bookDate = data.bookingDate || todayString();
  var ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sheet = ss.getSheetByName(BOOKINGS_SHEET);
  var rows  = sheet.getDataRange().getDisplayValues();

  for (var i = 1; i < rows.length; i++) {
    var row = rows[i];
    if (String(row[0]) === String(data.tableId) &&
        row[1] === data.shift &&
        String(row[6]) === bookDate) {
      sheet.getRange(i + 1, 3, 1, 6).setValues([['Available', '', '', '', bookDate, '']]);
      return jsonResponse({ success: true });
    }
  }
  return jsonResponse({ success: false, error: 'Table not found.' });
}

// ── cleanupExpiredSessions() ──────────────────────────────────
function cleanupExpiredSessions() {
  var ss     = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sheet  = ss.getSheetByName(USERS_SHEET);
  var rows   = sheet.getDataRange().getValues();
  var now    = new Date();
  var cutoff = SESSION_HOURS * 60 * 60 * 1000;
  var toDelete = [];

  for (var i = 1; i < rows.length; i++) {
    var ts = new Date(rows[i][2]);
    if (!isNaN(ts) && (now - ts) > cutoff) toDelete.push(i + 1);
  }
  for (var d = toDelete.length - 1; d >= 0; d--) sheet.deleteRow(toDelete[d]);
  return jsonResponse({ success: true, deleted: toDelete.length });
}

// ── cleanupPastBookings() ─────────────────────────────────────
// Resets any booking rows whose BookingDate is before today back to Available.
// Run via a nightly time-based trigger.
function cleanupPastBookings() {
  var today = todayString();
  var ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sheet = ss.getSheetByName(BOOKINGS_SHEET);
  var rows  = sheet.getDataRange().getDisplayValues();
  var count = 0;

  for (var i = 1; i < rows.length; i++) {
    var bookDate = String(rows[i][6]);
    if (bookDate && bookDate < today && rows[i][2] === 'Occupied') {
      sheet.getRange(i + 1, 3, 1, 6).setValues([['Available', '', '', '', bookDate, '']]);
      count++;
    }
  }
  return jsonResponse({ success: true, cleared: count });
}

// ── initSheets() ──────────────────────────────────────────────────────
// Resets ONLY today's booking rows. Ensures all rows for today and future dates exist.
// Future dates are NOT affected (their bookings are kept).
// Columns: TableID | Shift | Status | GuestName | Contact | TimeSlot | BookingDate | NumPeople
function initSheets() {
  var ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
  var today = todayString();

  // --- Bookings sheet ---
  var bSheet = ss.getSheetByName(BOOKINGS_SHEET);
  if (!bSheet) {
    bSheet = ss.insertSheet(BOOKINGS_SHEET);
    bSheet.getRange('G:G').setNumberFormat('@');
    bSheet.appendRow(['Table ID', 'Shift', 'Status', 'Guest Name', 'Contact', 'Time Slot', 'Booking Date', 'Num People']);
  }

  var rows = bSheet.getDataRange().getDisplayValues();

  // Track existing rows by "Date|TableID|Shift"
  var existing = {}; 
  for (var i = 1; i < rows.length; i++) {
    var bDate = String(rows[i][6]);
    var key = bDate + '|' + rows[i][0] + '|' + rows[i][1];
    existing[key] = i + 1; // 1-based row number
    
    // Only reset if the row is for TODAY
    if (bDate === today) {
      bSheet.getRange(i + 1, 3, 1, 6).setValues([['Available', '', '', '', bDate, '']]);
    }
  }

  // Ensure all rows exist for today up to ADVANCE_DAYS
  var toAdd = [];
  for (var offset = 0; offset <= ADVANCE_DAYS; offset++) {
    var dStr = dateString(offset);
    
    for (var l = 1; l <= 10; l++) {
      if (!existing[dStr + '|L' + l + '|Lunch']) {
        toAdd.push(['L' + l, 'Lunch', 'Available', '', '', '', dStr, '']);
      }
    }
    for (var d = 1; d <= 15; d++) {
      if (!existing[dStr + '|D' + d + '|Dinner']) {
        toAdd.push(['D' + d, 'Dinner', 'Available', '', '', '', dStr, '']);
      }
    }
  }

  if (toAdd.length > 0) {
    bSheet.getRange(bSheet.getLastRow() + 1, 1, toAdd.length, 8).setValues(toAdd);
  }

  // --- Users sheet ---
  var uSheet = ss.getSheetByName(USERS_SHEET);
  if (!uSheet) {
    uSheet = ss.insertSheet(USERS_SHEET);
    uSheet.appendRow(['Name', 'Contact Number', 'Timestamp']);
  }

  // --- Customers sheet ---
  var cSheet = ss.getSheetByName(CUSTOMERS_SHEET);
  if (!cSheet) {
    cSheet = ss.insertSheet(CUSTOMERS_SHEET);
    cSheet.appendRow(['Name', 'WhatsApp Number', 'First Booking Date']);
  }

  return jsonResponse({ success: true, message: 'Today\'s tables (' + today + ') have been reset. Future dates unchanged.' });
}

// ── setupCleanupTrigger() ─────────────────────────────────────
// Run ONCE manually from the GAS editor.
function setupCleanupTrigger() {
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === 'cleanupExpiredSessions' ||
        t.getHandlerFunction() === 'cleanupPastBookings') {
      ScriptApp.deleteTrigger(t);
    }
  });
  // Hourly session cleanup
  ScriptApp.newTrigger('cleanupExpiredSessions').timeBased().everyHours(1).create();
  // Nightly booking cleanup at midnight IST
  ScriptApp.newTrigger('cleanupPastBookings').timeBased().everyDays(1).atHour(0).create();
}
