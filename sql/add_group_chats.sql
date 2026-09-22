-- Group chats reuse conversations (type = 'group', name already exists)
-- and conversation_members. This adds:
-- 1. one encrypted copy of the group key per member
-- 2. a conversation-level last message time so every member sorts the same way

alter table public.conversations
  add column if not exists last_message_at timestamptz;

update public.conversations as conversation
set last_message_at = latest.created_at
from (
  select conversation_id, max(created_at) as created_at
  from public.messages
  group by conversation_id
) as latest
where conversation.id = latest.conversation_id
  and conversation.last_message_at is null;

create table if not exists public.conversation_key_envelopes (
  id bigint generated always as identity primary key,
  conversation_id bigint not null references public.conversations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  wrapped_by uuid not null references auth.users (id) on delete cascade,
  nonce text not null,
  key_box text not null,
  created_at timestamptz not null default now(),
  constraint conversation_key_envelopes_member_unique unique (conversation_id, user_id),
  constraint conversation_key_envelopes_nonce_len check (char_length(nonce) between 1 and 200),
  constraint conversation_key_envelopes_box_len check (char_length(key_box) between 1 and 500)
);

create index if not exists conversation_key_envelopes_user_idx
  on public.conversation_key_envelopes (user_id);

alter table public.conversation_key_envelopes enable row level security;

drop policy if exists "Read own group key envelope" on public.conversation_key_envelopes;
create policy "Read own group key envelope"
  on public.conversation_key_envelopes
  for select
  to authenticated
  using (user_id = auth.uid());

grant select on public.conversation_key_envelopes to authenticated;

create or replace function public.touch_conversation_last_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.conversations
  set last_message_at = new.created_at,
      updated_at = new.created_at
  where id = new.conversation_id;
  return new;
end;
$$;

drop trigger if exists messages_touch_conversation on public.messages;
create trigger messages_touch_conversation
after insert on public.messages
for each row
execute function public.touch_conversation_last_message();

create or replace function public.remove_group_key_on_leave()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.conversation_key_envelopes
  where conversation_id = old.conversation_id
    and user_id = old.user_id;
  return old;
end;
$$;

drop trigger if exists conversation_members_remove_group_key on public.conversation_members;
create trigger conversation_members_remove_group_key
after delete on public.conversation_members
for each row
execute function public.remove_group_key_on_leave();

notify pgrst, 'reload schema';
