// Chat edge function — routes each request to the fastest pipeline that can answer it.
//
//   POST { message, chatId, history, mode }  -> classify, then answer
//        fast:     streamed OpenAI-compatible completion (GROQ_API_KEY)
//        advanced: the existing 6-task CrewAI crew, job id + polling
//   POST { jobId }                            -> poll an advanced run
//   POST { action: "stop", jobId }            -> cancel a run
//   POST { action: "config" }                 -> what this deployment supports
//
// Auth, RLS and the daily cap are unchanged: every write uses the caller's JWT.
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const DAILY_MESSAGE_LIMIT = Number(Deno.env.get("DAILY_MESSAGE_LIMIT") ?? "80");
const MAX_HISTORY_TURNS = 10;
const HISTORY_CHAR_BUDGET = 6000;

// Fast path: any OpenAI-compatible endpoint. Defaults to Groq.
const FAST_API_KEY = Deno.env.get("GROQ_API_KEY") ?? Deno.env.get("FAST_LLM_API_KEY") ?? "";
const FAST_BASE_URL = (Deno.env.get("FAST_LLM_BASE_URL") ?? "https://api.groq.com/openai/v1").replace(/\/+$/, "");
const FAST_MODEL = Deno.env.get("FAST_LLM_MODEL") ?? "openai/gpt-oss-120b";
const FAST_MODEL_DEEP = Deno.env.get("FAST_LLM_MODEL_DEEP") ?? "openai/gpt-oss-120b";
const FAST_MAX_TOKENS = Number(Deno.env.get("FAST_MAX_TOKENS") ?? "900");
const FAST_TIMEOUT_MS = Number(Deno.env.get("FAST_TIMEOUT_MS") ?? "60000");

type Mode = "fast" | "advanced";
type Category = "simple" | "technical" | "coding" | "research" | "complex";

interface Routing {
  mode: Mode;
  category: Category;
  reason: string;
  forced: boolean;
}

interface HistoryTurn {
  role: string;
  content: string;
}

interface Caller {
  id: string;
  token: string;
}

interface AgentStep {
  agent: string;
  content: string;
  status: "pending" | "active" | "done";
}

const enc = new TextEncoder();

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

// ---------------------------------------------------------------- persistence

async function restInsert(caller: Caller, row: Record<string, unknown>) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/messages?select=*`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${caller.token}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify(row),
  });
  const text = await res.text();
  if (!res.ok) {
    return { row: null, status: res.status, error: text.slice(0, 300) };
  }
  const rows = JSON.parse(text || "[]");
  return { row: Array.isArray(rows) ? rows[0] ?? null : null, status: res.status, error: null };
}

async function restUpdate(caller: Caller, id: string, patch: Record<string, unknown>) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/messages?id=eq.${encodeURIComponent(id)}&select=*`, {
    method: "PATCH",
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${caller.token}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify(patch),
  });
  const text = await res.text();
  if (!res.ok) return null;
  const rows = JSON.parse(text || "[]");
  return Array.isArray(rows) ? rows[0] ?? null : null;
}

async function findByJobId(caller: Caller, jobId: string) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/messages?select=*&job_id=eq.${encodeURIComponent(jobId)}&limit=1`,
    { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${caller.token}` } },
  );
  if (!res.ok) return null;
  const rows = await res.json().catch(() => []);
  return Array.isArray(rows) ? rows[0] ?? null : null;
}

async function touchChat(caller: Caller, chatId: string) {
  await fetch(`${SUPABASE_URL}/rest/v1/chats?id=eq.${encodeURIComponent(chatId)}`, {
    method: "PATCH",
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${caller.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ updated_at: new Date().toISOString() }),
  }).catch(() => null);
}

// --------------------------------------------------------------- classifier
// Deterministic and instant: no model call, so routing never adds latency.

