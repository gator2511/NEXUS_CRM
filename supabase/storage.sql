-- Supabase Storage: private direct uploads avoid Vercel's function body-size limit.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('nexus-documents','nexus-documents',false,10485760,array['application/pdf','image/jpeg','image/png']) on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
create policy nexus_upload on storage.objects for insert to authenticated with check(bucket_id='nexus-documents' and public.wf_storage_access(name,true));
create policy nexus_download on storage.objects for select to authenticated using(bucket_id='nexus-documents' and public.wf_storage_access(name,false));
-- Objects are immutable to students. Replacements create a new version and preserve audit history.
