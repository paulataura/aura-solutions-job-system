-- Resources: what the business physically spends money on (tanker, jetvac, crews, waste disposal groups).
-- Kept in step with a Xero tracking category called "Resource".
alter table public.finance_categories drop constraint if exists finance_categories_kind_check;
alter table public.finance_categories add constraint finance_categories_kind_check check (kind in ('revenue','cost','resource'));
alter table public.finance_categories add column if not exists xero_tracking_option_id text;
alter table public.recurring_costs add column if not exists resource_id uuid references public.finance_categories(id) on delete set null;
alter table public.supplier_rates add column if not exists resource_id uuid references public.finance_categories(id) on delete set null;
insert into public.finance_categories (kind,name,sort) values
 ('resource','Tanker',10),('resource','Jetvac',20),('resource','CCTV crew',30),('resource','Pump technician',40),('resource','General labour',50),
 ('resource','Waste disposal – Non-hazardous liquid',60),('resource','Waste disposal – Sewage, septic & cesspit',61),('resource','Waste disposal – Interceptor & oily',62),
 ('resource','Waste disposal – Hazardous liquid',63),('resource','Waste disposal – Solid & general',64),('resource','Office / shared',90);
