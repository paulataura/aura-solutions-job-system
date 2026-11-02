-- CRM: leads (prospects), activity log with follow-ups, quotes with stages and lines, mail shots
create table if not exists public.crm_leads (
  id uuid primary key default gen_random_uuid(),
  company_name text not null,
  contact_name text, job_title text, email text, phone text, address text, postcode text,
  source text, stage text not null default 'new' check (stage in ('new','contacted','meeting','quoting','won','lost')),
  segment text default 'commercial', interests text[] default '{}',
  estimated_value numeric, notes text, lost_reason text,
  owner_id uuid references auth.users(id), owner_name text,
  next_action text, next_action_on date,
  customer_id uuid references public.customers(id) on delete set null,
  enquiry_id uuid references public.website_enquiries(id) on delete set null,
  created_by uuid default auth.uid(), created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.crm_activities (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid references public.customers(id) on delete cascade,
  lead_id uuid references public.crm_leads(id) on delete cascade,
  contact_id uuid references public.customer_contacts(id) on delete set null,
  contract_id uuid references public.contracts(id) on delete set null,
  quote_id uuid,
  kind text not null default 'call' check (kind in ('call','email','meeting','site_visit','note','mail_shot','quote')),
  subject text, details text,
  follow_up_on date, follow_up_note text, follow_up_done_at timestamptz,
  owner_id uuid references auth.users(id), owner_name text,
  created_by uuid default auth.uid(), created_by_name text, created_at timestamptz not null default now()
);
create index if not exists crm_activities_customer on public.crm_activities(customer_id);
create index if not exists crm_activities_lead on public.crm_activities(lead_id);
create index if not exists crm_activities_follow on public.crm_activities(follow_up_on) where follow_up_done_at is null;

create sequence if not exists public.aura_quote_number_seq;
create table if not exists public.quotes (
  id uuid primary key default gen_random_uuid(),
  quote_number text unique,
  version int not null default 1,
  customer_id uuid references public.customers(id) on delete set null,
  lead_id uuid references public.crm_leads(id) on delete set null,
  customer_site_id uuid references public.customer_sites(id) on delete set null,
  site_address text, postcode text,
  contact_name text, contact_email text, contact_phone text,
  title text not null default 'Quotation',
  intro text, terms text, internal_notes text,
  status text not null default 'draft' check (status in ('draft','sent','accepted','declined','expired')),
  vat_rate numeric not null default 20,
  quote_date date not null default current_date,
  valid_until date default (current_date + 30),
  sent_at timestamptz, accepted_at timestamptz, accepted_by text, declined_at timestamptz, decline_reason text,
  customer_po text,
  created_by uuid default auth.uid(), created_by_name text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.quote_stages (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references public.quotes(id) on delete cascade,
  sort int not null default 0,
  title text, description text,
  optional boolean not null default false,
  job_type_id uuid references public.job_types(id),
  job_id uuid references public.jobs(id) on delete set null,
  accepted boolean
);
create table if not exists public.quote_lines (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references public.quotes(id) on delete cascade,
  stage_id uuid references public.quote_stages(id) on delete cascade,
  sort int not null default 0,
  rate_card_item_id uuid references public.rate_card_items(id) on delete set null,
  description text not null default '',
  qty numeric not null default 1, unit text, unit_price numeric not null default 0
);
create index if not exists quote_stages_q on public.quote_stages(quote_id);
create index if not exists quote_lines_q on public.quote_lines(quote_id);
alter table public.jobs add column if not exists quote_id uuid references public.quotes(id) on delete set null;
alter table public.crm_activities drop constraint if exists crm_activities_quote_fk;
alter table public.crm_activities add constraint crm_activities_quote_fk foreign key (quote_id) references public.quotes(id) on delete set null;

create or replace function public.aura_quote_number() returns trigger language plpgsql set search_path = public as $$
begin
  if new.quote_number is null or new.quote_number = '' then
    new.quote_number := 'Q-' || to_char(now() at time zone 'Europe/London', 'YYMM') || '-' || lpad(nextval('public.aura_quote_number_seq')::text, 4, '0');
  end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists aura_quote_number on public.quotes;
create trigger aura_quote_number before insert or update on public.quotes for each row execute function public.aura_quote_number();

create table if not exists public.mail_shots (
  id uuid primary key default gen_random_uuid(),
  name text not null, subject text, preheader text,
  blocks jsonb not null default '[]',
  list_ids uuid[] default '{}', segment text, interests text[] default '{}',
  status text not null default 'draft' check (status in ('draft','sent')),
  sent_at timestamptz, sent_by_name text, recipient_count int,
  created_by uuid default auth.uid(), created_by_name text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.mail_shot_recipients (
  mail_shot_id uuid not null references public.mail_shots(id) on delete cascade,
  contact_id uuid references public.customer_contacts(id) on delete set null,
  customer_id uuid references public.customers(id) on delete set null,
  email text not null, name text, company text,
  sent_at timestamptz not null default now(),
  primary key (mail_shot_id, email)
);
alter table public.customer_contacts add column if not exists unsubscribed_at timestamptz;
alter table public.customer_contacts add column if not exists last_contacted_at timestamptz;

do $$ declare t text; begin
  foreach t in array array['crm_leads','crm_activities','quotes','quote_stages','quote_lines','mail_shots','mail_shot_recipients'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t||'_mgmt', t);
    execute format('create policy %I on public.%I for all to authenticated using (public.is_management()) with check (public.is_management())', t||'_mgmt', t);
  end loop;
end $$;

-- accepted quote -> draft jobs, one per chosen stage (stage 2+ linked as stages of the first)
create or replace function public.aura_quote_to_jobs(p_quote_id uuid, p_stage_ids uuid[])
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare q public.quotes%rowtype; s public.customer_sites%rowtype; st record; v_job uuid; v_parent uuid; v_type uuid; v_waste boolean;
  v_scope text; n int := 0; v_no text; v_base text;
begin
  if not public.is_management() then raise exception 'Only management users can turn quotes into jobs'; end if;
  select * into q from public.quotes where id = p_quote_id;
  if not found then raise exception 'Quote not found'; end if;
  if q.customer_id is null then raise exception 'Make the prospect a customer first'; end if;
  if q.customer_site_id is not null then select * into s from public.customer_sites where id = q.customer_site_id; end if;
  v_base := 'ASG-' || to_char(now() at time zone 'Europe/London', 'YYYYMMDD-HH24MISS');
  for st in select * from public.quote_stages where quote_id = q.id and id = any(p_stage_ids) and job_id is null order by sort loop
    n := n + 1;
    v_type := coalesce(st.job_type_id, (select id from public.job_types where code = 'site_visit' limit 1));
    select coalesce(requires_waste_workflow, false) into v_waste from public.job_types where id = v_type;
    select string_agg(description || case when qty <> 1 or coalesce(unit,'') <> '' then ' (' || trim(to_char(qty, 'FM999999990.##')) || coalesce(' ' || nullif(unit,''), '') || ')' else '' end, E'\n' order by sort)
      into v_scope from public.quote_lines where stage_id = st.id;
    v_no := v_base || case when n > 1 or v_parent is not null then '-S' || n else '' end;
    insert into public.jobs (job_number, status, created_by, updated_at, customer_id, customer_site_id, job_type_id,
      site_address, postcode, site_latitude, site_longitude, google_place_id, what3words, site_location_notes,
      site_contact_name, site_contact_phone, reference, customer_po, scope_of_work, waste_expected,
      stage_parent_job_id, stage_number, stage_title, quote_id)
    values (v_no, 'draft', auth.uid(), now(), q.customer_id, q.customer_site_id, v_type,
      coalesce(s.site_address, q.site_address, ''), coalesce(s.postcode, q.postcode), s.site_latitude, s.site_longitude, s.google_place_id, s.what3words, s.site_location_notes,
      coalesce(s.site_contact_name, q.contact_name), coalesce(s.site_contact_phone, q.contact_phone), q.quote_number || ' – ' || coalesce(nullif(st.title,''), q.title), q.customer_po,
      coalesce(nullif(st.title,''), q.title) || coalesce(E'\n' || nullif(st.description,''), '') || coalesce(E'\n' || v_scope, ''), coalesce(v_waste, false),
      v_parent, case when v_parent is null then null else n end, nullif(st.title,''), q.id)
    returning id into v_job;
    if v_parent is null then v_parent := v_job; end if;
    insert into public.job_scope_sections (job_id, position, title, details)
      values (v_job, 1, coalesce(nullif(st.title,''), q.title), coalesce(nullif(trim(coalesce(st.description,'') || E'\n' || coalesce(v_scope,'')), ''), q.title));
    update public.quote_stages set job_id = v_job, accepted = true where id = st.id;
  end loop;
  return jsonb_build_object('created', n, 'first_job_id', v_parent);
end $$;
grant execute on function public.aura_quote_to_jobs(uuid, uuid[]) to authenticated;
