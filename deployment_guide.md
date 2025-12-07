# Grid Trading System - Deployment Guide

## 📋 System Overview

This is a **production-ready High-Frequency Trading Grid System** with:
- ✅ MT5 Client polling server every 1 second
- ✅ Python FastAPI server with persistent state
- ✅ Automatic recovery from restarts
- ✅ Hash ID trade tracking
- ✅ Sequential grid gap calculation
- ✅ Global take profit (Equity%, Balance%, Fixed $)
- ✅ Limit entry support
- ✅ Cyclic/Non-cyclic modes

---

## 🚀 Quick Start

### 1. Install Python Dependencies

```bash
pip install fastapi uvicorn pydantic
```

### 2. Start Python Server

```bash
python main.py
```

Server will start on `http://0.0.0.0:8000`

**On first run:** Creates `state.json` with default empty state.

### 3. Configure MT5

1. Open MetaTrader 5
2. Go to **Tools → Options → Expert Advisors**
3. Check ✅ **Allow WebRequest for listed URL**
4. Add: `http://127.0.0.1:8000`
5. Click **OK**

### 4. Load EA on Chart

1. Compile `TradingClient.mq5` in MetaEditor
2. Drag EA onto any chart (e.g., EURUSD M1)
3. Check **Expert** tab for connection logs:
   ```
   ==================================================
   Grid Trading Client v2.0 Initialized
   Broker: Your Broker Name
   Account: 12345678
   Symbol: EURUSD
   Server: http://127.0.0.1:8000
   ==================================================
   ```

---

## 📡 API Endpoints

### Main Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/` | GET | Health check |
| `/api/tick` | POST | Receives MT5 tick data (called every 1s by EA) |
| `/api/control` | POST | Switch controls (Buy/Sell/Cyclic/Close All) |
| `/api/update-settings` | POST | Update grid rows and settings |
| `/api/ui-data` | GET | Get complete state for UI display |
| `/api/health` | GET | Detailed system health |

### Example `/api/tick` Request (from MT5)

```json
{
  "account_id": "12345678",
  "equity": 10500.50,
  "balance": 10000.00,
  "symbol": "EURUSD",
  "ask": 1.08456,
  "bid": 1.08453,
  "positions": [
    {
      "ticket": 123456,
      "symbol": "EURUSD",
      "type": "BUY",
      "volume": 0.10,
      "price": 1.08400,
      "profit": 5.60,
      "comment": "buy_a1b2c3d4_idx0"
    }
  ]
}
```

### Example `/api/tick` Response

```json
{
  "action": "BUY",
  "volume": 0.10,
  "comment": "buy_a1b2c3d4_idx1",
  "symbol": "EURUSD",
  "alert": false
}
```

**Actions:**
- `WAIT` - No action needed
- `BUY` - Execute buy order
- `SELL` - Execute sell order
- `CLOSE_ALL` - Close all positions with specified hash ID

---

## 🎮 Control Panel Usage (via `/api/control`)

### Turn ON Buy Switch

```bash
curl -X POST http://127.0.0.1:8000/api/control \
  -H "Content-Type: application/json" \
  -d '{"buy_switch": true}'
```

**Server Response:**
```json
{
  "status": "ok",
  "action": "WAIT",
  "runtime": {...}
}
```

### Turn OFF Buy Switch (Closes all buy trades)

```bash
curl -X POST http://127.0.0.1:8000/api/control \
  -H "Content-Type: application/json" \
  -d '{"buy_switch": false}'
```

**Server Response:**
```json
{
  "status": "ok",
  "action": "CLOSE_ALL",
  "comment": "buy_a1b2c3d4",
  "message": "Switch OFF - closing trades"
}
```

### Emergency Close All

```bash
curl -X POST http://127.0.0.1:8000/api/control \
  -H "Content-Type: application/json" \
  -d '{"close_all": true}'
```

---

