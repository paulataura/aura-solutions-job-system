-- Suppliers, purchase orders (ASG-PO-0001…, one supplier and one job each; a job can have several) and the job's invoice value for margins.
-- Applied 30 Oct 2026 – see the app's finance section. Tables: suppliers, purchase_orders (+ trigger aura_po_defaults, sequence po_number_seq); jobs.invoice_net_amount.
alter table public.jobs add column if not exists invoice_net_amount numeric(12,2);
