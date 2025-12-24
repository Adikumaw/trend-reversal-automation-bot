"""
High-Frequency Grid Trading System - Production Server
VERSION: 3.4.2 - PROPER EXTERNAL CLOSE FIX
Stack: Python 3.9+, FastAPI, Uvicorn
"""

import json
import uuid
import os
import traceback
import re
import time
from typing import List, Dict, Optional
from datetime import datetime
from collections import deque
from fastapi import FastAPI, Body, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.exceptions import RequestValidationError
from pydantic import BaseModel, Field

# --- Configuration ---
STATE_FILE = "state.json"
PRICE_HISTORY_LEN = 100
# Regex to identify trades managed by this system format: "buy_HASH_idx0"
TRADE_ID_PATTERN = re.compile(r"^(sell|buy)_[0-9a-fA-F]{8}_idx\d+$")
# Grace period: Wait for broker to acknowledge trades before checking external close
EXTERNAL_CLOSE_GRACE_PERIOD = 5.0  # seconds

# --- Data Models ---

class GridRow(BaseModel):
    index: int
    dollar: float
    lots: float
    alert: bool = False

class Position(BaseModel):
    ticket: int
    symbol: str
    type: str
    volume: float
    price: float
    profit: float
    comment: str

class TickData(BaseModel):
    account_id: str
    equity: float
    balance: float
    symbol: str
    ask: float
    bid: float
    positions: List[Position] = []

class RowExecStats(BaseModel):
    index: int
    entry_price: float
    lots: float
    profit: float
    timestamp: str
    cumulative_lots: float = 0.0
    cumulative_profit: float = 0.0

class RuntimeState(BaseModel):
    buy_on: bool = False
    sell_on: bool = False
    cyclic_on: bool = False
    
    buy_id: str = ""
    sell_id: str = ""
    
    # Closing Phase Flags
    buy_is_closing: bool = False
    sell_is_closing: bool = False
    
    # Hedge Trigger Flags
    buy_hedge_triggered: bool = False
    sell_hedge_triggered: bool = False
    
    # Separate Limit Price Waiting Flags
    buy_waiting_limit: bool = False
    sell_waiting_limit: bool = False
    
    # Separate Start References
    buy_start_ref: float = 0.0
    sell_start_ref: float = 0.0
    
    buy_exec_map: Dict[str, RowExecStats] = {}
    sell_exec_map: Dict[str, RowExecStats] = {}
    
    pending_actions: List[str] = []
    
    current_price: float = 0.0
    current_ask: float = 0.0
    current_bid: float = 0.0
    price_direction: str = "neutral"
    
    error_status: str = ""
    
    # Latency protection: Track when we last sent orders
    buy_last_order_sent_ts: float = 0.0
    sell_last_order_sent_ts: float = 0.0

class UserSettings(BaseModel):
    # Separate Limit Prices
    buy_limit_price: float = 0.0
    sell_limit_price: float = 0.0
    
    # Separate Take Profit Settings
    buy_tp_type: str = "equity_pct"
    buy_tp_value: float = 0.0
    sell_tp_type: str = "equity_pct"
    sell_tp_value: float = 0.0
    
    # Loss Hedge Settings
    buy_hedge_value: float = 0.0
    sell_hedge_value: float = 0.0
    
    rows_buy: List[GridRow] = []
    rows_sell: List[GridRow] = []

class SystemState(BaseModel):
    settings: UserSettings = Field(default_factory=UserSettings)
    runtime: RuntimeState = Field(default_factory=RuntimeState)
    last_update_ts: str = ""

# --- Global State ---
state = SystemState()
price_history = deque(maxlen=PRICE_HISTORY_LEN)

# --- Persistence Functions ---

def save_state():
    try:
        state_dict = state.model_dump()
        state_dict['price_history'] = list(price_history)
        with open(STATE_FILE, "w") as f:
            json.dump(state_dict, f, indent=2)
    except Exception as e:
        print(f"[ERROR] Save: {e}")

