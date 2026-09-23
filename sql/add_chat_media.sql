-- Private bucket for encrypted chat files.
-- The browser uploads ciphertext only. Run this once in the Supabase SQL editor.

insert into storage.buckets (id, name, public, file_size_limit)
values ('chat-media', 'chat-media', false, 12582912)
on conflict (id) do update
set public = false,
    file_size_limit = 12582912;

drop policy if exists chat_media_read on storage.objects;
drop policy if exists chat_media_insert on storage.objects;

create policy chat_media_read on storage.objects
for select to authenticated
using (
  bucket_id = 'chat-media'
  and exists (
    select 1
    from public.conversation_members as member
    where member.user_id = auth.uid()
      and member.conversation_id::text = (storage.foldername(name))[1]
  )
);

create policy chat_media_insert on storage.objects
for insert to authenticated
with check (
  bucket_id = 'chat-media'
  and exists (
    select 1
    from public.conversation_members as member
    where member.user_id = auth.uid()
      and member.conversation_id::text = (storage.foldername(name))[1]
  )
);
