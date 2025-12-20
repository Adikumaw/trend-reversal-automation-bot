# 📡 Grid Trading System - Complete API Documentation

## 🎯 Overview

**Server Version:** `3.3.0` (Separate Buy/Sell Management)  
**Base URL:** `http://127.0.0.1:8000`  
**Protocol:** HTTP/JSON  
**Authentication:** None (Local deployment)  
**CORS:** Enabled for all origins

> **⭐ Key Update (v3.3.0):**  
> The Buy and Sell sides are now **completely independent**. You can set a Limit Price for Buys while executing Sells at Market. You can set a 1% Equity TP for Buys and a Fixed $50 TP for Sells.

---

## 📋 Table of Contents

1. [Quick Start](#quick-start)
2. [Data Flow & Lifecycle](#data-flow--lifecycle)
3. [Core Endpoints](#core-endpoints)
4. [Data Models](#data-models)
5. [UI Integration Guide](#ui-integration-guide)
6. [System Logic & Error Handling](#system-logic--error-handling)

---

## 🚀 Quick Start

### Polling Pattern (UI -> Server)

```javascript
// Poll server every 1 second for live updates
setInterval(async () => {
  try {
    const response = await fetch("http://127.0.0.1:8000/api/ui-data");
    const data = await response.json();
    updateUI(data); // Render settings, price, and errors
  } catch (e) {
    showDisconnectedState();
  }
}, 1000);
```

---

## 🔄 Data Flow & Lifecycle

The lifecycle now runs essentially two parallel engines (Buy Engine and Sell Engine).

1.  **Waiting for Limit (Optional):**
    - If `buy_limit_price > 0`, the server enters `buy_waiting_limit` state.
    - Trades will not start until `Ask <= buy_limit_price`.
2.  **Grid Execution:**
    - Once triggered (Market or Limit), the server locks the `start_ref` (Starting Reference Price).
    - Grid levels are calculated relative to this specific reference.
3.  **TP Hit (Independent):**
    - If **Buy TP** is hit, only the Buy side enters "Closing Phase".
    - The Sell side continues running uninterrupted.
4.  **Closing Phase:**
    - Server sets `buy_is_closing` (or `sell_is_closing`) to `True`.
    - Waits for MT5 active trade count to drop to **0** for that specific specific side.

---

## 🔌 Core Endpoints

### 1. GET `/api/ui-data`

**Purpose:** Get complete system state including the new separate flags.  
**Frequency:** Poll every 1 second.

**Response Example:**

```json
{
  "settings": {
    "buy_limit_price": 1.0500,      // 0.0 = Market Execution
    "sell_limit_price": 0.0,        // 0.0 = Market Execution
    "buy_tp_type": "equity_pct",
    "buy_tp_value": 1.5,
    "sell_tp_type": "fixed_money",
    "sell_tp_value": 50.0,
    "rows_buy": [...],
    "rows_sell": [...]
  },
  "runtime": {
    "buy_on": true,
    "sell_on": false,

    // --- NEW: Limit & Reference States ---
    "buy_waiting_limit": true,      // UI: Show "Waiting for Price..."
    "sell_waiting_limit": false,
    "buy_start_ref": 1.0500,        // The anchor price for the grid
    "sell_start_ref": 0.0,

    // --- Closing States ---
    "buy_is_closing": false,
    "sell_is_closing": false,

    "error_status": "",             // CRITICAL: If not empty, block UI
    "buy_exec_map": { ... },
    "sell_exec_map": { ... }
  },
  "market": {
      "current": { "mid": 1.0520, "ts": 1700000000.0 },
      "history": [...]
  },
  "last_update": "2025-12-20T20:30:15..."
}
```

---

### 2. POST `/api/control`

**Purpose:** Master switches.
**Note:** `emergency_close` kills **both** sides immediately.

**Request:**

```json
{
  "buy_switch": true,
  "sell_switch": false,
  "cyclic": true,
  "emergency_close": false
}
```

---

### 3. POST `/api/update-settings`

**Purpose:** Update the split configuration and acknowledge alerts.
**Important:** You must send the full structure (Buy settings AND Sell settings).

> **🔒 Partial Locking Rule:**
> If a row has already traded (exists in `exec_map`), the server ignores changes to `dollar` and `lots`, but accepts changes to `alert`.

**Request:**

```json
{
  # --- Buy Settings ---
  "buy_limit_price": 1.0500,    # Set to 0 for Market Execution
  "buy_tp_type": "equity_pct",  # Options: "equity_pct", "balance_pct", "fixed_money"
  "buy_tp_value": 1.0,          # Value corresponding to type

  # --- Sell Settings ---
  "sell_limit_price": 0.0,      # 0 = Start immediately
  "sell_tp_type": "fixed_money",
  "sell_tp_value": 100.0,

  # --- Grid Rows ---
  "rows_buy": [
    { "index": 0, "dollar": 0.002, "lots": 0.01, "alert": false },
    { "index": 1, "dollar": 0.003, "lots": 0.02, "alert": true }
  ],
  "rows_sell": [
    { "index": 0, "dollar": 0.002, "lots": 0.01, "alert": false }
  ]
}
```

---

## 🎨 UI Integration Guide

### 1. Split Interface

Your UI should visually separate the **Buy Control Panel** from the **Sell Control Panel**.

- **Buy Panel:** Inputs for `buy_limit_price`, `buy_tp_type`, `buy_tp_value`, and the Buy Grid Table.
- **Sell Panel:** Inputs for `sell_limit_price`, `sell_tp_type`, `sell_tp_value`, and the Sell Grid Table.

### 2. Status Indicators

You need to visualize 3 distinct states per side based on `runtime`:

| Runtime State                        | UI Status Text       | Color         |
| :----------------------------------- | :------------------- | :------------ |
| `buy_on=F`                           | **STOPPED**          | Gray          |
| `buy_on=T` AND `buy_waiting_limit=T` | **WAITING LIMIT**    | Orange/Yellow |
| `buy_on=T` AND `buy_waiting_limit=F` | **ACTIVE / TRADING** | Green         |
| `buy_is_closing=T`                   | **CLOSING...**       | Blue/Spinner  |

### 3. Acknowledging Alerts

Same as previous versions:

1.  If a trade executes with `alert: true`, UI plays sound.
2.  User clicks "Stop Alarm".
3.  UI sends `/api/update-settings` with that specific row's `alert` set to `false`.

---

## ⚙️ System Logic & Error Handling

### 1. Limit Price Logic (The "Trap")

- **Logic:** If you set `buy_limit_price = 1.0500` and current Ask is `1.0550`:
  - The bot sets `buy_waiting_limit = True`.
  - It **waits** until Ask drops to `<= 1.0500`.
  - Once hit, `buy_waiting_limit` becomes `False`, and `buy_start_ref` is set to `1.0500` (or current Ask). The grid builds down from there.
- **Reset:** If you stop the bot (`buy_on = False`), the limit waiting state is cleared.

### 2. Conflict Detection 🛑

- The server explicitly checks `p.comment` against `rt.buy_id` and `rt.sell_id`.
- If a trade appears with `buy_...` in the comment but doesn't match the current Session ID, the server throws a **CRITICAL ERROR** and freezes.

### 3. TP Calculation

- **Equity %:** `Current Equity * (Value / 100)`
- **Balance %:** `Current Balance * (Value / 100)`
- **Fixed Money:** Raw `Value`
- _Note:_ TP is checked on every tick. If hit, it triggers the "Close Sequence" for that specific side only.
