# Quick Reference - API Field Mappings

## UserSettings Object (Sent to `/api/update-settings`)

```typescript
{
  limit_price: number,           // 0 = Market Price, >0 = Specific price
  tp_type: "equity_pct" | "balance_pct" | "amount" | "none",
  tp_value: number,              // 2.0 for 2%, 50.0 for $50
  rows_buy: [                    // Array of 100 GridRow objects
    {
      index: 0,
      dollar: 2.5,               // Price gap
      lots: 0.01,                // Volume
      alert: false               // UI alert flag
    },
    ...
  ],
  rows_sell: [ ... ]             // Same structure as rows_buy
}
```

## RuntimeState Object (Received from `/api/ui-data`)

```typescript
{
  buy_on: boolean,               // Buy switch state
  sell_on: boolean,              // Sell switch state
  cyclic_on: boolean,            // Cyclic run state
  buy_next_index: number,        // Next row to execute (BUY side)
  sell_next_index: number,       // Next row to execute (SELL side)
  buy_waiting_limit: boolean,    // Waiting for limit price to be hit
  sell_waiting_limit: boolean,
  last_alert_msg: string         // Alert message (empty if none)
}
```

## Control Commands (Sent to `/api/control`)

```typescript
// Toggle BUY
{
  buy_switch: true;
}
{
  buy_switch: false;
}

// Toggle SELL
{
  sell_switch: true;
}
{
  sell_switch: false;
}

// Toggle CYCLIC
{
  cyclic: true;
}
{
  cyclic: false;
}

// Emergency Close All
{
  close_all: true;
}
```

## TP Type Values

| Frontend    | Server      | Meaning              |
| ----------- | ----------- | -------------------- |
| EQUITY_PCT  | equity_pct  | % of current equity  |
| BALANCE_PCT | balance_pct | % of account balance |
| AMOUNT      | amount      | Fixed dollar amount  |
| NONE        | none        | No take profit       |

## Active Row Highlighting

The UI highlights the next row to be executed:

- **BUY side**: Highlights row at index `runtime.buy_next_index`
- **SELL side**: Highlights row at index `runtime.sell_next_index`
- Row index -1 means no active trade (idle state)

## Alert System

- Server sends `last_alert_msg` in every `/api/ui-data` response
- When message is non-empty and different from previous: trigger sound + display popup
- Message content is displayed to user (e.g., "BUY Trade Executed at Level 2")
