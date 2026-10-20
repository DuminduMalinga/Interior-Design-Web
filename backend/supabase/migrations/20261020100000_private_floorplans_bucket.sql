-- Floor plans show the inside of people's homes, so the bucket is private.
-- The app now stores each file's path and opens it through a short-lived signed
-- link (frontend/src/app/lib/floorPlanImage.ts). Run this AFTER that version of
-- the web app is live: links the old version saved stop working once it runs.
update storage.buckets set public = false where id = 'floorplans';

drop policy if exists "Floor plan images are publicly accessible" on storage.objects;
drop policy if exists "Users can read their own floor plans" on storage.objects;
create policy "Users can read their own floor plans" on storage.objects
  for select to authenticated
  using (bucket_id = 'floorplans' and (storage.foldername(name))[1] = auth.uid()::text);
