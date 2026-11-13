// Chat edge function — proxies project descriptions to the Super Agent backend (CrewAI)
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const DAILY_MESSAGE_LIMIT = Number(Deno.env.get("DAILY_MESSAGE_LIMIT") ?? "80");
const MAX_HISTORY_TURNS = 12;

interface AgentStep {
  agent: string;
  content: string;
  status: "pending" | "active" | "done";
}

interface HistoryTurn {
  role: string;
  content: string;
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
async function getCaller(req: Request): Promise<{ id: string; token: string } | null> {
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

// Count the caller's own messages sent today (RLS scopes the count to their chats).
async function messagesSentToday(caller: { id: string; token: string }): Promise<number> {
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

    // Status poll: { jobId } — a crew run can take many minutes, so the browser
    // polls instead of holding one long request open.
    const jobId = typeof body?.jobId === "string" ? body.jobId.trim() : "";
    if (jobId) {
      return json(await readJob(jobId, crew));
    }

    const message = body?.message;
    const model = typeof body?.model === "string" ? body.model : "gpt-4o";
    const history: HistoryTurn[] = Array.isArray(body?.history) ? body.history : [];

    if (!message || typeof message !== "string") {
      return json({ error: "Message is required" }, 400);
    }

    const used = await messagesSentToday(caller);
    if (used >= DAILY_MESSAGE_LIMIT) {
      return json(
        { error: `You've reached today's limit of ${DAILY_MESSAGE_LIMIT} messages. Try again tomorrow.` },
        429,
      );
    }

    const agentResponse = await fetch(`${crew.url}/kickoff`, {
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

    if (!agentResponse.ok) {
      const errorText = await agentResponse.text().catch(() => "");
      return json(
        {
          error: `Agent request failed (${agentResponse.status})`,
          details: errorText.slice(0, 500),
        },
        502,
      );
    }

    const agentData = await agentResponse.json();

    // /kickoff returns a UUID; poll /status/:uuid for the result
    const taskId =
      typeof agentData === "string"
        ? agentData
        : agentData?.uuid ?? agentData?.task_id ?? agentData?.id ?? agentData?.kickoff_id ?? null;

    if (taskId) {
      return json({ jobId: String(taskId), state: "STARTED" });
    }

    const { reply, steps } = extractResult(agentData);
    return json({ state: "COMPLETED", reply, steps });
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

async function readJob(jobId: string, crew: { url: string; token: string }) {
  const res = await fetch(`${crew.url}/status/${encodeURIComponent(jobId)}`, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${crew.token}`,
    },
  });

  if (!res.ok) {
    return { state: "RUNNING", error: null, progress: null };
  }

  const data = await res.json().catch(() => null);
  if (!data || typeof data !== "object") {
    return { state: "RUNNING", error: null, progress: null };
  }

  const d = data as Record<string, unknown>;
  const rawState = String(d.state ?? "").toUpperCase();
  const progress = normalizeProgress(d.progress);

  if (rawState === "COMPLETED" || rawState === "SUCCESS" || rawState === "FINISHED") {
    const { reply, steps } = extractResult(d);
    return { state: "COMPLETED", reply, steps, progress, error: null };
  }

  if (rawState === "FAILED" || rawState === "ERROR" || rawState === "NOT FOUND") {
    const detail = typeof d.status === "string" && d.status ? d.status : "The agent team failed.";
    return { state: "FAILED", error: detail, progress, reply: null };
  }

  return { state: rawState === "PENDING" ? "PENDING" : "RUNNING", progress, error: null };
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
