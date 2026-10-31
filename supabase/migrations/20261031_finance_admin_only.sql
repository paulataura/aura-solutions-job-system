-- All finance is admin only. Invoice details move off the job record (operatives can read their own jobs) into job_finance.
create or replace function public.is_finance_admin() returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and active = true and role = 'admin');
$$;
create table if not exists public.job_finance (
  job_id uuid primary key references public.jobs(id) on delete cascade,
  invoice_number text, invoice_net_amount numeric(12,2), invoice_lines jsonb,
  xero_invoice_id text, xero_invoice_status text, xero_invoice_total numeric(12,2), xero_synced_at timestamptz,
  updated_at timestamptz not null default now()
);
insert into public.job_finance (job_id, invoice_number, invoice_net_amount, invoice_lines, xero_invoice_id, xero_invoice_status, xero_invoice_total, xero_synced_at)
select id, invoice_number, invoice_net_amount, invoice_lines, xero_invoice_id, xero_invoice_status, xero_invoice_total, xero_synced_at from public.jobs
where coalesce(invoice_number, xero_invoice_id) is not null or invoice_net_amount is not null or invoice_lines is not null
on conflict (job_id) do nothing;
alter table public.job_finance enable row level security;
create policy aura_job_finance_admin on public.job_finance for all using (public.is_finance_admin()) with check (public.is_finance_admin());
alter table public.jobs drop column if exists invoice_number, drop column if exists invoice_net_amount, drop column if exists invoice_lines,
  drop column if exists xero_invoice_id, drop column if exists xero_invoice_status, drop column if exists xero_invoice_total, drop column if exists xero_synced_at;
drop policy if exists aura_suppliers_management on public.suppliers;
create policy aura_suppliers_admin on public.suppliers for all using (public.is_finance_admin()) with check (public.is_finance_admin());
drop policy if exists aura_po_management on public.purchase_orders;
create policy aura_po_admin on public.purchase_orders for all using (public.is_finance_admin()) with check (public.is_finance_admin());
drop policy if exists aura_fincat_management on public.finance_categories;
create policy aura_fincat_admin on public.finance_categories for all using (public.is_finance_admin()) with check (public.is_finance_admin());
drop policy if exists aura_suprates_management on public.supplier_rates;
create policy aura_suprates_admin on public.supplier_rates for all using (public.is_finance_admin()) with check (public.is_finance_admin());
drop policy if exists aura_recurring_management on public.recurring_costs;
create policy aura_recurring_admin on public.recurring_costs for all using (public.is_finance_admin()) with check (public.is_finance_admin());
create or replace function public.xero_status()
 returns table(connected boolean, tenant_name text, connected_at timestamptz, connected_by_name text, settings jsonb)
 language sql security definer set search_path to 'public' as $function$
  select (c.refresh_token is not null), c.tenant_name, c.connected_at, c.connected_by_name, coalesce(c.settings,'{}'::jsonb)
  from (select 1) d left join public.xero_connection c on c.id = 1 where public.is_finance_admin();
$function$;
