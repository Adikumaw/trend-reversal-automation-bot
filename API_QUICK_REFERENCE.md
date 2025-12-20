# 📘 Quick Reference - API Field Mappings (v3.3.0)

## 1. UserSettings Object
**Endpoint:** `POST /api/update-settings`  
**Correction:** The server now separates Buy and Sell settings (TPs and Limits). The TP type `amount` is actually `fixed_money` in the Python code.

```typescript
interface UserSettings {
  // --- BUY SETTINGS ---
  buy_limit_price: number;       // 0 = Market Price, >0 = Pending Limit
  buy_tp_type: "equity_pct" | "balance_pct" | "fixed_money";
  buy_tp_value: number;          // e.g. 1.5 (for 1.5%) or 50.0 (for $50)

  // --- SELL SETTINGS ---
  sell_limit_price: number;      // 0 = Market Price, >0 = Pending Limit
  sell_tp_type: "equity_pct" | "balance_pct" | "fixed_money";
  sell_tp_value: number;

  // --- GRIDS ---
  rows_buy: GridRow[];           // Array of GridRow objects
  rows_sell: GridRow[];          // Array of GridRow objects
}

interface GridRow {
  index: number;
  dollar: number;                // Price gap
  lots: number;                  // Volume
  alert: boolean;                // UI alert flag (User sets this)
}
```

## 2. RuntimeState Object
**Endpoint:** `GET /api/ui-data` (Inside the `runtime` key)  
**Correction:** The server does **not** send `next_index` or `last_alert_msg`. You must calculate the next index based on the execution map length.

```typescript
interface RuntimeState {
  // --- SWITCHES ---
  buy_on: boolean;
  sell_on: boolean;
  cyclic_on: boolean;

  // --- STATES ---
  buy_waiting_limit: boolean;    // True if waiting for price to hit limit
  sell_waiting_limit: boolean;
  
  buy_is_closing: boolean;       // True if TP hit, waiting for trades to close
  sell_is_closing: boolean;

  // --- EXECUTION DATA ---
  // Maps index (as string) to stats. 
  // Length of keys = Current Next Index.
  buy_exec_map: Record<string, RowExecStats>; 
  sell_exec_map: Record<string, RowExecStats>; 

  // --- REFERENCE PRICES ---
  buy_start_ref: number;         // The anchor price the grid is built on
  sell_start_ref: number;

  // --- ERRORS ---
  error_status: string;          // If not empty string, BLOCK THE UI (Critical)
}

interface RowExecStats {
  index: number;
  entry_price: number;
  lots: number;
  profit: number;
  timestamp: string;
}
```

## 3. Control Commands
**Endpoint:** `POST /api/control`  
**Correction:** The emergency command is `emergency_close`, not `close_all`.

```typescript
// Toggle BUY
{ "buy_switch": true }  // or false

// Toggle SELL
{ "sell_switch": true } // or false

// Toggle CYCLIC
{ "cyclic": true }      // or false

// ⚠️ EMERGENCY KILL (Closes BOTH sides immediately)
{ "emergency_close": true }
```

## 4. TP Type Values (Enums)

| Frontend Label | Server Value (String) | Meaning |
| :--- | :--- | :--- |
| EQUITY % | `"equity_pct"` | % of Current Equity |
| BALANCE % | `"balance_pct"` | % of Balance |
| FIXED $ | `"fixed_money"` | Specific Currency Amount |
| *OFF* | *N/A* | Send `value: 0` to disable TP |

## 5. UI Logic: Highlighting & Alerts

Since the server doesn't send "Next Index" or "Alert Messages" explicitly, the Frontend must derive them:

### A. Calculating "Next Row" (Blue Highlight)
The "next" row to be executed is simply the count of currently executed rows.
```typescript
const buyNextIndex = Object.keys(runtime.buy_exec_map).length;
const sellNextIndex = Object.keys(runtime.sell_exec_map).length;

// Logic:
// If buyNextIndex is 0 -> Highlight Row 0
// If buyNextIndex is 5 -> Highlight Row 5
```

### B. Triggering Alerts (Red Highlight / Sound)
You need to cross-reference the **Executed Rows** with the **Settings**.

**Logic:**
Iterate through `runtime.buy_exec_map`. For every executed index:
1.  Look up the corresponding row in `settings.rows_buy`.
2.  If `row.alert === true`:
    *   **UI:** Play Sound.
    *   **UI:** Show "Acknowledge" button.
    *   **Action:** When user clicks Acknowledge, update settings sending `alert: false` for that row.

### C. Waiting for Limit (Yellow Status)
If `runtime.buy_waiting_limit === true`:
*   **UI:** Overlay the Buy Grid with text: *"Waiting for Price < [limit_price]..."*
*   **Input:** Allow user to change `buy_limit_price` on the fly.