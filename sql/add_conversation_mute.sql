-- Per-user mute for a conversation. Stored on the membership row so it
-- follows the account across browsers. Existing reads and inserts keep
-- working because the column defaults to false.
alter table public.conversation_members
  add column if not exists muted boolean not null default false;

comment on column public.conversation_members.muted is
  'When true, this member does not play sounds for the conversation.';

notify pgrst, 'reload schema';
