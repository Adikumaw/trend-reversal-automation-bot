
import React from 'react';
import { RuntimeState } from '../types';

interface StatusHeaderProps {
  runtime: RuntimeState | null;
  connected: boolean;
}

const StatusHeader: React.FC<StatusHeaderProps> = ({ runtime, connected }) => {
  const currentPrice = runtime?.current_price || 0;
  const direction = runtime?.price_direction || 'neutral';
  
  const ask = runtime?.current_ask;
  const bid = runtime?.current_bid;

  const dirIcon = direction === 'up' ? '▲' : direction === 'down' ? '▼' : '■';
  const dirColor = direction === 'up' ? 'text-green-500' : direction === 'down' ? 'text-red-500' : 'text-gray-500';

  return (
    <div className="bg-gray-900 border-b border-gray-800 px-4 py-2 flex flex-col md:flex-row items-center justify-between text-sm space-y-2 md:space-y-0">
      <div className="flex items-center space-x-6">
        <div className="flex items-center space-x-2">
          <div className={`h-2.5 w-2.5 rounded-full ${connected ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`}></div>
          <span className={`font-mono font-bold ${connected ? 'text-green-500' : 'text-red-500'}`}>
            {connected ? 'CONNECTED' : 'DISCONNECTED'}
          </span>
        </div>
        
        {connected && (
          <div className="flex items-center space-x-4">
             <div className="flex items-center space-x-2 text-gray-400">
                <span>Mid:</span>
                <span className={`font-mono text-lg font-bold ${dirColor}`}>
                   {currentPrice.toFixed(5)} {dirIcon}
                </span>
            </div>
            
            {/* Ask/Bid Display for v3.2.1 */}
            {(ask !== undefined && bid !== undefined) && (
              <div className="hidden lg:flex space-x-3 text-xs font-mono text-gray-500 border-l border-gray-700 pl-4">
                  <div>Bid: <span className="text-red-400">{bid.toFixed(5)}</span></div>
                  <div>Ask: <span className="text-green-400">{ask.toFixed(5)}</span></div>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="flex items-center space-x-6">
         {runtime && (
             <div className="flex space-x-4 text-xs font-mono text-gray-500">
                <div title="Current Cycle IDs">
                    B: <span className="text-gray-300">{runtime.buy_id || '---'}</span> | 
                    S: <span className="text-gray-300">{runtime.sell_id || '---'}</span>
                </div>
             </div>
         )}
      </div>
    </div>
  );
};

export default StatusHeader;
