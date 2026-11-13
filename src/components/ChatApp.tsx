import { useState, useEffect, useRef, useCallback } from 'react';
import { Menu, Sparkles, AlertCircle, Download } from 'lucide-react';
import { ModelSelector } from '@/components/ModelSelector';
import { BackendSelector, type BackendType } from '@/components/BackendSelector';
import type { User } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import type { Chat, Message, AgentStep } from '@/types/chat';
import { Sidebar } from '@/components/Sidebar';
import { ChatMessage } from '@/components/ChatMessage';
import { ChatInput } from '@/components/ChatInput';
import { LoadingSpinner } from '@/components/LoadingSpinner';
import { AgentSteps } from '@/components/AgentSteps';

interface ChatAppProps {
  user: User;
  onSignOut: () => void;
}

const REQUEST_TIMEOUT_MS = 150_000;

async function fetchWithTimeout(input: string, init: RequestInit, timeoutMs = REQUEST_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new Error('The request timed out. The agent team may still be finishing, try again.');
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

const FASTAPI_BASE = (import.meta.env.VITE_FASTAPI_URL as string | undefined)?.replace(/\/+$/, '');

export function ChatApp({ user, onSignOut }: ChatAppProps) {
  const [chats, setChats] = useState<Chat[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [agentSteps, setAgentSteps] = useState<AgentStep[]>([]);
  const [selectedModel, setSelectedModel] = useState('gpt-4o');
  const [backend, setBackend] = useState<BackendType>('crewai');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const loadChats = useCallback(async () => {
    const { data, error } = await supabase
      .from('chats')
      .select('*')
      .order('updated_at', { ascending: false });

    if (error) {
      setError('Failed to load chat history');
      return;
    }
    setChats(data as Chat[]);
  }, []);

  const loadMessages = useCallback(async (chatId: string) => {
    const { data, error } = await supabase
      .from('messages')
      .select('*')
      .eq('chat_id', chatId)
      .order('created_at', { ascending: true });

    if (error) {
      setError('Failed to load messages');
      return;
    }
    setMessages(data as Message[]);
  }, []);

  useEffect(() => {
    loadChats();
  }, [loadChats]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading, agentSteps]);

  const handleSelectChat = (chatId: string) => {
    setActiveChatId(chatId);
    setSidebarOpen(false);
    setError(null);
    setAgentSteps([]);
    loadMessages(chatId);
  };

  const handleNewChat = () => {
    setActiveChatId(null);
    setMessages([]);
    setSidebarOpen(false);
    setError(null);
    setAgentSteps([]);
  };

  const handleDeleteChat = async (chatId: string) => {
    const { error } = await supabase.from('chats').delete().eq('id', chatId);
    if (error) {
      setError('Failed to delete chat');
      return;
    }
    setChats((prev) => prev.filter((c) => c.id !== chatId));
    if (activeChatId === chatId) {
      setActiveChatId(null);
      setMessages([]);
    }
  };

  const handleExport = () => {
    if (messages.length === 0) return;

    const activeChat = chats.find((c) => c.id === activeChatId);
    const title = activeChat?.title ?? 'conversation';
    const date = new Date().toISOString().split('T')[0];

    let markdown = `# Super Agent — ${title}\n\n`;
    markdown += `_Exported on ${new Date().toLocaleString()}_\n\n---\n\n`;

    for (const msg of messages) {
      const isUser = msg.role === 'user';
      const sender = isUser ? '**You**' : '**Super Agent**';
      const timestamp = new Date(msg.created_at).toLocaleTimeString();
      markdown += `### ${sender}\n`;
      markdown += `_${timestamp}_\n\n`;
      markdown += `${msg.content}\n\n---\n\n`;
    }

    const blob = new Blob([markdown], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${title.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-${date}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const crewEndpoint = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/chat`;

  const authHeaders = async () => {
    const { data: sessionData } = await supabase.auth.getSession();
    const accessToken = sessionData.session?.access_token;
    return {
      Authorization: `Bearer ${accessToken ?? import.meta.env.VITE_SUPABASE_ANON_KEY}`,
      'Content-Type': 'application/json',
    };
  };

  // A crew run can take many minutes, so the backend returns a job id and we poll it.
  const startCrewJob = async (userMessage: string, history: { role: string; content: string }[]) => {
    const response = await fetchWithTimeout(
      crewEndpoint,
      {
        method: 'POST',
        headers: await authHeaders(),
        body: JSON.stringify({ message: userMessage, history, model: selectedModel }),
      },
      60_000,
    );

    const data = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(data?.error ?? `Request failed (${response.status})`);
    }
    if (typeof data?.reply === 'string') {
      return { jobId: null as string | null, reply: data.reply as string, steps: (data.steps ?? []) as AgentStep[] };
    }
    if (!data?.jobId) {
      throw new Error('The server did not return a job id');
    }
    return { jobId: String(data.jobId), reply: null as string | null, steps: [] as AgentStep[] };
  };

  const pollCrewJob = async (jobId: string) => {
    const response = await fetchWithTimeout(
      crewEndpoint,
      { method: 'POST', headers: await authHeaders(), body: JSON.stringify({ jobId }) },
      45_000,
    );
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(data?.error ?? `Request failed (${response.status})`);
    }
    return data as {
      state: string;
      reply?: string | null;
      steps?: AgentStep[];
      error?: string | null;
      progress?: { completed: number | null; total: number | null; current: string | null; current_agent: string | null } | null;
    };
  };

  const waitForCrewJob = async (jobId: string) => {
    const deadline = Date.now() + 15 * 60 * 1000;

    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 4000));

      let status;
      try {
        status = await pollCrewJob(jobId);
      } catch {
        continue; // transient network hiccup, keep waiting
      }

      if (status.progress) {
        const { completed, total, current_agent, current } = status.progress;
        setAgentSteps([
          {
            agent: current_agent ?? current ?? 'Agent team working',
            content: total ? `${completed ?? 0}/${total} tasks complete` : '',
            status: 'active',
          },
        ]);
      }

      if (status.state === 'COMPLETED' && typeof status.reply === 'string') {
        return { reply: status.reply, steps: status.steps ?? [] };
      }
      if (status.state === 'FAILED') {
        throw new Error(status.error ?? 'The agent team failed.');
      }
    }

    throw new Error('The agent team is still running after 15 minutes. Try a shorter request.');
  };

  // Optional local FastAPI crew backend (only used when VITE_FASTAPI_URL is set)
  const callFastApi = async (userMessage: string, history: { role: string; content: string }[]) => {
    const response = await fetchWithTimeout(`${FASTAPI_BASE}/api/run-crew`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: userMessage, model: selectedModel, history }),
    });

    if (!response.ok) {
      throw new Error(`FastAPI request failed (${response.status})`);
    }

    const data = await response.json();
    if (data?.status === 'success') {
      return { reply: String(data.result ?? ''), steps: [] as AgentStep[] };
    }
    throw new Error(data?.message ?? 'FastAPI returned an error');
  };

  const handleSend = async (text: string) => {
    setError(null);
    setLoading(true);
    setAgentSteps([]);

    let chatId = activeChatId;
    let currentMessages = messages;

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      if (!sessionData.session) {
        throw new Error('Your session has expired. Please sign in again.');
      }

      if (!chatId) {
        const title = text.length > 40 ? text.slice(0, 40) + '...' : text;
        const { data: chatData, error: chatError } = await supabase
          .from('chats')
          .insert({ title })
          .select()
          .single();

        if (chatError || !chatData) {
          console.error('Creating chat failed', chatError);
          throw new Error('Failed to create chat');
        }

        chatId = (chatData as Chat).id;
        setActiveChatId(chatId);
        loadChats();
      }

      const { data: userMsgData, error: userMsgError } = await supabase
        .from('messages')
        .insert({ chat_id: chatId, role: 'user', content: text })
        .select()
        .single();

      if (userMsgError || !userMsgData) {
        console.error('Saving user message failed', userMsgError);
        throw new Error('Failed to save message');
      }

      const userMsg = userMsgData as Message;
      currentMessages = [...currentMessages, userMsg];
      setMessages(currentMessages);

      // Honest progress: one working indicator until the backend replies
      setAgentSteps([{ agent: 'Your agent team is working', content: '', status: 'active' }]);

      // Conversation memory: everything except the message we just sent
      const history = currentMessages
        .slice(0, -1)
        .map((m) => ({ role: m.role, content: m.content }));

      let reply: string;
      let steps: AgentStep[] = [];

      if (backend === 'fastapi' && FASTAPI_BASE) {
        const result = await callFastApi(text, history);
        reply = result.reply;
        steps = result.steps;
      } else {
        const started = await startCrewJob(text, history);
        if (started.reply !== null) {
          reply = started.reply;
          steps = started.steps;
        } else {
          const finished = await waitForCrewJob(started.jobId as string);
          reply = finished.reply;
          steps = finished.steps;
        }
      }

      // Only show steps the backend actually reported
      setAgentSteps(steps.length > 0 ? steps.map((s) => ({ ...s, status: 'done' })) : []);

      const { data: aiMsgData, error: aiMsgError } = await supabase
        .from('messages')
        .insert({ chat_id: chatId, role: 'assistant', content: reply })
        .select()
        .single();

      if (aiMsgError || !aiMsgData) {
        console.error('Saving assistant message failed', aiMsgError);
        throw new Error('Failed to save assistant response');
      }

      setMessages((prev) => [...prev, aiMsgData as Message]);

      await supabase
        .from('chats')
        .update({ updated_at: new Date().toISOString() })
        .eq('id', chatId);

      loadChats();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Something went wrong';
      setError(msg);
      setAgentSteps([]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex h-screen bg-[#0f0f0f] text-neutral-100 overflow-hidden">
      <Sidebar
        chats={chats}
        activeChatId={activeChatId}
        onSelectChat={handleSelectChat}
        onNewChat={handleNewChat}
        onDeleteChat={handleDeleteChat}
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        userEmail={user.email ?? ''}
        onSignOut={onSignOut}
      />

      <main className="flex-1 flex flex-col min-w-0">
        <header className="flex items-center gap-3 px-4 py-3 border-b border-white/5 shrink-0">
          <button
            onClick={() => setSidebarOpen(true)}
            className="md:hidden text-neutral-400 hover:text-white transition-colors"
            aria-label="Open sidebar"
          >
            <Menu size={20} />
          </button>
          <div className="flex items-center gap-2 flex-1">
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-blue-500 to-emerald-500 flex items-center justify-center">
              <Sparkles size={15} className="text-white" />
            </div>
            <span className="text-sm font-semibold text-neutral-200">Super Agent</span>
          </div>

          <div className="flex items-center gap-2">
            {FASTAPI_BASE && (
              <BackendSelector value={backend} onChange={setBackend} disabled={loading} />
            )}
            <ModelSelector value={selectedModel} onChange={setSelectedModel} disabled={loading} />

            <button
              onClick={handleExport}
              disabled={messages.length === 0}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-neutral-300 text-xs font-medium transition-colors border border-white/5 disabled:opacity-30 disabled:cursor-not-allowed"
              aria-label="Export conversation"
              title="Export as Markdown"
            >
              <Download size={14} />
              <span className="hidden sm:inline">Export</span>
            </button>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto">
          <div className="max-w-3xl mx-auto py-4">
            {messages.length === 0 && !loading && (
              <div className="flex flex-col items-center justify-center py-20 px-4 text-center">
                <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-blue-500 to-emerald-500 flex items-center justify-center mb-4">
                  <Sparkles size={26} className="text-white" />
                </div>
                <h2 className="text-xl font-semibold text-neutral-200 mb-2">
                  Describe your project
                </h2>
                <p className="text-sm text-neutral-500 max-w-md">
                  Type a project description below and I'll help you analyze scope,
                  architecture, and development approach.
                </p>
              </div>
            )}

            {messages.map((msg) => (
              <ChatMessage key={msg.id} message={msg} />
            ))}

            {loading && <LoadingSpinner steps={agentSteps} />}

            {!loading && agentSteps.length > 0 && (
              <AgentSteps steps={agentSteps} />
            )}

            {error && (
              <div className="mx-4 md:mx-6 mb-4 flex items-center gap-2 px-4 py-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
                <AlertCircle size={16} className="shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>
        </div>

        <ChatInput onSend={handleSend} disabled={loading} />
      </main>
    </div>
  );
}
