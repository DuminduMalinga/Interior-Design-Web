-- A record of the emails the send-notification function sent, so one user
-- cannot trigger an unlimited number of them. Only the function (service
-- role) reads or writes it.
create table if not exists public."EmailLog" (
  "EmailLogID" bigint generated always as identity primary key,
  "UserID" uuid not null references auth.users (id) on delete cascade,
  "Kind" text not null,
  "Recipients" integer not null default 1,
  "SentAt" timestamptz not null default now()
);

create index if not exists "EmailLog_UserID_SentAt_idx" on public."EmailLog" ("UserID", "SentAt" desc);

alter table public."EmailLog" enable row level security;
revoke all on public."EmailLog" from anon, authenticated;
