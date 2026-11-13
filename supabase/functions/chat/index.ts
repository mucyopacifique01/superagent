// Chat edge function — proxies project descriptions to the Super Agent backend (CrewAI)
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

function getCrewConfig() {
  const url = Deno.env.get("CREWAI_URL")?.replace(/\/+$/, "");
  const token = Deno.env.get("CREWAI_TOKEN");
  if (!url || !token) {
    throw new Error("CrewAI is not configured: CREWAI_URL and CREWAI_TOKEN must be set");
  }
  return { url, token };
}

interface AgentStep {
  agent: string;
  content: string;
  status: "pending" | "active" | "done";
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const { message, model } = await req.json();

    if (!message || typeof message !== "string") {
      return new Response(
        JSON.stringify({ error: "Message is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const crew = getCrewConfig();

    // Forward the user's text as project_description to the agent backend
    const agentResponse = await fetch(`${crew.url}/kickoff`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${crew.token}`,
      },
      body: JSON.stringify({
        inputs: {
          project_description: message,
          model: model ?? "gpt-4o",
        },
      }),
    });

    if (!agentResponse.ok) {
      const errorText = await agentResponse.text().catch(() => "");
      return new Response(
        JSON.stringify({
          error: `Agent request failed (${agentResponse.status})`,
          details: errorText.slice(0, 500),
        }),
        {
          status: 502,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const agentData = await agentResponse.json();

    // /kickoff returns a UUID; poll /status/:uuid for the result
    const taskId =
      typeof agentData === "string" ? agentData :
      agentData?.uuid ?? agentData?.task_id ?? agentData?.id ?? agentData?.kickoff_id ?? null;

    if (taskId) {
      const { reply, steps } = await pollAgentTask(taskId, crew);
      return new Response(
        JSON.stringify({ reply, steps }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // If the agent returned a direct result, extract it
    const { reply, steps } = extractResult(agentData);
    return new Response(
      JSON.stringify({ reply, steps }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal server error";
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});

async function pollAgentTask(
  taskId: string,
  crew: { url: string; token: string },
): Promise<{ reply: string; steps: AgentStep[] }> {
  const maxAttempts = 60;
  const intervalMs = 2000;

  for (let i = 0; i < maxAttempts; i++) {
    await new Promise((resolve) => setTimeout(resolve, intervalMs));

    const statusResponse = await fetch(`${crew.url}/status/${taskId}`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${crew.token}`,
      },
    });

    if (!statusResponse.ok) continue;

    const statusData = await statusResponse.json();
    const status = statusData?.status ?? statusData?.state ?? "pending";

    if (status === "completed" || status === "success" || status === "finished" || status === "DONE") {
      return extractResult(statusData);
    }

    if (status === "failed" || status === "error") {
      const errMsg = statusData?.error ?? statusData?.message ?? "unknown error";
      throw new Error(`Agent task failed: ${errMsg}`);
    }
  }

  throw new Error("Agent task timed out after 2 minutes");
}

function extractResult(data: unknown): { reply: string; steps: AgentStep[] } {
  if (typeof data === "string") {
    return { reply: data, steps: [] };
  }
  if (typeof data !== "object" || data === null) {
    return { reply: JSON.stringify(data), steps: [] };
  }

  const obj = data as Record<string, unknown>;
  const steps: AgentStep[] = [];

  // Extract steps from tasks_output if available
  if (obj.tasks_output && Array.isArray(obj.tasks_output)) {
    const taskSteps: AgentStep[] = obj.tasks_output.map((t: unknown, i: number) => {
      if (typeof t === "string") {
        return { agent: `Task ${i + 1}`, content: t, status: "done" as const };
      }
      const task = t as Record<string, unknown>;
      const role = String(task?.agent ?? task?.role ?? `Task ${i + 1}`);
      const content = String(task?.output ?? task?.result ?? task?.description ?? JSON.stringify(t));
      return { agent: role, content, status: "done" as const };
    });

    const reply = taskSteps
      .map((s) => `**${s.agent}:** ${s.content}`)
      .join("\n\n");

    return { reply, steps: taskSteps };
  }

  // Check for nested result object with tasks
  if (obj.result && typeof obj.result === "object") {
    const nested = extractTaskOutput(obj.result);
    return nested;
  }
  if (obj.result && typeof obj.result === "string") {
    return { reply: obj.result, steps: [] };
  }
  if (obj.output && typeof obj.output === "string") {
    return { reply: obj.output, steps: [] };
  }
  if (obj.final_output && typeof obj.final_output === "string") {
    return { reply: obj.final_output, steps: [] };
  }

  return { reply: JSON.stringify(obj, null, 2), steps: [] };
}

function extractTaskOutput(result: unknown): { reply: string; steps: AgentStep[] } {
  if (typeof result === "string") {
    return { reply: result, steps: [] };
  }
  if (typeof result === "object" && result !== null) {
    const obj = result as Record<string, unknown>;

    if (obj.tasks_output && Array.isArray(obj.tasks_output)) {
      const taskSteps: AgentStep[] = obj.tasks_output.map((t: unknown, i: number) => {
        if (typeof t === "string") {
          return { agent: `Task ${i + 1}`, content: t, status: "done" as const };
        }
        const task = t as Record<string, unknown>;
        const role = String(task?.agent ?? task?.role ?? `Task ${i + 1}`);
        const content = String(task?.output ?? task?.result ?? task?.description ?? JSON.stringify(t));
        return { agent: role, content, status: "done" as const };
      });

      const reply = taskSteps
        .map((s) => `**${s.agent}:** ${s.content}`)
        .join("\n\n");

      return { reply, steps: taskSteps };
    }
    if (obj.raw && typeof obj.raw === "string") {
      return { reply: obj.raw, steps: [] };
    }
    if (obj.output && typeof obj.output === "string") {
      return { reply: obj.output, steps: [] };
    }
  }
  return { reply: JSON.stringify(result, null, 2), steps: [] };
}
