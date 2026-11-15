/*
# Create chat_jobs to track long-running CrewAI runs

1. New Tables
- `chat_jobs`: one row per agent run started from a chat.
  - `id` (uuid, primary key) is the job id the browser polls with.
  - `user_id` (uuid, defaults to the signed-in user) and `chat_id` (uuid, references chats).
  - `crew_job_id` (text): the kickoff id returned by the CrewAI backend.
  - `status` (text): STARTING, PENDING, RUNNING, SUCCESS, FAILED or REVOKED.
  - `progress` (jsonb), `steps` (jsonb), `result` (text), `error` (text).
  - `reply_saved` (boolean): lock that makes sure the reply is written once.
  - `assistant_message_id` (uuid): the saved assistant message for this run.
  - `created_at`, `updated_at` (timestamps).

2. Security Changes
- Row level security enabled.
- Anonymous role has no access; authenticated users get SELECT, INSERT, UPDATE and DELETE.
- Four owner-scoped policies (one per verb). Inserts must belong to a chat the user owns.

3. Important Notes
- Rows are created and updated by the chat function running with the caller's own session, so ownership checks still apply.
- Safe to re-run: all statements use IF NOT EXISTS or DROP POLICY IF EXISTS.
*/

CREATE TABLE IF NOT EXISTS chat_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  chat_id uuid NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  crew_job_id text,
  status text NOT NULL DEFAULT 'STARTING'
    CHECK (status IN ('STARTING', 'PENDING', 'RUNNING', 'SUCCESS', 'FAILED', 'REVOKED')),
  progress jsonb,
  steps jsonb NOT NULL DEFAULT '[]'::jsonb,
  result text,
  error text,
  reply_saved boolean NOT NULL DEFAULT false,
  assistant_message_id uuid REFERENCES messages(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS chat_jobs_chat_id_idx ON chat_jobs(chat_id);
CREATE INDEX IF NOT EXISTS chat_jobs_user_status_idx ON chat_jobs(user_id, status);

ALTER TABLE chat_jobs ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON chat_jobs FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON chat_jobs TO authenticated;

DROP POLICY IF EXISTS "select_own_chat_jobs" ON chat_jobs;
CREATE POLICY "select_own_chat_jobs" ON chat_jobs FOR SELECT
  TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "insert_own_chat_jobs" ON chat_jobs;
CREATE POLICY "insert_own_chat_jobs" ON chat_jobs FOR INSERT
  TO authenticated WITH CHECK (
    auth.uid() = user_id
    AND EXISTS (SELECT 1 FROM chats WHERE chats.id = chat_jobs.chat_id AND chats.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "update_own_chat_jobs" ON chat_jobs;
CREATE POLICY "update_own_chat_jobs" ON chat_jobs FOR UPDATE
  TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "delete_own_chat_jobs" ON chat_jobs;
CREATE POLICY "delete_own_chat_jobs" ON chat_jobs FOR DELETE
  TO authenticated USING (auth.uid() = user_id);
