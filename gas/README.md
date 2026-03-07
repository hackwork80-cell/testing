# Google Apps Script Setup Guide

## One-Time Setup (≈ 5 minutes)

### Step 1 — Create a Google Sheet

1. Go to [sheets.google.com](https://sheets.google.com) and create a new spreadsheet.
2. Rename it to **"Restaurant Bookings"** (or anything you like).
3. Copy the **Spreadsheet ID** from the URL:
   ```
   https://docs.google.com/spreadsheets/d/THIS_PART_IS_YOUR_ID/edit
   ```
4. Create two tabs (sheets) named exactly:
   - `Bookings`
   - `Users`

---

### Step 2 — Create the Apps Script Project

1. In your Google Sheet, click **Extensions → Apps Script**.
2. Delete all existing code in the editor.
3. Paste the entire contents of `Code.gs` (this folder) into the editor.
4. Replace `YOUR_SPREADSHEET_ID_HERE` at the top of the file with the ID you copied in Step 1.
5. Click **Save** (💾 icon).

---

### Step 3 — Deploy as a Web App

1. Click **Deploy → New deployment**.
2. Click the gear icon ⚙️ next to "Select type" and choose **Web app**.
3. Fill in:
   | Field | Value |
   |-------|-------|
   | Description | Restaurant Booking API |
   | Execute as | **Me** |
   | Who has access | **Anyone** |
4. Click **Deploy**.
5. **Copy the Web App URL** that appears — it looks like:
   ```
   https://script.google.com/macros/s/XXXXXXXXXX/exec
   ```

---

### Step 4 — Update the Frontend

Open `js/api.js` and replace:
```js
const GAS_URL = 'YOUR_GAS_WEB_APP_URL_HERE';
```
with your Web App URL from Step 3.

---

### Step 5 — Initialise the Sheet Data

1. Open `admin.html` in your browser.
2. Log in with password: **admin123**
3. Click the **"⚙ Initialise Sheets"** button.
   - This seeds `Bookings` with 10 Lunch rows and 15 Dinner rows.
   - This only needs to be done **once**.

---

## Re-deploying after Code Changes

If you edit `Code.gs`, you must create a **new deployment version**:
1. Click **Deploy → Manage deployments**.
2. Click the pencil ✏️ icon.
3. Under "Version", select **"New version"**.
4. Click **Deploy**.

> ⚠️ The Web App URL stays the same after re-deploying — no need to update `api.js`.

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| CORS errors in console | Make sure deploy access is set to **Anyone** (not "Anyone with Google account") |
| 302 redirects / auth errors | Re-deploy with access = **Anyone** |
| Data not updating | You edited Code.gs but didn't create a new version — re-deploy |
| `#REF!` in sheet | Check SPREADSHEET_ID is correct |
