-- Enforce blocks on messaging and clean up relationships when a block is created.

CREATE OR REPLACE FUNCTION public.users_are_blocked(user_a uuid, user_b uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(user_a, '00000000-0000-0000-0000-000000000000'::uuid)
         <> COALESCE(user_b, '00000000-0000-0000-0000-000000000000'::uuid)
     AND EXISTS (
      SELECT 1
      FROM public.blocks
      WHERE (blocker_id = user_a AND blocked_user_id = user_b)
         OR (blocker_id = user_b AND blocked_user_id = user_a)
    );
$$;

REVOKE ALL ON FUNCTION public.users_are_blocked(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.users_are_blocked(uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.conversation_has_block(_conversation_id bigint)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.conversation_members me
    JOIN public.conversation_members other
      ON other.conversation_id = me.conversation_id
     AND other.user_id <> me.user_id
    WHERE me.conversation_id = _conversation_id
      AND public.users_are_blocked(me.user_id, other.user_id)
  );
$$;

REVOKE ALL ON FUNCTION public.conversation_has_block(bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.conversation_has_block(bigint) TO authenticated;

DROP POLICY IF EXISTS "Users can send messages" ON public.messages;

CREATE POLICY "Users can send messages"
ON public.messages
FOR INSERT
WITH CHECK (
  auth.uid() = sender_id
  AND EXISTS (
    SELECT 1
    FROM public.conversation_members
    WHERE conversation_members.conversation_id = messages.conversation_id
      AND conversation_members.user_id = auth.uid()
  )
  AND NOT public.conversation_has_block(conversation_id)
);

CREATE OR REPLACE FUNCTION public.handle_new_block()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.friendships
  WHERE (user_id = NEW.blocker_id AND receiver_id = NEW.blocked_user_id)
     OR (user_id = NEW.blocked_user_id AND receiver_id = NEW.blocker_id);

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS blocks_remove_relationships ON public.blocks;
CREATE TRIGGER blocks_remove_relationships
AFTER INSERT ON public.blocks
FOR EACH ROW
EXECUTE FUNCTION public.handle_new_block();

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.blocks;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