def load_state():
    global state, price_history
    if os.path.exists(STATE_FILE):
        try:
            with open(STATE_FILE, "r") as f:
                data = json.load(f)
            if 'price_history' in data:
                hist = data.pop('price_history')
                price_history = deque(hist, maxlen=PRICE_HISTORY_LEN)
            state = SystemState(**data)
            print(f"[INIT] Loaded - Buy:{state.runtime.buy_on} Sell:{state.runtime.sell_on}")
        except Exception as e:
            print(f"[ERROR] Load: {e}")
    else:
        print("[INIT] Fresh start")

# --- Core Logic ---

def get_hash(side: str) -> str:
    return f"{side}_{uuid.uuid4().hex[:8]}"

def calculate_grid_level_price(side: str, level_index: int) -> float:
    rt = state.runtime
    st = state.settings
    
    if side == "buy":
        ref = rt.buy_start_ref
        for i in range(level_index + 1):
            if i < len(st.rows_buy):
                ref -= st.rows_buy[i].dollar
        return ref
    else:
        ref = rt.sell_start_ref
        for i in range(level_index + 1):
            if i < len(st.rows_sell):
                ref += st.rows_sell[i].dollar
        return ref

def update_exec_stats(tick: TickData):
    rt = state.runtime
    
    # Start with a copy to preserve history of closed trades during the session
    buy_map = rt.buy_exec_map.copy()
    sell_map = rt.sell_exec_map.copy()
    
    for p in tick.positions:
        if not TRADE_ID_PATTERN.match(p.comment):
            continue 

        # Check for Conflict
        if "buy_" in p.comment:
            if not rt.buy_id or rt.buy_id not in p.comment:
                rt.error_status = f"CRITICAL: Conflict detected. Unknown Buy trade {p.ticket}."
                return

        if "sell_" in p.comment:
            if not rt.sell_id or rt.sell_id not in p.comment:
                rt.error_status = f"CRITICAL: Conflict detected. Unknown Sell trade {p.ticket}."
                return

        try:
            if p.type == "BUY" and rt.buy_id in p.comment:
                parts = p.comment.split("_idx")
                if len(parts) == 2:
                    idx = int(parts[1])
                    buy_map[str(idx)] = RowExecStats(
                        index=idx, entry_price=p.price, lots=p.volume,
                        profit=p.profit, timestamp=datetime.now().isoformat()
                    )
            
            if p.type == "SELL" and rt.sell_id in p.comment:
                parts = p.comment.split("_idx")
                if len(parts) == 2:
                    idx = int(parts[1])
                    sell_map[str(idx)] = RowExecStats(
                        index=idx, entry_price=p.price, lots=p.volume,
                        profit=p.profit, timestamp=datetime.now().isoformat()
                    )
        except Exception:
            pass

    # Calculate cumulatives
    for map_dict in [buy_map, sell_map]:
        indices = sorted([int(k) for k in map_dict.keys()])
        cum_lots, cum_profit = 0.0, 0.0
        for idx in indices:
            row = map_dict[str(idx)]
            cum_lots += row.lots
            cum_profit += row.profit
            row.cumulative_lots = cum_lots
            row.cumulative_profit = cum_profit
    
    rt.buy_exec_map = buy_map
    rt.sell_exec_map = sell_map

def check_tp_buy(tick: TickData) -> int:
    """Check if BUY side take profit is hit"""
    st = state.settings
    rt = state.runtime
    
    if st.buy_tp_value <= 0 or not rt.buy_id:
        return -1
    
    buy_positions = [p for p in tick.positions if rt.buy_id in p.comment]
    
    if not buy_positions:
        return 0
    
    profit = sum(p.profit for p in buy_positions)
    
    target = 0.0
    if st.buy_tp_type == "equity_pct":
        target = tick.equity * (st.buy_tp_value / 100.0)
    elif st.buy_tp_type == "balance_pct":
        target = tick.balance * (st.buy_tp_value / 100.0)
    elif st.buy_tp_type == "fixed_money":
        target = st.buy_tp_value
    
    if target > 0 and profit >= target:
        print(f"[BUY TP HIT] ${profit:.2f} >= ${target:.2f}")
        return 1
        
    return 0

