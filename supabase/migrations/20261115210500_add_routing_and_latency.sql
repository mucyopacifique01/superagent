/*
# Speed layer: routing metadata, latency and exactly-once reply storage

1. New columns on `messages`
- `mode` text        — 'fast' | 'advanced' (which pipeline produced the answer)
- `category` text    — classifier label: simple | technical | coding | research | complex
- `status` text      — 'running' | 'complete' | 'cancelled' | 'failed'
- `latency_ms` int   — end-to-end server time for the answer
- `steps` jsonb      — real agent steps reported by the backend
- `job_id` text      — CrewAI kickoff id for advanced runs (idempotency key)

2. Exactly-once saving
- A partial unique index on `job_id` makes a duplicated insert impossible, so a
  retried or concurrent poll can never save the same crew reply twice.
- The assistant row is created once (status 'running') and updated in place, so a
  reply survives a closed tab or a cancel.

3. Security unchanged
- No policy, grant or RLS change. The edge function writes with the caller's own
  JWT, so every existing owner-scoped policy still applies.
*/

ALTER TABLE messages ADD COLUMN IF NOT EXISTS mode text;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS category text;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'complete';
ALTER TABLE messages ADD COLUMN IF NOT EXISTS latency_ms integer;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS steps jsonb;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS job_id text;

ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_status_check;
ALTER TABLE messages ADD CONSTRAINT messages_status_check
  CHECK (status IN ('running', 'complete', 'cancelled', 'failed'));

CREATE UNIQUE INDEX IF NOT EXISTS messages_job_id_key
  ON messages (job_id) WHERE job_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS messages_running_idx
  ON messages (chat_id) WHERE status = 'running';
