-- A record of what admins did. Written by the delete-user edge function; admins can read it.
create table if not exists public."AdminAuditLog" (
  "AuditID" bigint generated always as identity primary key,
  "ActorID" uuid references auth.users (id) on delete set null,
  "Action" text not null,
  "TargetID" uuid,
  "Detail" jsonb not null default '{}'::jsonb,
  "CreatedAt" timestamptz not null default now()
);

create index if not exists "AdminAuditLog_CreatedAt_idx" on public."AdminAuditLog" ("CreatedAt" desc);

alter table public."AdminAuditLog" enable row level security;
revoke all on public."AdminAuditLog" from anon, authenticated;
grant select on public."AdminAuditLog" to authenticated;

drop policy if exists "Admins can read the audit log" on public."AdminAuditLog";
create policy "Admins can read the audit log" on public."AdminAuditLog"
  for select to authenticated
  using (public.is_admin());
