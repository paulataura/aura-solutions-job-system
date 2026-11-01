-- Arrival pictures were saved without their visit: link each to the visit it was taken on.
update public.job_files f set visit_id = (
  select v.id from public.job_visits v where v.job_id = f.job_id and v.created_at <= f.created_at + interval '10 seconds'
  order by v.created_at desc limit 1)
where f.file_type = 'arrival_photo' and f.visit_id is null
  and exists (select 1 from public.job_visits v where v.job_id = f.job_id and v.created_at <= f.created_at + interval '10 seconds');
