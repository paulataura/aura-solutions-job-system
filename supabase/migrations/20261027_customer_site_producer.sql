-- A site can belong to a different waste producer (e.g. when the customer is a broker): producer name and SIC code for the WTN
alter table public.customer_sites add column if not exists producer_name text, add column if not exists sic_code text;
