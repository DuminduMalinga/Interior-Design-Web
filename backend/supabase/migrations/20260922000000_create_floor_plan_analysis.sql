create table if not exists public."FloorPlanAnalysis" (
  "FloorPlanID" varchar primary key references public."FloorPlan" ("FloorPlanID") on delete cascade,
  "UserID" uuid not null references auth.users (id) on delete cascade,
  "SelectedRoomID" text,
  "DetectionJSON" jsonb not null,
  "LayoutJSON" jsonb,
  "SelectedLayoutJSON" jsonb,
  "Status" text not null default 'Detected'
    check ("Status" in ('Detected', 'LayoutReady', 'LayoutSelected')),
  "CreatedAt" timestamptz not null default now(),
  "UpdatedAt" timestamptz not null default now()
);

create index if not exists "FloorPlanAnalysis_UserID_idx"
  on public."FloorPlanAnalysis" ("UserID");

alter table public."FloorPlanAnalysis" enable row level security;

drop policy if exists "Users can read their floor plan analyses"
  on public."FloorPlanAnalysis";
create policy "Users can read their floor plan analyses"
  on public."FloorPlanAnalysis"
  for select
  using (auth.uid() = "UserID");

drop policy if exists "Users can create their floor plan analyses"
  on public."FloorPlanAnalysis";
create policy "Users can create their floor plan analyses"
  on public."FloorPlanAnalysis"
  for insert
  with check (auth.uid() = "UserID");

drop policy if exists "Users can update their floor plan analyses"
  on public."FloorPlanAnalysis";
create policy "Users can update their floor plan analyses"
  on public."FloorPlanAnalysis"
  for update
  using (auth.uid() = "UserID")
  with check (auth.uid() = "UserID");
