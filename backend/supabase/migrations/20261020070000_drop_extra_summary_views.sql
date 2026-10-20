-- Only UserSummary is kept; the other summary views from the previous
-- migration were removed again.
drop view if exists public."FloorPlanSummary";
drop view if exists public."RoomSummary";
drop view if exists public."LayoutSummary";
drop view if exists public."SavedDesignSummary";
