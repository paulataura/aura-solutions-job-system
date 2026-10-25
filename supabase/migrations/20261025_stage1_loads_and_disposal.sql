-- Stage 1: waste loads (one WTN per load), weights, disposal confirmation,
-- WTN parties on jobs, and operator workflow without an "accept" step.
-- Additive only: nothing existing is removed or renamed.

-- 1. WTN parties on the job (producer may differ from the paying client; a broker may arrange it)
alter table public.jobs
  add column if not exists producer_name text,
  add column if not exists producer_address text,
  add column if not exists producer_postcode text,
  add column if not exists producer_sic_code text,
  add column if not exists broker_name text,
  add column if not exists broker_address text,
  add column if not exists broker_registration text,
  add column if not exists planned_estimated_weight_kg numeric,
  add column if not exists review_notes text,
  add column if not exists returned_to_operator_at timestamptz,
  add column if not exists reviewed_at timestamptz,
  add column if not exists reviewed_by uuid references auth.users(id),
  add column if not exists reviewed_by_name text;

-- 2. Disposal site permit number (for disposal confirmation and Digital Waste Tracking)
alter table public.disposal_sites
  add column if not exists permit_number text;

-- 3. Sign-off details on the visit
alter table public.job_visits
  add column if not exists customer_signed_name text,
  add column if not exists customer_unable_reason text,
  add column if not exists operative_signed_name text,
  add column if not exists work_notes jsonb not null default '[]'::jsonb;

-- 4. More file types (old values kept)
alter table public.job_files drop constraint if exists job_files_file_type_check;
alter table public.job_files add constraint job_files_file_type_check check (file_type = any (array[
  'job_attachment','arrival_photo','completion_photo','waste_evidence',
  'work_photo','load_photo','disposal_ticket','job_sheet_pdf','wtn_pdf','issue_photo'
]));
alter table public.job_files add column if not exists load_id uuid;
alter table public.job_files add column if not exists scope_section_id uuid;

-- 5. Waste loads
create table if not exists public.job_waste_loads (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete cascade,
  load_number integer not null default 1,
  wtn_number text,
  -- the waste
  description text,
  ewc_code text,
  hazardous boolean not null default false,
  physical_form text check (physical_form is null or physical_form = any (array['solid','liquid','sludge','powder','mixed','gas'])),
  contains_pops boolean,
  pops_details text,
  quantity_value numeric,
  quantity_unit text,
  estimated_weight_kg numeric,
  container_type text,          -- 'loose' when not contained
  sic_code text,
  vehicle_registration text,
  -- the transfer (collection)
  collected_at timestamptz,
  hierarchy_confirmed boolean not null default false,
  transferor_signed_name text,
  transferor_signature text,
  transferor_signed_at timestamptz,
  transferee_signed_name text,
  transferee_signature text,
  transferee_signed_at timestamptz,
  -- disposal confirmation
  disposal_site_id uuid references public.disposal_sites(id),
  disposal_status text not null default 'pending' check (disposal_status = any (array['pending','confirmed'])),
  disposed_at timestamptz,
  receiver_name text,
  receiver_signature text,
  receiver_signed_at timestamptz,
  receiver_unable_reason text,
  ticket_number text,
  actual_weight_kg numeric,
  waste_tracking_id text,
  disposal_notes text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (job_id, load_number)
);
create unique index if not exists job_waste_loads_wtn_unique on public.job_waste_loads (wtn_number) where wtn_number is not null;
create index if not exists job_waste_loads_job_idx on public.job_waste_loads (job_id);

create or replace function public.aura_load_defaults()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.wtn_number is null or btrim(new.wtn_number) = '' then
    new.wtn_number := public.generate_wtn_number();
  end if;
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists aura_load_defaults on public.job_waste_loads;
create trigger aura_load_defaults before insert or update on public.job_waste_loads
  for each row execute function public.aura_load_defaults();

alter table public.job_waste_loads enable row level security;

drop policy if exists aura_loads_read on public.job_waste_loads;
create policy aura_loads_read on public.job_waste_loads for select to authenticated
  using (public.is_management() or exists (
    select 1 from public.jobs j where j.id = job_waste_loads.job_id and j.assigned_to = auth.uid()));

drop policy if exists aura_loads_management_write on public.job_waste_loads;
create policy aura_loads_management_write on public.job_waste_loads for all to authenticated
  using (public.is_management()) with check (public.is_management());

-- Operators: add and edit loads on their own live jobs only
drop policy if exists aura_loads_operator_insert on public.job_waste_loads;
create policy aura_loads_operator_insert on public.job_waste_loads for insert to authenticated
  with check (exists (select 1 from public.jobs j where j.id = job_waste_loads.job_id
    and j.assigned_to = auth.uid() and j.status = any (array['issued','accepted','on_site'])));

drop policy if exists aura_loads_operator_update on public.job_waste_loads;
create policy aura_loads_operator_update on public.job_waste_loads for update to authenticated
  using (exists (select 1 from public.jobs j where j.id = job_waste_loads.job_id
    and j.assigned_to = auth.uid() and j.status = any (array['issued','accepted','on_site'])))
  with check (exists (select 1 from public.jobs j where j.id = job_waste_loads.job_id
    and j.assigned_to = auth.uid() and j.status = any (array['issued','accepted','on_site'])));

drop policy if exists aura_loads_operator_delete on public.job_waste_loads;
create policy aura_loads_operator_delete on public.job_waste_loads for delete to authenticated
  using (exists (select 1 from public.jobs j where j.id = job_waste_loads.job_id
    and j.assigned_to = auth.uid() and j.status = any (array['issued','accepted','on_site'])));

grant select, insert, update, delete on public.job_waste_loads to authenticated;

-- 6. Operator workflow: no accept step needed (issued -> on_site), and the
--    office can send a returned job back to the operator (returned -> on_site).
create or replace function public.operative_update_job_status(p_job_id uuid, p_new_status text)
returns public.jobs language plpgsql security definer set search_path = public as $$
declare
  v_job public.jobs;
begin
  select * into v_job from public.jobs where id = p_job_id for update;
  if not found then raise exception 'Job not found'; end if;

  if not public.is_management() then
    if not exists (select 1 from public.profiles where id = auth.uid() and active = true and role = 'operative') then
      raise exception 'Not authorised';
    end if;
    if v_job.assigned_to is distinct from auth.uid() then
      raise exception 'Job is not assigned to this operative';
    end if;
    if not (
      (v_job.status = 'issued'    and p_new_status in ('accepted','on_site')) or
      (v_job.status = 'accepted'  and p_new_status = 'on_site') or
      (v_job.status = 'on_site'   and p_new_status in ('completed','returned')) or
      (v_job.status = 'completed' and p_new_status = 'returned')
    ) then
      raise exception 'Invalid job status change: % to %', v_job.status, p_new_status;
    end if;
  end if;

  if p_new_status not in ('draft','issued','accepted','on_site','completed','returned','reviewed','closed') then
    raise exception 'Invalid job status';
  end if;

  update public.jobs set status = p_new_status, updated_at = now()
  where id = p_job_id returning * into v_job;
  return v_job;
end $$;

-- Not callable without signing in
revoke execute on function public.operative_update_job_status(uuid, text) from anon, public;
grant execute on function public.operative_update_job_status(uuid, text) to authenticated;