## ⚙️ Update Settings (via `/api/update-settings`)

### Configure Grid Rows

```bash
curl -X POST http://127.0.0.1:8000/api/update-settings \
  -H "Content-Type: application/json" \
  -d '{
    "limit_price": 0,
    "tp_type": "amount",
    "tp_value": 100,
    "rows_buy": [
      {"index": 0, "dollar": 2.0, "lots": 0.01, "alert": true},
      {"index": 1, "dollar": 5.0, "lots": 0.02, "alert": false},
      {"index": 2, "dollar": 3.0, "lots": 0.03, "alert": true}
    ],
    "rows_sell": []
  }'
```

**Key Parameters:**
- `limit_price`: Entry limit (0 = immediate, >0 = wait for price to cross)
- `tp_type`: `"none"`, `"equity_pct"`, `"balance_pct"`, `"amount"`
- `tp_value`: TP target value
- `rows_buy`/`rows_sell`: Grid configuration (up to 100 rows)

---

## 🧮 Grid Logic Example

### Scenario: Market at 4100, Grid: [2, 5, 3]

**Buy Grid (Price goes DOWN):**
1. **Row 0:** Triggers at `4100 - 2 = 4098` → Buy 0.01 lots
2. **Row 1:** Triggers at `4098 - 5 = 4093` → Buy 0.02 lots (gap from **previous** price)
3. **Row 2:** Triggers at `4093 - 3 = 4090` → Buy 0.03 lots (gap from **previous** price)

**Sell Grid (Price goes UP):**
1. **Row 0:** Triggers at `4100 + 2 = 4102` → Sell 0.01 lots
2. **Row 1:** Triggers at `4102 + 5 = 4107` → Sell 0.02 lots
3. **Row 2:** Triggers at `4107 + 3 = 4110` → Sell 0.03 lots

✅ **Each gap is calculated from the PREVIOUS trade price, NOT the start price!**

---

## 🎯 Global Take Profit

### Equity % Example

```json
{
  "tp_type": "equity_pct",
  "tp_value": 5.0
}
```

If Equity = $10,000 → TP Target = $500

When cumulative profit across ALL active hash ID trades ≥ $500 → Close All

### Fixed Dollar Example

```json
{
  "tp_type": "amount",
  "tp_value": 100.0
}
```

When cumulative profit ≥ $100 → Close All

---

## 🔄 Cyclic vs Non-Cyclic Mode

### Cyclic Mode (`cyclic_on: true`)
- **On TP Hit:** Close all trades → Generate NEW Hash IDs → Restart grid from current price
- **Infinite loop** until user turns switches OFF

### Non-Cyclic Mode (`cyclic_on: false`)
- **On TP Hit:** Close all trades → Turn switches OFF → Stop
- **Manual restart** required

---

## 🛡️ State Persistence & Recovery

### State File: `state.json`

Contains:
- ✅ User settings (grid rows, TP config, limit)
- ✅ Runtime state (switches, hash IDs, executed rows)
- ✅ Price history

### Recovery Scenarios

**Scenario 1: Server Restarts**
- Server loads `state.json`
- Sees `buy_id = "buy_a1b2c3d4"` is active
- On next tick from MT5, receives open positions
- Verifies trades with `buy_a1b2c3d4` exist
- **Resumes operation** from current grid level

**Scenario 2: MT5 Restarts**
- MT5 reconnects, sends positions with comments
- Server matches hash IDs: `buy_a1b2c3d4`
- **Continues tracking** existing trades
- Prevents opening duplicate trades

**Scenario 3: Both Restart**
- Server loads state with active hash IDs
- MT5 sends positions on reconnection
- Server reconciles state with actual positions
- **System resumes seamlessly**

---

## 🚨 Critical Safety Features

### 1. No New Cycles While Trades Open
```python
if has_active_trades(tick, s.buy_id):
    # Cannot start new buy cycle
    # Must wait for all trades to close
```

