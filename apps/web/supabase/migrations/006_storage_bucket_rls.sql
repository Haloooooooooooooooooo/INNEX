-- Phase 2 fix: Supabase Storage RLS for capture-files bucket
-- Goal:
-- 1) Ensure bucket exists
-- 2) Allow authenticated users to upload/read/delete only their own path:
--    <auth.uid()>/<capture_item_id>/<file>

insert into storage.buckets (id, name, public)
values ('capture-files', 'capture-files', true)
on conflict (id) do nothing;

-- Clean up old policies (if any)
drop policy if exists "capture files read own path" on storage.objects;
drop policy if exists "capture files insert own path" on storage.objects;
drop policy if exists "capture files update own path" on storage.objects;
drop policy if exists "capture files delete own path" on storage.objects;

-- Read own files in bucket
create policy "capture files read own path"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'capture-files'
  and split_part(name, '/', 1) = auth.uid()::text
);

-- Upload into own folder only
create policy "capture files insert own path"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'capture-files'
  and split_part(name, '/', 1) = auth.uid()::text
);

-- Update own files only
create policy "capture files update own path"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'capture-files'
  and split_part(name, '/', 1) = auth.uid()::text
)
with check (
  bucket_id = 'capture-files'
  and split_part(name, '/', 1) = auth.uid()::text
);

-- Delete own files only
create policy "capture files delete own path"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'capture-files'
  and split_part(name, '/', 1) = auth.uid()::text
);

