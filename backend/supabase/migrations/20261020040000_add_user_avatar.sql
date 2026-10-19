-- Profile picture. The image lives in the public "avatars" bucket under
-- <user id>/..., and the User row keeps its public URL.
alter table public."User" add column if not exists "AvatarUrl" text;

grant update ("AvatarUrl") on public."User" to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Users can upload their avatar" on storage.objects;
create policy "Users can upload their avatar" on storage.objects
  for insert with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "Users can replace their avatar" on storage.objects;
create policy "Users can replace their avatar" on storage.objects
  for update using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "Users can delete their avatar" on storage.objects;
create policy "Users can delete their avatar" on storage.objects
  for delete using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
