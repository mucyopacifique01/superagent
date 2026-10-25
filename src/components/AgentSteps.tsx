import { Bot, Check, Loader2, Circle } from 'lucide-react';
import type { AgentStep } from '@/types/chat';

interface AgentStepsProps {
  steps: AgentStep[];
  compact?: boolean;
}

export function AgentSteps({ steps, compact = false }: AgentStepsProps) {
  if (steps.length === 0) return null;

  return (
    <div className={`mx-4 md:mx-6 mb-4 rounded-xl border border-white/10 bg-white/[0.03] overflow-hidden ${compact ? '' : ''}`}>
      <div className="px-4 py-2.5 border-b border-white/5 flex items-center gap-2">
        <Bot size={14} className="text-emerald-400" />
        <span className="text-xs font-semibold text-neutral-300">Agent Pipeline</span>
        <span className="text-[10px] text-neutral-500 ml-auto">
          {steps.filter((s) => s.status === 'done').length}/{steps.length} complete
        </span>
      </div>

      <div className="divide-y divide-white/5">
        {steps.map((step, i) => (
          <div key={i} className="flex items-start gap-3 px-4 py-3">
            <div className="shrink-0 mt-0.5">
              {step.status === 'done' && (
                <div className="w-5 h-5 rounded-full bg-emerald-600/20 flex items-center justify-center">
                  <Check size={11} className="text-emerald-400" />
                </div>
              )}
              {step.status === 'active' && (
                <div className="w-5 h-5 rounded-full bg-blue-600/20 flex items-center justify-center">
                  <Loader2 size={11} className="text-blue-400 animate-spin" />
                </div>
              )}
              {step.status === 'pending' && (
                <div className="w-5 h-5 rounded-full bg-white/5 flex items-center justify-center">
                  <Circle size={8} className="text-neutral-600" />
                </div>
              )}
            </div>

            <div className="flex-1 min-w-0">
              <p className={`text-xs font-semibold mb-0.5 ${
                step.status === 'pending' ? 'text-neutral-500' :
                step.status === 'active' ? 'text-blue-400' : 'text-neutral-200'
              }`}>
                {step.agent}
              </p>
              {step.content && step.status === 'done' && (
                <p className="text-xs text-neutral-500 leading-relaxed line-clamp-2">
                  {step.content.slice(0, 200)}
                  {step.content.length > 200 ? '...' : ''}
                </p>
              )}
              {step.status === 'active' && (
                <p className="text-xs text-neutral-500 leading-relaxed">
                  Working...
                </p>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