const RESEARCH_HINTS = [
  "market research", "competitor", "competitors", "business analysis", "business plan",
  "feasibility", "industry analysis", "pricing strategy", "go-to-market", "gtm",
  "swot", "benchmark", "survey", "investment memo", "due diligence", "landscape",
  "market size", "tam", "sam", "som", "value proposition", "revenue model",
];

const COMPLEX_HINTS = [
  "architecture", "system design", "security audit", "threat model", "threat modeling",
  "deployment plan", "deploy", "kubernetes", "ci/cd", "end-to-end", "end to end",
  "full-stack", "full stack", "migration plan", "migrate", "roadmap", "mvp",
  "technical spec", "specification", "proposal", "grant", "budget", "scalab",
  "microservices", "multi-tenant", "disaster recovery", "compliance", "audit",
  "step by step plan", "project plan", "sprint plan", "production ready",
];

const RESEARCH_WORDS = /\b(competitive|competition|competitors?|industry|industries|market|markets|trends?|opportunit(?:y|ies)|outlook|growth|startups?|landscape|positioning|demand|adoption|sector)\b/g;
const RESEARCH_PHRASES = /\b(summarize|summarise|analyze|analyse|compare)\b[^.!?]{0,40}\b(market|industry|sector|competitors?|competition|business|startups?)\b/;

const CODING_HINTS = [
  "```", "function", "bug", "error", "exception", "traceback", "stack trace", "compile",
  "typescript", "javascript", "python", "react", "sql", "regex", "api endpoint",
  "dockerfile", "git ", "npm ", "pip ", "refactor", "unit test", "null pointer",
  "segfault", "crash", "install",
];

const TECHNICAL_HINTS = [
  "explain", "how does", "how do", "how can", "what is", "what are", "why does",
  "difference between", "compare", "vs ", "versus", "define", "meaning of",
  "how to", "tutorial", "example of",
];

function hits(text: string, list: string[]) {
  return list.filter((needle) => text.includes(needle));
}

