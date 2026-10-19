-- A read-only summary of each user for people browsing the database: names,
-- role and how much they have done, instead of UUIDs and JSON.
-- security_invoker makes the view obey the row-level security of the tables it
-- reads, so a user sees only their own row and an admin sees everyone's.
create or replace view public."UserSummary" with (security_invoker = true) as
select
  u."FullName" as "Name",
  u."UserName" as "Username",
  u."Email",
  u."Role",
  u."LastSignIn" as "Last sign-in",
  (select count(*) from public."FloorPlan" f where f."UserID" = u."UserID") as "Floor plans",
  (select count(*) from public."FloorPlanAnalysis" a where a."UserID" = u."UserID" and a."SelectedLayoutJSON" is not null) as "Rooms furnished",
  (select count(*) from public."SavedDesign" s where s."UserID" = u."UserID") as "Saved 3D designs",
  u."UserID"
from public."User" u;

revoke all on public."UserSummary" from anon, authenticated;
grant select on public."UserSummary" to authenticated;

-- The per-plan, per-room, per-layout and per-saved-design summary views were
-- tried and removed; only UserSummary is kept.
drop view if exists public."FloorPlanSummary";
drop view if exists public."RoomSummary";
drop view if exists public."LayoutSummary";
drop view if exists public."SavedDesignSummary";
