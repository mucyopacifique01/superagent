// Chat edge function: starts a CrewAI kickoff and tracks it in chat_jobs.
// The browser polls with { jobId }; the assistant reply is saved here exactly once.
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const DAILY_MESSAGE_LIMIT = Number(Deno.env.get("DAILY_MESSAGE_LIMIT") ?? "80");
const MAX_HISTORY_TURNS = 12;
const MAX_JOB_AGE_MS = 2 * 60 * 60 * 1000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface AgentStep {
  agent: string;
  content: string;
  status: "pending" | "active" | "done";
}

interface HistoryTurn {
  role: string;
  content: string;
}

interface Caller {
  id: string;
  token: string;
}

interface Progress {
  completed: number | null;
  total: number | null;
  current: string | null;
  current_agent: string | null;
  elapsed_seconds: number | null;
}

interface ChatJob {
  id: string;
  chat_id: string;
  crew_job_id: string | null;
  status: string;
  progress: Progress | null;
  steps: AgentStep[] | null;
  result: string | null;
  error: string | null;
  reply_saved: boolean;
  assistant_message_id: string | null;
  created_at: string;
}

interface PollResult {
  state: string;
  progress?: Progress | null;
  reply?: string;
  steps?: AgentStep[];
  error?: string | null;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function getCrewConfig() {
  const url = Deno.env.get("CREWAI_URL")?.replace(/\/+$/, "");
  const token = Deno.env.get("CREWAI_TOKEN");
  if (!url || !token) {
    throw new Error("CrewAI is not configured: CREWAI_URL and CREWAI_TOKEN must be set");
  }
  return { url, token };
}

// Verify the caller's Supabase session so an anonymous visitor can't spend crew credits.
async function getCaller(req: Request): Promise<Caller | null> {
  const header = req.headers.get("Authorization") ?? "";
  const token = header.replace(/^Bearer\s+/i, "").trim();
  if (!token || token === SUPABASE_ANON_KEY) return null;

  const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { Authorization: `Bearer ${token}`, apikey: SUPABASE_ANON_KEY },
  });
  if (!res.ok) return null;
  const user = await res.json().catch(() => null);
  if (!user?.id) return null;
  return { id: String(user.id), token };
}

// Calls PostgREST as the caller so row level security applies to every read and write.
function rest(caller: Caller, path: string, init: { method: string; body?: unknown; prefer?: string }) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: init.method,
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${caller.token}`,
      "Content-Type": "application/json",
      ...(init.prefer ? { Prefer: init.prefer } : {}),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
}

async function readRows<T>(res: Response): Promise<T[]> {
  if (!res.ok) return [];
  const data = await res.json().catch(() => []);
  return Array.isArray(data) ? (data as T[]) : [];
}

// Count the caller's own messages sent today (RLS scopes the count to their chats).
async function messagesSentToday(caller: Caller): Promise<number> {
  const startOfDay = new Date();
  startOfDay.setUTCHours(0, 0, 0, 0);
  const url =
    `${SUPABASE_URL}/rest/v1/messages?select=id&role=eq.user` +
    `&created_at=gte.${encodeURIComponent(startOfDay.toISOString())}`;

  const res = await fetch(url, {
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${caller.token}`,
      Prefer: "count=exact",
      Range: "0-0",
    },
  });
  if (!res.ok) return 0;
  const total = res.headers.get("content-range")?.split("/")?.[1];
  const parsed = Number(total);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatHistory(history: HistoryTurn[]): string {
  return history
    .filter((turn) => turn && typeof turn.content === "string" && turn.content.trim().length > 0)
    .slice(-MAX_HISTORY_TURNS)
    .map((turn) => `${turn.role === "assistant" ? "Agent" : "User"}: ${turn.content.trim()}`)
    .join("\n\n");
}

async function createJob(caller: Caller, chatId: string): Promise<ChatJob | null> {
  const rows = await readRows<ChatJob>(
    await rest(caller, "chat_jobs", {
      method: "POST",
      body: { chat_id: chatId, status: "STARTING" },
      prefer: "return=representation",
    }),
  );
  return rows[0] ?? null;
}

async function loadJob(caller: Caller, jobId: string): Promise<ChatJob | null> {
  const rows = await readRows<ChatJob>(
    await rest(caller, `chat_jobs?id=eq.${jobId}&select=*`, { method: "GET" }),
  );
  return rows[0] ?? null;
}

async function updateJob(
  caller: Caller,
  jobId: string,
  patch: Record<string, unknown>,
  extraFilter = "",
): Promise<ChatJob[]> {
  return readRows<ChatJob>(
    await rest(caller, `chat_jobs?id=eq.${jobId}${extraFilter}`, {
      method: "PATCH",
      body: { ...patch, updated_at: new Date().toISOString() },
      prefer: "return=representation",
    }),
  );
}

async function insertAssistantMessage(caller: Caller, chatId: string, content: string) {
  const rows = await readRows<{ id: string }>(
    await rest(caller, "messages", {
      method: "POST",
      body: { chat_id: chatId, role: "assistant", content },
      prefer: "return=representation",
    }),
  );
  return rows[0] ?? null;
}

