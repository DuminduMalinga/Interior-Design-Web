-- Owners can update and delete their own floor plans (the upload flow marks a
-- plan 'Analysed' once its rooms are detected).
drop policy if exists "Users can update their own floor plans" on public."FloorPlan";
create policy "Users can update their own floor plans" on public."FloorPlan"
  for update
  using (("UserID")::text = (auth.uid())::text)
  with check (("UserID")::text = (auth.uid())::text);

drop policy if exists "Users can delete their own floor plans" on public."FloorPlan";
create policy "Users can delete their own floor plans" on public."FloorPlan"
  for delete
  using (("UserID")::text = (auth.uid())::text);

update public."FloorPlan" f
set "Status" = 'Analysed'
where "Status" = 'Pending'
  and exists (select 1 from public."FloorPlanAnalysis" a where a."FloorPlanID" = f."FloorPlanID");

-- Notification choices from the profile page.
alter table public."User"
  add column if not exists "NotificationPrefs" jsonb not null
  default '{"email": true, "browser": false, "updates": true}'::jsonb;

grant update ("NotificationPrefs") on public."User" to authenticated;

-- A user deletes their own account. Deleting the profile row fires
-- trg_delete_auth_user, which removes the auth user; their floor plans,
-- analyses and saved designs go with it (on delete cascade). Admin accounts
-- cannot be deleted this way.
create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  if exists (select 1 from public."User" where ("UserID")::text = auth.uid()::text and "Role" = 'Admin') then
    raise exception 'Admin accounts cannot be deleted';
  end if;
  delete from public."User" where ("UserID")::text = auth.uid()::text;
end;
$$;

revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;
