#!/usr/bin/env node
// Timed end-to-end check of both pipelines against a deployed function.
//
//   SUPABASE_URL=... SUPABASE_ANON_KEY=... BENCH_EMAIL=... BENCH_PASSWORD=... \
//     node scripts/bench.mjs [--advanced]
//
// Prints wall-clock latency per prompt and the latency the server recorded.

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const EMAIL = process.env.BENCH_EMAIL;
const PASSWORD = process.env.BENCH_PASSWORD;
const WITH_ADVANCED = process.argv.includes('--advanced');

if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !EMAIL || !PASSWORD) {
  console.error('Set SUPABASE_URL, SUPABASE_ANON_KEY, BENCH_EMAIL and BENCH_PASSWORD.');
  process.exit(1);
}

const FN = `${SUPABASE_URL}/functions/v1/chat`;

const PROMPTS = [
  { label: 'simple', text: 'What is the capital city of Rwanda?' },
  { label: 'technical', text: 'Explain how HTTP caching works, briefly.' },
  { label: 'coding', text: 'Write a Python function that returns the nth Fibonacci number, iteratively.' },
  { label: 'research', text: 'Summarize the main competitive factors for EV charging startups in East Africa.' },
];

async function signIn() {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  const data = await res.json();
  if (!res.ok || !data.access_token) throw new Error(`Sign-in failed: ${JSON.stringify(data).slice(0, 200)}`);
  return data.access_token;
}

async function call(token, body) {
  const res = await fetch(FN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, apikey: SUPABASE_ANON_KEY },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let data = null;
  try {
    data = JSON.parse(text);
  } catch {
    data = null;
  }
  return { ok: res.ok, status: res.status, data, text };
}

async function newChat(token) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/chats?select=*`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      apikey: SUPABASE_ANON_KEY,
      Prefer: 'return=representation',
    },
    body: JSON.stringify({ title: 'benchmark' }),
  });
  const rows = await res.json();
  return rows[0].id;
}

async function runStreaming(token, chatId, text) {
  const started = Date.now();
  let firstTokenAt = null;
  let answer = '';
  let routing = null;

  const res = await fetch(FN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, apikey: SUPABASE_ANON_KEY },
    body: JSON.stringify({ message: text, chatId, mode: 'auto', stream: true, history: [] }),
  });

  if (!(res.headers.get('content-type') ?? '').includes('text/event-stream')) {
    const data = await res.json().catch(() => null);
    return { kind: data?.state === 'STARTED' ? 'advanced' : 'error', data, ms: Date.now() - started };
  }

  const reader = res.body.getReader();
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
      let event;
      try {
        event = JSON.parse(payload);
      } catch {
        continue;
      }
      if (event.type === 'routing') routing = event.routing;
      else if (event.type === 'delta') {
        if (firstTokenAt === null) firstTokenAt = Date.now();
        answer += event.delta;
      } else if (event.type === 'done') {
        if (typeof event.reply === 'string') answer = event.reply;
      }
    }
  }

  const ms = Date.now() - started;
  return {
    kind: 'fast',
    ms,
    ttft: firstTokenAt ? firstTokenAt - started : null,
    routing,
    chars: answer.length,
    answer: answer.slice(0, 120),
  };
}

async function runAdvanced(token, chatId, text) {
  const started = Date.now();
  const start = await call(token, { message: text, chatId, mode: 'advanced', stream: false, history: [] });
  const jobId = start.data?.jobId;
  if (!jobId) return { kind: 'error', data: start.data, ms: Date.now() - started };

  while (Date.now() - started < 25 * 60 * 1000) {
    await new Promise((r) => setTimeout(r, 5000));
    const poll = await call(token, { jobId });
    const state = poll.data?.state;
    if (state === 'COMPLETED' || state === 'FAILED' || state === 'CANCELLED') {
      return {
        kind: 'advanced',
        ms: Date.now() - started,
        state,
        chars: (poll.data?.reply ?? '').length,
        progress: poll.data?.progress ?? null,
      };
    }
  }
  return { kind: 'advanced', ms: Date.now() - started, state: 'TIMEOUT' };
}

const token = await signIn();
const chatId = await newChat(token);
console.log(`chat ${chatId}\n`);

const rows = [];
for (const prompt of PROMPTS) {
  const result = await runStreaming(token, chatId, prompt.text);
  if (result.kind === 'advanced') {
    rows.push({ prompt: prompt.label, route: 'advanced (not executed)', seconds: '-', note: result.data?.routing?.reason ?? '' });
    continue;
  }
  rows.push({
    prompt: prompt.label,
    route: `${result.routing?.mode}/${result.routing?.category}`,
    seconds: (result.ms / 1000).toFixed(2),
    note: result.ttft ? `first token ${(result.ttft / 1000).toFixed(2)}s, ${result.chars} chars` : `${result.chars} chars`,
  });
}

if (WITH_ADVANCED) {
  const advancedPrompt = 'Design a production architecture, security audit and deployment plan for a multi-tenant SaaS billing platform.';
  const result = await runAdvanced(token, chatId, advancedPrompt);
  rows.push({
    prompt: 'advanced',
    route: `advanced/${result.state ?? result.kind}`,
    seconds: (result.ms / 1000).toFixed(2),
    note: `${result.chars ?? 0} chars`,
  });
}

console.table(rows);
