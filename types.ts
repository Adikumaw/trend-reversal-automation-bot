export type TradeSide = 'BUY' | 'SELL';

export type TpType = 'equity_pct' | 'balance_pct' | 'fixed_money';

export type PriceDirection = 'up' | 'down' | 'neutral';

export interface GridRow {
  index: number;
  dollar: number;       // Price gap
  lots: number;         // Volume
  alert: boolean;       // Trigger alert
}

export interface RowExecStats {
  index: number;
  entry_price: number;
  lots: number;
  profit: number;
  timestamp: string;
  cumulative_lots: number;
  cumulative_profit: number;
}

export interface UserSettings {
  buy_limit_price: number;
  sell_limit_price: number;

  buy_tp_type: TpType;
  buy_tp_value: number;
  buy_hedge_value: number; // New: Loss limit for hedging

  sell_tp_type: TpType;
  sell_tp_value: number;
  sell_hedge_value: number; // New: Loss limit for hedging

  rows_buy: GridRow[];
  rows_sell: GridRow[];
}

export interface RuntimeState {
  buy_on: boolean;
  sell_on: boolean;
  cyclic_on: boolean;
  
  buy_id: string;
  sell_id: string;
  
  buy_waiting_limit: boolean;
  sell_waiting_limit: boolean;
  buy_start_ref: number;
  sell_start_ref: number;
  
  // v3.2.1 updates
  current_ask?: number;
  current_bid?: number;
  error_status?: string; // Critical conflict message
  
  // v3.2.4 Closing Phase updates
  buy_is_closing?: boolean;
  sell_is_closing?: boolean;

  // v3.4.0 Hedge updates
  buy_hedge_triggered?: boolean;
  sell_hedge_triggered?: boolean;
  
  buy_exec_map: Record<string, RowExecStats>;
  sell_exec_map: Record<string, RowExecStats>;
  
  pending_actions: string[];
  
  current_price: number;
  price_direction: PriceDirection;
}

export interface MarketState {
  history: Array<{ mid: number; ts: number }>;
  current: number;
}

export interface AppData {
  settings: UserSettings;
  runtime: RuntimeState;
  market: MarketState;
  last_update: string;
}

// Initial default state helpers
export const DEFAULT_GRID_SIZE = 100;

export const createEmptyGrid = (): GridRow[] => 
  Array.from({ length: DEFAULT_GRID_SIZE }, (_, i) => ({
    index: i,
    dollar: 0,
    lots: 0,
    alert: false
  }));

export const DEFAULT_SETTINGS: UserSettings = {
  buy_limit_price: 0,
  sell_limit_price: 0,
  buy_tp_type: 'equity_pct',
  buy_tp_value: 1.5,
  buy_hedge_value: 0,
  sell_tp_type: 'equity_pct',
  sell_tp_value: 1.5,
  sell_hedge_value: 0,
  rows_buy: createEmptyGrid(),
  rows_sell: createEmptyGrid()
};