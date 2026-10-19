-- Keep the normalised design tables (Room, StructuralElement, Layout,
-- FurnitureLayout, Furniture, Furniture_FurnitureLayout) filled from the JSON
-- the site saves in FloorPlanAnalysis. The JSON stays the source of truth;
-- these rows are a copy of it, rebuilt by a trigger on every save.
--
-- IDs are built from the source data so they are stable across re-syncs:
--   Room              <FloorPlanID>:<room id>                  e.g. 3f..:room-6
--   StructuralElement <RoomID>:<opening id>                    e.g. 3f..:room-6:det-25
--   Layout            <RoomID>:<layout type>                   e.g. 3f..:room-6:bed_east_open
--   FurnitureLayout   <LayoutID>:<piece id>                    e.g. ...:bed_east_open:bed_1
--   Furniture         <furniture type>                         e.g. bed

-- The original columns were varchar(10)/(15)/(20): too short for these IDs and names.
-- A room's real size is unknown when nothing on its plan gave a scale.
alter table public."Room"
  alter column "RoomID" type varchar(200),
  alter column "RoomType" type varchar(50),
  alter column "FloorPlanID" type varchar(36),
  alter column "Length" drop not null,
  alter column "Width" drop not null;
alter table public."StructuralElement"
  alter column "ElementNo" type varchar(200),
  alter column "Position" type varchar(50),
  alter column "ElementType" type varchar(50),
  alter column "RoomID" type varchar(200);
alter table public."Layout"
  alter column "LayoutID" type varchar(200),
  alter column "RoomID" type varchar(200);
alter table public."FurnitureLayout"
  alter column "FurnitureLayoutID" type varchar(200),
  alter column "LayoutID" type varchar(200);
alter table public."Furniture"
  alter column "FurnitureID" type varchar(50),
  alter column "FurnitureName" type varchar(50),
  alter column "Category" type varchar(50);
alter table public."Furniture_FurnitureLayout"
  alter column "FurnitureID" type varchar(50),
  alter column "FurnitureLayoutID" type varchar(200);

