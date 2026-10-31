-- Finance categories (revenue and cost, each mapped to a Xero GL code), supplier agreed rates, recurring overheads,
-- and the invoice split by category on each job – for reporting where the money is made and spent.
create table if not exists public.finance_categories (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('revenue','cost')),
  name text not null,
  account_code text,
  tax_type text,
  is_overhead boolean not null default false,
  xero_tracking_option text,
  sort integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create table if not exists public.supplier_rates (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references public.suppliers(id) on delete cascade,
  description text not null,
  unit text,
  unit_price numeric(12,2),
  category_id uuid references public.finance_categories(id) on delete set null,
  tax_type text,
  valid_from date,
  valid_to date,
  notes text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.recurring_costs (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid references public.suppliers(id) on delete set null,
  supplier_name text,
  description text not null,
  category_id uuid references public.finance_categories(id) on delete set null,
  account_code text,
  amount numeric(12,2) not null,
  tax_type text,
  vat_rate numeric(5,2) not null default 20,
  frequency text not null default 'monthly' check (frequency in ('weekly','monthly','quarterly','annually')),
  start_date date not null default current_date,
  end_date date,
  notes text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.jobs add column if not exists invoice_lines jsonb;
alter table public.finance_categories enable row level security;
alter table public.supplier_rates enable row level security;
alter table public.recurring_costs enable row level security;
create policy aura_fincat_management on public.finance_categories for all using (public.is_management()) with check (public.is_management());
create policy aura_suprates_management on public.supplier_rates for all using (public.is_management()) with check (public.is_management());
create policy aura_recurring_management on public.recurring_costs for all using (public.is_management()) with check (public.is_management());
create index if not exists supplier_rates_supplier_idx on public.supplier_rates(supplier_id);

insert into public.finance_categories (kind,name,account_code,tax_type,is_overhead,sort) values
 ('revenue','Waste removal & disposal','200','OUTPUT2',false,10),
 ('revenue','Tanker / liquid waste','200','OUTPUT2',false,20),
 ('revenue','Drainage & jetting','200','OUTPUT2',false,30),
 ('revenue','Maintenance contracts','200','OUTPUT2',false,40),
 ('revenue','Consultancy & other','200','OUTPUT2',false,50),
 ('cost','Disposal / tipping','327','INPUT2',false,10),
 ('cost','Haulage','328','INPUT2',false,20),
 ('cost','Tanker / plant hire','329','INPUT2',false,30),
 ('cost','Materials','310','INPUT2',false,40),
 ('cost','Subcontractor','328','INPUT2',false,50),
 ('cost','Other direct cost','325','INPUT2',false,60),
 ('cost','Vehicles & fuel','449','INPUT2',true,110),
 ('cost','Insurance','433','EXEMPTINPUT',true,120),
 ('cost','Rent & rates','469','INPUT2',true,130),
 ('cost','Software & IT','463','INPUT2',true,140),
 ('cost','Phone & internet','489','INPUT2',true,150),
 ('cost','Accountancy & legal','401','INPUT2',true,160),
 ('cost','Marketing','400','INPUT2',true,170),
 ('cost','Repairs & maintenance','473','INPUT2',true,180),
 ('cost','PPE & uniform','405','INPUT2',true,190),
 ('cost','Subscriptions','485','INPUT2',true,200),
 ('cost','Other overheads','429','INPUT2',true,210);
