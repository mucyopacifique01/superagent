import { Bot, Loader2, Square, Zap } from 'lucide-react';
import type { Routing, RunProgress } from '@/types/chat';

interface ProgressPanelProps {
  routing: Routing | null;
  progress: RunProgress | null;
  elapsedSeconds: number;
  streaming: boolean;
  onStop: () => void;
}

function fmt(seconds: number | null | undefined) {
  if (seconds == null || seconds < 0) return null;
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return s ? `${m}m ${s}s` : `${m}m`;
}

function humanise(task: string | null | undefined) {
  if (!task) return 'Working';
  return task.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export function ProgressPanel({ routing, progress, elapsedSeconds, streaming, onStop }: ProgressPanelProps) {
  const mode = routing?.mode ?? 'fast';
  const advanced = mode === 'advanced';

  const completed = progress?.completed ?? null;
  const total = progress?.total ?? null;
  const pct = completed != null && total ? Math.min(100, Math.round((completed / total) * 100)) : null;
  const eta = fmt(progress?.eta_seconds);

  return (
    <div className="mx-4 md:mx-6 mb-4 rounded-xl border border-white/10 bg-white/[0.03] overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-white/5">
        {advanced ? (
          <Bot size={14} className="text-blue-400" />
        ) : (
          <Zap size={14} className="text-emerald-400" />
        )}
        <span className="text-xs font-semibold text-neutral-200">
          {advanced ? 'Advanced research' : 'Fast response'}
        </span>
        <span className="text-[10px] text-neutral-500">
          {advanced ? '6-task crew' : routing?.category ?? 'direct'}
        </span>
        <span className="ml-auto flex items-center gap-2">
          <span className="text-[10px] text-neutral-500 tabular-nums">{fmt(elapsedSeconds)}</span>
          <button
            onClick={onStop}
            className="flex items-center gap-1 px-2 py-1 rounded-md bg-white/5 hover:bg-red-500/15 text-neutral-300 hover:text-red-300 text-[10px] font-semibold transition-colors border border-white/5"
            aria-label="Stop this response"
          >
            <Square size={9} />
            Stop
          </button>
        </span>
      </div>

      <div className="px-4 py-3 space-y-2">
        <div className="flex items-center gap-2.5">
          <Loader2 size={12} className="text-blue-400 animate-spin shrink-0" />
          <span className="text-xs text-neutral-300">
            {!routing
              ? 'Reading your message...'
              : advanced
                ? completed != null && total
                  ? `${humanise(progress?.current)} · task ${Math.min(completed + 1, total)} of ${total}`
                  : 'Starting the agent team...'
                : streaming
                  ? 'Writing the answer...'
                  : 'Thinking...'}
          </span>
          {advanced && eta && <span className="text-[10px] text-neutral-500 ml-auto">~{eta} left</span>}
        </div>

        {advanced && pct != null && (
          <div className="h-1 rounded-full bg-white/10 overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-blue-500 to-emerald-500 transition-all duration-500"
              style={{ width: `${Math.max(3, pct)}%` }}
            />
          </div>
        )}

        {routing && (
          <p className="text-[10px] text-neutral-500 leading-snug">
            Routed to {advanced ? 'Advanced Research' : 'Fast'} · {routing.reason}
          </p>
        )}
      </div>
    </div>
  );
}
