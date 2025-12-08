
import React, { useCallback } from 'react';
import { GridRow, RowExecStats, TradeSide } from '../types';

interface GridTableProps {
  side: TradeSide;
  rows: GridRow[];
  execMap: Record<string, RowExecStats>;
  invalidRows?: number[]; // Indices of rows that failed validation
  onRowChange: (index: number, field: keyof GridRow, value: any) => void;
  onRowSave: () => void;
}

const GridTable: React.FC<GridTableProps> = ({ side, rows, execMap, invalidRows = [], onRowChange, onRowSave }) => {
  const isBuy = side === 'BUY';
  const headerColor = isBuy ? 'text-green-400' : 'text-red-400';
  
  const executedCount = Object.keys(execMap).length;

  const handleInputChange = useCallback((index: number, field: keyof GridRow, value: string | boolean) => {
    let processedValue: any = value;
    if (typeof value === 'string') {
        processedValue = parseFloat(value);
        if (isNaN(processedValue)) processedValue = 0;
    }
    onRowChange(index, field, processedValue);
  }, [onRowChange]);

  const handleCheckboxChange = (index: number, checked: boolean) => {
      onRowChange(index, 'alert', checked);
      setTimeout(onRowSave, 0); 
  };

  return (
    <div className="flex flex-col h-full bg-gray-900 border border-gray-800 rounded-lg overflow-hidden shadow-lg">
      <div className={`flex-shrink-0 px-4 py-2 border-b border-gray-800 font-bold text-center ${isBuy ? 'bg-green-900/20' : 'bg-red-900/20'} ${headerColor}`}>
        {side} GRID ({executedCount} Active)
      </div>
      
      {/* Table Body Container - Takes remaining height, allows internal scroll */}
      <div className="flex-1 overflow-auto relative scrollbar-thin scrollbar-thumb-gray-700 scrollbar-track-gray-900">
        <div className="min-w-[700px]"> {/* Min width forces horizontal scroll on small screens */}
            
            {/* Sticky Header */}
            <div className="sticky top-0 z-10 grid grid-cols-7 gap-1 px-2 py-2 bg-gray-850 text-xs font-bold text-gray-500 uppercase text-center border-b border-gray-800 shadow-sm">
                <div className="col-span-1">Idx</div>
                <div className="col-span-1">Gap</div>
                <div className="col-span-1">Lots</div>
                <div className="col-span-1">Alert</div>
                <div className="col-span-1">Price</div>
                <div className="col-span-1">Tot. Lot</div>
                <div className="col-span-1">Cum. P/L</div>
            </div>

            {/* Rows */}
            <div>
                {rows.map((row, idx) => {
                const isExecuted = String(idx) in execMap;
                const execData = execMap[String(idx)];
                const isInvalid = invalidRows.includes(idx);
                
                // Sequential Logic
                const prevRow = idx > 0 ? rows[idx - 1] : null;
                const isSequentiallyLocked = idx > 0 && (prevRow?.dollar === 0);
                
                // v3.2.4 Logic
                const isInputDisabled = isExecuted || isSequentiallyLocked;
                const isAlertDisabled = isSequentiallyLocked; // Alert allowed if executed

                // Visual States
                const isNext = idx === executedCount; 
                const isActive = isExecuted;
                
                // Base Classes
                let rowClass = "grid grid-cols-7 gap-1 px-2 py-1 items-center text-sm border-b border-gray-800 transition-colors ";
                
                // State Styling
                if (isInvalid) {
                    // ERROR STATE
                    rowClass += "bg-red-900/40 border-l-4 border-red-500 ";
                } else if (isActive) {
                    rowClass += `bg-gray-800/80 ${isBuy ? 'text-green-100' : 'text-red-100'} `;
                } else if (isNext) {
                    rowClass += "bg-blue-900/10 border-l-4 border-blue-500 ";
                } else {
                    rowClass += "border-l-4 border-transparent hover:bg-gray-800 ";
                }
                
                if (isSequentiallyLocked) {
                    rowClass += "opacity-40 ";
                }

                return (
                    <div key={row.index} className={rowClass}>
                    {/* Index */}
                    <div className="col-span-1 text-center text-gray-500 font-mono">
                        {row.index}
                    </div>

                    {/* Dollar (Gap) Input */}
                    <div className="col-span-1">
                        <input
                        type="number"
                        step="0.00001"
                        disabled={isInputDisabled}
                        className={`w-full border rounded px-1 py-0.5 text-center font-mono focus:outline-none focus:ring-1 focus:ring-blue-500 
                            ${isInputDisabled ? 'opacity-50 cursor-not-allowed bg-gray-900 border-gray-800 text-gray-500' : 'bg-gray-950 text-white'}
                            ${isInvalid && !isInputDisabled ? 'border-red-500 bg-red-900/20' : 'border-gray-700'}
                        `}
                        value={row.dollar}
                        onChange={(e) => handleInputChange(idx, 'dollar', e.target.value)}
                        onBlur={onRowSave}
                        placeholder="0"
                        />
                    </div>

                    {/* Lots Input */}
                    <div className="col-span-1">
                        <input
                        type="number"
                        step="0.01"
                        disabled={isInputDisabled}
                        className={`w-full border rounded px-1 py-0.5 text-center font-mono focus:outline-none focus:ring-1 focus:ring-blue-500 
                             ${isInputDisabled ? 'opacity-50 cursor-not-allowed bg-gray-900 border-gray-800 text-gray-500' : 'bg-gray-950 text-white'}
                             ${isInvalid && !isInputDisabled ? 'border-red-500 bg-red-900/20' : 'border-gray-700'}
                        `}
                        value={row.lots}
                        onChange={(e) => handleInputChange(idx, 'lots', e.target.value)}
                        onBlur={onRowSave}
                        placeholder="0"
                        />
                    </div>

                    {/* Alert Checkbox */}
                    <div className="col-span-1 flex justify-center">
                        <input 
                        type="checkbox" 
                        disabled={isAlertDisabled}
                        className="form-checkbox h-4 w-4 text-blue-600 bg-gray-700 border-gray-600 rounded focus:ring-offset-gray-900 disabled:opacity-50"
                        checked={row.alert}
                        onChange={(e) => handleCheckboxChange(idx, e.target.checked)}
                        />
                    </div>

                    {/* Entry Price (Real Data) */}
                    <div className="col-span-1 text-center font-mono text-gray-400 text-xs">
                        {execData ? execData.entry_price.toFixed(5) : '-'}
                    </div>

                    {/* Cumulative Lots */}
                    <div className="col-span-1 text-center font-mono text-gray-500 text-xs">
                        {execData ? execData.cumulative_lots.toFixed(2) : '-'}
                    </div>

                    {/* Cumulative P/L */}
                    <div className={`col-span-1 text-center font-mono font-bold text-xs ${execData ? (execData.cumulative_profit >= 0 ? 'text-green-500' : 'text-red-500') : 'text-gray-600'}`}>
                        {execData ? `$${execData.cumulative_profit.toFixed(2)}` : '-'}
                    </div>
                    </div>
                );
                })}
            </div>
        </div>
      </div>
    </div>
  );
};

export default GridTable;
