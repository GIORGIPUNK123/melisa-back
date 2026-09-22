-- Group photo, moderator role, and the permissions a moderator can be given.
-- Admin stays equal to the creator except actions against the creator.
-- Clients still cannot change their own role or permissions.

alter table public.conversations
  add column if not exists avatar_url text;

alter table public.conversation_members
  drop constraint if exists conversation_members_role_check;

alter table public.conversation_members
  add constraint conversation_members_role_check
  check (role in ('member', 'moderator', 'admin'));

alter table public.conversation_members
  add column if not exists can_kick boolean not null default false;

alter table public.conversation_members
  add column if not exists can_change_photo boolean not null default false;

alter table public.conversation_members
  add column if not exists can_clear_messages boolean not null default false;

comment on column public.conversations.avatar_url is
  'Group photo URL. Direct chats leave this empty.';

comment on column public.conversation_members.role is
  'member, moderator, or admin. The creator is an admin and cannot be removed.';

comment on column public.conversation_members.can_kick is
  'Moderator permission: remove normal members.';

comment on column public.conversation_members.can_change_photo is
  'Moderator permission: change the group photo.';

comment on column public.conversation_members.can_clear_messages is
  'Moderator permission: clear every message in the group.';

-- Group membership can only be removed by the server. That is what enforces
-- the leave picker: an admin cannot drop their own row from the client
-- and skip choosing the next admin. Direct chats can still be deleted here.
create or replace function public.block_direct_group_leave()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  conv_type text;
  role_name text;
begin
  role_name := coalesce(
    nullif(auth.role(), ''),
    nullif(current_setting('request.jwt.claim.role', true), ''),
    ''
  );

  if role_name not in ('authenticated', 'anon') then
    return old;
  end if;

  select type
    into conv_type
  from public.conversations
  where id = old.conversation_id;

  if conv_type = 'group' then
    raise exception 'Use group settings to leave this group'
      using errcode = '42501';
  end if;

  return old;
end;
$$;

drop trigger if exists conversation_members_block_direct_group_leave
  on public.conversation_members;

create trigger conversation_members_block_direct_group_leave
before delete on public.conversation_members
for each row
execute function public.block_direct_group_leave();

revoke all on function public.block_direct_group_leave() from public, anon, authenticated;

notify pgrst, 'reload schema';
