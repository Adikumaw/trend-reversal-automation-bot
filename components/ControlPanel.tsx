
import React from 'react';
import { UserSettings, RuntimeState } from '../types';
import Switch from './Switch';

interface ControlPanelProps {
  settings: UserSettings;
  runtime: RuntimeState | null; // Null if not yet connected
  onSettingsChange: (newSettings: UserSettings) => void;
  onSettingsSave: (settingsOverride?: UserSettings) => void;
  onControlToggle: (type: 'buy' | 'sell' | 'cyclic', value: boolean) => void;
  onEmergencyClose: () => void;
  connected: boolean;
}

const ControlPanel: React.FC<ControlPanelProps> = ({ 
  settings, 
  runtime, 
  onSettingsChange,
  onSettingsSave,
  onControlToggle,
  onEmergencyClose,
  connected
}) => {
  
  const updateField = <K extends keyof UserSettings>(key: K, value: UserSettings[K]) => {
    const newSettings = { ...settings, [key]: value };
    onSettingsChange(newSettings);
    // For text inputs, we save onBlur. For changes here we just update state.
  };

  // Helper for immediate update + save (for Radios)
  const setAndSave = <K extends keyof UserSettings>(key: K, value: UserSettings[K]) => {
      const newSettings = { ...settings, [key]: value };
      onSettingsChange(newSettings);
      onSettingsSave(newSettings);
  };

  const isBuyOn = runtime?.buy_on ?? false;
  const isSellOn = runtime?.sell_on ?? false;
  const isCyclicOn = runtime?.cyclic_on ?? false;

  // v3.2.4 Closing Phase Logic
  const isBuyClosing = runtime?.buy_is_closing ?? false;
  const isSellClosing = runtime?.sell_is_closing ?? false;

  return (
    <div className={`bg-gray-850 border-b border-gray-800 p-4 shadow-lg z-20 transition-opacity duration-300 ${connected ? 'opacity-100' : 'opacity-60 pointer-events-none'}`}>
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-center">
        
        {/* Switches Section */}
        <div className="lg:col-span-3 flex flex-col space-y-3 border-r border-gray-700 pr-4">
          <h3 className="text-xs text-gray-400 uppercase tracking-wider font-bold">Main Controls</h3>
          
          {/* Buy Switch */}
          <div className="flex justify-between items-center h-8">
             {isBuyClosing ? (
                 <div className="flex items-center space-x-2 text-yellow-500 font-bold animate-pulse px-1">
                     <i className="fas fa-sync fa-spin text-sm"></i>
                     <span className="text-sm tracking-wide">CLOSING...</span>
                 </div>
             ) : (
                 <Switch 
                    label="BUY System" 
                    checked={isBuyOn} 
                    onChange={(val) => onControlToggle('buy', val)} 
                    color="green"
                 />
             )}
          </div>

          {/* Sell Switch */}
          <div className="flex justify-between items-center h-8">
             {isSellClosing ? (
                 <div className="flex items-center space-x-2 text-yellow-500 font-bold animate-pulse px-1">
                     <i className="fas fa-sync fa-spin text-sm"></i>
                     <span className="text-sm tracking-wide">CLOSING...</span>
                 </div>
             ) : (
                 <Switch 
                    label="SELL System" 
                    checked={isSellOn} 
                    onChange={(val) => onControlToggle('sell', val)} 
                    color="red"
                 />
             )}
          </div>

          <div className="flex justify-between items-center pt-2 border-t border-gray-700">
             <Switch 
                label="Cyclic Run" 
                checked={isCyclicOn} 
                onChange={(val) => onControlToggle('cyclic', val)} 
                color="blue"
             />
          </div>
        </div>

        {/* Global TP Section */}
        <div className="lg:col-span-5 border-r border-gray-700 pr-4">
          <h3 className="text-xs text-gray-400 uppercase tracking-wider font-bold mb-3">Global Take Profit</h3>
          <div className="flex flex-col space-y-3">
            <div className="flex items-center space-x-4">
              <label className="flex items-center cursor-pointer">
                <input 
                  type="radio" 
                  name="tpType" 
                  className="form-radio text-blue-500 bg-gray-700 border-gray-600 focus:ring-blue-500"
                  checked={settings.tp_type === 'equity_pct'}
                  onChange={() => setAndSave('tp_type', 'equity_pct')}
                />
                <span className="ml-2 text-sm text-gray-300">Equity %</span>
              </label>
              <label className="flex items-center cursor-pointer">
                <input 
                  type="radio" 
                  name="tpType" 
                  className="form-radio text-blue-500 bg-gray-700 border-gray-600 focus:ring-blue-500"
                  checked={settings.tp_type === 'balance_pct'}
                  onChange={() => setAndSave('tp_type', 'balance_pct')}
                />
                <span className="ml-2 text-sm text-gray-300">Balance %</span>
              </label>
              <label className="flex items-center cursor-pointer">
                <input 
                  type="radio" 
                  name="tpType" 
                  className="form-radio text-blue-500 bg-gray-700 border-gray-600 focus:ring-blue-500"
                  checked={settings.tp_type === 'fixed_money'}
                  onChange={() => setAndSave('tp_type', 'fixed_money')}
                />
                <span className="ml-2 text-sm text-gray-300">Fixed $</span>
              </label>
            </div>
            
            <div className="flex items-center space-x-2">
              <span className="text-sm text-gray-400">Target:</span>
              <input 
                type="number" 
                step="0.01"
                className="bg-gray-700 border border-gray-600 rounded px-3 py-1 text-white w-32 focus:outline-none focus:border-blue-500 transition-colors"
                value={settings.tp_value}
                onChange={(e) => updateField('tp_value', parseFloat(e.target.value) || 0)}
                onBlur={() => onSettingsSave()}
              />
              <span className="text-sm font-mono text-yellow-500">
                {settings.tp_type === 'fixed_money' ? '$' : '%'}
              </span>
            </div>
          </div>
        </div>

        {/* Limit & Emergency Section */}
        <div className="lg:col-span-4 flex flex-col justify-between h-full">
           <div className="flex items-center justify-between mb-4">
             <div>
                <h3 className="text-xs text-gray-400 uppercase tracking-wider font-bold mb-1">Limit Start Price</h3>
                <p className="text-[10px] text-gray-500">0 = Market Price</p>
             </div>
             <input 
                type="number" 
                step="0.00001"
                className="bg-gray-700 border border-gray-600 rounded px-3 py-1 text-white w-32 focus:outline-none focus:border-blue-500 transition-colors"
                value={settings.limit_price}
                onChange={(e) => updateField('limit_price', parseFloat(e.target.value) || 0)}
                onBlur={() => onSettingsSave()}
              />
           </div>

           <button 
             onClick={onEmergencyClose}
             disabled={!connected}
             className={`w-full font-bold py-2 px-4 rounded border shadow-lg transition-all active:transform active:scale-95 flex items-center justify-center space-x-2 ${connected ? 'bg-red-900/80 hover:bg-red-700 text-red-100 border-red-600 shadow-red-900/50' : 'bg-gray-800 text-gray-500 border-gray-700 cursor-not-allowed'}`}
           >
             <i className="fas fa-skull-crossbones"></i>
             <span>EMERGENCY CLOSE ALL</span>
           </button>
        </div>

      </div>
    </div>
  );
};

export default ControlPanel;
