-- Admins manage customer accounts, but never other admins: they cannot edit or
-- delete an admin's row. The deletion-request table that used to sit beside
-- this was removed.
drop policy if exists "Admins can update deletion requests" on public."DeletionRequest";
drop policy if exists "Manage deletion requests" on public."DeletionRequest";
drop policy if exists "Users can create their own deletion request" on public."DeletionRequest";
drop policy if exists "View deletion requests" on public."DeletionRequest";
drop table if exists public."DeletionRequest";

drop policy if exists "Admins can delete users" on public."User";
drop policy if exists "Admins can delete non-admin users" on public."User";
create policy "Admins can delete non-admin users" on public."User"
  for delete
  using (public.is_admin() and "Role" is distinct from 'Admin');

drop policy if exists "Admins can update all users" on public."User";
drop policy if exists "Admins can update non-admin users" on public."User";
create policy "Admins can update non-admin users" on public."User"
  for update
  using (public.is_admin() and "Role" is distinct from 'Admin')
  with check (public.is_admin());
