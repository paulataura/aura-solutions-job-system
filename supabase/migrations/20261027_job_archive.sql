-- Archive flag for jobs (test jobs, aborted jobs) - hidden from lists, reversible
alter table public.jobs add column if not exists archived_at timestamptz, add column if not exists archived_by_name text;
create index if not exists jobs_archived_at_idx on public.jobs (archived_at);
