import { Sparkles, MessageSquare, Zap, Shield, ArrowRight, Bot, Users, Workflow } from 'lucide-react';

interface LandingPageProps {
  onGetStarted: () => void;
}

export function LandingPage({ onGetStarted }: LandingPageProps) {
  return (
    <div className="min-h-screen bg-[#0a0a0a] text-neutral-100 overflow-x-hidden">
      {/* Nav */}
      <nav className="fixed top-0 left-0 right-0 z-50 bg-[#0a0a0a]/80 backdrop-blur-xl border-b border-white/5">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-blue-500 to-emerald-500 flex items-center justify-center">
              <Sparkles size={18} className="text-white" />
            </div>
            <span className="text-lg font-bold tracking-tight">Super Agent</span>
          </div>
          <button
            onClick={onGetStarted}
            className="px-5 py-2 rounded-lg bg-white text-black text-sm font-semibold hover:bg-neutral-200 transition-colors"
          >
            Get Started
          </button>
        </div>
      </nav>

      {/* Hero */}
      <section className="relative pt-32 pb-20 px-6">
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute top-20 left-1/4 w-96 h-96 bg-blue-600/20 rounded-full blur-[120px]" />
          <div className="absolute top-40 right-1/4 w-96 h-96 bg-emerald-600/15 rounded-full blur-[120px]" />
        </div>

        <div className="relative max-w-4xl mx-auto text-center">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-white/5 border border-white/10 text-xs font-medium text-neutral-300 mb-8">
            <Zap size={13} className="text-emerald-400" />
            AI-powered project planning agent
          </div>

          <h1 className="text-5xl md:text-7xl font-bold tracking-tight leading-[1.05] mb-6">
            Describe your project.
            <br />
            <span className="bg-gradient-to-r from-blue-400 via-cyan-300 to-emerald-400 bg-clip-text text-transparent">
              Let AI do the rest.
            </span>
          </h1>

          <p className="text-lg md:text-xl text-neutral-400 max-w-2xl mx-auto mb-10 leading-relaxed">
            Chat with Super Agent to brainstorm architecture, scope features, and plan
            your development milestones — all through a simple conversation.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <button
              onClick={onGetStarted}
              className="group flex items-center gap-2 px-7 py-3.5 rounded-xl bg-white text-black font-semibold text-sm hover:bg-neutral-200 transition-all hover:scale-[1.02]"
            >
              Start Chatting
              <ArrowRight size={17} className="group-hover:translate-x-0.5 transition-transform" />
            </button>
            <a
              href="#features"
              className="px-7 py-3.5 rounded-xl bg-white/5 border border-white/10 text-neutral-200 font-semibold text-sm hover:bg-white/10 transition-colors"
            >
              Learn More
            </a>
          </div>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="py-20 px-6">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-14">
            <h2 className="text-3xl md:text-4xl font-bold tracking-tight mb-4">
              Everything you need to plan smarter
            </h2>
            <p className="text-neutral-400 max-w-xl mx-auto">
              From initial idea to detailed architecture — Super Agent guides you
              through every step of project planning.
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-6">
            <FeatureCard
              icon={<MessageSquare size={22} />}
              title="Conversational Planning"
              description="Describe your project in plain language. Get structured analysis on scope, stack, and milestones instantly."
              gradient="from-blue-500 to-cyan-500"
            />
            <FeatureCard
              icon={<Workflow size={22} />}
              title="Architecture Guidance"
              description="Receive tailored recommendations on frontend, backend, database, and deployment strategies for your specific needs."
              gradient="from-emerald-500 to-teal-500"
            />
            <FeatureCard
              icon={<Users size={22} />}
              title="Agent Collaboration"
              description="Multiple AI agents work together to analyze your project from different angles — design, engineering, and product."
              gradient="from-orange-500 to-amber-500"
            />
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="py-20 px-6 border-t border-white/5">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-3xl md:text-4xl font-bold tracking-tight text-center mb-14">
            How it works
          </h2>
          <div className="grid md:grid-cols-3 gap-8">
            <StepCard
              step="01"
              title="Sign in"
              description="Create your account or sign in to access your personal chat workspace."
              icon={<Shield size={20} />}
            />
            <StepCard
              step="02"
              title="Describe your project"
              description="Type a project description and send it to the AI. Be as detailed or as vague as you like."
              icon={<MessageSquare size={20} />}
            />
            <StepCard
              step="03"
              title="Get AI insights"
              description="Receive structured analysis with architecture, features, and development phases — then iterate."
              icon={<Bot size={20} />}
            />
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-24 px-6">
        <div className="max-w-3xl mx-auto text-center">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-500 to-emerald-500 flex items-center justify-center mx-auto mb-6">
            <Sparkles size={30} className="text-white" />
          </div>
          <h2 className="text-3xl md:text-4xl font-bold tracking-tight mb-4">
            Ready to plan your next project?
          </h2>
          <p className="text-neutral-400 mb-8 max-w-lg mx-auto">
            Join Super Agent and start turning your ideas into actionable development plans.
          </p>
          <button
            onClick={onGetStarted}
            className="group inline-flex items-center gap-2 px-8 py-4 rounded-xl bg-white text-black font-semibold text-sm hover:bg-neutral-200 transition-all hover:scale-[1.02]"
          >
            Get Started Free
            <ArrowRight size={17} className="group-hover:translate-x-0.5 transition-transform" />
          </button>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-white/5 py-8 px-6">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-lg bg-gradient-to-br from-blue-500 to-emerald-500 flex items-center justify-center">
              <Sparkles size={13} className="text-white" />
            </div>
            <span className="text-sm font-semibold text-neutral-300">Super Agent</span>
          </div>
          <p className="text-xs text-neutral-600">
            © 2026 Super Agent. Built for smarter project planning.
          </p>
        </div>
      </footer>
    </div>
  );
}

function FeatureCard({
  icon,
  title,
  description,
  gradient,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  gradient: string;
}) {
  return (
    <div className="group p-6 rounded-2xl bg-white/[0.02] border border-white/5 hover:border-white/10 transition-all hover:bg-white/[0.04]">
      <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${gradient} flex items-center justify-center text-white mb-4`}>
        {icon}
      </div>
      <h3 className="text-lg font-semibold text-neutral-100 mb-2">{title}</h3>
      <p className="text-sm text-neutral-400 leading-relaxed">{description}</p>
    </div>
  );
}

function StepCard({
  step,
  title,
  description,
  icon,
}: {
  step: string;
  title: string;
  description: string;
  icon: React.ReactNode;
}) {
  return (
    <div className="relative">
      <div className="text-5xl font-bold text-white/5 mb-3">{step}</div>
      <div className="w-10 h-10 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center text-neutral-300 mb-3">
        {icon}
      </div>
      <h3 className="text-lg font-semibold text-neutral-100 mb-2">{title}</h3>
      <p className="text-sm text-neutral-400 leading-relaxed">{description}</p>
    </div>
  );
}