function classify(message: string, forced: string | undefined): Routing {
  const text = message.toLowerCase();
  const length = message.trim().length;
  const codeBlock = (message.match(/```/g) ?? []).length >= 2;
  const numbered = (message.match(/^\s*(?:\d+[.)]|[-*])\s+/gm) ?? []).length;

  if (forced === "fast" || forced === "advanced") {
    return {
      mode: forced,
      category: forced === "fast" ? "simple" : "complex",
      reason: forced === "fast" ? "Fast mode selected" : "Advanced mode selected",
      forced: true,
    };
  }

  const research = [
    ...hits(text, RESEARCH_HINTS),
    ...(text.match(RESEARCH_WORDS) ?? []),
    ...(RESEARCH_PHRASES.test(text) ? ["analysis request"] : []),
  ];
  const complex = hits(text, COMPLEX_HINTS);
  const coding = hits(text, CODING_HINTS);
  const technical = hits(text, TECHNICAL_HINTS);

  // Complex multi-step project: long brief, several deliverables, or heavy keywords
  const heavy = complex.length >= 2 || (complex.length >= 1 && (length > 400 || numbered >= 3));
  if (length > 1400 || numbered >= 5 || heavy) {
    return {
      mode: "advanced",
      category: "complex",
      reason: complex.length ? `Long multi-step brief (${complex.slice(0, 2).join(", ")})` : "Long multi-step brief",
      forced: false,
    };
  }

  // Research / business analysis: the crew's research task is the only thing that helps
  if (research.length >= 1 && !(length < 180 && technical.length >= 1 && coding.length === 0 && research.length === 1 && text.includes("what is"))) {
    return {
      mode: "advanced",
      category: "research",
      reason: `Research question (${research.slice(0, 2).join(", ")})`,
      forced: false,
    };
  }

  if (codeBlock || coding.length >= 1) {
    return {
      mode: "fast",
      category: "coding",
      reason: codeBlock ? "Code in the message" : `Coding question (${coding.slice(0, 2).join(", ")})`,
      forced: false,
    };
  }

  if (technical.length >= 1 || length > 200) {
    return {
      mode: "fast",
      category: "technical",
      reason: technical.length ? `Explanation request (${technical.slice(0, 2).join(", ")})` : "Single focused question",
      forced: false,
    };
  }

  return { mode: "fast", category: "simple", reason: "Short conversational question", forced: false };
}

// ------------------------------------------------------------- fast pipeline

const FAST_SYSTEM_PROMPT = `You are Super Agent, a senior software engineer and analyst.

Answer the user's actual question in the first sentence. Never open with pleasantries,
never restate the question, never describe what you are about to do.

Rules:
- Default length: 60-120 words. Go longer only when the user asks for detail, or when
  the question truly needs steps, code, or a comparison.
- Always write at least one full sentence with a brief reason or context. Never answer
  with a bare fact, a single word, or a fragment.
- Professional, plain language. Short paragraphs, bullets for steps, fenced code with a
  language tag for code.
- Be factually accurate. If something depends on an unknown (a version, a price, a
  local detail), say so in one clause instead of inventing it.
- If the request would genuinely need deep research, a security audit, or a full
  architecture review, answer the part you can and say in one line that Advanced
  Research mode covers the rest.`;

function buildFastMessages(message: string, history: HistoryTurn[], deep: boolean) {
  const clean = history
    .filter((turn) => turn && typeof turn.content === "string" && turn.content.trim())
    .slice(-MAX_HISTORY_TURNS);

  let budget = HISTORY_CHAR_BUDGET;
  const kept: { role: string; content: string }[] = [];
  for (let i = clean.length - 1; i >= 0; i -= 1) {
    const turn = clean[i];
    const content = turn.content.trim().slice(0, 4000);
    if (content.length > budget) break;
    budget -= content.length;
    kept.unshift({ role: turn.role === "assistant" ? "assistant" : "user", content });
  }

  const system = deep
    ? `${FAST_SYSTEM_PROMPT}\n- This is a coding task: give working code first, then at most three lines of explanation.`
    : FAST_SYSTEM_PROMPT;

  return [{ role: "system", content: system }, ...kept, { role: "user", content: message }];
}

async function saveFastReply(
  caller: Caller,
  opts: { chatId?: string; content: string; routing: Routing; latencyMs: number; status: string; model: string },
) {
  if (!opts.chatId) return null;
  const inserted = await restInsert(caller, {
    chat_id: opts.chatId,
    role: "assistant",
    content: opts.content,
    mode: "fast",
    category: opts.routing.category,
    status: opts.status,
    latency_ms: opts.latencyMs,
    steps: [{ agent: opts.model, content: "", status: "done" }],
  });
  return inserted.row;
}

async function handleFast(
  req: Request,
  caller: Caller,
  opts: { message: string; history: HistoryTurn[]; routing: Routing; chatId?: string; stream: boolean },
) {
  if (!FAST_API_KEY) {
    return json(
      {
        error: "Fast mode is not configured on this deployment. Add the GROQ_API_KEY secret, or switch to Advanced.",
        code: "FAST_NOT_CONFIGURED",
      },
      503,
    );
  }

  const startedAt = Date.now();
  const deep = opts.routing.category === "coding";
  const model = deep ? FAST_MODEL_DEEP : FAST_MODEL;

  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), FAST_TIMEOUT_MS);
  const onClientAbort = () => abort.abort();
  req.signal.addEventListener?.("abort", onClientAbort);

  let upstream: Response;
  try {
    upstream = await fetch(`${FAST_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${FAST_API_KEY}` },
      body: JSON.stringify({
        model,
        messages: buildFastMessages(opts.message, opts.history, deep),
        temperature: 0.3,
        max_tokens: FAST_MAX_TOKENS,
        stream: opts.stream,
      }),
      signal: abort.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    req.signal.removeEventListener?.("abort", onClientAbort);
    const reason = abort.signal.aborted ? "Fast model timed out" : "Could not reach the fast model";
    return json({ error: `${reason}. ${err instanceof Error ? err.message : ""}`.trim() }, 502);
  }

  if (!upstream.ok) {
    clearTimeout(timer);
    req.signal.removeEventListener?.("abort", onClientAbort);
    const detail = await upstream.text().catch(() => "");
    return json(
      { error: `Fast model error (${upstream.status})`, details: detail.slice(0, 400), code: "FAST_PROVIDER_ERROR" },
      502,
    );
  }

  // Non-streaming: collect, save once, return.
  if (!opts.stream || !upstream.body) {
    const payload = await upstream.json().catch(() => null);
    clearTimeout(timer);
    req.signal.removeEventListener?.("abort", onClientAbort);
    const reply = String(payload?.choices?.[0]?.message?.content ?? "").trim();
    if (!reply) {
      return json({ error: "The fast model returned an empty answer." }, 502);
    }
    const latencyMs = Date.now() - startedAt;
    const row = await saveFastReply(caller, {
      chatId: opts.chatId,
      content: reply,
      routing: opts.routing,
      latencyMs,
      status: "complete",
      model,
    });
    if (opts.chatId) await touchChat(caller, opts.chatId);
    return json({
      state: "COMPLETED",
      reply,
      messageId: row?.id ?? null,
      mode: "fast",
      category: opts.routing.category,
      latencyMs,
      model,
      routing: opts.routing,
    });
  }

  // Streaming: forward deltas as SSE, save the finished answer once.
  const decoder = new TextDecoder();
  let assistant = "";
  let clientGone = false;

  const body = new ReadableStream({
    async start(controller) {
      const send = (obj: unknown) => {
        if (clientGone) return;
        try {
          controller.enqueue(enc.encode(`data: ${JSON.stringify(obj)}\n\n`));
        } catch {
          clientGone = true;
        }
      };

      send({ type: "routing", routing: opts.routing, mode: "fast", model });

      let buffer = "";
      const reader = upstream.body!.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith("data:")) continue;
            const data = trimmed.slice(5).trim();
            if (!data || data === "[DONE]") continue;
            try {
              const parsed = JSON.parse(data);
              const delta = parsed?.choices?.[0]?.delta?.content;
              if (typeof delta === "string" && delta) {
                assistant += delta;
                send({ type: "delta", delta });
              }
            } catch {
              // keep-alive or partial frame
            }
          }
        }
      } catch {
        // aborted upstream or client disconnect; keep whatever we have
      } finally {
        clearTimeout(timer);
        req.signal.removeEventListener?.("abort", onClientAbort);
      }

      const latencyMs = Date.now() - startedAt;
      const status = clientGone || !assistant ? (assistant ? "cancelled" : "failed") : "complete";
      const row = assistant
        ? await saveFastReply(caller, {
            chatId: opts.chatId,
            content: assistant,
            routing: opts.routing,
            latencyMs,
            status,
            model,
          }).catch(() => null)
        : null;
      if (opts.chatId && assistant) await touchChat(caller, opts.chatId).catch(() => null);

      send({ type: "done", messageId: row?.id ?? null, latencyMs, reply: assistant, status });
      try {
        controller.close();
      } catch {
        // already closed
      }
    },
    cancel() {
      clientGone = true;
      abort.abort();
    },
  });

  return new Response(body, {
    headers: {
      ...corsHeaders,
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}

// --------------------------------------------------------- advanced pipeline

function formatHistory(history: HistoryTurn[]): string {
  return history
    .filter((turn) => turn && typeof turn.content === "string" && turn.content.trim().length > 0)
    .slice(-MAX_HISTORY_TURNS)
    .map((turn) => `${turn.role === "assistant" ? "Agent" : "User"}: ${turn.content.trim().slice(0, 2000)}`)
    .join("\n\n")
    .slice(-HISTORY_CHAR_BUDGET);
}

async function startAdvanced(
  req: Request,
  caller: Caller,
  opts: {
    message: string;
    history: HistoryTurn[];
    model: string;
    chatId?: string;
    routing: Routing;
    stream: boolean;
  },
) {
  const crew = getCrewConfig();
  const startedAt = Date.now();

  const agentResponse = await fetch(`${crew.url}/kickoff`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${crew.token}` },
    body: JSON.stringify({
      inputs: {
        project_description: opts.message,
        conversation_history: formatHistory(opts.history),
        model: opts.model,
      },
    }),
  });

  if (!agentResponse.ok) {
    const errorText = await agentResponse.text().catch(() => "");

    if (!opts.routing.forced && FAST_API_KEY && agentResponse.status >= 500) {
      const fallbackRouting: Routing = {
        ...opts.routing,
        mode: "fast",
        reason: `Advanced agent unavailable (${agentResponse.status}); answered with the fast model`,
      };
      return await handleFast(req, caller, {
        message: opts.message,
        history: opts.history,
        routing: fallbackRouting,
        chatId: opts.chatId,
        stream: opts.stream,
      });
    }

    const message =
      agentResponse.status === 503
        ? "The advanced agent service is temporarily unavailable. Switch to Auto or Fast mode and try again."
        : `Agent request failed (${agentResponse.status})`;
    return json(
      { error: message, details: errorText.slice(0, 500), code: "ADVANCED_PROVIDER_ERROR" },
      agentResponse.status === 503 ? 503 : 502,
    );
  }

  const agentData = await agentResponse.json();
  const taskId =
    typeof agentData === "string"
      ? agentData
      : agentData?.uuid ?? agentData?.kickoff_id ?? agentData?.task_id ?? agentData?.id ?? agentData?.kickoff_id ?? null;

  if (!taskId) {
    const { reply, steps } = extractResult(agentData);
    const latencyMs = Date.now() - startedAt;
    let messageId: string | null = null;
    if (opts.chatId) {
      const row = await restInsert(caller, {
        chat_id: opts.chatId,
        role: "assistant",
        content: reply,
        mode: "advanced",
        category: opts.routing.category,
        status: "complete",
        latency_ms: latencyMs,
        steps,
      });
      messageId = row.row?.id ?? null;
      await touchChat(caller, opts.chatId);
    }
    return json({ state: "COMPLETED", reply, steps, messageId, mode: "advanced", latencyMs, routing: opts.routing });
  }

  const jobId = String(taskId);

  // One assistant row per job, created now so the reply survives a closed tab.
  let messageId: string | null = null;
  if (opts.chatId) {
    const existing = await findByJobId(caller, jobId);
    if (existing) {
      messageId = existing.id;
    } else {
      const created = await restInsert(caller, {
        chat_id: opts.chatId,
        role: "assistant",
        content: "",
        mode: "advanced",
        category: opts.routing.category,
        status: "running",
        job_id: jobId,
        steps: [],
      });
      messageId = created.row?.id ?? null;
      if (!created.row && created.error) {
        // Duplicate job id (another request already created the row): fetch it.
        const again = await findByJobId(caller, jobId);
        messageId = again?.id ?? null;
      }
    }
  }

  return json({ state: "STARTED", jobId, messageId, mode: "advanced", routing: opts.routing, latencyMs: 0 });
}