def check_tp_sell(tick: TickData) -> int:
    """Check if SELL side take profit is hit"""
    st = state.settings
    rt = state.runtime
    
    if st.sell_tp_value <= 0 or not rt.sell_id:
        return -1
    
    sell_positions = [p for p in tick.positions if rt.sell_id in p.comment]
    
    if not sell_positions:
        return 0
    
    profit = sum(p.profit for p in sell_positions)
    
    target = 0.0
    if st.sell_tp_type == "equity_pct":
        target = tick.equity * (st.sell_tp_value / 100.0)
    elif st.sell_tp_type == "balance_pct":
        target = tick.balance * (st.sell_tp_value / 100.0)
    elif st.sell_tp_type == "fixed_money":
        target = st.sell_tp_value
    
    if target > 0 and profit >= target:
        print(f"[SELL TP HIT] ${profit:.2f} >= ${target:.2f}")
        return 1
        
    return 0

def has_active_trades(tick: TickData, hash_id: str) -> bool:
    return hash_id and any(hash_id in p.comment for p in tick.positions)

def count_active_trades(tick: TickData, hash_id: str) -> int:
    if not hash_id: return 0
    return sum(1 for p in tick.positions if hash_id in p.comment)

def get_last_executed_price(side: str) -> float:
    """Get the price of the last executed level"""
    rt = state.runtime
    
    if side == "buy":
        if not rt.buy_exec_map:
            return rt.buy_start_ref
        indices = sorted([int(k) for k in rt.buy_exec_map.keys()])
        last_idx = indices[-1]
        return rt.buy_exec_map[str(last_idx)].entry_price
    else:
        if not rt.sell_exec_map:
            return rt.sell_start_ref
        indices = sorted([int(k) for k in rt.sell_exec_map.keys()])
        last_idx = indices[-1]
        return rt.sell_exec_map[str(last_idx)].entry_price

# --- FastAPI App ---

app = FastAPI(title="Grid Trading Server", version="3.4.2")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.exception_handler(RequestValidationError)
async def validation_handler(request: Request, exc: RequestValidationError):
    print("=" * 80)
    print("[VALIDATION ERROR]")
    body = await request.body()
    print(f"Body: {body.decode('utf-8')[:500]}")
    print(f"Errors: {exc.errors()}")
    print("=" * 80)
    return JSONResponse(status_code=422, content={"detail": exc.errors()})

@app.on_event("startup")
async def startup():
    print("=" * 60)
    print("Grid Trading Server v3.4.2 - PROPER FIX")
    print("External Close Detection Improved")
    print("=" * 60)
    load_state()

@app.get("/")
async def root():
    return {"status": "running", "version": "3.4.2"}

