Here is the comprehensive API documentation for the **Python Trading Server**.

This server is built with **FastAPI**. All data is exchanged in **JSON** format.

### **Base URL**
```
http://localhost:8000
```

---

## **1. Data Models (JSON Structures)**

Before looking at the endpoints, understand the common data structures used in Requests and Responses.

### **Object: `GridRow`**
Represents a single row in the Buy or Sell table.
```json
{
  "index": 0,       // Row number (0-99)
  "dollar": 2.5,    // Price gap input
  "lots": 0.01,     // Volume input
  "alert": true     // Whether to trigger UI alert
}
```

### **Object: `UserSettings`**
Contains all user-defined inputs from the UI.
```json
{
  "limit_price": 4000.50,
  "tp_type": "equity_pct",  // Options: "equity_pct", "balance_pct", "amount", "none"
  "tp_value": 2.0,          // The value associated with the type (e.g., 2%)
  "rows_buy": [ ...list of GridRow objects... ],
  "rows_sell": [ ...list of GridRow objects... ]
}
```

### **Object: `RuntimeState`**
Contains the live status of the server (switches, current active indexes, logic state).
```json
{
  "buy_on": true,
  "sell_on": false,
  "cyclic_on": false,
  "buy_id": "buy_a1b2",       // Current active Hash ID
  "buy_next_index": 1,        // The next row index to be executed
  "buy_waiting_limit": false, // True if waiting for Limit Price to be hit
  "last_alert_msg": "BUY Trade Executed at Level 2" // Message for UI Popup
}
```

---

## **2. Frontend API Endpoints**

These are the endpoints the Web UI (Vue.js/HTML) will use.

### **A. Get Full UI State (Polling)**
**Endpoint:** `GET /api/ui-data`
**Description:** Called by the Frontend every 1 second (Polling). It retrieves the current Inputs and the Live Runtime status.

**Response (200 OK):**
```json
{
  "settings": {
    "limit_price": 0,
    "tp_type": "none",
    "tp_value": 0,
    "rows_buy": [ ... ], 
    "rows_sell": [ ... ]
  },
  "runtime": {
    "buy_on": false,
    "sell_on": false,
    "cyclic_on": false,
    "buy_next_index": 0,
    "sell_next_index": 0,
    "last_alert_msg": "" 
  }
}
```
> **UI Logic:** Use `runtime.buy_next_index` to highlight the active row in the table. Use `runtime.last_alert_msg` to trigger a popup if the string is not empty and has changed since the last poll.

---

### **B. Update Settings (Save Inputs)**
**Endpoint:** `POST /api/update-settings`
**Description:** Called whenever the user changes an input field (Dollars, Lots, Limit, TP) and creates a "Save" event or simply leaves the input field (onBlur).

**Request Body:** (Must be the full `UserSettings` object)
```json
{
  "limit_price": 4050.0,
  "tp_type": "amount",
  "tp_value": 50.0,
  "rows_buy": [
    { "index": 0, "dollar": 2, "lots": 0.01, "alert": false },
    { "index": 1, "dollar": 5, "lots": 0.02, "alert": true }
  ],
  "rows_sell": []
}
```

**Response (200 OK):**
```json
{ "status": "updated" }
```

---

### **C. Control Switches**
**Endpoint:** `POST /api/control`
**Description:** Called when the user clicks a Toggle Switch (Buy, Sell, Cyclic) or the "Emergency Close" button.

**Request Body:** (Send only the keys you want to change)
*Example 1: Turning Buy Switch ON*
```json
{ "buy_switch": true }
```
*Example 2: Turning Cyclic ON*
```json
{ "cyclic": true }
```
*Example 3: Emergency Close All*
```json
{ "close_all": true }
```

**Response (200 OK):**
```json
{
  "status": "ok",
  "state": { ...updated RuntimeState object... }
}
```

---

## **3. MQL5 Interaction Endpoint**

*Note: The Frontend usually does not call this, but it is useful for debugging.*

### **Process Tick (The Heartbeat)**
**Endpoint:** `POST /api/tick`
**Description:** Called by the MetaTrader 5 EA every 1 second. It sends market data and receives trading instructions.

**Request Body:**
```json
{
  "account_id": "123456",
  "equity": 5000.0,
  "balance": 5000.0,
  "symbol": "EURUSD",
  "ask": 1.1050,
  "bid": 1.1048,
  "positions": [
    {
      "ticket": 998877,
      "symbol": "EURUSD",
      "type": "BUY",
      "volume": 0.01,
      "price": 1.1040,
      "profit": 8.0,
      "comment": "buy_a1b2_idx0"
    }
  ]
}
```

**Response (200 OK):**
```json
{
  "action": "BUY",        // Options: "BUY", "SELL", "CLOSE_ALL", "WAIT"
  "volume": 0.01,
  "comment": "buy_a1b2_idx1",
  "symbol": "EURUSD"
}
```

---

## **Summary of Frontend Workflow**
1.  **On Load:** Call `GET /api/ui-data` to pre-fill the tables and set the switch positions (Persistence).
2.  **On Input Change:** Assemble the full `rows_buy` / `rows_sell` arrays and `settings` object, then POST to `/api/update-settings`.
3.  **On Switch Click:** POST to `/api/control` with `{ "buy_switch": boolean }`.
4.  **On Interval (1s):** Call `GET /api/ui-data`.
    *   Update the "Active Row" highlight based on `buy_next_index`.
    *   Check `last_alert_msg` for notifications.