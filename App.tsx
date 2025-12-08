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

  // Refs for tracking changes
  const lastAlertTimeRef = useRef<string | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);

  const playAlertSound = useCallback(() => {
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
      osc.frequency.setValueAtTime(440, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.1);

      gain.gain.setValueAtTime(0.1, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.5);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start();
      osc.stop(ctx.currentTime + 0.5);
    } catch (e) {
      console.error("Audio playback failed", e);
    }
  }, []);

  // Alert Logic
  const checkAlerts = useCallback(
    (data: AppData) => {
      // Collect all executed rows
      const buyExecs = Object.values(data.runtime.buy_exec_map);
      const sellExecs = Object.values(data.runtime.sell_exec_map);
      const allExecs = [...buyExecs, ...sellExecs];

      // Sort by timestamp desc
      allExecs.sort(
        (a, b) =>
          new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
      );

      const latest = allExecs[0];
      if (!latest) return;

      // Check Staleness: If trade is older than 10 seconds (vs server time), ignore it.
      const serverTime = new Date(data.last_update).getTime();
      const tradeTime = new Date(latest.timestamp).getTime();
      const ageSeconds = (serverTime - tradeTime) / 1000;

      // Update ref so we don't check this trade again
      if (latest.timestamp !== lastAlertTimeRef.current) {
        lastAlertTimeRef.current = latest.timestamp;

        // Only show popup if trade is fresh (< 10s old)
        if (ageSeconds < 10) {
          const isBuy = buyExecs.includes(latest);
          const side = isBuy ? "BUY" : "SELL";
          const rows = isBuy ? data.settings.rows_buy : data.settings.rows_sell;
          const rowConfig = rows.find((r) => r.index === latest.index);

          if (rowConfig && rowConfig.alert) {
            playAlertSound();
            setAlertState({
              show: true,
              message: `Level ${
                latest.index + 1
              } Executed @ ${latest.entry_price.toFixed(5)}`,
              side: side,
              rowIndex: latest.index,
            });
          }
        }
      }
    },
    [playAlertSound]
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
        // console.log('[Server Data]', data); // Uncomment for debug
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

  // Strict Validation Logic - Returns invalid indices instead of throwing
  const validateSettings = (
    settings: UserSettings
  ): { isValid: boolean; invalidBuy: number[]; invalidSell: number[] } => {
    // Basic global checks (we handle these usually in inputs, but good to check)
    // Note: We won't block the whole save for global inputs here as user asked for ROW validation.
    // But negatives for TP/Limit should ideally be fixed. Assuming inputs prevent negative UI.

    const getInvalidIndices = (rows: GridRow[]) => {
      const invalidIndices: number[] = [];
      let gapDetected = false;

      rows.forEach((row, i) => {
        // Index integrity check
        if (row.index !== i) {
          // Should not happen in UI logic, but good safety
          return;
        }

        // Logic:
        // If dollar > 0: "Active Row"
        //   - If gapDetected (previous row was empty): INVALID (Gap)
        //   - If lots <= 0: INVALID
        // If dollar == 0: "Empty Row"
        //   - Sets gapDetected = true
        //   - If lots > 0: INVALID (Stray lots without gap)

        if (row.dollar > 0) {
          if (gapDetected) {
            // Gap detected: Value exists after an empty row
            invalidIndices.push(i);
          }
          if (row.lots <= 0) {
            // Invalid Lot size for active row
            invalidIndices.push(i);
          }
        } else {
          // Empty row
          gapDetected = true;
          if (row.lots > 0) {
            // Lots set but dollar is 0 -> Invalid state
            invalidIndices.push(i);
          }
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

    // 1. Validate
    const validation = validateSettings(settingsToSave);

    // 2. Update Validation State (Shows Red Rows)
    setInvalidRows({
      buy: validation.invalidBuy,
      sell: validation.invalidSell,
    });

    // 3. If Valid, Send to Server. If Invalid, BLOCK update.
    if (validation.isValid) {
      // Global checks (safe to allow save if positive, inputs usually handle type="number" min="0")
      if (settingsToSave.tp_value < 0 || settingsToSave.limit_price < 0) return;

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

  const handleAcknowledgeAlert = async () => {
    setIsAcknowledging(true);
    const side = alertState.side;
    const rowIndex = alertState.rowIndex;

    const newSettings = { ...localSettings };
    const rows = side === "BUY" ? newSettings.rows_buy : newSettings.rows_sell;
    const targetRow = rows.find((r) => r.index === rowIndex);

    if (targetRow) {
      targetRow.alert = false;
      setLocalSettings(newSettings);

      // This will trigger validation. If validation fails (e.g. user made bad edits elsewhere),
      // the alert won't be acknowledged on server. This ensures data integrity.
      // We could theoretically force-send, but safest is to require valid state.
      await handleSettingsSave(newSettings);
    }

    setIsAcknowledging(false);
    setAlertState((prev) => ({ ...prev, show: false }));
  };

  const criticalError = appData?.runtime?.error_status;

  return (
    <div className="flex flex-col h-screen bg-gray-950 text-gray-100 font-sans relative">
      {/* ALERT POPUP MODAL */}
      {alertState.show && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-gray-800 border-2 border-white rounded-lg p-6 shadow-2xl max-w-sm w-full text-center transform scale-100 transition-transform">
            <div
              className={`text-4xl mb-4 ${
                alertState.side === "BUY" ? "text-green-500" : "text-red-500"
              }`}
            >
              <i className="fas fa-bell animate-bounce"></i>
            </div>
            <h2 className="text-2xl font-bold text-white mb-2">
              {alertState.side} TRADE EXECUTION
            </h2>
            <p className="text-lg text-gray-300 font-mono mb-2">
              {alertState.message}
            </p>
            <div className="text-xs text-gray-500 mb-6">
              Time:{" "}
              {new Date(lastAlertTimeRef.current || "").toLocaleTimeString()}
            </div>
            <button
              onClick={handleAcknowledgeAlert}
              disabled={isAcknowledging}
              className={`bg-blue-600 hover:bg-blue-500 text-white font-bold py-2 px-6 rounded-full transition-colors w-full focus:outline-none focus:ring-2 focus:ring-blue-400 ${
                isAcknowledging ? "opacity-70 cursor-wait" : ""
              }`}
            >
              {isAcknowledging ? "SAVING..." : "ACKNOWLEDGE"}
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
        {/* Container for Tables - Flex Row on Desktop, Col on Mobile */}
        {/* min-h ensures that on small screens the tables have height and body scrolls */}
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
