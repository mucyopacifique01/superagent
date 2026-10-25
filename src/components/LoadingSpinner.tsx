import { Bot } from 'lucide-react';
import type { AgentStep } from '@/types/chat';

interface LoadingSpinnerProps {
  steps?: AgentStep[];
}

const defaultSteps: AgentStep[] = [
  { agent: 'Analyzing your project description', content: '', status: 'active' },
  { agent: 'Delegating to specialist agents', content: '', status: 'pending' },
  { agent: 'Synthesizing recommendations', content: '', status: 'pending' },
];

export function LoadingSpinner({ steps }: LoadingSpinnerProps) {
  const displaySteps = steps && steps.length > 0 ? steps : defaultSteps;

  return (
    <div className="px-4 md:px-6 py-4">
      <div className="flex gap-3 mb-3">
        <div className="shrink-0 w-8 h-8 rounded-lg flex items-center justify-center bg-emerald-600 text-white">
          <Bot size={16} />
        </div>
        <div className="flex-1">
          <p className="text-xs font-semibold mb-1 text-neutral-400">Super Agent</p>
          <p className="text-xs text-neutral-500">Working on your request...</p>
        </div>
      </div>

      <div className="ml-11 space-y-2">
        {displaySteps.map((step, i) => (
          <div key={i} className="flex items-center gap-2.5">
            <div className="shrink-0">
              {step.status === 'done' && (
                <div className="w-4 h-4 rounded-full bg-emerald-600/20 flex items-center justify-center">
                  <svg width="9" height="9" viewBox="0 0 12 12" fill="none">
                    <path d="M2.5 6.5L5 9L9.5 3.5" stroke="#34d399" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </div>
              )}
              {step.status === 'active' && (
                <div className="w-4 h-4 rounded-full border-2 border-blue-500/30 border-t-blue-400 animate-spin" />
              )}
              {step.status === 'pending' && (
                <div className="w-4 h-4 rounded-full border border-neutral-700" />
              )}
            </div>
            <span className={`text-xs ${
              step.status === 'done' ? 'text-neutral-400' :
              step.status === 'active' ? 'text-blue-400 font-medium' : 'text-neutral-600'
            }`}>
              {step.agent}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
