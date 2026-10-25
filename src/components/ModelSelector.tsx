import { useState, useRef, useEffect } from 'react';
import { ChevronDown, Check, Cpu } from 'lucide-react';

export interface AIModel {
  id: string;
  name: string;
  description: string;
}

const MODELS: AIModel[] = [
  { id: 'gpt-4o', name: 'GPT-4o', description: 'Most capable — best for complex analysis' },
  { id: 'gpt-4o-mini', name: 'GPT-4o Mini', description: 'Fast and cost-efficient' },
  { id: 'gpt-4-turbo', name: 'GPT-4 Turbo', description: 'High quality with extended context' },
  { id: 'claude-3-5-sonnet', name: 'Claude 3.5 Sonnet', description: 'Excellent reasoning and writing' },
  { id: 'claude-3-haiku', name: 'Claude 3 Haiku', description: 'Quick responses, lighter tasks' },
];

interface ModelSelectorProps {
  value: string;
  onChange: (modelId: string) => void;
  disabled?: boolean;
}

export function ModelSelector({ value, onChange, disabled }: ModelSelectorProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const selected = MODELS.find((m) => m.id === value) ?? MODELS[0];

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => !disabled && setOpen((prev) => !prev)}
        disabled={disabled}
        className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-neutral-300 text-xs font-medium transition-colors border border-white/5 disabled:opacity-30 disabled:cursor-not-allowed"
        aria-label="Select AI model"
      >
        <Cpu size={14} className="text-blue-400" />
        <span className="hidden sm:inline">{selected.name}</span>
        <ChevronDown size={13} className={`text-neutral-500 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1.5 w-64 rounded-xl bg-[#1c1c1c] border border-white/10 shadow-xl shadow-black/40 z-50 overflow-hidden">
          <div className="px-3 py-2 border-b border-white/5">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
              AI Model
            </span>
          </div>
          <div className="py-1 max-h-72 overflow-y-auto">
            {MODELS.map((model) => (
              <button
                key={model.id}
                onClick={() => {
                  onChange(model.id);
                  setOpen(false);
                }}
                className={`w-full flex items-start gap-2.5 px-3 py-2.5 text-left transition-colors ${
                  model.id === value ? 'bg-blue-600/10' : 'hover:bg-white/5'
                }`}
              >
                <div className="flex-1 min-w-0">
                  <p className={`text-xs font-semibold ${
                    model.id === value ? 'text-blue-400' : 'text-neutral-200'
                  }`}>
                    {model.name}
                  </p>
                  <p className="text-[11px] text-neutral-500 mt-0.5 leading-snug">
                    {model.description}
                  </p>
                </div>
                {model.id === value && (
                  <Check size={14} className="shrink-0 mt-0.5 text-blue-400" />
                )}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export { MODELS };
