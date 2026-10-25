import { useState, useRef, useEffect } from 'react';
import { ChevronDown, Check, Server, Cloud } from 'lucide-react';

export type BackendType = 'crewai' | 'fastapi';

interface BackendOption {
  id: BackendType;
  name: string;
  description: string;
  icon: React.ReactNode;
}

const BACKENDS: BackendOption[] = [
  {
    id: 'crewai',
    name: 'CrewAI Cloud',
    description: 'Hosted agent team via edge function',
    icon: <Cloud size={14} className="text-emerald-400" />,
  },
  {
    id: 'fastapi',
    name: 'FastAPI Local',
    description: 'Local backend at localhost:8000',
    icon: <Server size={14} className="text-blue-400" />,
  },
];

interface BackendSelectorProps {
  value: BackendType;
  onChange: (backend: BackendType) => void;
  disabled?: boolean;
}

export function BackendSelector({ value, onChange, disabled }: BackendSelectorProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const selected = BACKENDS.find((b) => b.id === value) ?? BACKENDS[0];

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
        aria-label="Select backend"
        title="Switch backend"
      >
        {selected.icon}
        <span className="hidden md:inline">{selected.name}</span>
        <ChevronDown size={13} className={`text-neutral-500 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1.5 w-60 rounded-xl bg-[#1c1c1c] border border-white/10 shadow-xl shadow-black/40 z-50 overflow-hidden">
          <div className="px-3 py-2 border-b border-white/5">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
              Backend
            </span>
          </div>
          <div className="py-1">
            {BACKENDS.map((backend) => (
              <button
                key={backend.id}
                onClick={() => {
                  onChange(backend.id);
                  setOpen(false);
                }}
                className={`w-full flex items-start gap-2.5 px-3 py-2.5 text-left transition-colors ${
                  backend.id === value ? 'bg-blue-600/10' : 'hover:bg-white/5'
                }`}
              >
                <div className="shrink-0 mt-0.5">{backend.icon}</div>
                <div className="flex-1 min-w-0">
                  <p className={`text-xs font-semibold ${
                    backend.id === value ? 'text-blue-400' : 'text-neutral-200'
                  }`}>
                    {backend.name}
                  </p>
                  <p className="text-[11px] text-neutral-500 mt-0.5 leading-snug">
                    {backend.description}
                  </p>
                </div>
                {backend.id === value && (
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