async function touchChat(caller: Caller, chatId: string) {
  await rest(caller, `chats?id=eq.${chatId}`, {
    method: "PATCH",
    body: { updated_at: new Date().toISOString() },
  });
}

async function kickoffCrew(
  crew: { url: string; token: string },
  message: string,
  model: string,
  history: HistoryTurn[],
): Promise<string> {
  const res = await fetch(`${crew.url}/kickoff`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${crew.token}`,
    },
    body: JSON.stringify({
      inputs: {
        project_description: message,
        conversation_history: formatHistory(history),
        model,
      },
    }),
  });
  if (!res.ok) {
    throw new Error(`Agent request failed (${res.status})`);
  }

  const data = await res.json().catch(() => null);
  const kickoffId =
    typeof data === "string" ? data : data?.kickoff_id ?? data?.uuid ?? data?.task_id ?? data?.id;
  if (!kickoffId) {
    throw new Error("The agent backend did not return a job id");
  }
  return String(kickoffId);
}

async function fetchCrewStatus(
  crew: { url: string; token: string },
  crewJobId: string,
): Promise<Record<string, unknown> | null> {
  const res = await fetch(`${crew.url}/status/${encodeURIComponent(crewJobId)}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${crew.token}` },
  });
  if (!res.ok) return null;
  const data = await res.json().catch(() => null);
  return data && typeof data === "object" ? (data as Record<string, unknown>) : null;
}

function completedResult(job: ChatJob): PollResult {
  return {
    state: "COMPLETED",
    reply: job.result ?? "",
    steps: job.steps ?? [],
    progress: job.progress,
    error: null,
  };
}

function failedResult(job: ChatJob): PollResult {
  return {
    state: "FAILED",
    error: job.error ?? "The agent team failed.",
    progress: job.progress,
  };
}

// Saves the reply once: the reply_saved flag is claimed atomically before the message is inserted.
async function deliverReply(caller: Caller, job: ChatJob): Promise<PollResult> {
  if (job.assistant_message_id) return completedResult(job);
  if (job.result === null) return { state: "RUNNING", progress: job.progress };

  const claimed = await updateJob(caller, job.id, { reply_saved: true }, "&reply_saved=is.false");
  if (claimed.length === 0) return { state: "RUNNING", progress: job.progress };

  const message = await insertAssistantMessage(caller, job.chat_id, job.result);
  if (!message) {
    await updateJob(caller, job.id, { reply_saved: false });
    return { state: "RUNNING", progress: job.progress };
  }

  await updateJob(caller, job.id, { assistant_message_id: message.id });
  await touchChat(caller, job.chat_id);
  return completedResult({ ...job, assistant_message_id: message.id });
}

async function pollJob(
  caller: Caller,
  jobId: string,
  crew: { url: string; token: string },
): Promise<PollResult | null> {
  const job = await loadJob(caller, jobId);
  if (!job) return null;

  if (job.status === "SUCCESS") return deliverReply(caller, job);
  if (job.status === "FAILED" || job.status === "REVOKED") return failedResult(job);

  if (Date.now() - Date.parse(job.created_at) > MAX_JOB_AGE_MS) {
    const reason = "The agent team did not finish in time.";
    await updateJob(caller, job.id, { status: "FAILED", error: reason });
    return { state: "FAILED", error: reason, progress: job.progress };
  }

  if (!job.crew_job_id) return { state: "RUNNING", progress: job.progress };

  const remote = await fetchCrewStatus(crew, job.crew_job_id);
  if (!remote) {
    return { state: job.status === "PENDING" ? "PENDING" : "RUNNING", progress: job.progress };
  }

  const remoteState = String(remote.state ?? "").toUpperCase();
  const progress = normalizeProgress(remote.progress) ?? job.progress;

  if (remoteState === "SUCCESS" || remoteState === "COMPLETED" || remoteState === "FINISHED") {
    const { reply, steps } = extractResult(remote);
    const [updated] = await updateJob(caller, job.id, { status: "SUCCESS", result: reply, steps, progress });
    if (!updated) return { state: "RUNNING", progress };
    return deliverReply(caller, updated);
  }

  if (remoteState === "FAILED" || remoteState === "ERROR" || remoteState === "NOT FOUND") {
    const reason =
      typeof remote.error === "string" && remote.error ? remote.error : "The agent team failed.";
    await updateJob(caller, job.id, { status: "FAILED", error: reason, progress });
    return { state: "FAILED", error: reason, progress };
  }

  if (remoteState === "REVOKED") {
    const reason = "The agent task was cancelled.";
    await updateJob(caller, job.id, { status: "REVOKED", error: reason, progress });
    return { state: "FAILED", error: reason, progress };
  }

  const status = remoteState === "PENDING" ? "PENDING" : "RUNNING";
  await updateJob(caller, job.id, { status, progress });
  return { state: status, progress };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const body = await req.json().catch(() => null);

    const caller = await getCaller(req);
    if (!caller) {
      return json({ error: "Your session has expired. Please sign in again." }, 401);
    }

    const crew = getCrewConfig();

    // Status check: { jobId } returns the job's current state; the browser polls this.
    const jobId = typeof body?.jobId === "string" ? body.jobId.trim() : "";
    if (jobId) {
      if (!UUID_PATTERN.test(jobId)) return json({ error: "Job not found" }, 404);
      const result = await pollJob(caller, jobId, crew);
      if (!result) return json({ error: "Job not found" }, 404);
      return json(result);
    }

    const message = body?.message;
    const model = typeof body?.model === "string" ? body.model : "gpt-4o";
    const history: HistoryTurn[] = Array.isArray(body?.history) ? body.history : [];
    const chatId = typeof body?.chatId === "string" ? body.chatId.trim() : "";

    if (!message || typeof message !== "string") {
      return json({ error: "Message is required" }, 400);
    }
    if (!UUID_PATTERN.test(chatId)) {
      return json({ error: "Chat is required" }, 400);
    }

    const used = await messagesSentToday(caller);
    if (used >= DAILY_MESSAGE_LIMIT) {
      return json(
        { error: `You've reached today's limit of ${DAILY_MESSAGE_LIMIT} messages. Try again tomorrow.` },
        429,
      );
    }

    const job = await createJob(caller, chatId);
    if (!job) {
      return json({ error: "Chat not found" }, 404);
    }

    try {
      const crewJobId = await kickoffCrew(crew, message, model, history);
      await updateJob(caller, job.id, { crew_job_id: crewJobId, status: "PENDING" });
      return json({ jobId: job.id, state: "PENDING" });
    } catch (err) {
      const reason = err instanceof Error ? err.message : "Agent request failed";
      await updateJob(caller, job.id, { status: "FAILED", error: reason });
      return json({ error: reason }, 502);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal server error";

    if (message.includes("CrewAI is not configured")) {
      return json(
        { error: "The agent backend isn't connected yet. Add CREWAI_TOKEN to the project secrets." },
        503,
      );
    }

    return json({ error: message }, 500);
  }
});

function normalizeProgress(value: unknown): Progress | null {
  if (!value || typeof value !== "object") return null;
  const p = value as Record<string, unknown>;
  return {
    completed: typeof p.completed === "number" ? p.completed : null,
    total: typeof p.total === "number" ? p.total : null,
    current: typeof p.current === "string" ? p.current : null,
    current_agent: typeof p.current_agent === "string" ? p.current_agent : null,
    elapsed_seconds: typeof p.duration_seconds === "number" ? Math.round(p.duration_seconds) : null,
  };
}

function toSteps(tasks: unknown[]): AgentStep[] {
  return tasks.map((t, i) => {
    if (typeof t === "string") {
      return { agent: `Task ${i + 1}`, content: t, status: "done" as const };
    }
    const task = t as Record<string, unknown>;
    const role = String(task?.agent ?? task?.role ?? `Task ${i + 1}`);
    const content = String(task?.output ?? task?.result ?? task?.description ?? JSON.stringify(t));
    return { agent: role, content, status: "done" as const };
  });
}

function extractResult(data: unknown): { reply: string; steps: AgentStep[] } {
  if (typeof data === "string") {
    return { reply: data, steps: [] };
  }
  if (typeof data !== "object" || data === null) {
    return { reply: JSON.stringify(data), steps: [] };
  }

  const obj = data as Record<string, unknown>;

  if (Array.isArray(obj.tasks_output)) {
    const steps = toSteps(obj.tasks_output);
    const reply = steps.map((s) => `**${s.agent}:** ${s.content}`).join("\n\n");
    return { reply, steps };
  }

  if (obj.result && typeof obj.result === "object") {
    return extractTaskOutput(obj.result);
  }
  if (typeof obj.result === "string" && obj.result.trim()) return { reply: obj.result, steps: [] };
  if (typeof obj.result_json === "string" && obj.result_json.trim()) {
    return { reply: obj.result_json, steps: [] };
  }
  if (obj.result_json && typeof obj.result_json === "object") {
    return extractTaskOutput(obj.result_json);
  }
  if (Array.isArray(obj.results) && obj.results.length > 0) {
    const steps = toSteps(obj.results);
    const reply = steps.map((s) => `**${s.agent}:** ${s.content}`).join("\n\n");
    return { reply, steps };
  }
  if (typeof obj.output === "string") return { reply: obj.output, steps: [] };
  if (typeof obj.final_output === "string") return { reply: obj.final_output, steps: [] };

  return { reply: JSON.stringify(obj, null, 2), steps: [] };
}

function extractTaskOutput(result: unknown): { reply: string; steps: AgentStep[] } {
  if (typeof result === "string") return { reply: result, steps: [] };
  if (typeof result === "object" && result !== null) {
    const obj = result as Record<string, unknown>;
    if (Array.isArray(obj.tasks_output)) {
      const steps = toSteps(obj.tasks_output);
      const reply = steps.map((s) => `**${s.agent}:** ${s.content}`).join("\n\n");
      return { reply, steps };
    }
    if (typeof obj.raw === "string") return { reply: obj.raw, steps: [] };
    if (typeof obj.output === "string") return { reply: obj.output, steps: [] };
  }
  return { reply: JSON.stringify(result, null, 2), steps: [] };
}
