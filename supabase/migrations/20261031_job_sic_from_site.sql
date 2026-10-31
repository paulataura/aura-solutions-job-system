-- The WTN SIC code is the producer's: fill the job's planned SIC from the job's producer, then the site, then the customer, when left blank.
create or replace function public.aura_job_sic_default() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if coalesce(trim(new.planned_sic_code),'') = '' then
    new.planned_sic_code := coalesce(nullif(trim(new.producer_sic_code),''),
      (select nullif(trim(s.sic_code),'') from public.customer_sites s where s.id = new.customer_site_id),
      (select nullif(trim(c.sic_code),'') from public.customers c where c.id = new.customer_id));
  end if;
  return new;
end $$;
drop trigger if exists aura_job_sic_default on public.jobs;
create trigger aura_job_sic_default before insert or update of planned_sic_code, customer_site_id, customer_id, producer_sic_code on public.jobs
  for each row execute function public.aura_job_sic_default();
update public.jobs set planned_sic_code = planned_sic_code where coalesce(trim(planned_sic_code),'') = '' and status not in ('closed','aborted');
update public.job_visits v set waste_sic_code = j.planned_sic_code from public.jobs j
 where j.id = v.job_id and coalesce(trim(v.waste_sic_code),'') = '' and j.planned_sic_code is not null and v.completed_at is null and j.status not in ('closed','aborted');
