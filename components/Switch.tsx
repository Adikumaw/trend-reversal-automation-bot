import React from 'react';

interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
  color?: 'green' | 'blue' | 'red';
}

const Switch: React.FC<SwitchProps> = ({ checked, onChange, label, color = 'green' }) => {
  const bgClass = checked 
    ? (color === 'green' ? 'bg-green-600' : color === 'blue' ? 'bg-blue-600' : 'bg-red-600') 
    : 'bg-gray-700';

  return (
    <div className="flex items-center space-x-3 cursor-pointer" onClick={() => onChange(!checked)}>
      <div className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${bgClass}`}>
        <span
          aria-hidden="true"
          className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${checked ? 'translate-x-5' : 'translate-x-0'}`}
        />
      </div>
      {label && <span className="text-sm font-medium text-gray-300 select-none">{label}</span>}
    </div>
  );
};

export default Switch;