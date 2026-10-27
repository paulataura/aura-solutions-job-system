-- Allow office-added documents on a job (Additional documents box)
alter table public.job_files drop constraint job_files_file_type_check;
alter table public.job_files add constraint job_files_file_type_check check (file_type = any (array['job_attachment','arrival_photo','completion_photo','waste_evidence','progress_photo','work_photo','load_photo','disposal_ticket','job_sheet_pdf','wtn_pdf','issue_photo','reference_photo','office_document']));
