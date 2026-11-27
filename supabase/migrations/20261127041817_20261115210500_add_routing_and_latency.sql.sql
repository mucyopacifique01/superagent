/*
# Persist assistant response metadata and job identifiers

1. Purpose
- Extend the existing `messages` table so fast and advanced assistant replies can be stored permanently with their processing details.
- This change is additive and preserves all existing chat and message rows.

2. New columns on `messages`
- `mode` (text): identifies whether the reply came from the fast or advanced pipeline.
- `category` (text): stores the routing category used for the request.
- `status` (text): tracks whether an assistant reply is running, complete, cancelled, or failed.
- `latency_ms` (integer): stores the server processing time for the reply.
- `steps` (jsonb): stores structured agent-step information for advanced replies.
- `job_id` (text): stores the external advanced-job identifier for reconnecting to an in-progress reply.

3. Data integrity and performance
- Add a status check constraint with the four supported message states.
- Add a partial unique index on `job_id` so one advanced job cannot create duplicate assistant replies.
- Add an index for finding running messages by chat.

4. Security
- No access policy or grant changes are made.
- Existing authenticated, owner-scoped policies on `messages` continue to protect each user's conversation history.

5. Important notes
- The migration is additive and safe for existing data.
- Existing messages receive the default `complete` status when the new column is added.
- The edge function can now save both fast replies and advanced replies with the fields it already sends.
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