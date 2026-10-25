-- Let management delete job files; operators can remove their own uploads on live jobs.
drop policy if exists aura_files_delete on public.job_files;
create policy aura_files_delete on public.job_files for delete to authenticated
  using (public.is_management() or (uploaded_by = auth.uid() and exists (
    select 1 from public.jobs j where j.id = job_files.job_id and j.assigned_to = auth.uid()
      and j.status = any (array['issued','accepted','on_site']))));

drop policy if exists aura_storage_operator_delete on storage.objects;
create policy aura_storage_operator_delete on storage.objects for delete to authenticated
  using (bucket_id = 'job-files' and owner = auth.uid() and (storage.foldername(name))[1] = 'jobs'
    and exists (select 1 from public.jobs j where (j.id)::text = (storage.foldername(objects.name))[2]
      and j.assigned_to = auth.uid() and j.status = any (array['issued','accepted','on_site'])));
