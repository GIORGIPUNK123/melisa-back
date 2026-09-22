-- Lets a moderator be allowed to rename the group.
-- Admins and the creator can always rename, without this flag.

alter table public.conversation_members
  add column if not exists can_change_name boolean not null default false;

comment on column public.conversation_members.can_change_name is
  'Moderator permission: rename the group.';

notify pgrst, 'reload schema';
