-- Extra office documents (added during review) can be sent with the job card / WTN and appear on the customer's link page
alter table public.job_document_links add column if not exists extra_documents jsonb not null default '[]'::jsonb;
drop function if exists public.aura_create_document_link(uuid,text,text,text);
create or replace function public.aura_create_document_link(p_job_id uuid, p_job_card_path text, p_wtn_path text, p_sent_to text, p_extra jsonb default '[]'::jsonb)
returns text language plpgsql security definer set search_path = public, extensions as $$
declare v_token text; v_name text;
begin
  if not public.is_management() then raise exception 'Not allowed'; end if;
  v_token := translate(encode(extensions.gen_random_bytes(12), 'base64'), '+/=', '-_');
  select full_name into v_name from public.profiles where id = auth.uid();
  insert into public.job_document_links (token_hash, job_id, job_card_path, wtn_path, sent_to, sent_by_name, extra_documents)
  values (encode(extensions.digest(v_token,'sha256'),'hex'), p_job_id, p_job_card_path, p_wtn_path, nullif(btrim(p_sent_to),''), v_name, coalesce(p_extra,'[]'::jsonb));
  return v_token;
end $$;
drop function if exists public.customer_documents_get(text);
create or replace function public.customer_documents_get(p_token text)
returns table (job_number text, customer_name text, site_name text, job_date date, reference text, customer_po text, job_card_path text, wtn_path text, created_at timestamptz, extra_documents jsonb)
language plpgsql security definer set search_path = public, extensions as $$
declare r public.job_document_links;
begin
  select * into r from public.job_document_links l where l.token_hash = encode(extensions.digest(coalesce(p_token,''),'sha256'),'hex');
  if not found then raise exception 'This link is not valid.'; end if;
  if r.expires_at < now() then raise exception 'This link has expired. Please contact Aura Solutions for a copy.'; end if;
  if r.opened_at is null then update public.job_document_links set opened_at = now() where id = r.id; end if;
  return query select j.job_number, c.company_name, s.site_name, j.job_date, j.reference, j.customer_po, r.job_card_path, r.wtn_path, r.created_at, r.extra_documents
    from public.jobs j left join public.customers c on c.id = j.customer_id left join public.customer_sites s on s.id = j.customer_site_id where j.id = r.job_id;
end $$;
revoke all on function public.aura_create_document_link(uuid,text,text,text,jsonb) from public;
revoke all on function public.customer_documents_get(text) from public;
grant execute on function public.aura_create_document_link(uuid,text,text,text,jsonb) to authenticated;
grant execute on function public.customer_documents_get(text) to anon, authenticated;
