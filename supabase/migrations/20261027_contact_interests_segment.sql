-- Contacts: interests (the four service headings) and domestic/commercial, so mailing lists can be filtered
alter table public.customer_contacts add column if not exists interests text[] not null default '{}', add column if not exists segment text not null default 'commercial';
alter table public.customer_contacts add constraint customer_contacts_segment_check check (segment in ('domestic','commercial'));
insert into public.mailing_lists(name,description) values ('Regulation and compliance updates','Changes to waste rules, e.g. Digital Waste Tracking and WTN requirements') on conflict (name) do nothing;
