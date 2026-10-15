-- FICTIONAL criteria, courses and intakes for capstone/demo only. Never treat as RIC policy.
update public.programs set min_qualification_level=1,language_requirements='{"IELTS":6,"PTE":50,"TOEFL":60}',brochure_url=null;
insert into public.intakes(program_id,name,start_date) select id,'February 2027 (demo)','2027-02-22' from public.programs;
insert into public.intakes(program_id,name,start_date) select id,'July 2027 (demo)','2027-07-19' from public.programs;
insert into public.document_types(program_id,name) select id,t from public.programs cross join unnest(array['Passport or photo ID','Academic transcript','English test result']) t on conflict do nothing;
