# Super Agent

An AI chat app where a team of agents (CrewAI Cloud) analyses a project description:
scope, architecture and development approach. React + Vite + TypeScript frontend,
Supabase for auth, chat storage and the edge function that talks to the crew.

## How it fits together

```
Browser (Vite React app)
  ├─ Supabase Auth        sign up / sign in (email + password)
  ├─ Supabase Postgres    chats + messages, owner-scoped with RLS
  └─ Edge function `chat` → CrewAI Cloud (/kickoff, then poll /status/:id)
```

The browser never sees the CrewAI token. It only calls the `chat` function with the
user's session token.

## Setup

### 1. Frontend env

```bash
cp .env.example .env
```

`VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` come from Supabase → Project Settings → API.

### 2. Database

Run both files in `supabase/migrations/` in order, in the Supabase SQL editor.
The second one adds `user_id` and rewrites the policies so each user only sees their
own chats and messages. Do not skip it: without it every visitor can read all chats.

### 3. Edge function secrets

```bash
supabase secrets set CREWAI_URL=https://<your-crew>.crewai.com
supabase secrets set CREWAI_TOKEN=<crew token from CrewAI cloud dashboard>
# optional, defaults to 80
supabase secrets set DAILY_MESSAGE_LIMIT=80
```

The function verifies the caller's Supabase session, enforces a per-user daily cap
(counted from their own messages today) and forwards the conversation history to the
crew as `conversation_history`. For the crew to use it, reference
`{conversation_history}` in the task description of your CrewAI crew.

### 4. Deploy the function

```bash
supabase functions deploy chat --project-ref <project-ref>
```

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

## Notes

- The backend switcher only appears when `VITE_FASTAPI_URL` is set, so visitors never
  see the `localhost:8000` option.
- The "agent pipeline" panel shows steps the backend actually returns. No simulated
  timers.
- Requests time out after 150s with a readable message instead of hanging.
- Password reset and email confirmation screens are not built yet.