@app.post("/api/tick")
async def handle_tick(request: Request):
    try:
        # Raw Body Parsing
        body_bytes = await request.body()
        body_str = body_bytes.decode('utf-8', errors='ignore')
        body_str = body_str.rstrip('\x00').strip()
        last_brace = body_str.rfind('}')
        if last_brace != -1:
            body_str = body_str[:last_brace + 1]
        
        try:
            tick_data = json.loads(body_str)
            tick = TickData(**tick_data)
        except json.JSONDecodeError as e:
            print(f"[ERROR] JSON Parse: {e}")
            return {"action": "WAIT"}
        
        rt = state.runtime
        st = state.settings
        now_ts = time.time()
        
        # Conflict Block
        if rt.error_status:
            print(f"[BLOCKED] Server frozen: {rt.error_status}")
            return {"action": "WAIT", "error": rt.error_status}

        # Market Data Update
        mid = (tick.ask + tick.bid) / 2
        rt.current_ask = tick.ask
        rt.current_bid = tick.bid
        
        if price_history:
            rt.price_direction = "up" if mid > price_history[-1]['mid'] else "down"
        
        price_history.append({"mid": mid, "ts": now_ts})
        rt.current_price = mid
        state.last_update_ts = datetime.now().isoformat()
        
        # Update Stats
        update_exec_stats(tick)
        if rt.error_status:
             return {"action": "WAIT", "error": rt.error_status}

        # Priority 1: Pending Actions
        if rt.pending_actions:
            action = rt.pending_actions.pop(0)
            save_state()
            cmt = "server"
            if "BUY" in action: cmt = rt.buy_id
            elif "SELL" in action: cmt = rt.sell_id
            return {"action": "CLOSE_ALL", "comment": cmt}
        
        # --- PRIORITY 1.5: Closing Confirmation Monitor ---
        
        # Check Buy Closing Phase
        if rt.buy_is_closing:
            count = count_active_trades(tick, rt.buy_id)
            if count == 0:
                print(f"[CONFIRMED] All Buy trades closed. Resetting Session.")
                rt.buy_is_closing = False
                rt.buy_exec_map = {}
                rt.buy_hedge_triggered = False
                
                if rt.cyclic_on:
                    rt.buy_id = ""
                    rt.buy_start_ref = mid
                else:
                    rt.buy_on = False
                    rt.buy_id = ""
                    rt.buy_start_ref = 0.0
                save_state()
                return {"action": "WAIT"}
            else:
                return {"action": "CLOSE_ALL", "comment": rt.buy_id}

        # Check Sell Closing Phase
        if rt.sell_is_closing:
            count = count_active_trades(tick, rt.sell_id)
            if count == 0:
                print(f"[CONFIRMED] All Sell trades closed. Resetting Session.")
                rt.sell_is_closing = False
                rt.sell_exec_map = {}
                rt.sell_hedge_triggered = False
                
                if rt.cyclic_on:
                    rt.sell_id = ""
                    rt.sell_start_ref = mid
                else:
                    rt.sell_on = False
                    rt.sell_id = ""
                    rt.sell_start_ref = 0.0
                save_state()
                return {"action": "WAIT"}
            else:
                return {"action": "CLOSE_ALL", "comment": rt.sell_id}

        # --- PRIORITY 1.8: HEDGE MONITOR ---
        
        # BUY SIDE HEDGE CHECK
        if (rt.buy_on and rt.buy_id and not rt.buy_hedge_triggered and 
            st.buy_hedge_value > 0 and not rt.buy_is_closing):
            
            buy_positions = [p for p in tick.positions if rt.buy_id in p.comment]
            if buy_positions:
                total_buy_profit = sum(p.profit for p in buy_positions)
                loss_threshold = -1 * st.buy_hedge_value
                
                if total_buy_profit <= loss_threshold:
                    print(f"[BUY HEDGE TRIGGERED] Loss: ${total_buy_profit:.2f} <= ${loss_threshold:.2f}")
                    
                    # Lock the losing side
                    rt.buy_hedge_triggered = True
                    
                    # Calculate total hedge volume
                    hedge_lots = sum(p.volume for p in buy_positions)
                    print(f"[HEDGE] Calculated hedge volume: {hedge_lots} lots")
                    
                    # Check if opposite side is ready (not closing)
                    if not rt.sell_is_closing:
                        # Scenario A: Sell Side is OFF or Empty
                        if not rt.sell_on or not rt.sell_id or len(rt.sell_exec_map) == 0:
                            print(f"[HEDGE] Starting new SELL session with {hedge_lots} lots")
                            
                            # Force start Sell Session
                            rt.sell_id = get_hash("sell")
                            rt.sell_start_ref = tick.bid
                            rt.sell_exec_map = {}
                            rt.sell_on = True
                            rt.sell_waiting_limit = False
                            
                            # Clear and inject hedge row
                            st.rows_sell = [GridRow(index=0, dollar=0.0, lots=hedge_lots, alert=True)]
                            
                            save_state()
                            
                            # Execute immediately
                            rt.sell_exec_map["0"] = RowExecStats(
                                index=0,
                                entry_price=tick.bid,
                                lots=hedge_lots,
                                profit=0,
                                timestamp=datetime.now().isoformat()
                            )
                            rt.sell_last_order_sent_ts = now_ts  # Mark timestamp
                            save_state()
                            
                            return {
                                "action": "SELL",
                                "volume": hedge_lots,
                                "comment": f"{rt.sell_id}_idx0",
                                "alert": True
                            }
                        
                        # Scenario B: Sell Side is Already Running
                        else:
                            print(f"[HEDGE] Appending {hedge_lots} lots to existing SELL session")
                            
                            # Get last executed index
                            indices = sorted([int(k) for k in rt.sell_exec_map.keys()])
                            last_idx = indices[-1] if indices else -1
                            new_idx = last_idx + 1
                            
                            # Get price of last level
                            last_price = get_last_executed_price("sell")
                            
                            # Calculate dynamic gap to current market
                            new_dollar_gap = abs(tick.bid - last_price)
                            
                            # Inject new row
                            new_row = GridRow(index=new_idx, dollar=new_dollar_gap, lots=hedge_lots, alert=True)
                            st.rows_sell.append(new_row)
                            
                            save_state()
                            
                            # Execute immediately (gap designed to match current bid)
                            rt.sell_exec_map[str(new_idx)] = RowExecStats(
                                index=new_idx,
                                entry_price=tick.bid,
                                lots=hedge_lots,
                                profit=0,
                                timestamp=datetime.now().isoformat()
                            )
                            rt.sell_last_order_sent_ts = now_ts  # Mark timestamp
                            save_state()
                            
                            return {
                                "action": "SELL",
                                "volume": hedge_lots,
                                "comment": f"{rt.sell_id}_idx{new_idx}",
                                "alert": True
                            }
        
        # SELL SIDE HEDGE CHECK
        if (rt.sell_on and rt.sell_id and not rt.sell_hedge_triggered and 
            st.sell_hedge_value > 0 and not rt.sell_is_closing):
            
            sell_positions = [p for p in tick.positions if rt.sell_id in p.comment]
            if sell_positions:
                total_sell_profit = sum(p.profit for p in sell_positions)
                loss_threshold = -1 * st.sell_hedge_value
                
                if total_sell_profit <= loss_threshold:
                    print(f"[SELL HEDGE TRIGGERED] Loss: ${total_sell_profit:.2f} <= ${loss_threshold:.2f}")
                    
                    # Lock the losing side
                    rt.sell_hedge_triggered = True
                    
                    # Calculate total hedge volume
                    hedge_lots = sum(p.volume for p in sell_positions)
                    print(f"[HEDGE] Calculated hedge volume: {hedge_lots} lots")
                    
                    # Check if opposite side is ready (not closing)
                    if not rt.buy_is_closing:
                        # Scenario A: Buy Side is OFF or Empty
                        if not rt.buy_on or not rt.buy_id or len(rt.buy_exec_map) == 0:
                            print(f"[HEDGE] Starting new BUY session with {hedge_lots} lots")
                            
                            # Force start Buy Session
                            rt.buy_id = get_hash("buy")
                            rt.buy_start_ref = tick.ask
                            rt.buy_exec_map = {}
                            rt.buy_on = True
                            rt.buy_waiting_limit = False
                            
                            # Clear and inject hedge row
                            st.rows_buy = [GridRow(index=0, dollar=0.0, lots=hedge_lots, alert=True)]
                            
                            save_state()
                            
                            # Execute immediately
                            rt.buy_exec_map["0"] = RowExecStats(
                                index=0,
                                entry_price=tick.ask,
                                lots=hedge_lots,
                                profit=0,
                                timestamp=datetime.now().isoformat()
                            )
                            rt.buy_last_order_sent_ts = now_ts  # Mark timestamp
                            save_state()
                            
                            return {
                                "action": "BUY",
                                "volume": hedge_lots,
                                "comment": f"{rt.buy_id}_idx0",
                                "alert": True
                            }
                        
                        # Scenario B: Buy Side is Already Running
                        else:
                            print(f"[HEDGE] Appending {hedge_lots} lots to existing BUY session")
                            
                            # Get last executed index
                            indices = sorted([int(k) for k in rt.buy_exec_map.keys()])
                            last_idx = indices[-1] if indices else -1
                            new_idx = last_idx + 1
                            
                            # Get price of last level
                            last_price = get_last_executed_price("buy")
                            
                            # Calculate dynamic gap to current market
                            new_dollar_gap = abs(tick.ask - last_price)
                            
                            # Inject new row
                            new_row = GridRow(index=new_idx, dollar=new_dollar_gap, lots=hedge_lots, alert=True)
                            st.rows_buy.append(new_row)
                            
                            save_state()
                            
                            # Execute immediately (gap designed to match current ask)
                            rt.buy_exec_map[str(new_idx)] = RowExecStats(
                                index=new_idx,
                                entry_price=tick.ask,
                                lots=hedge_lots,
                                profit=0,
                                timestamp=datetime.now().isoformat()
                            )
                            rt.buy_last_order_sent_ts = now_ts  # Mark timestamp
                            save_state()
                            
                            return {
                                "action": "BUY",
                                "volume": hedge_lots,
                                "comment": f"{rt.buy_id}_idx{new_idx}",
                                "alert": True
                            }

        # Priority 2: TP Logic - Check Buy Side
        if rt.buy_id:
            tp_result = check_tp_buy(tick)
            if tp_result == 1:
                rt.buy_is_closing = True
                print("[BUY TP HIT] Initiating Buy Close Sequence...")
                save_state()
                return {"action": "CLOSE_ALL", "comment": rt.buy_id}

        # Priority 2: TP Logic - Check Sell Side
        if rt.sell_id:
            tp_result = check_tp_sell(tick)
            if tp_result == 1:
                rt.sell_is_closing = True
                print("[SELL TP HIT] Initiating Sell Close Sequence...")
                save_state()
                return {"action": "CLOSE_ALL", "comment": rt.sell_id}

        # Priority 3: External Close (Manual Close Detection) - WITH GRACE PERIOD
        
        # Buy Side - Only check if grace period has passed
        buy_grace_passed = (now_ts - rt.buy_last_order_sent_ts) >= EXTERNAL_CLOSE_GRACE_PERIOD
        
        if (rt.buy_id and len(rt.buy_exec_map) > 0 and not rt.buy_is_closing and buy_grace_passed):
            mt5_count = count_active_trades(tick, rt.buy_id)
            
            if mt5_count == 0:
                print(f"[EXTERNAL CLOSE] Buy Session Ended Manually.")
                if rt.cyclic_on:
                    rt.buy_id = ""
                    rt.buy_exec_map = {}
                    rt.buy_start_ref = mid
                    rt.buy_hedge_triggered = False
                else:
                    rt.buy_on = False
                    rt.buy_id = ""
                    rt.buy_exec_map = {}
                    rt.buy_hedge_triggered = False
                save_state()

        # Sell Side - Only check if grace period has passed
        sell_grace_passed = (now_ts - rt.sell_last_order_sent_ts) >= EXTERNAL_CLOSE_GRACE_PERIOD
        
        if (rt.sell_id and len(rt.sell_exec_map) > 0 and not rt.sell_is_closing and sell_grace_passed):
            mt5_count = count_active_trades(tick, rt.sell_id)
            
            if mt5_count == 0:
                print(f"[EXTERNAL CLOSE] Sell Session Ended Manually.")
                if rt.cyclic_on:
                    rt.sell_id = ""
                    rt.sell_exec_map = {}
                    rt.sell_start_ref = mid
                    rt.sell_hedge_triggered = False
                else:
                    rt.sell_on = False
                    rt.sell_id = ""
                    rt.sell_exec_map = {}
                    rt.sell_hedge_triggered = False
                save_state()
        
        # Priority 4: BUY Entry (Skip if hedge triggered)
        if rt.buy_on and not rt.buy_is_closing and not rt.buy_hedge_triggered:
            if not rt.buy_id:
                rt.buy_id = get_hash("buy")
                rt.buy_exec_map = {}
                rt.buy_start_ref = st.buy_limit_price if st.buy_limit_price > 0 else tick.ask
                rt.buy_waiting_limit = st.buy_limit_price > 0
                print(f"[BUY] Start: {rt.buy_id} Ref: {rt.buy_start_ref}")
                save_state()
            
            if rt.buy_waiting_limit:
                if tick.ask <= st.buy_limit_price:
                    rt.buy_waiting_limit = False
                    rt.buy_start_ref = tick.ask
                    print(f"[BUY] Limit price reached. Starting grid at {rt.buy_start_ref}")
                    save_state()
            else:
                idx = len(rt.buy_exec_map)
                if idx < len(st.rows_buy):
                    row = st.rows_buy[idx]
                    if row.dollar <= 0 or row.lots <= 0:
                        return {"action": "WAIT"} 
                    target = calculate_grid_level_price("buy", idx)
                    if tick.ask <= target:
                        rt.buy_exec_map[str(idx)] = RowExecStats(
                            index=idx, 
                            entry_price=tick.ask, 
                            lots=row.lots,
                            profit=0, 
                            timestamp=datetime.now().isoformat()
                        )
                        rt.buy_last_order_sent_ts = now_ts  # Mark timestamp
                        print(f"[BUY] L{idx}: {target}")
                        save_state()
                        return {
                            "action": "BUY",
                            "volume": row.lots,
                            "comment": f"{rt.buy_id}_idx{idx}",
                            "alert": row.alert
                        }
        
        # Priority 5: SELL Entry (Skip if hedge triggered)
        if rt.sell_on and not rt.sell_is_closing and not rt.sell_hedge_triggered:
            if not rt.sell_id:
                rt.sell_id = get_hash("sell")
                rt.sell_exec_map = {}
                rt.sell_start_ref = st.sell_limit_price if st.sell_limit_price > 0 else tick.bid
                rt.sell_waiting_limit = st.sell_limit_price > 0
                print(f"[SELL] Start: {rt.sell_id} Ref: {rt.sell_start_ref}")
                save_state()
            
            if rt.sell_waiting_limit:
                if tick.bid >= st.sell_limit_price:
                    rt.sell_waiting_limit = False
                    rt.sell_start_ref = tick.bid
                    print(f"[SELL] Limit price reached. Starting grid at {rt.sell_start_ref}")
                    save_state()
            else:
                idx = len(rt.sell_exec_map)
                if idx < len(st.rows_sell):
                    row = st.rows_sell[idx]
                    if row.dollar <= 0 or row.lots <= 0:
                        return {"action": "WAIT"}
                    target = calculate_grid_level_price("sell", idx)
                    if tick.bid >= target:
                        rt.sell_exec_map[str(idx)] = RowExecStats(
                            index=idx,
                            entry_price=tick.bid, 
                            lots=row.lots,
                            profit=0,
                            timestamp=datetime.now().isoformat()
                        )
                        rt.sell_last_order_sent_ts = now_ts  # Mark timestamp
                        print(f"[SELL] L{idx}: {target}")
                        save_state()
                        return {
                            "action": "SELL",
                            "volume": row.lots,
                            "comment": f"{rt.sell_id}_idx{idx}",
                            "alert": row.alert
                        }
        
        return {"action": "WAIT"}
        
    except Exception as e:
        print(f"[ERROR] Tick: {e}")
        traceback.print_exc()
        return {"action": "WAIT"}

