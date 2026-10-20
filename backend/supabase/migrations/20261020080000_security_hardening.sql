-- Trigger helper: only the trigger needs it, nobody should call it over the API.
revoke execute on function public.delete_auth_user_on_profile_delete() from public, anon, authenticated;

-- Signed-out visitors never read or write app tables directly (they only call
-- check_username_available and get_site_stats). Row-level security already
-- blocks them; this removes the grants as well.
revoke all on all tables in schema public from anon;
alter default privileges in schema public revoke all on tables from anon;

-- Floor plan uploads: the upload page only accepts PNG and JPEG up to 10 MB.
update storage.buckets
set file_size_limit = 10485760,
    allowed_mime_types = array['image/png', 'image/jpeg']
where id = 'floorplans';
