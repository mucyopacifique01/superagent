# Super Agent

An AI chat app with two speeds: a **fast direct answer** for questions, and an
**advanced research** pipeline run by a 6-task CrewAI Cloud crew for architecture,
security audits and business research. React + Vite + TypeScript frontend, Supabase for
auth, chat storage and the edge function that routes and executes each request.

## How it fits together

```
Browser (Vite React app)
  ├─ Supabase Auth        sign up / sign in (email + password)
  ├─ Supabase Postgres    chats + messages, owner-scoped with RLS
  └─ Edge function `chat`
        ├─ classifier            0 ms, deterministic, picks the cheapest pipeline
        ├─ fast  → Groq / any OpenAI-compatible model, streamed token by token
        └─ advanced → CrewAI Cloud (/kickoff, then poll /status/:id)
```

The browser never sees an API key. It calls the `chat` function with the user's
session token; only the function holds `GROQ_API_KEY` and `CREWAI_TOKEN`.

## Routing

Every message is classified before anything is executed. Explicit Fast or Advanced
always wins; Auto is the default.

| Category  | Examples                                              | Runs on  |
|-----------|-------------------------------------------------------|----------|
| simple    | "hi", short conversational questions                   | Fast     |
| technical | "explain HTTP caching", "difference between X and Y"    | Fast     |
| coding    | code in the message, bugs, tracebacks, "implement..."   | Fast (deep model) |
| research  | market research, competitors, pricing, business analysis | Advanced |
| complex   | long briefs, architecture, audits, deployment, roadmaps  | Advanced |

The classifier is keyword, length and structure based: no model call, so routing adds
no latency. The chosen route and its reason are shown in the UI and stored on the
message.

## Setup

### 1. Frontend env

```bash
cp .env.example .env
```

`VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` come from Supabase → Project Settings → API.

### 2. Database

Run every file in `supabase/migrations/` in order, in the Supabase SQL editor.
The second one adds `user_id` and rewrites the policies so each user only sees their
own chats and messages. The third adds `mode`, `category`, `status`, `latency_ms`,
`steps` and `job_id` (with a unique index, so a reply can never be saved twice).
Do not skip them.

### 3. Edge function secrets

```bash
# fast path (Groq is OpenAI-compatible; any compatible provider works)
supabase secrets set GROQ_API_KEY=gsk_...
# optional: override provider, models and limits
supabase secrets set FAST_LLM_BASE_URL=https://api.groq.com/openai/v1
supabase secrets set FAST_LLM_MODEL=openai/gpt-oss-120b
supabase secrets set FAST_LLM_MODEL_DEEP=openai/gpt-oss-120b
supabase secrets set FAST_MAX_TOKENS=900
supabase secrets set FAST_TIMEOUT_MS=60000

# advanced path (existing crew, unchanged)
supabase secrets set CREWAI_URL=https://<your-crew>.crewai.com
supabase secrets set CREWAI_TOKEN=<crew token from CrewAI cloud dashboard>
supabase secrets set DAILY_MESSAGE_LIMIT=80
```

Without `GROQ_API_KEY` the function still works: Auto routing falls back to the crew and
the UI marks Fast mode as unavailable.

### 4. Deploy the function

```bash
supabase functions deploy chat --project-ref <project-ref> --no-verify-jwt
```

`--no-verify-jwt` is required because the function verifies the session itself, so an
anonymous caller gets a 401 without spending credits.

### 5. Run locally

```bash
npm install
npm run dev
```

## Scripts

- `npm run dev` — Vite dev server
- `npm run build` — production build
- `npm run typecheck` — TypeScript, no emit
- `npm run lint` — ESLint
- `node scripts/bench.mjs` — timed end-to-end test of both paths (see below)

## Measuring

`scripts/bench.mjs` signs in, sends one prompt per category, and prints wall-clock
latency plus the latency the server recorded:

```bash
SUPABASE_URL=... SUPABASE_ANON_KEY=... BENCH_EMAIL=... BENCH_PASSWORD=... node scripts/bench.mjs
```

## Message contract

| Request | Response |
|---|---|
| `{ message, chatId, history, mode, stream }` | Fast + `stream`: SSE frames `{type:"routing"}`, `{type:"delta"}`, `{type:"done"}`. Fast without stream: `{state:"COMPLETED", reply, latencyMs, messageId}`. Advanced: `{state:"STARTED", jobId, messageId, routing}` |
| `{ jobId }` | `{state, progress:{completed,total,current,current_agent,elapsed_seconds,eta_seconds}, reply}` |
| `{ action:"stop", jobId }` | `{stopped, remote}` — `remote` tells you whether the crew itself accepted a cancel |
| `{ action:"config" }` | `{modes, fast:{configured,model,deepModel}, advanced:{configured}, dailyLimit}` |
| `{ action:"crew-inputs" }` | the inputs the deployed crew declares (diagnostics) |

The assistant row is created once, server-side, when a run starts (`status:'running'`)
and updated in place. A closed tab or a cancel never loses or duplicates a reply; a
reloaded chat reattaches to the running job.

## Notes

- The backend switcher only appears when `VITE_FASTAPI_URL` is set, so visitors never
  see the `localhost:8000` option.
- No simulated progress: the panel shows the crew's real task name, count and ETA, and
  a fast request shows elapsed time only.
- CrewAI's `stop` only stops the client and marks the message cancelled. Unless the
  crew exposes a cancel endpoint (`remote:true`), it finishes in the background.
- Cancelling an advanced run does not refund crew credits.
- Password reset and email confirmation screens are not built yet.
