-- Baseline: the tables, helper functions, triggers and policies the app was
-- first built on, written down so a fresh Supabase project can be created from
-- this folder alone. Later migrations extend it. Every statement is safe to
-- run on a project that already has these objects.

-- ── Profile of every signed-up user ──────────────────────────────────────────
create table if not exists public."User" (
  "UserID" uuid primary key references auth.users (id) on delete cascade,
  "UserName" varchar(50) not null unique,
  "Email" varchar(255) not null unique,
  "FullName" varchar(100) not null,
  "Role" varchar(20) not null default 'Customer'
    check ("Role" in ('Admin', 'Customer')),
  "LastSignIn" timestamptz,
  "Phone" text default '',
  "Location" text default '',
  "Bio" text default ''
);
alter table public."User" enable row level security;

-- ── Uploaded floor plans and what is detected in them ───────────────────────
create table if not exists public."FloorPlan" (
  "FloorPlanID" varchar(36) primary key,
  "UploadDateTime" timestamp not null default now(),
  "ImagePath" varchar(2048) not null,
  "Status" varchar(50) not null default 'pending',
  "UserID" uuid not null references public."User" ("UserID") on delete cascade
);
alter table public."FloorPlan" enable row level security;

create table if not exists public."Room" (
  "RoomID" varchar(200) primary key,
  "RoomType" varchar(50) not null,
  "Length" integer,
  "Width" integer,
  "FloorPlanID" varchar(36) not null references public."FloorPlan" ("FloorPlanID") on delete cascade
);
alter table public."Room" enable row level security;

create table if not exists public."StructuralElement" (
  "ElementNo" varchar(200) primary key,
  "Size" integer,
  "Position" varchar(50),
  "ElementType" varchar(50) not null,
  "Orientation" integer,
  "RoomID" varchar(200) not null references public."Room" ("RoomID") on delete cascade
);
alter table public."StructuralElement" enable row level security;

create table if not exists public."Layout" (
  "LayoutID" varchar(200) primary key,
  "GenerateDateTime" timestamp not null default now(),
  "Score" numeric not null,
  "RoomID" varchar(200) not null references public."Room" ("RoomID") on delete cascade
);
alter table public."Layout" enable row level security;

create table if not exists public."FurnitureLayout" (
  "FurnitureLayoutID" varchar(200) primary key,
  "PositionX" numeric,
  "PositionY" numeric,
  "Rotation" integer,
  "LayoutID" varchar(200) not null references public."Layout" ("LayoutID") on delete cascade
);
alter table public."FurnitureLayout" enable row level security;

create table if not exists public."Furniture" (
  "FurnitureID" varchar(50) primary key,
  "FurnitureName" varchar(50) not null,
  "Length" integer,
  "Width" integer,
  "Category" varchar(50)
);
alter table public."Furniture" enable row level security;

create table if not exists public."Furniture_FurnitureLayout" (
  "FurnitureID" varchar(50) not null references public."Furniture" ("FurnitureID") on delete cascade,
  "FurnitureLayoutID" varchar(200) not null references public."FurnitureLayout" ("FurnitureLayoutID") on delete cascade,
  primary key ("FurnitureID", "FurnitureLayoutID")
);
alter table public."Furniture_FurnitureLayout" enable row level security;

-- ── Helper functions ─────────────────────────────────────────────────────────
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
    select 1 from public."User"
    where ("UserID")::text = (auth.uid())::text and "Role" = 'Admin'
  );
$$;

-- The sign-up form asks whether a username is free before creating the account.
create or replace function public.check_username_available(p_username text)
returns boolean
language sql
security definer
set search_path to ''
as $$
  select not exists (
    select 1 from public."User" where lower("UserName") = lower(trim(p_username))
  );
$$;

-- A profile row is created for every new auth user, always as a Customer.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_full_name text;
  v_username text;
  v_email_prefix text;
begin
  v_email_prefix := split_part(coalesce(new.email, ''), '@', 1);

  v_full_name := coalesce(
    nullif(trim(new.raw_user_meta_data->>'full_name'), ''),
    nullif(trim(new.raw_user_meta_data->>'name'), ''),
    nullif(trim(v_email_prefix), ''),
    'User'
  );

  if new.raw_user_meta_data->>'username' is not null and trim(new.raw_user_meta_data->>'username') <> '' then
    if length(trim(new.raw_user_meta_data->>'username')) <= 50 then
      v_username := trim(new.raw_user_meta_data->>'username');
    else
      v_username := left(trim(new.raw_user_meta_data->>'username'), 17) || '_' || replace(new.id::text, '-', '');
    end if;
  else
    v_username := left(v_email_prefix, 17) || '_' || replace(new.id::text, '-', '');
  end if;

  insert into public."User" ("UserID", "UserName", "Email", "FullName", "Role")
  values (new.id, v_username, new.email, v_full_name, 'Customer');

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Deleting a profile row also removes the sign-in account behind it.
create or replace function public.delete_auth_user_on_profile_delete()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  delete from auth.users where id = old."UserID"::uuid;
  return old;
end;
$$;

drop trigger if exists trg_delete_auth_user on public."User";
create trigger trg_delete_auth_user
  after delete on public."User"
  for each row execute function public.delete_auth_user_on_profile_delete();

-- ── User policies ────────────────────────────────────────────────────────────
drop policy if exists "Allow authenticated user to read own row" on public."User";
create policy "Allow authenticated user to read own row" on public."User"
  for select to authenticated
  using ((auth.uid())::text = ("UserID")::text);

drop policy if exists "Allow authenticated user to update own row" on public."User";
create policy "Allow authenticated user to update own row" on public."User"
  for update to authenticated
  using ((auth.uid())::text = ("UserID")::text)
  with check ((auth.uid())::text = ("UserID")::text);

drop policy if exists "Admins can view all users" on public."User";
create policy "Admins can view all users" on public."User"
  for select using (public.is_admin());

-- Users may change only these columns of their own row; Role and Email are not
-- among them, so nobody can promote themselves.
revoke update on public."User" from authenticated;
grant update ("FullName", "UserName", "Phone", "Location", "Bio", "LastSignIn")
  on public."User" to authenticated;

-- ── FloorPlan policies ───────────────────────────────────────────────────────
drop policy if exists "Users can view their own floor plans" on public."FloorPlan";
create policy "Users can view their own floor plans" on public."FloorPlan"
  for select to authenticated
  using (("UserID")::text = (auth.uid())::text);

drop policy if exists "Users can insert their own floor plans" on public."FloorPlan";
create policy "Users can insert their own floor plans" on public."FloorPlan"
  for insert to authenticated
  with check (("UserID")::text = (auth.uid())::text);

-- ── Storage for the uploaded floor plan images ───────────────────────────────
insert into storage.buckets (id, name, public)
values ('floorplans', 'floorplans', true)
on conflict (id) do nothing;

drop policy if exists "Floor plan images are publicly accessible" on storage.objects;
create policy "Floor plan images are publicly accessible" on storage.objects
  for select using (bucket_id = 'floorplans');

drop policy if exists "Users can upload their own floor plans" on storage.objects;
create policy "Users can upload their own floor plans" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'floorplans' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "Users can delete their own floor plans" on storage.objects;
create policy "Users can delete their own floor plans" on storage.objects
  for delete to authenticated
  using (bucket_id = 'floorplans' and (storage.foldername(name))[1] = auth.uid()::text);
