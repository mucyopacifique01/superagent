import { Zap, Telescope, Wand2, ChevronDown, Check } from 'lucide-react';
import { useState, useRef, useEffect } from 'react';
import type { ChatMode } from '@/types/chat';

interface ModeSelectorProps {
  value: ChatMode;
  onChange: (mode: ChatMode) => void;
  disabled?: boolean;
  fastAvailable?: boolean;
}

const MODES: { id: ChatMode; name: string; description: string; icon: React.ReactNode }[] = [
  {
    id: 'auto',
    name: 'Auto',
    description: 'Fast for questions, research team for big projects',
    icon: <Wand2 size={13} />,
  },
  {
    id: 'fast',
    name: 'Fast',
    description: 'Direct answer in seconds, no agent pipeline',
    icon: <Zap size={13} />,
  },
  {
    id: 'advanced',
    name: 'Advanced',
    description: 'Full 6-task crew: research, architecture, security, deployment',
    icon: <Telescope size={13} />,
  },
];

export function ModeSelector({ value, onChange, disabled, fastAvailable = true }: ModeSelectorProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const selected = MODES.find((m) => m.id === value) ?? MODES[0];

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const tone =
    selected.id === 'fast'
      ? 'text-emerald-400'
      : selected.id === 'advanced'
        ? 'text-blue-400'
        : 'text-neutral-300';

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => !disabled && setOpen((v) => !v)}
        disabled={disabled}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-xs font-medium transition-colors border border-white/5 disabled:opacity-40 disabled:cursor-not-allowed"
        aria-label="Select response mode"
        title="Choose how your message is answered"
      >
        <span className={tone}>{selected.icon}</span>
        <span className={`hidden sm:inline ${tone}`}>{selected.name}</span>
        <ChevronDown size={13} className={`text-neutral-500 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1.5 w-72 rounded-xl bg-[#1c1c1c] border border-white/10 shadow-xl shadow-black/40 z-50 overflow-hidden">
          <div className="px-3 py-2 border-b border-white/5">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
              Response mode
            </span>
          </div>
          <div className="py-1">
            {MODES.map((mode) => {
              const unavailable = mode.id === 'fast' && !fastAvailable;
              return (
                <button
                  key={mode.id}
                  onClick={() => {
                    onChange(mode.id);
                    setOpen(false);
                  }}
                  className={`w-full flex items-start gap-2.5 px-3 py-2.5 text-left transition-colors ${
                    mode.id === value ? 'bg-white/[0.06]' : 'hover:bg-white/5'
                  }`}
                >
                  <span
                    className={`mt-0.5 ${
                      mode.id === 'fast' ? 'text-emerald-400' : mode.id === 'advanced' ? 'text-blue-400' : 'text-neutral-400'
                    }`}
                  >
                    {mode.icon}
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="flex items-center gap-1.5">
                      <span className={`text-xs font-semibold ${mode.id === value ? 'text-white' : 'text-neutral-200'}`}>
                        {mode.name}
                      </span>
                      {unavailable && (
                        <span className="text-[9px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-400 font-semibold uppercase">
                          no key
                        </span>
                      )}
                    </span>
                    <span className="block text-[11px] text-neutral-500 mt-0.5 leading-snug">{mode.description}</span>
                  </span>
                  {mode.id === value && <Check size={14} className="shrink-0 mt-0.5 text-white" />}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
