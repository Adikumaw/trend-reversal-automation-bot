import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  AppData,
  GridRow,
  UserSettings,
  DEFAULT_SETTINGS,
  createEmptyGrid,
} from "./types";
import ControlPanel from "./components/ControlPanel";
import StatusHeader from "./components/StatusHeader";
import GridTable from "./components/GridTable";
import * as api from "./services/api";

interface AlertPopupState {
  show: boolean;
  message: string;
  side: "BUY" | "SELL";
  rowIndex: number;
}

interface InvalidRowsState {
  buy: number[];
  sell: number[];
}

const App: React.FC = () => {
  // Server State
  const [appData, setAppData] = useState<AppData | null>(null);
  const [connected, setConnected] = useState(false);

  // Local Settings State (Source of truth for Inputs)
  const [localSettings, setLocalSettings] =
    useState<UserSettings>(DEFAULT_SETTINGS);
  const [hasInitializedSettings, setHasInitializedSettings] = useState(false);

  // Validation State
  const [invalidRows, setInvalidRows] = useState<InvalidRowsState>({
    buy: [],
    sell: [],
  });

  // Popup Alert State
  const [alertState, setAlertState] = useState<AlertPopupState>({
    show: false,
    message: "",
    side: "BUY",
    rowIndex: -1,
  });
  const [isAcknowledging, setIsAcknowledging] = useState(false);

  // Refs for tracking changes and audio
  const audioContextRef = useRef<AudioContext | null>(null);
  // Fix: Use ReturnType<typeof setInterval> instead of NodeJS.Timeout to support both browser and node environments
  const alarmIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // --- AUDIO LOGIC ---
  const playBeep = useCallback(() => {
    try {
      if (!audioContextRef.current) {
        audioContextRef.current = new (window.AudioContext ||
          (window as any).webkitAudioContext)();
      }
      const ctx = audioContextRef.current;
      if (ctx.state === "suspended") ctx.resume();

      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = "square";
      osc.frequency.setValueAtTime(550, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.1);

      gain.gain.setValueAtTime(0.1, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start();
      osc.stop(ctx.currentTime + 0.3);
    } catch (e) {
      console.error("Audio playback failed", e);
    }
  }, []);

  const startAlarmLoop = useCallback(() => {
    if (alarmIntervalRef.current) return; // Already ringing
    playBeep();
    alarmIntervalRef.current = setInterval(playBeep, 600); // Continuous beep
  }, [playBeep]);

  const stopAlarmLoop = useCallback(() => {
    if (alarmIntervalRef.current) {
      clearInterval(alarmIntervalRef.current);
      alarmIntervalRef.current = null;
    }
  }, []);

  // --- ALERT CHECKING LOGIC ---
  const checkAlerts = useCallback(
    (data: AppData) => {
      // We check for ANY row that has (alert === true) AND (is executed in the map)
      // This is more robust than checking timestamps.
      
      // Check Buy side
      const triggeredBuyRow = data.settings.rows_buy.find(
        (r) => r.alert && data.runtime.buy_exec_map[String(r.index)]
      );

      // Check Sell side
      const triggeredSellRow = data.settings.rows_sell.find(
        (r) => r.alert && data.runtime.sell_exec_map[String(r.index)]
      );

      // Prioritize Buy if both happen (arbitrary, user can ack one then the other appears)
      const targetRow = triggeredBuyRow || triggeredSellRow;

      if (targetRow) {
        // Only trigger if we aren't already showing an alert
        // (Or if we are showing one, checking if it's the same one is handled by !show check usually, 
        // but if multiple alerts exist, we queue them essentially by waiting for Ack)
        if (!alertState.show) {
          const isBuy = !!triggeredBuyRow;
          const side = isBuy ? "BUY" : "SELL";
          const execMap = isBuy ? data.runtime.buy_exec_map : data.runtime.sell_exec_map;
          const execData = execMap[String(targetRow.index)];

          if (execData) {
             setAlertState({
                show: true,
                message: `Level ${targetRow.index + 1} Executed @ ${execData.entry_price.toFixed(5)}`,
                side: side,
                rowIndex: targetRow.index,
             });
             startAlarmLoop();
          }
        }
      }
    },
    [alertState.show, startAlarmLoop]
  );

  // Helper to ensure we always display 100 rows
  const mergeGridRows = useCallback((serverRows: GridRow[]): GridRow[] => {
    const merged = createEmptyGrid();
    serverRows.forEach((row) => {
      if (row.index < merged.length) {
        merged[row.index] = row;
      }
    });
    return merged;
  }, []);

  // Polling
  useEffect(() => {
    const poll = async () => {
      const data = await api.fetchUiData();

      if (data) {
        setConnected(true);
        setAppData(data);
        checkAlerts(data);

        // Sync local settings on first load
        if (!hasInitializedSettings) {
          const mergedSettings: UserSettings = {
            ...data.settings,
            rows_buy: mergeGridRows(data.settings.rows_buy),
            rows_sell: mergeGridRows(data.settings.rows_sell),
          };
          setLocalSettings(mergedSettings);
          setHasInitializedSettings(true);
        }
      } else {
        setConnected(false);
      }
    };

    poll(); // Initial call
    const interval = setInterval(poll, 1000);
    return () => clearInterval(interval);
  }, [hasInitializedSettings, checkAlerts, mergeGridRows]);

  // Strict Validation Logic
  const validateSettings = (
    settings: UserSettings
  ): { isValid: boolean; invalidBuy: number[]; invalidSell: number[] } => {
    const getInvalidIndices = (rows: GridRow[]) => {
      const invalidIndices: number[] = [];
      let gapDetected = false;

      rows.forEach((row, i) => {
        if (row.index !== i) return;

        if (row.dollar > 0) {
          if (gapDetected) invalidIndices.push(i);
          if (row.lots <= 0) invalidIndices.push(i);
        } else {
          gapDetected = true;
          if (row.lots > 0) invalidIndices.push(i);
        }
      });
      return invalidIndices;
    };

    const invalidBuy = getInvalidIndices(settings.rows_buy);
    const invalidSell = getInvalidIndices(settings.rows_sell);

    return {
      isValid: invalidBuy.length === 0 && invalidSell.length === 0,
      invalidBuy,
      invalidSell,
    };
  };

  // Handlers
  const handleSettingsChange = (newSettings: UserSettings) => {
    setLocalSettings(newSettings);
  };

  const handleSettingsSave = async (settingsOverride?: UserSettings) => {
    const settingsToSave = settingsOverride || localSettings;
    const validation = validateSettings(settingsToSave);

    setInvalidRows({
      buy: validation.invalidBuy,
      sell: validation.invalidSell,
    });

    if (validation.isValid) {
      if (
        settingsToSave.buy_tp_value < 0 ||
        settingsToSave.sell_tp_value < 0 ||
        settingsToSave.buy_limit_price < 0 ||
        settingsToSave.sell_limit_price < 0 ||
        settingsToSave.buy_hedge_value < 0 || 
        settingsToSave.sell_hedge_value < 0
      )
        return;

      const success = await api.updateSettings(settingsToSave);
      if (success) {
        console.log("Settings saved successfully");
        return true;
      } else {
        console.error("Failed to save settings");
        return false;
      }
    } else {
      console.warn("Validation failed - Update blocked until fixed.");
      return false;
    }
  };

  const handleRowChange = useCallback(
    (isBuy: boolean, index: number, field: keyof GridRow, value: any) => {
      setLocalSettings((prev) => {
        const rows = isBuy ? [...prev.rows_buy] : [...prev.rows_sell];
        const targetRow = rows.find((r) => r.index === index);

        if (targetRow) {
          const updatedRow = { ...targetRow, [field]: value };
          const newRows = rows.map((r) => (r.index === index ? updatedRow : r));

          return {
            ...prev,
            [isBuy ? "rows_buy" : "rows_sell"]: newRows,
          };
        }
        return prev;
      });
    },
    []
  );

  const handleControlToggle = async (
    type: "buy" | "sell" | "cyclic",
    value: boolean
  ) => {
    const payload: any = {};
    if (type === "buy") payload.buy_switch = value;
    if (type === "sell") payload.sell_switch = value;
    if (type === "cyclic") payload.cyclic = value;

    await api.controlSystem(payload);
  };

  const handleEmergencyClose = async () => {
    if (
      window.confirm("ARE YOU SURE? This will close ALL positions immediately.")
    ) {
      await api.controlSystem({ emergency_close: true });
    }
  };

  // --- ACKNOWLEDGE HANDLER ---
  const handleAcknowledgeAlert = async () => {
    stopAlarmLoop(); // 1. Stop sound immediately
    
    // 2. Hide UI immediately
    const side = alertState.side;
    const rowIndex = alertState.rowIndex;
    setAlertState((prev) => ({ ...prev, show: false }));
    setIsAcknowledging(true);

    // 3. Update Local State (Optimistic)
    const newSettings = { ...localSettings };
    const rows = side === "BUY" ? newSettings.rows_buy : newSettings.rows_sell;
    const targetRow = rows.find((r) => r.index === rowIndex);

    if (targetRow) {
      targetRow.alert = false; // Turn off alert locally
      setLocalSettings(newSettings);

      // 4. Send Update to Server
      await handleSettingsSave(newSettings);
    }

    setIsAcknowledging(false);
  };

  const criticalError = appData?.runtime?.error_status;

  return (
    <div className="flex flex-col h-screen bg-gray-950 text-gray-100 font-sans relative">
      {/* ALERT POPUP MODAL */}
      {alertState.show && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-gray-800 border-4 border-red-500 rounded-xl p-8 shadow-2xl max-w-md w-full text-center transform scale-100 transition-transform">
            <div
              className={`text-6xl mb-6 ${
                alertState.side === "BUY" ? "text-green-500" : "text-red-500"
              }`}
            >
              <i className="fas fa-bell animate-bounce"></i>
            </div>
            <h2 className="text-3xl font-extrabold text-white mb-4 tracking-wider">
              {alertState.side} EXECUTED
            </h2>
            <div className="bg-gray-900 rounded-lg p-4 mb-6 border border-gray-700">
               <p className="text-xl text-yellow-400 font-mono font-bold">
                {alertState.message}
               </p>
            </div>
            
            <button
              onClick={handleAcknowledgeAlert}
              disabled={isAcknowledging}
              className={`w-full bg-blue-600 hover:bg-blue-500 text-white text-xl font-bold py-4 px-8 rounded-lg shadow-lg transform transition hover:scale-105 focus:outline-none focus:ring-4 focus:ring-blue-400 ${
                isAcknowledging ? "opacity-70 cursor-wait" : ""
              }`}
            >
              {isAcknowledging ? "SAVING..." : "ACKNOWLEDGE ALERT"}
            </button>
          </div>
        </div>
      )}

      {/* CRITICAL ERROR BANNER */}
      {criticalError && (
        <div className="bg-red-600 text-white font-bold p-4 text-center animate-pulse z-40 shadow-xl border-b-4 border-red-800 flex-shrink-0">
          <i className="fas fa-exclamation-triangle mr-2"></i>
          CRITICAL ERROR: {criticalError}
          <div className="mt-2 text-sm font-normal bg-red-800/50 p-2 rounded">
            Please check MT5 manually or use Emergency Close.
          </div>
        </div>
      )}

      {/* HEADER & CONTROL PANEL (Fixed Top) */}
      <StatusHeader runtime={appData?.runtime || null} connected={connected} />

      <ControlPanel
        settings={localSettings}
        runtime={appData?.runtime || null}
        onSettingsChange={handleSettingsChange}
        onSettingsSave={handleSettingsSave}
        onControlToggle={handleControlToggle}
        onEmergencyClose={handleEmergencyClose}
        connected={connected && !criticalError}
      />

      {/* SCROLLABLE MAIN CONTENT AREA */}
      <div
        className={`flex-1 overflow-y-auto p-2 md:p-4 transition-opacity ${
          criticalError ? "opacity-50 pointer-events-none" : "opacity-100"
        }`}
      >
        <div className="flex flex-col md:flex-row gap-4 h-full min-h-[500px]">
          <div className="flex-1 flex flex-col min-h-[400px]">
            <GridTable
              side="BUY"
              rows={localSettings.rows_buy}
              execMap={appData?.runtime.buy_exec_map || {}}
              invalidRows={invalidRows.buy}
              onRowChange={(idx, f, v) => handleRowChange(true, idx, f, v)}
              onRowSave={() => handleSettingsSave()}
            />
          </div>

          <div className="flex-1 flex flex-col min-h-[400px]">
            <GridTable
              side="SELL"
              rows={localSettings.rows_sell}
              execMap={appData?.runtime.sell_exec_map || {}}
              invalidRows={invalidRows.sell}
              onRowChange={(idx, f, v) => handleRowChange(false, idx, f, v)}
              onRowSave={() => handleSettingsSave()}
            />
          </div>
        </div>
      </div>
    </div>
  );
};

export default App;