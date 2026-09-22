-- Group roles live on the membership row so many people can be admins.
-- The conversation creator is the only person who can grant or remove admin.
-- Clients can still update read/mute fields, but not their own role.

alter table public.conversation_members
  add column if not exists role text not null default 'member';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'conversation_members_role_check'
  ) then
    alter table public.conversation_members
      add constraint conversation_members_role_check
      check (role in ('member', 'admin'));
  end if;
end $$;

update public.conversation_members as member
set role = 'admin'
from public.conversations as conversation
where conversation.id = member.conversation_id
  and conversation.type = 'group'
  and conversation.created_by = member.user_id
  and member.role <> 'admin';

alter table public.conversations
  add column if not exists history_cleared_at timestamptz;

comment on column public.conversation_members.role is
  'member or admin. Admins can remove members, clear messages, and delete the group.';

comment on column public.conversations.history_cleared_at is
  'When set, messages at or before this time were cleared for the whole conversation.';

revoke insert on table public.conversation_members from authenticated, anon;
revoke update on table public.conversation_members from authenticated, anon;
grant update (last_read_at, last_message_at, muted)
  on table public.conversation_members to authenticated;

alter table public.conversation_members replica identity full;
alter table public.messages replica identity full;
alter table public.conversations replica identity full;

create or replace function public.reassign_group_owner()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  next_owner uuid;
begin
  if not exists (
    select 1
    from public.conversations
    where id = old.conversation_id
      and type = 'group'
      and created_by = old.user_id
  ) then
    return old;
  end if;

  select user_id
    into next_owner
  from public.conversation_members
  where conversation_id = old.conversation_id
    and user_id <> old.user_id
  order by case when role = 'admin' then 0 else 1 end, joined_at
  limit 1;

  if next_owner is null then
    return old;
  end if;

  update public.conversation_members
  set role = 'admin'
  where conversation_id = old.conversation_id
    and user_id = next_owner;

  update public.conversations
  set created_by = next_owner
  where id = old.conversation_id;

  return old;
end;
$$;

drop trigger if exists conversation_members_reassign_owner on public.conversation_members;
create trigger conversation_members_reassign_owner
after delete on public.conversation_members
for each row
execute function public.reassign_group_owner();

revoke all on function public.reassign_group_owner() from public, anon, authenticated;

notify pgrst, 'reload schema';
