-- Operatives can read the customer and site of jobs assigned to them (and nothing else).
drop policy if exists aura_customers_operative_read on public.customers;
create policy aura_customers_operative_read on public.customers for select to authenticated
  using (exists (select 1 from public.jobs j where j.customer_id = customers.id and j.assigned_to = auth.uid()));
drop policy if exists aura_customer_sites_operative_read on public.customer_sites;
create policy aura_customer_sites_operative_read on public.customer_sites for select to authenticated
  using (exists (select 1 from public.jobs j where j.customer_site_id = customer_sites.id and j.assigned_to = auth.uid()));

-- Third-party contractors: show the customer name, never the site contact; Aura is their contact.
drop function if exists public.contractor_get_job_contacts(text);
create function public.contractor_get_job_contacts(p_token text)
returns table(site_contact_name text, site_contact_phone text, aura_contact_name text, aura_contact_phone text, customer_name text)
language plpgsql security definer set search_path = public, extensions as $$
declare v_job_id uuid;
begin
  v_job_id := public.contractor_validate_job_token(p_token);
  return query
  select null::text, null::text,
    coalesce(nullif(trim(p.full_name), ''), nullif(trim(j.issued_by_name), ''), 'Aura Solutions')::text,
    p.phone::text, c.company_name::text
  from public.jobs j
  left join public.profiles p on p.id = j.created_by
  left join public.customers c on c.id = j.customer_id
  where j.id = v_job_id;
end $$;
grant execute on function public.contractor_get_job_contacts(text) to anon, authenticated;
