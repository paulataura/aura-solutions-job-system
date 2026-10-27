-- When a photo was taken (from the photo's EXIF, or upload time for operative uploads on site); null = unknown (office uploads)
alter table public.job_files add column if not exists taken_at timestamptz;
update public.job_files f set taken_at = f.created_at where f.taken_at is null and not exists (select 1 from public.profiles p where p.id = f.uploaded_by and p.role in ('admin','manager'));
