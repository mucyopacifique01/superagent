import { useState } from 'react';
import {
  Sparkles,
  ArrowLeft,
  AlertCircle,
  Loader2,
  Mail,
  Lock,
  Search,
  Code2,
  Layers,
  FileCheck2,
} from 'lucide-react';

interface AuthPageProps {
  onSignIn: (email: string, password: string) => Promise<{ error: string | null }>;
  onSignUp: (email: string, password: string) => Promise<{ error: string | null }>;
  onBack: () => void;
}

export function AuthPage({ onSignIn, onSignUp, onBack }: AuthPageProps) {
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    const fn = mode === 'signin' ? onSignIn : onSignUp;
    const { error } = await fn(email, password);

    if (error) {
      setError(error);
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-neutral-100 flex flex-col">
      {/* Nav */}
      <div className="px-6 h-16 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-blue-500 to-emerald-500 flex items-center justify-center">
            <Sparkles size={18} className="text-white" />
          </div>
          <span className="text-lg font-bold tracking-tight">Super Agent</span>
        </div>
        <button
          onClick={onBack}
          className="flex items-center gap-2 text-sm text-neutral-400 hover:text-white transition-colors"
        >
          <ArrowLeft size={16} />
          Back
        </button>
      </div>

      {/* Main content */}
      <div className="flex-1 flex items-center justify-center px-6 pb-20">
        <div className="w-full max-w-5xl grid lg:grid-cols-2 gap-12 items-center">
          {/* Left: Agent Steps Showcase */}
          <div className="hidden lg:block">
            <h2 className="text-3xl font-bold tracking-tight mb-3">
              Meet your AI agent team
            </h2>
            <p className="text-sm text-neutral-400 mb-8 leading-relaxed">
              Super Agent deploys a crew of specialized AI agents that work together
              to analyze your project from every angle.
            </p>

            <div className="space-y-4">
              <AgentPipelineStep
                icon={<Search size={18} />}
                title="Project Analyst"
                description="Parses your project description and identifies key requirements, constraints, and goals."
                step="01"
                gradient="from-blue-500 to-cyan-500"
              />
              <AgentPipelineStep
                icon={<Code2 size={18} />}
                title="Architecture Agent"
                description="Recommends the optimal tech stack, system design, and data flow for your specific needs."
                step="02"
                gradient="from-emerald-500 to-teal-500"
              />
              <AgentPipelineStep
                icon={<Layers size={18} />}
                title="Feature Planner"
                description="Breaks down your project into actionable MVP features and prioritized development phases."
                step="03"
                gradient="from-orange-500 to-amber-500"
              />
              <AgentPipelineStep
                icon={<FileCheck2 size={18} />}
                title="Review Agent"
                description="Synthesizes all agent outputs into a clear, structured recommendation you can act on."
                step="04"
                gradient="from-rose-500 to-pink-500"
              />
            </div>
          </div>

          {/* Right: Auth Form */}
          <div className="w-full max-w-md mx-auto lg:mx-0">
            <div className="text-center mb-8">
              <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-blue-500 to-emerald-500 flex items-center justify-center mx-auto mb-4">
                <Sparkles size={26} className="text-white" />
              </div>
              <h1 className="text-2xl font-bold tracking-tight mb-2">
                {mode === 'signin' ? 'Welcome back' : 'Create your account'}
              </h1>
              <p className="text-sm text-neutral-400">
                {mode === 'signin'
                  ? 'Sign in to access your chat workspace'
                  : 'Sign up to start planning with Super Agent'}
              </p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-neutral-400 mb-1.5">
                  Email
                </label>
                <div className="relative">
                  <Mail size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-neutral-500" />
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    disabled={submitting}
                    placeholder="you@example.com"
                    className="w-full pl-10 pr-4 py-3 rounded-xl bg-white/5 border border-white/10 text-sm text-neutral-100 placeholder:text-neutral-600 outline-none focus:border-blue-500/50 focus:bg-white/[0.07] transition-all disabled:opacity-50"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-neutral-400 mb-1.5">
                  Password
                </label>
                <div className="relative">
                  <Lock size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-neutral-500" />
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    minLength={6}
                    disabled={submitting}
                    placeholder="••••••••"
                    className="w-full pl-10 pr-4 py-3 rounded-xl bg-white/5 border border-white/10 text-sm text-neutral-100 placeholder:text-neutral-600 outline-none focus:border-blue-500/50 focus:bg-white/[0.07] transition-all disabled:opacity-50"
                  />
                </div>
              </div>

              {error && (
                <div className="flex items-center gap-2 px-4 py-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
                  <AlertCircle size={16} className="shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              <button
                type="submit"
                disabled={submitting}
                className="w-full py-3.5 rounded-xl bg-white text-black font-semibold text-sm hover:bg-neutral-200 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {submitting && <Loader2 size={16} className="animate-spin" />}
                {mode === 'signin' ? 'Sign In' : 'Create Account'}
              </button>
            </form>

            <p className="text-center text-sm text-neutral-500 mt-6">
              {mode === 'signin' ? "Don't have an account? " : 'Already have an account? '}
              <button
                onClick={() => {
                  setMode(mode === 'signin' ? 'signup' : 'signin');
                  setError(null);
                }}
                className="text-blue-400 hover:text-blue-300 font-medium transition-colors"
              >
                {mode === 'signin' ? 'Sign up' : 'Sign in'}
              </button>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function AgentPipelineStep({
  icon,
  title,
  description,
  step,
  gradient,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  step: string;
  gradient: string;
}) {
  return (
    <div className="flex items-start gap-4 group">
      <div className="relative shrink-0">
        <div className={`w-11 h-11 rounded-xl bg-gradient-to-br ${gradient} flex items-center justify-center text-white`}>
          {icon}
        </div>
        <span className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-[#0a0a0a] border border-white/10 flex items-center justify-center text-[9px] font-bold text-neutral-400">
          {step}
        </span>
      </div>
      <div className="flex-1">
        <h3 className="text-sm font-semibold text-neutral-100 mb-0.5 group-hover:text-white transition-colors">
          {title}
        </h3>
        <p className="text-xs text-neutral-500 leading-relaxed">{description}</p>
      </div>
    </div>
  );
}