@app.post("/api/update-settings")
async def update_settings(new: UserSettings):
    try:
        rt = state.runtime
        
        # Validation
        if new.buy_tp_value < 0 or new.sell_tp_value < 0:
             raise Exception("TP values cannot be negative")
        
        if new.buy_hedge_value < 0 or new.sell_hedge_value < 0:
             raise Exception("Hedge values cannot be negative")

        # Update separate limit prices
        state.settings.buy_limit_price = new.buy_limit_price
        state.settings.sell_limit_price = new.sell_limit_price
        
        # Update separate TP settings
        state.settings.buy_tp_type = new.buy_tp_type
        state.settings.buy_tp_value = new.buy_tp_value
        state.settings.sell_tp_type = new.sell_tp_type
        state.settings.sell_tp_value = new.sell_tp_value
        
        # Update hedge settings
        state.settings.buy_hedge_value = new.buy_hedge_value
        state.settings.sell_hedge_value = new.sell_hedge_value
        
        # --- Buy Rows ---
        final_buy_rows = []
        current_buy_rows_dict = {r.index: r for r in state.settings.rows_buy}
        
        for new_row in new.rows_buy:
            if new_row.dollar <= 0 or new_row.lots <= 0:
                continue

            # If executed, use OLD data for locked fields, but NEW data for Alert
            if str(new_row.index) in rt.buy_exec_map and new_row.index in current_buy_rows_dict:
                 old = current_buy_rows_dict[new_row.index]
                 merged_row = GridRow(
                     index=old.index,
                     dollar=old.dollar,
                     lots=old.lots,
                     alert=new_row.alert
                 )
                 final_buy_rows.append(merged_row)
            else:
                 final_buy_rows.append(new_row)
        
        state.settings.rows_buy = final_buy_rows

        # --- Sell Rows ---
        final_sell_rows = []
        current_sell_rows_dict = {r.index: r for r in state.settings.rows_sell}
        
        for new_row in new.rows_sell:
            if new_row.dollar <= 0 or new_row.lots <= 0:
                continue

            if str(new_row.index) in rt.sell_exec_map and new_row.index in current_sell_rows_dict:
                 old = current_sell_rows_dict[new_row.index]
                 merged_row = GridRow(
                     index=old.index,
                     dollar=old.dollar,
                     lots=old.lots,
                     alert=new_row.alert
                 )
                 final_sell_rows.append(merged_row)
            else:
                 final_sell_rows.append(new_row)
                 
        state.settings.rows_sell = final_sell_rows
        
        save_state()
        return {"status": "ok"}
    except Exception as e:
        print(f"[ERROR] Settings: {e}")
        raise

