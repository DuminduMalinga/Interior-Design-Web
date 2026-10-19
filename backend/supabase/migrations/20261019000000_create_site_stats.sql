-- Aggregate counts for the public landing page. Runs as the owner so anonymous
-- visitors can see totals without being able to read any individual row.
create or replace function public.get_site_stats()
returns table (
  "UserCount" bigint,
  "FloorPlanCount" bigint,
  "LayoutCount" bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select
    (select count(*) from public."User"),
    (select count(*) from public."FloorPlan"),
    (
      select count(*)
      from public."FloorPlanAnalysis" a
      cross join lateral jsonb_array_elements(
        case
          when jsonb_typeof(a."LayoutJSON" -> 'layouts') = 'array' then a."LayoutJSON" -> 'layouts'
          else '[]'::jsonb
        end
      ) as l(entry)
      where not (l.entry ? 'error')
    );
$$;

revoke all on function public.get_site_stats() from public;
grant execute on function public.get_site_stats() to anon, authenticated;
