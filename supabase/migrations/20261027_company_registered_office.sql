-- Registered office exactly as Companies House (used in document footers)
alter table public.company_settings add column if not exists registered_office text;
update public.company_settings set registered_office='129 Main Street, Sedgeberrow, Evesham, England, WR11 7UH' where company_number='15761350';
