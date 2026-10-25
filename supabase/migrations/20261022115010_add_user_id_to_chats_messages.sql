/*
# Add user_id to chats and messages for multi-user isolation

1. Modified Tables
- `chats`: add `user_id` uuid column, NOT NULL, defaults to auth.uid(), FK to auth.users(id) ON DELETE CASCADE
- `messages`: no structural change (already scoped via chat_id FK), but now inherits ownership through chats

2. Security Changes
- Drop all existing anon policies on chats and messages
- Revoke grants from anon role (app now requires sign-in)
- Re-grant CRUD to authenticated only
- Create new owner-scoped policies using auth.uid() = user_id on chats
- Create new owner-scoped policies on messages using EXISTS subquery to chats.user_id
- This ensures each user only sees their own chats and messages

3. Important Notes
- user_id defaults to auth.uid() so frontend inserts without explicit user_id still work
- messages ownership is checked through the parent chat's user_id
- anon role loses access entirely — the app now requires authentication
*/

ALTER TABLE chats ADD COLUMN IF NOT EXISTS user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE;

-- Revoke anon access (app now requires sign-in)
REVOKE SELECT, INSERT, UPDATE, DELETE ON chats FROM anon;
REVOKE SELECT, INSERT, UPDATE, DELETE ON messages FROM anon;

-- Re-grant to authenticated only
GRANT SELECT, INSERT, UPDATE, DELETE ON chats TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON messages TO authenticated;

-- Drop old anon policies on chats
DROP POLICY IF EXISTS "anon_select_chats" ON chats;
DROP POLICY IF EXISTS "anon_insert_chats" ON chats;
DROP POLICY IF EXISTS "anon_update_chats" ON chats;
DROP POLICY IF EXISTS "anon_delete_chats" ON chats;

-- Drop old anon policies on messages
DROP POLICY IF EXISTS "anon_select_messages" ON messages;
DROP POLICY IF EXISTS "anon_insert_messages" ON messages;
DROP POLICY IF EXISTS "anon_update_messages" ON messages;
DROP POLICY IF EXISTS "anon_delete_messages" ON messages;

-- New owner-scoped policies on chats
CREATE POLICY "select_own_chats" ON chats FOR SELECT
  TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "insert_own_chats" ON chats FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "update_own_chats" ON chats FOR UPDATE
  TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "delete_own_chats" ON chats FOR DELETE
  TO authenticated USING (auth.uid() = user_id);

-- New owner-scoped policies on messages (via parent chat ownership)
CREATE POLICY "select_own_messages" ON messages FOR SELECT
  TO authenticated USING (
    EXISTS (SELECT 1 FROM chats WHERE chats.id = messages.chat_id AND chats.user_id = auth.uid())
  );
CREATE POLICY "insert_own_messages" ON messages FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM chats WHERE chats.id = messages.chat_id AND chats.user_id = auth.uid())
  );
CREATE POLICY "update_own_messages" ON messages FOR UPDATE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM chats WHERE chats.id = messages.chat_id AND chats.user_id = auth.uid())
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM chats WHERE chats.id = messages.chat_id AND chats.user_id = auth.uid())
  );
CREATE POLICY "delete_own_messages" ON messages FOR DELETE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM chats WHERE chats.id = messages.chat_id AND chats.user_id = auth.uid())
  );