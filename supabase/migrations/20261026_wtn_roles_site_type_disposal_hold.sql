alter table public.jobs
  add column if not exists aura_role text not null default 'carrier',
  add column if not exists carrier_name text,
  add column if not exists carrier_registration text;
alter table public.jobs drop constraint if exists jobs_aura_role_check;
alter table public.jobs add constraint jobs_aura_role_check check (aura_role in ('carrier','broker'));
alter table public.disposal_sites add column if not exists site_type text;
alter table public.job_visits
  add column if not exists disposal_hold_note text,
  add column if not exists disposal_held_at timestamptz;