-- Room type from a room's OCR'd name; same rules as frontend/src/app/lib/roomKind.ts.
create or replace function public.room_type_from_name(p_name text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_name ~* 'living' then 'living_room'
    when p_name ~* '(bath|toilet|w\.?c|wash\s*room|shower|rest\s*room|lavatory)' then 'bathroom'
    when p_name ~* 'bed' and p_name ~* '(master|primary|main|\mm\.?\s*bed)' then 'master_bedroom'
    when p_name ~* 'bed' then 'bedroom'
    when p_name ~* 'kitchen' then 'kitchen'
    when p_name ~* 'din' then 'dining'
    else 'other'
  end;
$$;

-- Catalogue group of a furniture type.
create or replace function public.furniture_category(p_type text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_type in ('sofa', 'loveseat', 'l_sofa', 'chair', 'reading_chair', 'desk_chair', 'dining_chair', 'stool', 'bench', 'ottoman') then 'Seating'
    when p_type in ('bed', 'crib') then 'Beds'
    when p_type like '%table%' or p_type in ('desk', 'counter') then 'Tables & surfaces'
    when p_type in ('wardrobe', 'dresser', 'bookshelf', 'sideboard', 'storage_cabinet', 'tv_console', 'utensil_drawers', 'bathroom_cabinet', 'cabinet') then 'Storage'
    when p_type like '%light%' or p_type like '%lamp%' then 'Lighting'
    when p_type in ('sink', 'stove', 'fridge', 'oven', 'dishwasher', 'tv', 'washing_machine') then 'Appliances'
    when p_type in ('shower', 'toilet', 'washbasin', 'bathtub', 'mirror', 'towel_rail', 'towel_ring', 'grab_bar', 'floor_drain') then 'Bathroom fittings'
    when p_type in ('rug', 'plant') then 'Decor'
    else 'Other'
  end;
$$;

-- Rebuild the copies for one floor plan. p_rooms: re-read the detected rooms
-- (drops every Room row of the plan first). p_layouts: re-read the layouts of
-- the room in LayoutJSON (replaces only that room's openings and layouts, so
-- layouts made earlier for other rooms of the plan are kept).
create or replace function public.sync_floor_plan_tables(p_floor_plan_id varchar, p_rooms boolean, p_layouts boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  a public."FloorPlanAnalysis"%rowtype;
  v_room_key text;
  v_room_id text;
  v_first jsonb;
  v_generated timestamp;
begin
  select * into a from public."FloorPlanAnalysis" where "FloorPlanID" = p_floor_plan_id;
  if not found then
    return;
  end if;

  if p_rooms then
    delete from public."Room" where "FloorPlanID" = p_floor_plan_id;
    insert into public."Room" ("RoomID", "RoomType", "Length", "Width", "FloorPlanID")
    select p_floor_plan_id || ':' || (r->>'id'),
           public.room_type_from_name(coalesce(r->>'name', '')),
           round((r->>'heightM')::numeric * 1000)::int,
           round((r->>'widthM')::numeric * 1000)::int,
           p_floor_plan_id
    from jsonb_array_elements(case when jsonb_typeof(a."DetectionJSON"->'rooms') = 'array' then a."DetectionJSON"->'rooms' else '[]'::jsonb end) r
    where r ? 'id'
    on conflict ("RoomID") do nothing;
  end if;

  if not p_layouts or jsonb_typeof(a."LayoutJSON"->'layouts') is distinct from 'array' then
    return;
  end if;

  v_room_key := coalesce(a."LayoutJSON"->>'roomId', a."SelectedRoomID");
  if v_room_key is null then
    return;
  end if;
  v_room_id := p_floor_plan_id || ':' || v_room_key;
  v_generated := a."UpdatedAt" at time zone 'UTC';

  select l into v_first
  from jsonb_array_elements(a."LayoutJSON"->'layouts') l
  where not l ? 'error'
  limit 1;

  -- The layout engine measured the room exactly; prefer its size and type.
  insert into public."Room" ("RoomID", "RoomType", "Length", "Width", "FloorPlanID")
  values (
    v_room_id,
    coalesce(a."LayoutJSON"->>'roomType', 'other'),
    round((v_first->'room'->>'length')::numeric)::int,
    round((v_first->'room'->>'width')::numeric)::int,
    p_floor_plan_id
  )
  on conflict ("RoomID") do update set
    "RoomType" = coalesce(a."LayoutJSON"->>'roomType', public."Room"."RoomType"),
    "Length" = coalesce(excluded."Length", public."Room"."Length"),
    "Width" = coalesce(excluded."Width", public."Room"."Width");

  delete from public."StructuralElement" where "RoomID" = v_room_id;
  delete from public."Layout" where "RoomID" = v_room_id;   -- cascades to FurnitureLayout and the link table

  if v_first is null then
    return;
  end if;

  -- Doors and windows of the room. Orientation is the wall's compass bearing.
  insert into public."StructuralElement" ("ElementNo", "Size", "Position", "ElementType", "Orientation", "RoomID")
  select v_room_id || ':' || (o.item->>'id'),
         round((o.item->>'width')::numeric)::int,
         (o.item->>'wall') || ' wall, ' || round(coalesce((o.item->>'position')::numeric, (o.item->>'inset')::numeric, 0)) || ' mm',
         o.kind,
         case o.item->>'wall' when 'north' then 0 when 'east' then 90 when 'south' then 180 when 'west' then 270 end,
         v_room_id
  from (
    select 'Door' as kind, d as item
    from jsonb_array_elements(coalesce(v_first->'openings'->'doors', v_first->'doors', '[]'::jsonb)) d
    union all
    select 'Window', w
    from jsonb_array_elements(coalesce(v_first->'openings'->'windows', v_first->'windows', '[]'::jsonb)) w
  ) o
  where jsonb_typeof(o.item) = 'object' and o.item ? 'id'
  on conflict ("ElementNo") do nothing;

  -- One row per generated layout.
  insert into public."Layout" ("LayoutID", "GenerateDateTime", "Score", "RoomID")
  select v_room_id || ':' || (l->'layout'->>'type'), v_generated, (l->'layout'->>'score')::numeric, v_room_id
  from jsonb_array_elements(a."LayoutJSON"->'layouts') l
  where not l ? 'error' and l->'layout' ? 'type'
  on conflict ("LayoutID") do nothing;

  -- New furniture types join the catalogue, sized like the first piece seen.
  insert into public."Furniture" ("FurnitureID", "FurnitureName", "Length", "Width", "Category")
  select distinct on (f->>'type')
         f->>'type',
         initcap(replace(f->>'type', '_', ' ')),
         round((f->>'depth')::numeric)::int,
         round((f->>'width')::numeric)::int,
         public.furniture_category(f->>'type')
  from jsonb_array_elements(a."LayoutJSON"->'layouts') l,
       jsonb_array_elements(case when jsonb_typeof(l->'furniture') = 'array' then l->'furniture' else '[]'::jsonb end) f
  where not l ? 'error' and f ? 'type'
  on conflict ("FurnitureID") do nothing;

  -- Each placed piece, and its catalogue entry.
  insert into public."FurnitureLayout" ("FurnitureLayoutID", "PositionX", "PositionY", "Rotation", "LayoutID")
  select v_room_id || ':' || (l->'layout'->>'type') || ':' || (f->>'id'),
         (f->>'x')::numeric, (f->>'y')::numeric, (f->>'rotation')::int,
         v_room_id || ':' || (l->'layout'->>'type')
  from jsonb_array_elements(a."LayoutJSON"->'layouts') l,
       jsonb_array_elements(case when jsonb_typeof(l->'furniture') = 'array' then l->'furniture' else '[]'::jsonb end) f
  where not l ? 'error' and l->'layout' ? 'type' and f ? 'id'
  on conflict ("FurnitureLayoutID") do nothing;

  insert into public."Furniture_FurnitureLayout" ("FurnitureID", "FurnitureLayoutID")
  select f->>'type', v_room_id || ':' || (l->'layout'->>'type') || ':' || (f->>'id')
  from jsonb_array_elements(a."LayoutJSON"->'layouts') l,
       jsonb_array_elements(case when jsonb_typeof(l->'furniture') = 'array' then l->'furniture' else '[]'::jsonb end) f
  where not l ? 'error' and l->'layout' ? 'type' and f ? 'id' and f ? 'type'
  on conflict do nothing;
end;
$$;

revoke all on function public.sync_floor_plan_tables(varchar, boolean, boolean) from public, anon, authenticated;

create or replace function public.trg_sync_floor_plan_tables()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- A copy that cannot be made must never stop the user's save.
  begin
    perform public.sync_floor_plan_tables(
      new."FloorPlanID",
      tg_op = 'INSERT' or old."DetectionJSON" is distinct from new."DetectionJSON",
      tg_op = 'INSERT' or old."LayoutJSON" is distinct from new."LayoutJSON"
    );
  exception when others then
    raise warning 'sync_floor_plan_tables(%) failed: %', new."FloorPlanID", sqlerrm;
  end;
  return new;
end;
$$;

revoke all on function public.trg_sync_floor_plan_tables() from public, anon, authenticated;

drop trigger if exists trg_sync_floor_plan_tables on public."FloorPlanAnalysis";
create trigger trg_sync_floor_plan_tables
  after insert or update of "DetectionJSON", "LayoutJSON", "SelectedRoomID" on public."FloorPlanAnalysis"
  for each row execute function public.trg_sync_floor_plan_tables();

-- Read access: owners see the rows of their own floor plans, admins see all;
-- the furniture catalogue is readable by every signed-in user. Only the
-- trigger writes.
drop policy if exists "Owners can read their rooms" on public."Room";
create policy "Owners can read their rooms" on public."Room"
  for select to authenticated
  using (public.is_admin() or exists (
    select 1 from public."FloorPlan" f
    where f."FloorPlanID" = "Room"."FloorPlanID" and (f."UserID")::text = (auth.uid())::text));

drop policy if exists "Owners can read their structural elements" on public."StructuralElement";
create policy "Owners can read their structural elements" on public."StructuralElement"
  for select to authenticated
  using (public.is_admin() or exists (
    select 1 from public."Room" r join public."FloorPlan" f on f."FloorPlanID" = r."FloorPlanID"
    where r."RoomID" = "StructuralElement"."RoomID" and (f."UserID")::text = (auth.uid())::text));

drop policy if exists "Owners can read their layouts" on public."Layout";
create policy "Owners can read their layouts" on public."Layout"
  for select to authenticated
  using (public.is_admin() or exists (
    select 1 from public."Room" r join public."FloorPlan" f on f."FloorPlanID" = r."FloorPlanID"
    where r."RoomID" = "Layout"."RoomID" and (f."UserID")::text = (auth.uid())::text));

drop policy if exists "Owners can read their furniture placements" on public."FurnitureLayout";
create policy "Owners can read their furniture placements" on public."FurnitureLayout"
  for select to authenticated
  using (public.is_admin() or exists (
    select 1 from public."Layout" l
    join public."Room" r on r."RoomID" = l."RoomID"
    join public."FloorPlan" f on f."FloorPlanID" = r."FloorPlanID"
    where l."LayoutID" = "FurnitureLayout"."LayoutID" and (f."UserID")::text = (auth.uid())::text));

drop policy if exists "Owners can read their furniture links" on public."Furniture_FurnitureLayout";
create policy "Owners can read their furniture links" on public."Furniture_FurnitureLayout"
  for select to authenticated
  using (public.is_admin() or exists (
    select 1 from public."FurnitureLayout" fl
    join public."Layout" l on l."LayoutID" = fl."LayoutID"
    join public."Room" r on r."RoomID" = l."RoomID"
    join public."FloorPlan" f on f."FloorPlanID" = r."FloorPlanID"
    where fl."FurnitureLayoutID" = "Furniture_FurnitureLayout"."FurnitureLayoutID" and (f."UserID")::text = (auth.uid())::text));

drop policy if exists "Signed-in users can read the furniture catalogue" on public."Furniture";
create policy "Signed-in users can read the furniture catalogue" on public."Furniture"
  for select to authenticated
  using (true);

-- Fill the tables from everything saved so far.
select public.sync_floor_plan_tables("FloorPlanID", true, true) from public."FloorPlanAnalysis";
