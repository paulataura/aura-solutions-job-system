-- Track when the job card / WTN were sent to the customer (shown like the invoice stage)
alter table public.jobs add column if not exists documents_sent_at timestamptz, add column if not exists documents_sent_by_name text, add column if not exists documents_sent_to text;