### 2. Switch OFF Priority
```python
if not new_state and s.buy_on:
    # Turning OFF - MUST close all trades first
    return {"action": "CLOSE_ALL", "comment": buy_id}
```

### 3. Executed Row Protection
```python
if idx_key in s.buy_executed_rows:
    # Row already executed - prevent modification
    # Dollar and Lots cannot be changed
```

---

## 📊 Monitoring

### Check Server Status

```bash
curl http://127.0.0.1:8000/api/health
```

**Response:**
```json
{
  "status": "healthy",
  "timestamp": "2024-12-06T10:30:45",
  "state": {
    "buy_active": true,
    "sell_active": false,
    "buy_trades": 3,
    "sell_trades": 0,
    "current_price": 1.08456,
    "price_direction": "down"
  }
}
```

### View Complete State

```bash
curl http://127.0.0.1:8000/api/ui-data
```

Returns full state including:
- Settings
- Runtime state
- Executed rows with P/L
- Cumulative statistics

---

## 🐛 Troubleshooting

### Issue: EA shows "WebRequest not allowed"

**Solution:**
1. Tools → Options → Expert Advisors
2. Check "Allow WebRequest for listed URL"
3. Add: `http://127.0.0.1:8000`
4. Restart MT5

### Issue: Server not receiving ticks

**Check:**
1. Server logs: `python main.py` (should show incoming requests)
2. MT5 Expert tab: Should show `[INFO] Sending X positions to server`
3. Firewall: Allow port 8000

### Issue: Trades not executing

**Check:**
1. Grid configuration: `rows_buy` must be filled sequentially
2. Market price: Must cross trigger levels
3. Account balance: Sufficient margin
4. MT5 logs: Check for order errors

### Issue: State not persisting

**Check:**
1. `state.json` exists in server directory
2. File permissions (read/write)
3. Server logs for save errors

---

## 🧪 Testing Checklist

- [ ] Server starts without errors
- [ ] MT5 connects to server (check Expert tab)
- [ ] Turn ON buy switch → New hash ID generated
- [ ] Price crosses trigger → Trade executes with correct comment
- [ ] `state.json` updates after each action
- [ ] Turn OFF switch → All trades close
- [ ] Server restart → State loads correctly
- [ ] MT5 restart → Reconnects and syncs
- [ ] TP hit → Closes all trades
- [ ] Cyclic mode → Restarts automatically

---

## 📁 File Structure

```
trading-grid-system/
├── main.py                  # FastAPI server
├── TradingClient.mq5        # MT5 Expert Advisor
├── state.json               # State persistence (auto-generated)
├── DEPLOYMENT_GUIDE.md      # This file
└── requirements.txt         # Python dependencies
```

**requirements.txt:**
```
fastapi==0.104.1
uvicorn==0.24.0
pydantic==2.5.0
```

---

## 🔐 Production Considerations

### Security
- [ ] Use HTTPS in production
- [ ] Add authentication to API endpoints
- [ ] Restrict CORS origins
- [ ] Use environment variables for sensitive config

### Performance
- [ ] Monitor server response times (<100ms)
- [ ] Set up logging (file + console)
- [ ] Implement request rate limiting
- [ ] Add database for historical tracking

### Reliability
- [ ] Run server as system service (systemd/supervisor)
- [ ] Set up automatic restarts on failure
- [ ] Implement health check monitoring
- [ ] Add alerting for critical errors

---

## 📞 Support

For issues or questions:
1. Check MT5 Expert tab logs
2. Check server console output
3. Review `state.json` for state inconsistencies
4. Test endpoints with curl/Postman

---

## ✅ Ready to Deploy

You now have:
- ✅ Production-ready Python server with state persistence
- ✅ Robust MT5 EA with error handling
- ✅ Complete API documentation
- ✅ Recovery mechanisms for all restart scenarios

**Next Step:** Build the Web UI to control the system visually!
