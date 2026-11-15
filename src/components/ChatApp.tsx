import { useState, useEffect, useRef, useCallback } from 'react';
import { Menu, Sparkles, AlertCircle, Download } from 'lucide-react';
import { ModelSelector } from '@/components/ModelSelector';
import { ModeSelector } from '@/components/ModeSelector';
import { BackendSelector, type BackendType } from '@/components/BackendSelector';
import type { User } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import type { Chat, Message, AgentStep, ChatMode, Routing, RunProgress, ServerConfig } from '@/types/chat';
import { Sidebar } from '@/components/Sidebar';
import { ChatMessage } from '@/components/ChatMessage';
import { ChatInput } from '@/components/ChatInput';
import { ProgressPanel } from '@/components/ProgressPanel';

interface ChatAppProps {
  user: User;
  onSignOut: () => void;
}

const POLL_INTERVAL_MS = 4000;
const ADVANCED_MAX_MS = 30 * 60 * 1000;
const FASTAPI_BASE = (import.meta.env.VITE_FASTAPI_URL as string | undefined)?.replace(/\/+$/, '');

export function ChatApp({ user, onSignOut }: ChatAppProps) {
  const [chats, setChats] = useState<Chat[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedModel, setSelectedModel] = useState('gpt-4o');
  const [backend, setBackend] = useState<BackendType>('crewai');
  const [mode, setMode] = useState<ChatMode>('auto');
  const [routing, setRouting] = useState<Routing | null>(null);
  const [progress, setProgress] = useState<RunProgress | null>(null);
  const [streamingText, setStreamingText] = useState('');
  const [elapsed, setElapsed] = useState(0);
  const [config, setConfig] = useState<ServerConfig | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const jobIdRef = useRef<string | null>(null);
  const startedAtRef = useRef<number>(0);

  const crewEndpoint = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/chat`;

  const authHeaders = useCallback(async () => {
    const { data: sessionData } = await supabase.auth.getSession();
    const accessToken = sessionData.session?.access_token;
    return {
      Authorization: `Bearer ${accessToken ?? import.meta.env.VITE_SUPABASE_ANON_KEY}`,
      'Content-Type': 'application/json',
    };
  }, []);

  const loadChats = useCallback(async () => {
    const { data, error: err } = await supabase
      .from('chats')
      .select('*')
      .order('updated_at', { ascending: false });
    if (err) {
      setError('Failed to load chat history');
      return;
    }
    setChats(data as Chat[]);
  }, []);

  const loadMessages = useCallback(async (chatId: string) => {
    const { data, error: err } = await supabase
      .from('messages')
      .select('*')
      .eq('chat_id', chatId)
      .order('created_at', { ascending: true });
    if (err) {
      setError('Failed to load messages');
      return [];
    }
    setMessages(data as Message[]);
    return data as Message[];
  }, []);

  useEffect(() => {
    loadChats();
  }, [loadChats]);

  // Ask the backend what this deployment supports (fast mode needs a key).
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(crewEndpoint, {
          method: 'POST',
          headers: await authHeaders(),
          body: JSON.stringify({ action: 'config' }),
        });
        if (res.ok) setConfig((await res.json()) as ServerConfig);
      } catch {
        // configuration is optional; the UI works without it
      }
    })();
  }, [crewEndpoint, authHeaders]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading, streamingText, progress]);

  // Live elapsed timer while a request is in flight.
  useEffect(() => {
    if (!loading) return;
    const id = setInterval(() => {
      setElapsed((Date.now() - startedAtRef.current) / 1000);
    }, 500);
    return () => clearInterval(id);
  }, [loading]);

  const resetRun = useCallback(() => {
    setRouting(null);
    setProgress(null);
    setStreamingText('');
    setElapsed(0);
    jobIdRef.current = null;
  }, []);

  const handleSelectChat = async (chatId: string) => {
    setActiveChatId(chatId);
    setSidebarOpen(false);
    setError(null);
    resetRun();
    const loaded = await loadMessages(chatId);
    // A reply that is still being produced by the crew: reattach and keep watching.
    const running = loaded.find((m) => m.status === 'running' && m.job_id);
    if (running?.job_id) {
      setMode('advanced');
      setLoading(true);
      startedAtRef.current = Date.now();
      void pollAdvanced(chatId, running.job_id);
    }
  };

  const handleNewChat = () => {
    abortRef.current?.abort();
    setActiveChatId(null);
    setMessages([]);
    setSidebarOpen(false);
    setError(null);
    setLoading(false);
    resetRun();
  };

  const handleDeleteChat = async (chatId: string) => {
    const { error: err } = await supabase.from('chats').delete().eq('id', chatId);
    if (err) {
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

    let markdown = `# Super Agent — ${title}\n\n_Exported on ${new Date().toLocaleString()}_\n\n---\n\n`;
    for (const msg of messages) {
      const isUser = msg.role === 'user';
      const tag = msg.mode ? ` · ${msg.mode}` : '';
      const ms = msg.latency_ms ? ` · ${(msg.latency_ms / 1000).toFixed(1)}s` : '';
      markdown += `### ${isUser ? '**You**' : '**Super Agent**'}\n_${new Date(msg.created_at).toLocaleTimeString()}${tag}${ms}_\n\n${msg.content}\n\n---\n\n`;
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

  // ---- advanced runs: kickoff already returned a job id, so watch it ----
  const pollAdvanced = async (chatId: string, jobId: string) => {
    jobIdRef.current = jobId;
    const deadline = Date.now() + ADVANCED_MAX_MS;

    while (Date.now() < deadline) {
      if (abortRef.current?.signal.aborted) break;
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
      if (abortRef.current?.signal.aborted) break;

      let status: { state: string; reply?: string | null; error?: string | null; progress?: RunProgress | null } | null = null;
      try {
        const res = await fetch(crewEndpoint, {
          method: 'POST',
          headers: await authHeaders(),
          body: JSON.stringify({ jobId }),
        });
        if (!res.ok) continue;
        status = await res.json();
      } catch {
        continue; // transient, keep waiting
      }
      if (!status) continue;

      if (status.progress) setProgress(status.progress);

      if (status.state === 'COMPLETED' || status.state === 'CANCELLED') {
        await loadMessages(chatId);
        await loadChats();
        return;
      }
      if (status.state === 'FAILED') {
        await loadMessages(chatId);
        throw new Error(status.error ?? 'The agent team failed.');
      }
    }

    if (!abortRef.current?.signal.aborted) {
      throw new Error('The agent team is still running after 30 minutes. Try a narrower request.');
    }
  };

  // ---- fast mode: stream the answer as it is written ----
  const consumeStream = async (res: Response) => {
    const reader = res.body?.getReader();
    if (!reader) throw new Error('The server did not return a stream');
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const frames = buffer.split('\n\n');
      buffer = frames.pop() ?? '';

      for (const frame of frames) {
        const line = frame.trim();
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (!payload) continue;

        let event: Record<string, unknown>;
        try {
          event = JSON.parse(payload);
        } catch {
          continue;
        }

        if (event.type === 'routing' && event.routing) {
          setRouting(event.routing as Routing);
        } else if (event.type === 'delta' && typeof event.delta === 'string') {
          setStreamingText((prev) => prev + (event.delta as string));
        } else if (event.type === 'done') {
          if (typeof event.reply === 'string') setStreamingText(event.reply);
        }
      }
    }
  };

  const legacyFastApi = async (text: string, history: { role: string; content: string }[]) => {
    const res = await fetch(`${FASTAPI_BASE}/api/run-crew`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: text, model: selectedModel, history }),
    });
    if (!res.ok) throw new Error(`FastAPI request failed (${res.status})`);
    const data = await res.json();
    if (data?.status === 'success') return String(data.result ?? '');
    throw new Error(data?.message ?? 'FastAPI returned an error');
  };

  const handleSend = async (text: string) => {
    setError(null);
    setLoading(true);
    resetRun();
    startedAtRef.current = Date.now();
    setElapsed(0);

    const controller = new AbortController();
    abortRef.current = controller;

    let chatId = activeChatId;
    let currentMessages = messages;

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      if (!sessionData.session) throw new Error('Your session has expired. Please sign in again.');

      if (!chatId) {
        const title = text.length > 40 ? `${text.slice(0, 40)}...` : text;
        const { data: chatData, error: chatError } = await supabase
          .from('chats')
          .insert({ title })
          .select()
          .single();
        if (chatError || !chatData) throw new Error('Failed to create chat');
        chatId = (chatData as Chat).id;
        setActiveChatId(chatId);
        loadChats();
      }

      const { data: userMsgData, error: userMsgError } = await supabase
        .from('messages')
        .insert({ chat_id: chatId, role: 'user', content: text })
        .select()
        .single();
      if (userMsgError || !userMsgData) throw new Error('Failed to save message');

      const userMsg = userMsgData as Message;
      currentMessages = [...currentMessages, userMsg];
      setMessages(currentMessages);

      const history = currentMessages
        .slice(0, -1)
        .map((m) => ({ role: m.role, content: m.content }));

      if (backend === 'fastapi' && FASTAPI_BASE) {
        const reply = await legacyFastApi(text, history);
        await supabase.from('messages').insert({ chat_id: chatId, role: 'assistant', content: reply });
      } else {
        const wantStream = mode !== 'advanced';
        const res = await fetch(crewEndpoint, {
          method: 'POST',
          headers: await authHeaders(),
          signal: controller.signal,
          body: JSON.stringify({ message: text, chatId, history, mode, stream: wantStream }),
        });

        const contentType = res.headers.get('content-type') ?? '';

        if (res.ok && contentType.includes('text/event-stream')) {
          await consumeStream(res);
          await loadMessages(chatId);
        } else {
          const data = await res.json().catch(() => null);
          if (!res.ok) {
            throw new Error(data?.error ?? `Request failed (${res.status})`);
          }
          if (data?.routing) setRouting(data.routing as Routing);

          if (data?.state === 'STARTED' && data?.jobId) {
            jobIdRef.current = String(data.jobId);
            await pollAdvanced(chatId, String(data.jobId));
          } else {
            await loadMessages(chatId);
          }
        }
        await loadChats();
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        setError(null);
      } else {
        setError(err instanceof Error ? err.message : 'Something went wrong');
      }
      if (chatId) await loadMessages(chatId);
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      jobIdRef.current = null;
      setLoading(false);
      setStreamingText('');
    }
  };

  const handleStop = async () => {
    const jobId = jobIdRef.current;
    abortRef.current?.abort();
    setLoading(false);
    setStreamingText('');
    setProgress(null);

    if (jobId) {
      try {
        await fetch(crewEndpoint, {
          method: 'POST',
          headers: await authHeaders(),
          body: JSON.stringify({ action: 'stop', jobId }),
        });
      } catch {
        // stopping locally already worked; the crew may finish in the background
      }
      if (activeChatId) await loadMessages(activeChatId);
    }
  };

  const fastAvailable = config ? config.fast.configured : true;

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
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-blue-500 to-emerald-500 flex items-center justify-center shrink-0">
              <Sparkles size={15} className="text-white" />
            </div>
            <span className="text-sm font-semibold text-neutral-200">Super Agent</span>
            {config?.fast.configured && (
              <span className="hidden md:inline text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 font-medium">
                {config.fast.model}
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            {FASTAPI_BASE && <BackendSelector value={backend} onChange={setBackend} disabled={loading} />}
            <ModeSelector value={mode} onChange={setMode} disabled={loading} fastAvailable={fastAvailable} />
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
                <h2 className="text-xl font-semibold text-neutral-200 mb-2">Ask anything</h2>
                <p className="text-sm text-neutral-500 max-w-md">
                  Questions and code get a fast, direct answer. Architecture, audits and
                  business research go to the full agent team automatically.
                </p>
              </div>
            )}

            {messages.map((msg) => (
              <ChatMessage key={msg.id} message={msg} />
            ))}

            {loading && (
              <ProgressPanel
                routing={routing}
                progress={progress}
                elapsedSeconds={elapsed}
                streaming={streamingText.length > 0}
                onStop={handleStop}
              />
            )}

            {loading && streamingText.length > 0 && (
              <ChatMessage
                message={{
                  id: 'streaming',
                  chat_id: activeChatId ?? '',
                  role: 'assistant',
                  content: streamingText,
                  created_at: new Date().toISOString(),
                  mode: 'fast',
                  status: 'running',
                }}
              />
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

        <ChatInput onSend={handleSend} onStop={handleStop} disabled={loading} />
      </main>
    </div>
  );
}

export type { AgentStep };