@app.post("/api/control")
async def control(
    buy_switch: Optional[bool] = Body(None),
    sell_switch: Optional[bool] = Body(None),
    cyclic: Optional[bool] = Body(None),
    emergency_close: Optional[bool] = Body(None)
):
    try:
        rt = state.runtime
        
        if emergency_close:
            rt.buy_on = rt.sell_on = rt.cyclic_on = False
            rt.buy_is_closing = rt.sell_is_closing = True 
            rt.pending_actions.append("CLOSE_ALL_EMERGENCY")
            rt.error_status = "" 
            save_state()
            return {"status": "emergency"}
        
        if buy_switch is not None:
            if rt.buy_on and not buy_switch:
                rt.pending_actions.append("CLOSE_ALL_BUY")
                rt.buy_is_closing = True
            rt.buy_on = buy_switch
        
        if sell_switch is not None:
            if rt.sell_on and not sell_switch:
                rt.pending_actions.append("CLOSE_ALL_SELL")
                rt.sell_is_closing = True
            rt.sell_on = sell_switch
        
        if cyclic is not None:
            rt.cyclic_on = cyclic
        
        save_state()
        return {"status": "ok"}
    except Exception as e:
        print(f"[ERROR] Control: {e}")
        raise

@app.get("/api/ui-data")
async def ui_data():
    return {
        "settings": state.settings.model_dump(),
        "runtime": state.runtime.model_dump(),
        "market": {
            "history": list(price_history),
            "current": price_history[-1] if price_history else None
        },
        "last_update": state.last_update_ts
    }

@app.get("/api/health")
async def health():
    rt = state.runtime
    return {
        "status": "healthy" if not rt.error_status else "error",
        "error": rt.error_status,
        "version": "3.4.2",
        "buy": rt.buy_on,
        "sell": rt.sell_on,
        "price": rt.current_price
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000, log_level="info")