-- Documents attached to quotes (stored in job-files bucket under quotes/<quote_id>/)
create table if not exists public.quote_files (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references public.quotes(id) on delete cascade,
  file_name text not null,
  storage_path text not null,
  mime_type text,
  size_bytes bigint,
  show_to_customer boolean not null default true,
  created_by uuid default auth.uid(), created_by_name text,
  created_at timestamptz not null default now()
);
create index if not exists quote_files_q on public.quote_files(quote_id);
alter table public.quote_files enable row level security;
drop policy if exists quote_files_mgmt on public.quote_files;
create policy quote_files_mgmt on public.quote_files for all to authenticated using (public.is_management()) with check (public.is_management());
