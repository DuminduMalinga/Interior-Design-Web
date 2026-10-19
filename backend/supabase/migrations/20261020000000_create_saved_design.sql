-- A saved 3D design: one room of an uploaded floor plan furnished with one layout.
-- A floor plan can keep several (a row per room and layout). The layout data is
-- enough to rebuild the 3D scene; the exported model and a preview image are
-- kept in the private "designs" storage bucket.
create table if not exists public."SavedDesign" (
  "DesignID" uuid primary key default gen_random_uuid(),
  "UserID" uuid not null references auth.users (id) on delete cascade,
  "FloorPlanID" varchar not null references public."FloorPlan" ("FloorPlanID") on delete cascade,
  "RoomID" text not null,
  "RoomName" text,
  "LayoutType" text not null,
  "Title" text,
  "Score" numeric,
  "LayoutJSON" jsonb not null,
  "ModelPath" text,
  "PreviewPath" text,
  "CreatedAt" timestamptz not null default now(),
  "UpdatedAt" timestamptz not null default now(),
  unique ("FloorPlanID", "RoomID", "LayoutType")
);

create index if not exists "SavedDesign_UserID_idx" on public."SavedDesign" ("UserID");

alter table public."SavedDesign" enable row level security;

drop policy if exists "Users can read their saved designs" on public."SavedDesign";
create policy "Users can read their saved designs" on public."SavedDesign"
  for select using (auth.uid() = "UserID");

drop policy if exists "Users can create their saved designs" on public."SavedDesign";
create policy "Users can create their saved designs" on public."SavedDesign"
  for insert with check (auth.uid() = "UserID");

drop policy if exists "Users can update their saved designs" on public."SavedDesign";
create policy "Users can update their saved designs" on public."SavedDesign"
  for update using (auth.uid() = "UserID") with check (auth.uid() = "UserID");

drop policy if exists "Users can delete their saved designs" on public."SavedDesign";
create policy "Users can delete their saved designs" on public."SavedDesign"
  for delete using (auth.uid() = "UserID");

-- Private bucket; files live under <user id>/<floor plan id>/...
insert into storage.buckets (id, name, public)
values ('designs', 'designs', false)
on conflict (id) do nothing;

drop policy if exists "Users can read their design files" on storage.objects;
create policy "Users can read their design files" on storage.objects
  for select using (bucket_id = 'designs' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "Users can upload their design files" on storage.objects;
create policy "Users can upload their design files" on storage.objects
  for insert with check (bucket_id = 'designs' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "Users can replace their design files" on storage.objects;
create policy "Users can replace their design files" on storage.objects
  for update using (bucket_id = 'designs' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "Users can delete their design files" on storage.objects;
create policy "Users can delete their design files" on storage.objects
  for delete using (bucket_id = 'designs' and (storage.foldername(name))[1] = auth.uid()::text);
