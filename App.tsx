
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { 
  AppData, 
  GridRow, 
  UserSettings, 
  DEFAULT_SETTINGS,
  createEmptyGrid
} from './types';
import ControlPanel from './components/ControlPanel';
import StatusHeader from './components/StatusHeader';
import GridTable from './components/GridTable';
import * as api from './services/api';

interface AlertPopupState {
    show: boolean;
    message: string;
    side: 'BUY' | 'SELL';
    rowIndex: number;
}

const App: React.FC = () => {
  // Server State
  const [appData, setAppData] = useState<AppData | null>(null);
  const [connected, setConnected] = useState(false);
  
  // Local Settings State (Source of truth for Inputs)
  const [localSettings, setLocalSettings] = useState<UserSettings>(DEFAULT_SETTINGS);
  const [hasInitializedSettings, setHasInitializedSettings] = useState(false);
  
  // Popup Alert State
  const [alertState, setAlertState] = useState<AlertPopupState>({ show: false, message: '', side: 'BUY', rowIndex: -1 });
  const [isAcknowledging, setIsAcknowledging] = useState(false);

  // Refs for tracking changes
  const lastAlertTimeRef = useRef<string | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);

  const playAlertSound = useCallback(() => {
    try {
        if (!audioContextRef.current) {
            audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
        }
        const ctx = audioContextRef.current;
        if (ctx.state === 'suspended') ctx.resume();

        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        
        osc.type = 'square';
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
  const checkAlerts = useCallback((data: AppData) => {
    // Collect all executed rows
    const buyExecs = Object.values(data.runtime.buy_exec_map);
    const sellExecs = Object.values(data.runtime.sell_exec_map);
    const allExecs = [...buyExecs, ...sellExecs];
    
    // Sort by timestamp desc
    allExecs.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    
    const latest = allExecs[0];
    if (!latest) return;

    // If new execution found
    if (latest.timestamp !== lastAlertTimeRef.current) {
        lastAlertTimeRef.current = latest.timestamp;
        
        const isBuy = buyExecs.includes(latest);
        const side = isBuy ? 'BUY' : 'SELL';
        const rows = isBuy ? data.settings.rows_buy : data.settings.rows_sell;
        const rowConfig = rows.find(r => r.index === latest.index);
        
        if (rowConfig && rowConfig.alert) {
            playAlertSound();
            setAlertState({
                show: true,
                message: `Level ${latest.index + 1} Executed @ ${latest.entry_price}`,
                side: side,
                rowIndex: latest.index
            });
        }
    }
  }, [playAlertSound]);

  // Helper to ensure we always display 100 rows
  const mergeGridRows = useCallback((serverRows: GridRow[]): GridRow[] => {
      const merged = createEmptyGrid();
      serverRows.forEach(row => {
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
      
      // LOGGING FOR DEBUGGING
      if (data) {
          console.log('[Server Data]', data);
      } else {
          console.log('[Server Data] Disconnected or Fetch Failed');
      }

      if (data) {
        setConnected(true);
        setAppData(data);
        checkAlerts(data);

        // Sync local settings on first load
        // We merge server rows with default grid to ensure table is always full
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

  // Strict Validation for Permissive Mode
  const validateSettings = (settings: UserSettings) => {
    if (settings.tp_value < 0) throw new Error("TP value cannot be negative");
    if (settings.limit_price < 0) throw new Error("Limit Price cannot be negative");
    
    const validateRows = (rows: GridRow[], side: string) => {
        let reachedEnd = false;

        rows.forEach((row, i) => {
            if (row.index !== i) throw new Error(`${side} row ${i} has incorrect index`);
            
            // Logic:
            // If dollar > 0: It is an "Active Row".
            // - Must NOT occur after an empty row (Gap check).
            // - Must have lots > 0.
            // If dollar == 0: It is an "Empty Row".
            // - Sets flag reachedEnd = true.
            // - All subsequent rows must be 0.
            
            if (row.dollar > 0) {
                if (reachedEnd) {
                    throw new Error(`${side} row ${i}: Cannot set values after an empty row (Gap detected at row ${i-1})`);
                }
                if (row.lots <= 0) {
                    throw new Error(`${side} row ${i}: Lots must be positive (> 0) if dollar gap is set`);
                }
            } else {
                // Empty row (dollar 0)
                // We ignore 'lots' here (it's fine if lots is 0 or whatever, we send it to backend as is, user said send trailing 0s)
                reachedEnd = true;
            }
        });
    };
    
    validateRows(settings.rows_buy, 'Buy');
    validateRows(settings.rows_sell, 'Sell');
  };

  // Handlers
  const handleSettingsChange = (newSettings: UserSettings) => {
    setLocalSettings(newSettings);
  };

  const handleSettingsSave = async (settingsOverride?: UserSettings) => {
    const settingsToSave = settingsOverride || localSettings;
    try {
        validateSettings(settingsToSave);
        const success = await api.updateSettings(settingsToSave);
        if (success) {
            console.log("Settings saved successfully");
            return true;
        } else {
            console.error("Failed to save settings");
            return false;
        }
    } catch (e: any) {
        alert(`Validation Error (Not Sent to Server):\n${e.message}`);
        return false;
    }
  };

  const handleRowChange = useCallback((isBuy: boolean, index: number, field: keyof GridRow, value: any) => {
    setLocalSettings(prev => {
        const rows = isBuy ? [...prev.rows_buy] : [...prev.rows_sell];
        const targetRow = rows.find(r => r.index === index);
        
        if (targetRow) {
            const updatedRow = { ...targetRow, [field]: value };
            const newRows = rows.map(r => r.index === index ? updatedRow : r);
            
            return {
                ...prev,
                [isBuy ? 'rows_buy' : 'rows_sell']: newRows
            };
        }
        return prev;
    });
  }, []);

  const handleControlToggle = async (type: 'buy' | 'sell' | 'cyclic', value: boolean) => {
    const payload: any = {};
    if (type === 'buy') payload.buy_switch = value;
    if (type === 'sell') payload.sell_switch = value;
    if (type === 'cyclic') payload.cyclic = value;

    await api.controlSystem(payload);
  };

  const handleEmergencyClose = async () => {
    if (window.confirm("ARE YOU SURE? This will close ALL positions immediately.")) {
        await api.controlSystem({ emergency_close: true });
    }
  };

  const handleAcknowledgeAlert = async () => {
    setIsAcknowledging(true);
    // 1. Find and update the row in local settings
    const side = alertState.side;
    const rowIndex = alertState.rowIndex;
    
    const newSettings = { ...localSettings };
    const rows = side === 'BUY' ? newSettings.rows_buy : newSettings.rows_sell;
    const targetRow = rows.find(r => r.index === rowIndex);

    if (targetRow) {
        // Turn off alert locally
        targetRow.alert = false;
        
        // Update local state first to reflect UI change
        setLocalSettings(newSettings);
        
        // Send full settings to server (Server v3.2.4 allows alert updates on locked rows)
        await handleSettingsSave(newSettings);
    }

    setIsAcknowledging(false);
    // Close popup
    setAlertState(prev => ({ ...prev, show: false }));
  };

  const closePopup = () => setAlertState(prev => ({ ...prev, show: false }));

  // Critical Error Logic
  const criticalError = appData?.runtime?.error_status;

  return (
    <div className="flex flex-col h-screen bg-gray-950 text-gray-100 font-sans overflow-hidden relative">
      
      {/* ALERT POPUP MODAL */}
      {alertState.show && (
          <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm animate-in fade-in duration-200">
             <div className="bg-gray-800 border-2 border-white rounded-lg p-6 shadow-2xl max-w-sm w-full text-center transform scale-100 transition-transform">
                <div className={`text-4xl mb-4 ${alertState.side === 'BUY' ? 'text-green-500' : 'text-red-500'}`}>
                    <i className="fas fa-bell animate-bounce"></i>
                </div>
                <h2 className="text-2xl font-bold text-white mb-2">{alertState.side} TRADE EXECUTION</h2>
                <p className="text-lg text-gray-300 font-mono mb-6">{alertState.message}</p>
                <button 
                  onClick={handleAcknowledgeAlert}
                  disabled={isAcknowledging}
                  className={`bg-blue-600 hover:bg-blue-500 text-white font-bold py-2 px-6 rounded-full transition-colors w-full focus:outline-none focus:ring-2 focus:ring-blue-400 ${isAcknowledging ? 'opacity-70 cursor-wait' : ''}`}
                >
                  {isAcknowledging ? 'SAVING...' : 'ACKNOWLEDGE'}
                </button>
             </div>
          </div>
      )}

      {/* CRITICAL ERROR BANNER */}
      {criticalError && (
        <div className="bg-red-600 text-white font-bold p-4 text-center animate-pulse z-40 shadow-xl border-b-4 border-red-800">
           <i className="fas fa-exclamation-triangle mr-2"></i>
           CRITICAL ERROR: {criticalError}
           <div className="mt-2 text-sm font-normal bg-red-800/50 p-2 rounded">
             Please check MT5 manually or use Emergency Close.
           </div>
        </div>
      )}

      <StatusHeader 
        runtime={appData?.runtime || null} 
        connected={connected}
      />

      <ControlPanel 
        settings={localSettings} 
        runtime={appData?.runtime || null}
        onSettingsChange={handleSettingsChange}
        onSettingsSave={handleSettingsSave}
        onControlToggle={handleControlToggle}
        onEmergencyClose={handleEmergencyClose}
        connected={connected && !criticalError} // Disable controls on error
      />

      <div className={`flex-1 flex flex-col md:flex-row overflow-hidden p-2 md:p-4 gap-2 md:gap-4 transition-opacity ${criticalError ? 'opacity-50 pointer-events-none' : 'opacity-100'}`}>
        <div className="flex-1 min-h-0 min-w-0">
            <GridTable 
                side="BUY" 
                rows={localSettings.rows_buy} 
                execMap={appData?.runtime.buy_exec_map || {}}
                onRowChange={(idx, f, v) => handleRowChange(true, idx, f, v)}
                onRowSave={() => handleSettingsSave()}
            />
        </div>
        <div className="flex-1 min-h-0 min-w-0">
             <GridTable 
                side="SELL" 
                rows={localSettings.rows_sell} 
                execMap={appData?.runtime.sell_exec_map || {}}
                onRowChange={(idx, f, v) => handleRowChange(false, idx, f, v)}
                onRowSave={() => handleSettingsSave()}
            />
        </div>
      </div>
    </div>
  );
};

export default App;
