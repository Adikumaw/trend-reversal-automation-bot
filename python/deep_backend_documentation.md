Here is the completely updated and finalized **Deep API Documentation** for Server **v3.2.4**.

It covers the new **Alert Update Logic**, the **Closing Phase** mechanism, and the **Partial Close** tolerance.

***

# 📡 Grid Trading System - Complete API Documentation

## 🎯 Overview

**Server Version:** `3.2.4` (Permissive Mode + Alert Support + Close Confirmation)  
**Base URL:** `http://127.0.0.1:8000`  
**Protocol:** HTTP/JSON  
**Authentication:** None (Local deployment)  
**CORS:** Enabled for all origins

> **⚠️ IMPORTANT: Permissive Mode**  
> This server accepts **any** numerical input without strict server-side validation.  
> **The UI is solely responsible for data integrity.** Sending negative prices, zero lots, or non-sequential indices will be accepted by the server but **will break the trading logic** or cause MT5 errors.

---

## 📋 Table of Contents

1. [Quick Start](#quick-start)
2. [Data Flow & Lifecycle](#data-flow--lifecycle)
3. [Core Endpoints](#core-endpoints)
4. [Data Models](#data-models)
5. [UI Integration Guide (Alerts & Inputs)](#ui-integration-guide-alerts--inputs)
6. [Critical Rules (Do's and Don'ts)](#critical-rules-dos-and-donts)
7. [System Logic & Error Handling](#system-logic--error-handling)

---

## 🚀 Quick Start

### Polling Pattern (UI -> Server)

```javascript
// Poll server every 1 second for live updates
setInterval(async () => {
  try {
    const response = await fetch('http://127.0.0.1:8000/api/ui-data');
    const data = await response.json();
    updateUI(data); // Render settings, price, and errors
  } catch (e) {
    showDisconnectedState();
  }
}, 1000);
```

---

## 🔄 Data Flow & Lifecycle

Understanding the "Closing Phase" is critical for UI feedback.

1.  **Running:** Switch is ON. Trades are executing.
2.  **TP Hit:** Server detects Profit Target reached.
    *   Server enters **Closing Mode** (`buy_is_closing = true`).
    *   Server sends `CLOSE_ALL` command to MT5.
    *   **UI Status:** Should show "Closing..." or "Securing Profit...".
3.  **Closing Confirmation:**
    *   Server waits for MT5 trade count to drop to **0**.
    *   Server sends `CLOSE_ALL` repeatedly until confirmed.
4.  **Reset:**
    *   Once trades are 0, Server resets the Session ID and Reference Price.
    *   If Cyclic: Starts new cycle immediately.
    *   If One-Shot: Turns Switch OFF.

---

## 🔌 Core Endpoints

### 1. GET `/api/ui-data`

**Purpose:** Get complete system state.  
**Frequency:** Poll every 1 second.

**Response Example:**
```json
{
  "settings": { ... },
  "runtime": {
    "buy_on": true,
    "current_price": 1.08450,
    "current_ask": 1.08460,
    "current_bid": 1.08440,
    
    "error_status": "",       // CRITICAL: If not empty, show RED ALERT overlay
    
    "buy_id": "buy_a1b2c3",   // Current Session Hash
    "buy_is_closing": false,  // If true, show "Closing..." spinner
    
    "buy_exec_map": {
      "0": { "index": 0, "profit": 2.50, "cumulative_profit": 2.50 }
    }
  },
  "market": { ... },
  "last_update": "2024-12-06T10:32:15..."
}
```

---

### 2. POST `/api/control`

**Purpose:** Queue switch toggles or emergency actions.

**Request:**
```json
{
  "buy_switch": true,      // Optional
  "sell_switch": false,    // Optional
  "cyclic": true,          // Optional
  "emergency_close": true  // Optional: Kills everything immediately
}
```

---

### 3. POST `/api/update-settings`

**Purpose:** Update grid configuration, TP, and acknowledge alerts.

> **🔒 Behavior for Executed Rows (v3.2.4):**
> If a row has already traded (exists in `exec_map`), the server applies **Partial Locking**:
> 1.  **Dollar/Lots:** Ignored (Server forces old values).
> 2.  **Alert:** Updated (Server accepts new value).

**Request:**
```json
{
  "limit_price": 1.083,
  "tp_type": "fixed_money",
  "tp_value": 100.0,
  "rows_buy": [
    { "index": 0, "dollar": 0.002, "lots": 0.01, "alert": false }, // Index 0: Alert turned off
    { "index": 1, "dollar": 0.003, "lots": 0.02, "alert": true }
  ],
  "rows_sell": []
}
```

---

## 🎨 UI Integration Guide (Alerts & Inputs)

### 1. Input Field States
For the Grid Table in the UI, apply these states based on `exec_map`:

| Row Status | `Dollar` Input | `Lots` Input | `Alert` Checkbox |
| :--- | :--- | :--- | :--- |
| **Pending** (Not in map) | ✅ Editable | ✅ Editable | ✅ Editable |
| **Executed** (In map) | ❌ **Disabled** | ❌ **Disabled** | ✅ **Editable** |

### 2. Handling Alerts (The "Acknowledge" Pattern)
When the server executes a trade with `"alert": true`, the UI should play a sound or show a popup. The user needs to stop this alarm.

**How to Acknowledge:**
1.  User clicks "Stop Alarm" / "Acknowledge".
2.  UI updates local state: Set that row's `alert` to `false`.
3.  UI calls `/api/update-settings` with the full rows array.
4.  **Result:** Server updates the alert status to `false`, effectively silencing it for future polls, but keeps the trade logic (dollar/lots) locked and safe.

---

## 🚨 Critical Rules (Do's and Don'ts)

### ✅ DO's
1.  **DO Check `error_status`:** In every poll, check `runtime.error_status`. If it is not empty, display a full-screen **"CRITICAL ERROR"** overlay blocking all controls. The server is frozen until the user fixes the issue in MT5.
2.  **DO Validate Inputs:** Ensure `tp_value >= 0`, `limit_price >= 0`, and `lots > 0` before sending.
3.  **DO Send Full Arrays:** When updating settings (even just acknowledging one alert), send the **entire** `rows_buy` and `rows_sell` arrays.

### ❌ DON'Ts
1.  **DON'T Enable Locked Inputs:** Never let users modify `dollar` or `lots` for executed rows. The server will ignore it, but it creates a confusing UX.
2.  **DON'T Call `/api/tick`:** This is for MT5 only.
3.  **DON'T Assume Instant Close:** When TP is hit, the `buy_id` will **not** disappear immediately. The system enters a "Closing Phase" first. Wait for the server to clear the ID.

---

## ⚙️ System Logic & Error Handling

### 1. Critical Conflict (Red Flag) 🛑
*   **Condition:** An unknown trade ("Alien") is detected in MT5 that looks like a bot trade but matches no active Session ID.
*   **Behavior:** Server **FREEZES**. Returns `action: WAIT`.
*   **UI Response:** Show Red Alert. User must manually close the alien trade in MT5 or use "Emergency Close" to wipe server state.

### 2. Partial Close (Tolerance) ⚠️
*   **Condition:** User manually closes *some* trades in MT5, but not all.
*   **Behavior:** Server detects `MT5 Count < Server Count`.
*   **Action:** Server **CONTINUES** running. It preserves the history of the closed trades so it doesn't re-open the same grid levels. It treats them as "Resolved/Loss".

### 3. Closing Confirmation (Priority 1.5) 🔄
*   **Condition:** TP Hit or Switch OFF.
*   **Behavior:**
    1.  Server sets `buy_is_closing = True`.
    2.  Server sends `CLOSE_ALL` command.
    3.  Server **waits** until MT5 reports **0 active trades**.
    4.  Only then does it clear `buy_id` and reset the cycle.
*   **Benefit:** Prevents "Orphan Trades" where the server forgets the ID before MT5 finishes closing them.

### 4. TP Logic (Always On) 💰
*   **Behavior:** The server checks Take Profit logic if a **Session ID exists**, regardless of whether the Master Switch is ON or OFF.
*   **Benefit:** You can "Pause" the bot (Switch OFF) safely; it will still close trades when they hit profit.