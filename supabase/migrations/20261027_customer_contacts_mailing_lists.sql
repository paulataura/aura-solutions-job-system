-- Customer contacts (several per customer, by role) and mailing lists – start of the CRM. Applied 27 Oct 2026.
create table if not exists public.customer_contacts (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete cascade,
  full_name text not null, job_title text, email text, phone text, mobile text,
  roles text[] not null default '{}', is_primary boolean not null default false, notes text,
  active boolean not null default true, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create index if not exists customer_contacts_customer_idx on public.customer_contacts(customer_id);
alter table public.customer_contacts enable row level security;
create policy aura_customer_contacts_management on public.customer_contacts for all to authenticated using (public.is_management()) with check (public.is_management());
create table if not exists public.mailing_lists (id uuid primary key default gen_random_uuid(), name text not null unique, description text, active boolean not null default true, created_at timestamptz not null default now());
alter table public.mailing_lists enable row level security;
create policy aura_mailing_lists_management on public.mailing_lists for all to authenticated using (public.is_management()) with check (public.is_management());
create table if not exists public.contact_mailing_lists (contact_id uuid not null references public.customer_contacts(id) on delete cascade, list_id uuid not null references public.mailing_lists(id) on delete cascade, subscribed_at timestamptz not null default now(), consent_source text, added_by_name text, primary key (contact_id, list_id));
alter table public.contact_mailing_lists enable row level security;
create policy aura_contact_mailing_lists_management on public.contact_mailing_lists for all to authenticated using (public.is_management()) with check (public.is_management());
insert into public.mailing_lists(name,description) values ('Newsletter','General news and updates from Aura Solutions'),('Service reminders','Reminders when maintenance or servicing is due'),('Offers and promotions','Occasional offers and seasonal promotions') on conflict (name) do nothing;
