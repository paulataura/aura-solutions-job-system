alter table public.jobs
  add column if not exists customer_po text,
  add column if not exists invoiced_at timestamptz,
  add column if not exists invoice_number text,
  add column if not exists invoiced_by_name text;
alter table public.company_settings
  add column if not exists company_number text,
  add column if not exists vat_number text;
