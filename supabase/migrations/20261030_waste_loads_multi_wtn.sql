-- Several loads per job, each with its own WTN (job_waste_loads); operators can record tipping until the job is reviewed
alter table public.job_waste_loads add column if not exists visit_id uuid references public.job_visits(id) on delete set null,
 add column if not exists transfer_location text, add column if not exists transferor_company text, add column if not exists transferor_address text,
 add column if not exists transferor_capacity text, add column if not exists disposal_site_text text;
drop policy if exists aura_loads_operator_update on public.job_waste_loads;
create policy aura_loads_operator_update on public.job_waste_loads for update to authenticated
 using (exists (select 1 from public.jobs j where j.id = job_waste_loads.job_id and j.assigned_to = auth.uid() and j.status = any (array['issued','accepted','on_site','completed'])))
 with check (exists (select 1 from public.jobs j where j.id = job_waste_loads.job_id and j.assigned_to = auth.uid() and j.status = any (array['issued','accepted','on_site','completed'])));
-- also saved earlier: multi-day visit fields
alter table public.jobs add column if not exists planned_end_date date, add column if not exists start_date date;
alter table public.job_visits add column if not exists visit_number integer, add column if not exists planned_date date, add column if not exists visit_operator_id uuid references public.profiles(id), add column if not exists office_notes text, add column if not exists day_outcome text, add column if not exists issued_by_name text, add column if not exists issued_at timestamptz;
