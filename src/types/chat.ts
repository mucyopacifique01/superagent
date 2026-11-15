export interface Chat {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
}

export type MessageMode = 'fast' | 'advanced';

export type MessageStatus = 'running' | 'complete' | 'cancelled' | 'failed';

export interface Message {
  id: string;
  chat_id: string;
  role: 'user' | 'assistant';
  content: string;
  created_at: string;
  mode?: MessageMode | null;
  category?: string | null;
  status?: MessageStatus | null;
  latency_ms?: number | null;
  steps?: AgentStep[] | null;
  job_id?: string | null;
}

export interface AgentStep {
  agent: string;
  content: string;
  status: 'pending' | 'active' | 'done';
}

export type ChatMode = 'auto' | 'fast' | 'advanced';

export interface Routing {
  mode: MessageMode;
  category: 'simple' | 'technical' | 'coding' | 'research' | 'complex';
  reason: string;
  forced: boolean;
}

export interface RunProgress {
  completed: number | null;
  total: number | null;
  current: string | null;
  current_agent: string | null;
  elapsed_seconds: number | null;
  eta_seconds: number | null;
}

export interface ServerConfig {
  modes: ChatMode[];
  fast: { configured: boolean; model: string; deepModel: string; baseUrl: string };
  advanced: { configured: boolean };
  dailyLimit: number;
}
