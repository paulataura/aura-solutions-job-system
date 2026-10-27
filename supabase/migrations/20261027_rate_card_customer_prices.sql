-- Stage A: rate card (standard costs and prices) and customer price lists. Management only.
create table if not exists public.rate_card_items (
  id uuid primary key default gen_random_uuid(),
  code text,
  name text not null check (btrim(name) <> ''),
  category text not null default 'other' check (category in ('labour','vehicle','equipment','disposal','materials','subcontract','service','admin','other')),
  unit text not null default 'item',
  cost_price numeric(12,2),
  sell_price numeric(12,2),
  vat_rate numeric(5,2) not null default 20,
  supplier text,
  disposal_site_id uuid references public.disposal_sites(id) on delete set null,
  notes text,
  active boolean not null default true,
  sort_order integer not null default 100,
  price_updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists rate_card_items_code_unique on public.rate_card_items (lower(code)) where code is not null;

create table if not exists public.customer_prices (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete cascade,
  rate_card_item_id uuid references public.rate_card_items(id) on delete set null,
  name text,                       -- custom fixed-price service, or a label for the override
  unit text,
  sell_price numeric(12,2) not null,
  cost_price numeric(12,2),         -- optional: our expected cost for a fixed-price service
  is_fixed_price boolean not null default false,
  contract_ref text,
  agreed_on date not null default current_date,
  review_by date,
  notes text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (rate_card_item_id is not null or btrim(coalesce(name,'')) <> '')
);
create index if not exists customer_prices_customer_idx on public.customer_prices (customer_id);

create or replace function public.aura_touch_updated()
returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  if tg_table_name = 'rate_card_items' and tg_op = 'UPDATE'
     and (new.cost_price is distinct from old.cost_price or new.sell_price is distinct from old.sell_price) then
    new.price_updated_at := now();
  end if;
  return new;
end $$;
drop trigger if exists rate_card_items_touch on public.rate_card_items;
create trigger rate_card_items_touch before update on public.rate_card_items for each row execute function public.aura_touch_updated();
drop trigger if exists customer_prices_touch on public.customer_prices;
create trigger customer_prices_touch before update on public.customer_prices for each row execute function public.aura_touch_updated();

alter table public.rate_card_items enable row level security;
alter table public.customer_prices enable row level security;
drop policy if exists aura_rate_card_management on public.rate_card_items;
create policy aura_rate_card_management on public.rate_card_items for all to authenticated using (public.is_management()) with check (public.is_management());
drop policy if exists aura_customer_prices_management on public.customer_prices;
create policy aura_customer_prices_management on public.customer_prices for all to authenticated using (public.is_management()) with check (public.is_management());
grant select, insert, update, delete on public.rate_card_items, public.customer_prices to authenticated;

-- Starter items (no prices yet: fill in on the Rate Card page; delete what you don't use)
insert into public.rate_card_items (code, name, category, unit, sort_order)
select * from (values
 ('LAB-01','Operative','labour','hour',10),('LAB-02','Operative – overtime','labour','hour',11),('LAB-03','Operative – weekend / bank holiday','labour','hour',12),
 ('LAB-04','Supervisor / chargehand','labour','hour',13),('LAB-05','Confined space / man entry team (3 person)','labour','hour',14),('LAB-06','Out-of-hours call-out','labour','item',15),
 ('VEH-01','Jet vac tanker (with driver)','vehicle','hour',20),('VEH-02','Jet vac tanker (with driver)','vehicle','day',21),('VEH-03','Vacuum tanker (with driver)','vehicle','hour',22),
 ('VEH-04','Vacuum tanker (with driver)','vehicle','day',23),('VEH-05','Van-pack jetter','vehicle','hour',24),('VEH-06','CCTV survey unit','vehicle','hour',25),('VEH-07','CCTV survey unit','vehicle','day',26),
 ('VEH-08','Mileage','vehicle','mile',27),('VEH-09','Welfare unit','vehicle','day',28),
 ('EQP-01','Man entry kit (tripod, winch, harnesses)','equipment','day',30),('EQP-02','Gas monitor','equipment','day',31),('EQP-03','Escape sets / breathing apparatus','equipment','day',32),
 ('EQP-04','Submersible pump','equipment','day',33),('EQP-05','Over-pumping set','equipment','day',34),('EQP-06','Generator','equipment','day',35),
 ('EQP-07','Traffic management','equipment','day',36),('EQP-08','Barriers and signage','equipment','day',37),('EQP-09','Pipe / drain plugs','equipment','item',38),
 ('DSP-01','Liquid waste disposal','disposal','tonne',40),('DSP-02','Sludge / silt disposal','disposal','tonne',41),('DSP-03','Interceptor waste disposal','disposal','tonne',42),
 ('DSP-04','Fat, oil and grease disposal','disposal','tonne',43),('DSP-05','Disposal minimum charge','disposal','load',44),('DSP-06','Gate fee','disposal','load',45),
 ('MAT-01','Absorbents','materials','item',50),('MAT-02','Consumables','materials','item',51),('MAT-03','Replacement parts','materials','item',52),('MAT-04','Drain repair materials','materials','item',53),
 ('SUB-01','Subcontractor','subcontract','item',60),('SUB-02','Specialist survey','subcontract','item',61),
 ('SRV-01','Pump station minor service','service','visit',70),('SRV-02','Pump station major service','service','visit',71),('SRV-03','Pump station compound maintenance','service','visit',72),
 ('SRV-04','CCTV drain survey and report','service','item',73),('SRV-05','Drain jetting','service','visit',74),('SRV-06','Interceptor clean','service','visit',75),
 ('SRV-07','Site visit / survey','service','visit',76),('SRV-08','Tank / chamber clean','service','visit',77),
 ('ADM-01','Waste transfer note','admin','item',80),('ADM-02','Hazardous waste consignment note','admin','item',81),('ADM-03','Report writing','admin','hour',82),('ADM-04','RAMS / method statement','admin','item',83)
) as v(code,name,category,unit,sort_order)
where not exists (select 1 from public.rate_card_items);
