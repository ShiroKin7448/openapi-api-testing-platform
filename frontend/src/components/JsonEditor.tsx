import { useState, useRef } from 'react';

interface JsonEditorProps {
  value: string;
  originalValue?: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}

export default function JsonEditor({ value, originalValue, onChange, disabled }: JsonEditorProps) {
  const [isFocused, setIsFocused] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Basic syntax highlighter logic with diffing
  const renderHighlighted = () => {
    if (!value) return null;
    
    const lines = value.split('\n');
    let origLines: string[] = [];
    if (originalValue) origLines = originalValue.split('\n');
    
    return lines.map((line, i) => {
      // Check if this line contains runtime bindings {{...}}
      const hasBinding = /\{\{.+?\}\}/.test(line);
      
      // Basic check if overridden (line text differs from original payload)
      const isOverridden = originalValue && line !== origLines[i];

      let lineClass = 'text-emerald-400';
      if (hasBinding) lineClass = 'text-amber-400 font-bold'; // Runtime context binding
      else if (isOverridden) lineClass = 'text-sky-400 font-bold'; // User overridden value
      else lineClass = 'text-emerald-400/70'; // Generated value (default)

      // Replace {{...}} with styled spans
      const parts = line.split(/(\{\{.+?\}\})/g);
      return (
        <div key={i} className="min-h-[1.5rem] whitespace-pre font-mono">
          {parts.map((part, j) => {
            if (part.startsWith('{{') && part.endsWith('}}')) {
              return <span key={j} className="text-amber-400 bg-amber-400/10 px-1 rounded mx-0.5">{part}</span>;
            }
            return <span key={j} className={lineClass}>{part}</span>;
          })}
        </div>
      );
    });
  };

  return (
    <div className={`relative w-full h-full min-h-[15rem] bg-slate-950 rounded-xl border transition-colors ${isFocused ? 'border-primary-500 ring-1 ring-primary-500/50' : 'border-slate-800'}`}>
      <div className="absolute inset-0 p-4 overflow-auto pointer-events-none text-xs leading-6">
        {renderHighlighted()}
      </div>
      <textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setIsFocused(true)}
        onBlur={() => setIsFocused(false)}
        disabled={disabled}
        spellCheck={false}
        className="absolute inset-0 w-full h-full p-4 bg-transparent text-transparent caret-white resize-none outline-none text-xs font-mono leading-6"
      />
    </div>
  );
}