async function readJob(jobId: string, crew: { url: string; token: string }, caller: Caller) {
  const row = await findByJobId(caller, jobId);
  const cancelled = row?.status === "cancelled";
  const messageId = row?.id ?? null;

  const res = await fetch(`${crew.url}/status/${encodeURIComponent(jobId)}`, {
    method: "GET",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${crew.token}` },
  });

  if (!res.ok) return { state: "RUNNING", error: null, progress: null, messageId };
  const data = await res.json().catch(() => null);
  if (!data || typeof data !== "object") return { state: "RUNNING", error: null, progress: null, messageId };

  const d = data as Record<string, unknown>;
  const rawState = String(d.state ?? "").toUpperCase();
  const progress = normalizeProgress(d.progress);
  const elapsed = progress?.elapsed_seconds ?? null;
  const eta = progress && progress.total && progress.completed != null && elapsed
    ? Math.max(0, Math.round((elapsed / Math.max(progress.completed, 1)) * (progress.total - progress.completed)))
    : null;
  const withEta = progress ? { ...progress, eta_seconds: eta } : null;

  // A stopped run keeps whatever the user already has; the crew's late result is discarded.
  if (cancelled) {
    return {
      state: "CANCELLED",
      error: null,
      progress: withEta,
      reply: row?.content ?? "",
      messageId,
      cancelled: true,
    };
  }

  if (rawState === "COMPLETED" || rawState === "SUCCESS" || rawState === "FINISHED") {
    const { reply, steps } = extractResult(d);
    const latencyMs = elapsed ? elapsed * 1000 : null;
    let finalId = messageId;
    if (row && (row.status !== "complete" || row.content !== reply)) {
      const updated = await restUpdate(caller, row.id, {
        content: reply,
        steps,
        status: "complete",
        latency_ms: latencyMs,
      });
      finalId = updated?.id ?? finalId;
      if (row.chat_id) await touchChat(caller, row.chat_id);
    }
    return { state: "COMPLETED", reply, steps, progress: withEta, error: null, messageId: finalId, latencyMs };
  }

  if (rawState === "FAILED" || rawState === "ERROR" || rawState === "NOT FOUND") {
    const detail = typeof d.status === "string" && d.status ? d.status : "The agent team failed.";
    if (row && row.status === "running") {
      await restUpdate(caller, row.id, { status: "failed", content: detail.slice(0, 500) });
    }
    return { state: "FAILED", error: detail, progress: withEta, reply: null, messageId };
  }

  return {
    state: rawState === "PENDING" ? "PENDING" : "RUNNING",
    progress: withEta,
    error: null,
    messageId,
  };
}

function normalizeProgress(value: unknown) {
  if (!value || typeof value !== "object") return null;
  const p = value as Record<string, unknown>;
  return {
    completed: typeof p.completed === "number" ? p.completed : null,
    total: typeof p.total === "number" ? p.total : null,
    current: typeof p.current === "string" ? p.current : null,
    current_agent: typeof p.current_agent === "string" ? p.current_agent : null,
    elapsed_seconds: typeof p.duration_seconds === "number" ? Math.round(p.duration_seconds) : null,
    eta_seconds: null as number | null,
  };
}

function toSteps(tasks: unknown[]): AgentStep[] {
  return tasks.map((t, i) => {
    if (typeof t === "string") return { agent: `Task ${i + 1}`, content: t, status: "done" as const };
    const task = t as Record<string, unknown>;
    const role = String(task?.agent ?? task?.role ?? `Task ${i + 1}`);
    const content = String(task?.output ?? task?.result ?? task?.description ?? JSON.stringify(t));
    return { agent: role, content, status: "done" as const };
  });
}

function extractResult(data: unknown): { reply: string; steps: AgentStep[] } {
  if (typeof data === "string") return { reply: data, steps: [] };
  if (typeof data !== "object" || data === null) return { reply: JSON.stringify(data), steps: [] };

  const obj = data as Record<string, unknown>;

  if (Array.isArray(obj.tasks_output)) {
    const steps = toSteps(obj.tasks_output);
    return { reply: steps.map((s) => `**${s.agent}:** ${s.content}`).join("\n\n"), steps };
  }
  if (obj.result && typeof obj.result === "object") return extractTaskOutput(obj.result);
  if (typeof obj.result === "string" && obj.result.trim()) return { reply: obj.result, steps: [] };
  if (typeof obj.result_json === "string" && obj.result_json.trim()) return { reply: obj.result_json, steps: [] };
  if (obj.result_json && typeof obj.result_json === "object") return extractTaskOutput(obj.result_json);
  if (Array.isArray(obj.results) && obj.results.length > 0) {
    const steps = toSteps(obj.results);
    return { reply: steps.map((s) => `**${s.agent}:** ${s.content}`).join("\n\n"), steps };
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
      return { reply: steps.map((s) => `**${s.agent}:** ${s.content}`).join("\n\n"), steps };
    }
    if (typeof obj.raw === "string") return { reply: obj.raw, steps: [] };
    if (typeof obj.output === "string") return { reply: obj.output, steps: [] };
  }
  return { reply: typeof result === "string" ? result : JSON.stringify(result, null, 2), steps: [] };
}

// -------------------------------------------------------------------- routes

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

    const action = typeof body?.action === "string" ? body.action : "";

    if (action === "config") {
      return json({
        modes: ["auto", "fast", "advanced"],
        fast: { configured: Boolean(FAST_API_KEY), model: FAST_MODEL, deepModel: FAST_MODEL_DEEP, baseUrl: FAST_BASE_URL },
        advanced: { configured: Boolean(Deno.env.get("CREWAI_URL") && Deno.env.get("CREWAI_TOKEN")) },
        dailyLimit: DAILY_MESSAGE_LIMIT,
      });
    }

    if (action === "crew-inputs") {
      // Diagnostics: which inputs the deployed crew accepts (no secrets involved).
      const crew = getCrewConfig();
      const res = await fetch(`${crew.url}/inputs`, {
        headers: { Authorization: `Bearer ${crew.token}` },
      });
      const payload = await res.text().catch(() => "");
      return json({ status: res.status, body: payload.slice(0, 2000) });
    }

    if (action === "stop") {
      const jobId = typeof body?.jobId === "string" ? body.jobId.trim() : "";
      if (!jobId) return json({ error: "jobId is required" }, 400);
      const row = await findByJobId(caller, jobId);
      let remote = false;
      try {
        const crew = getCrewConfig();
        const res = await fetch(`${crew.url}/kickoff/${encodeURIComponent(jobId)}/stop`, {
          method: "POST",
          headers: { Authorization: `Bearer ${crew.token}` },
        });
        remote = res.ok;
      } catch {
        remote = false;
      }
      if (row && row.status === "running") {
        await restUpdate(caller, row.id, { status: "cancelled" });
      }
      return json({ stopped: true, remote, messageId: row?.id ?? null });
    }

    // Status poll for an advanced run.
    const jobId = typeof body?.jobId === "string" ? body.jobId.trim() : "";
    if (jobId) {
      const crew = getCrewConfig();
      return json(await readJob(jobId, crew, caller));
    }

    const message = body?.message;
    if (!message || typeof message !== "string") {
      return json({ error: "Message is required" }, 400);
    }

    const history: HistoryTurn[] = Array.isArray(body?.history) ? body.history : [];
    const chatId = typeof body?.chatId === "string" ? body.chatId : undefined;
    const model = typeof body?.model === "string" ? body.model : "gpt-4o";
    const requestedMode = typeof body?.mode === "string" ? body.mode : "auto";
    const wantsStream = body?.stream === true;

    const routing = classify(message, requestedMode === "auto" ? undefined : requestedMode);

    // If fast mode has no key, fall back to the crew rather than failing.
    if (routing.mode === "fast" && !FAST_API_KEY) {
      routing.mode = "advanced";
      routing.reason = `${routing.reason}; fast mode is not configured`;
    }

    const used = await messagesSentToday(caller);
    if (used >= DAILY_MESSAGE_LIMIT) {
      return json(
        { error: `You've reached today's limit of ${DAILY_MESSAGE_LIMIT} messages. Try again tomorrow.` },
        429,
      );
    }

    if (routing.mode === "fast") {
      return await handleFast(req, caller, {
        message,
        history,
        routing,
        chatId,
        stream: wantsStream,
      });
    }

    return await startAdvanced(req, caller, { message, history, model, chatId, routing, stream: wantsStream });
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
