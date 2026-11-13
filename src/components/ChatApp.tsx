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

  const callApi = async (userMessage: string, history: { role: string; content: string }[]) => {
    if (backend === 'fastapi') {
      return callFastApi(userMessage, history);
    }
    return callCrewAi(userMessage, history);
  };

  const callFastApi = async (userMessage: string, _history: { role: string; content: string }[]) => {
    const fastApiUrl = `${import.meta.env.VITE_FASTAPI_URL ?? 'http://localhost:8000'}/api/run-crew`;
    const response = await fetch(fastApiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ prompt: userMessage, model: selectedModel }),
    });

    if (!response.ok) {
      throw new Error(`FastAPI request failed (${response.status})`);
    }

    const data = await response.json();
    if (data.status === 'success') {
      return { reply: data.result as string, steps: [] as AgentStep[] };
    }
    throw new Error(data.message ?? 'FastAPI returned an error');
  };

  const callCrewAi = async (userMessage: string, history: { role: string; content: string }[]) => {
    const { data: sessionData } = await supabase.auth.getSession();
    const accessToken = sessionData.session?.access_token;

    const apiUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/chat`;
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken ?? import.meta.env.VITE_SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ message: userMessage, history, model: selectedModel }),
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => null);
      throw new Error(errData?.error ?? `Request failed (${response.status})`);
    }

    const data = await response.json();
    if (!data || typeof data.reply !== 'string') {
      throw new Error('Invalid response from server');
    }
    return {
      reply: data.reply as string,
      steps: (data.steps ?? []) as AgentStep[],
    };
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

      // Show initial agent steps while processing
      setAgentSteps([
        { agent: 'Analyzing your project description', content: '', status: 'active' },
        { agent: 'Delegating to specialist agents', content: '', status: 'pending' },
        { agent: 'Synthesizing recommendations', content: '', status: 'pending' },
      ]);

      // Simulate step progression while waiting for the response
      const stepTimer1 = setTimeout(() => {
        setAgentSteps((prev) => prev.map((s, i) =>
          i === 0 ? { ...s, status: 'done', content: 'Project description parsed and analyzed.' } :
          i === 1 ? { ...s, status: 'active' } : s
        ));
      }, 3000);

      const stepTimer2 = setTimeout(() => {
        setAgentSteps((prev) => prev.map((s, i) =>
          i === 1 ? { ...s, status: 'done', content: 'Specialist agents have completed their analysis.' } :
          i === 2 ? { ...s, status: 'active' } : s
        ));
      }, 8000);

      const history = currentMessages.map((m) => ({ role: m.role, content: m.content }));
      const { reply, steps } = await callApi(text, history);

      clearTimeout(stepTimer1);
      clearTimeout(stepTimer2);

      // Use real steps from the backend if available, otherwise mark all as done
      if (steps && steps.length > 0) {
        setAgentSteps(steps.map((s) => ({ ...s, status: 'done' })));
      } else {
        setAgentSteps((prev) => prev.map((s) => ({
          ...s,
          status: 'done',
          content: s.content || 'Complete',
        })));
      }

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
            <BackendSelector value={backend} onChange={setBackend} disabled={loading} />
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
