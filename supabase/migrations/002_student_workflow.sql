-- Upgrade v1 in place. Run once, after a backup; never run schema-v1.sql on an existing database.
begin;
alter table public.programs add column brochure_url text, add column min_qualification_level int check(min_qualification_level between 1 and 5),add column language_requirements jsonb;
create table public.intakes(id uuid primary key default gen_random_uuid(),program_id uuid not null references public.programs(id),name text not null,start_date date not null,is_open boolean not null default true);
create table public.document_types(id uuid primary key default gen_random_uuid(),program_id uuid not null references public.programs(id),name text not null,required boolean not null default true,unique(program_id,name));
alter table public.prospects add column student_id uuid unique references auth.users(id),add column closed_reason text,add column current_application_id uuid,add column cycle int not null default 1,add column stage_entered_at timestamptz not null default now();
alter table public.prospects drop constraint prospects_stage_check;

-- A current application pointer preserves historical attempts without guessing by program.
alter table public.applications drop constraint applications_prospect_id_program_id_key;
alter table public.applications drop constraint applications_status_check;
alter table public.applications add constraint applications_status_check check(status in ('Draft','Submitted','Under Review','Accepted','Rejected','Withdrawn'));
alter table public.applications add column intake_id uuid references public.intakes(id),add column cycle int not null default 1,add column details jsonb not null default '{}',add column decision_note text,add column decided_by uuid references public.staff_users(id),add column decided_at timestamptz,add column offer_expires_at timestamptz,add column offer_snapshot jsonb;
alter table public.applications add constraint applications_cycle_program_unique unique(prospect_id,cycle,program_id);
alter table public.prospects add constraint prospects_current_application_fk foreign key(current_application_id) references public.applications(id);
create table public.qualifications(id uuid primary key default gen_random_uuid(),prospect_id uuid not null references public.prospects(id),program_id uuid not null references public.programs(id),cycle int not null,details jsonb not null default '{}',submitted_at timestamptz,auto_result text check(auto_result in ('Pass','Review','Fail')),auto_reasons jsonb,decision text,reviewed_by uuid references public.staff_users(id),review_note text,unique(prospect_id,cycle));
create table public.documents(id uuid primary key default gen_random_uuid(),application_id uuid not null references public.applications(id),document_type_id uuid not null references public.document_types(id),student_id uuid not null references auth.users(id),storage_path text not null unique,file_name text not null,mime_type text not null check(mime_type in ('application/pdf','image/png','image/jpeg')),size_bytes int not null check(size_bytes between 1 and 10485760),status text not null default 'Uploading' check(status in ('Uploading','Pending','Verified','Rejected','Superseded')),rejection_reason text,verified_by uuid references public.staff_users(id),uploaded_at timestamptz not null default now(),reviewed_at timestamptz);
create unique index documents_current_type on public.documents(application_id,document_type_id) where status in ('Pending','Verified','Rejected');
alter table public.followups alter column staff_id drop not null;
alter table public.followups add column kind text not null default 'Manual',add column completed_at timestamptz,add column escalated_at timestamptz;
create unique index workflow_open_task on public.followups(prospect_id,kind) where not completed and kind<>'Manual';
alter table public.audit_log add column actor_type text not null default 'staff' check(actor_type in ('staff','student','system')),add column actor_id uuid;
alter table public.stage_history add column closed_reason text,add column cycle int not null default 1,add column actor_type text,add column actor_id uuid;
create table public.email_outbox(id uuid primary key default gen_random_uuid(),prospect_id uuid references public.prospects(id),recipient text not null,template text not null,payload jsonb not null,dedupe_key text not null unique,status text not null default 'Queued' check(status in ('Queued','Sending','Sent','Logged','Failed')),attempts int not null default 0,next_attempt_at timestamptz not null default now(),created_at timestamptz not null default now(),sent_at timestamptz,claim_token uuid,last_error text);
create index email_due on public.email_outbox(next_attempt_at) where status in ('Queued','Failed','Sending');
create index on public.documents(application_id);
create index on public.qualifications(prospect_id);
create index on public.intakes(program_id);
-- Preserve identity and history while mapping old terminal/draft states.
insert into public.stage_history(prospect_id,from_stage,to_stage,closed_reason,actor_type) select id,'Withdrawn','Closed','Withdrawn','system' from public.prospects where stage='Withdrawn';
update public.prospects set stage='Closed',closed_reason='Withdrawn' where stage='Withdrawn';
update public.prospects set closed_reason=coalesce(closed_reason,'Legacy closure') where stage='Closed';
update public.prospects p set current_application_id=(select a.id from public.applications a where a.prospect_id=p.id order by created_at desc,id limit 1),stage_entered_at=coalesce((select max(changed_at) from public.stage_history h where h.prospect_id=p.id),created_at);
insert into public.audit_log(prospect_id,action,actor_type,detail) select p.id,'Legacy application migrated','system',jsonb_build_object('old_application',to_jsonb(a),'new_status','Draft','reason','New mandatory application details and document evidence required') from public.prospects p join public.applications a on a.id=p.current_application_id where p.stage='Application';
update public.applications a set status='Draft' from public.prospects p where p.current_application_id=a.id and p.stage='Application';
insert into public.stage_history(prospect_id,from_stage,to_stage,actor_type) select p.id,'Application','Qualified','system' from public.prospects p join public.applications a on a.id=p.current_application_id where p.stage='Application' and a.status='Draft';
update public.prospects p set stage='Qualified' from public.applications a where p.current_application_id=a.id and p.stage='Application' and a.status='Draft';
alter table public.prospects add constraint prospects_stage_check check(stage in ('Enquiry','Qualification review','Qualified','Application','Offer','Enrolled','Closed'));
-- New automation gets a fresh grace period; original event dates remain in history.
update public.prospects set stage_entered_at=now() where stage not in ('Closed','Enrolled');
alter table public.prospects add constraint prospect_closure_reason check((stage='Closed')=(closed_reason is not null));
-- Actor-aware audit and guarded state engine. Helpers are private to definer functions.
create function public.wf_audit(pid uuid,event text,extra jsonb default '{}') returns void language plpgsql security definer set search_path=public as $$ begin
 insert into audit_log(prospect_id,staff_id,actor_type,actor_id,action,detail) values(pid,case when crm_role() is not null then auth.uid() end,case when auth.uid() is null then 'system' when crm_role() is not null then 'staff' else 'student' end,auth.uid(),event,extra);
end $$;
create function public.wf_stage(pid uuid,target text,reason text default null) returns void language plpgsql security definer set search_path=public as $$ declare p prospects;begin
 select * into p from prospects where id=pid for update;
 if p.id is null or not ((p.stage='Enquiry' and target='Qualification review') or (p.stage='Qualification review' and target='Qualified') or (p.stage='Qualified' and target='Application') or (p.stage='Application' and target='Offer') or (p.stage='Offer' and target='Enrolled') or (p.stage not in ('Enrolled','Closed') and target='Closed') or (p.stage='Closed' and target='Enquiry')) then raise exception 'Invalid stage transition';end if;
 if target='Closed' and reason not in ('No response','Not eligible','Application rejected','Offer declined','Offer lapsed','Withdrawn') then raise exception 'Invalid closure reason';end if;
 if target='Closed' and reason is null then raise exception 'Closure reason required';end if;
 update prospects set stage=target,closed_reason=case when target='Closed' then reason end,stage_entered_at=clock_timestamp() where id=pid;
 insert into stage_history(prospect_id,from_stage,to_stage,closed_reason,cycle,actor_type,actor_id,changed_at) values(pid,p.stage,target,reason,p.cycle,case when auth.uid() is null then 'system' when crm_role() is not null then 'staff' else 'student' end,auth.uid(),clock_timestamp());
 perform wf_audit(pid,'Stage changed',jsonb_build_object('from',p.stage,'to',target,'reason',reason));
 if target='Closed' then
 update applications set status='Withdrawn' where id=p.current_application_id and status not in ('Rejected','Withdrawn');
 update followups set completed=true,completed_at=now() where prospect_id=pid and not completed;
 end if;
end $$;
create function public.wf_task(pid uuid,title_text text,task_kind text,working_days int) returns void language plpgsql security definer set search_path=public as $$ declare due timestamptz:=now();n int:=0;begin
 while n<working_days loop due:=due+interval '1 day';if extract(isodow from due at time zone 'Australia/Darwin')<6 then n:=n+1;end if;end loop;
 insert into followups(prospect_id,staff_id,title,due_at,kind) select id,assigned_staff_id,title_text,due,task_kind from prospects where id=pid on conflict do nothing;
end $$;
-- Email events commit with business records. Network delivery is retried separately.
create function public.wf_email(pid uuid,template_name text,event_key text,extra jsonb default '{}',to_address text default null) returns void language plpgsql security definer set search_path=public as $$ begin
 insert into email_outbox(prospect_id,recipient,template,payload,dedupe_key) select id,coalesce(to_address,email),template_name,jsonb_build_object('name',full_name,'stage',stage)||extra,event_key from prospects where id=pid on conflict(dedupe_key) do nothing;
end $$;
create or replace function public.submit_enquiry(input jsonb) returns jsonb language plpgsql security definer set search_path=public as $$
declare pid uuid;existing boolean;eid uuid:=gen_random_uuid();em text:=lower(trim(input->>'email'));ph text:=regexp_replace(input->>'phone','[ ()-]','','g');owner_id uuid;p prospects;g programs;
begin
 if input->>'consent' is distinct from 'true' or coalesce(length(trim(input->>'full_name')),0) not between 2 and 120 or em is null or em !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' or length(em)>254 or ph is null or ph !~ '^\+?[0-9]{7,15}$' or coalesce(length(trim(input->>'address')),0) not between 5 and 500 or length(coalesce(input->>'message',''))>2000 then raise exception 'Invalid enquiry';end if;
 select * into g from programs where id=(input->>'program_id')::uuid and active;if g.id is null then raise exception 'Invalid program';end if;
 perform pg_advisory_xact_lock(hashtext('nexus-assignment'));
 select * into p from prospects where email=em for update;pid:=p.id;existing:=found;
 if exists(select 1 from enquiries where prospect_id=pid and enquiry_date>now()-interval '1 minute') then raise exception 'Please wait before submitting again';end if;
 if pid is null then
 select s.id into owner_id from staff_users s left join prospects px on px.assigned_staff_id=s.id and px.stage not in ('Closed','Enrolled') where s.active and s.role='recruitment' group by s.id order by count(px.id),s.id limit 1;
 insert into prospects(full_name,email,phone,address,assigned_staff_id) values(trim(input->>'full_name'),em,ph,trim(input->>'address'),owner_id) returning id into pid;
 insert into stage_history(prospect_id,to_stage,actor_type) values(pid,'Enquiry','system');
 elsif p.stage='Closed' then
 -- Reopening is a new attempt; old assessments, offers and documents stay intact.
 update prospects set cycle=cycle+1,current_application_id=null where id=pid;
 perform wf_stage(pid,'Enquiry');
 end if;
 insert into enquiries(id,prospect_id,program_id,message,duplicate_flag) values(eid,pid,g.id,coalesce(input->>'message',''),existing or exists(select 1 from prospects where regexp_replace(phone,'[ ()-]','','g')=ph and id<>pid));
 perform wf_email(pid,'Brochure',eid::text,jsonb_build_object('program',g.name,'brochure_url',g.brochure_url));
 perform wf_audit(pid,'Enquiry received',jsonb_build_object('reference',eid));
 return jsonb_build_object('reference',eid,'message','Your enquiry has been received. Create or sign in to your student account to continue.');
end $$;
-- Confirmed Auth email is required before linking a student to any existing enquiry.
create policy programs_staff on public.programs for select to authenticated using(crm_role() in ('recruitment','administration','admin'));
create function public.student_prospect() returns uuid language plpgsql security definer set search_path=public as $$ declare uid uuid:=auth.uid();em text;pid uuid;begin
 if uid is null or exists(select 1 from staff_users where id=uid) then raise exception 'Student access required';end if;
 select lower(email) into em from auth.users where id=uid and email_confirmed_at is not null;if em is null then raise exception 'Verify your email before opening the portal';end if;
 select id into pid from prospects where student_id=uid;
 if pid is null then
 update prospects set student_id=uid where email=em and student_id is null returning id into pid;
 end if;
 if pid is null then raise exception 'Submit an enquiry using your verified account email first';end if;
 return pid;
end $$;
create function public.wf_validate_qualification(v jsonb,all_fields boolean) returns void language plpgsql set search_path=public as $$ declare level text:=v->>'highest_qualification';t text:=v->>'language_test_type';score numeric;dt date;begin
 if jsonb_typeof(v)<>'object' then raise exception 'Invalid details';end if;
 if all_fields and (coalesce(level,'')='' or coalesce(v->>'institution','')='' or coalesce(v->>'year_completed','')='' or coalesce(t,'')='' or coalesce(v->>'intake_id','')='') then raise exception 'Complete all required qualification fields';end if;
 if level is not null and level not in ('Year 12 or equivalent','Certificate','Diploma','Bachelor degree','Master degree or higher') then raise exception 'Invalid qualification';end if;
 if coalesce(length(v->>'institution'),0)>150 or coalesce(length(v->>'result'),0)>100 then raise exception 'Details too long';end if;
 if nullif(v->>'year_completed','') is not null and (v->>'year_completed')::int not between 1970 and extract(year from now()) then raise exception 'Invalid completion year';end if;
 if t is not null and t not in ('IELTS','PTE','TOEFL','None taken') then raise exception 'Invalid language test';end if;
 if t is not null and t<>'None taken' then
 if all_fields and (nullif(v->>'language_score','') is null or nullif(v->>'test_date','') is null) then raise exception 'Language score and test date required';end if;
 score:=nullif(v->>'language_score','')::numeric;
 if score is not null and (score<case when t='PTE' then 10 else 0 end or score>case t when 'IELTS' then 9 when 'PTE' then 90 else 120 end) then raise exception 'Language score out of range';end if;
 dt:=nullif(v->>'test_date','')::date;
 if dt is not null and (dt>current_date or dt<current_date-interval '2 years') then raise exception 'Test must be within the past two years';end if;
 end if;
end $$;
create function public.wf_eligibility(gid uuid,v jsonb) returns jsonb language plpgsql set search_path=public as $$ declare g programs;level int;minimum numeric;score numeric;margin numeric;reasons jsonb:='[]';result text:='Pass';t text:=v->>'language_test_type';begin
 select * into g from programs where id=gid;
 if g.min_qualification_level is null or g.language_requirements is null then return '{"result":"Review","reasons":["Program criteria are not configured"]}';end if;
 level:=case v->>'highest_qualification' when 'Year 12 or equivalent' then 1 when 'Certificate' then 2 when 'Diploma' then 3 when 'Bachelor degree' then 4 when 'Master degree or higher' then 5 end;
 if level is null then result:='Review';reasons:=reasons||'"Qualification needs review"'::jsonb;
 elsif level<g.min_qualification_level then result:='Fail';reasons:=reasons||'"Academic qualification is below the program minimum"'::jsonb;end if;
 minimum:=(g.language_requirements->>t)::numeric;score:=nullif(v->>'language_score','')::numeric;margin:=case t when 'IELTS' then 0.5 else 5 end;
 if t='None taken' or minimum is null or score is null then if result<>'Fail' then result:='Review';end if;reasons:=reasons||'"English language evidence needs staff review"'::jsonb;
 elsif score<minimum-margin then result:='Fail';reasons:=reasons||'"Language score is below the program minimum"'::jsonb;
 elsif score<minimum then if result<>'Fail' then result:='Review';end if;reasons:=reasons||'"Language score is borderline"'::jsonb;end if;
 if result='Pass' then reasons:='["All configured entry criteria met"]';end if;
 return jsonb_build_object('result',result,'reasons',reasons);
end $$;
create function public.wf_application(pid uuid,gid uuid,intake uuid) returns uuid language plpgsql security definer set search_path=public as $$ declare aid uuid;begin
 insert into applications(prospect_id,program_id,intake_id,cycle) select id,gid,intake,cycle from prospects where id=pid returning id into aid;
 update prospects set current_application_id=aid where id=pid;return aid;
end $$;
create function public.wf_checklist(aid uuid) returns jsonb language sql stable security definer set search_path=public as $$
 select coalesce(jsonb_agg(jsonb_build_object('id',t.id,'name',t.name,'required',t.required,'document',case when d.id is not null then to_jsonb(d)-'storage_path'-'student_id' else null end) order by t.name),'[]') from applications a join document_types t on t.program_id=a.program_id
 left join documents d on d.application_id=a.id and d.document_type_id=t.id and d.status in ('Pending','Verified','Rejected')
 where a.id=aid and not(t.name='English test result' and exists(select 1 from qualifications q where q.prospect_id=a.prospect_id and q.cycle=a.cycle and q.details->>'language_test_type'='None taken'));
$$;
create function public.wf_validate_application(v jsonb,all_fields boolean) returns void language plpgsql set search_path=public as $$ declare k text;dt date;begin
 if jsonb_typeof(v)<>'object' then raise exception 'Invalid application';end if;
 if all_fields then foreach k in array array['date_of_birth','nationality','emergency_contact_name','emergency_contact_phone','study_mode','intake_id'] loop if coalesce(trim(v->>k),'')='' then raise exception 'Complete all application fields';end if;end loop;end if;
 if nullif(v->>'date_of_birth','') is not null then dt:=(v->>'date_of_birth')::date;if dt>current_date-interval '16 years' or dt<current_date-interval '100 years' then raise exception 'Applicant must be aged 16 to 100';end if;end if;
 if length(coalesce(v->>'nationality',''))>60 or length(coalesce(v->>'emergency_contact_name',''))>120 then raise exception 'Details too long';end if;
 if nullif(v->>'emergency_contact_phone','') is not null and v->>'emergency_contact_phone' !~ '^\+?[0-9 ()-]{7,25}$' then raise exception 'Invalid emergency telephone';end if;
 if v->>'study_mode' is not null and v->>'study_mode' not in ('On campus','Online','Blended') then raise exception 'Invalid study mode';end if;
end $$;
create function public.student_workspace() returns jsonb language plpgsql security definer set search_path=public as $$ declare pid uuid:=student_prospect();p prospects;a applications;gid uuid;begin
 select * into p from prospects where id=pid;select * into a from applications where id=p.current_application_id;
 select coalesce((select program_id from qualifications where prospect_id=pid and cycle=p.cycle and submitted_at is not null),(select program_id from enquiries where prospect_id=pid order by enquiry_date desc,id desc limit 1)) into gid;
 return jsonb_build_object('prospect',jsonb_build_object('id',p.id,'full_name',p.full_name,'email',p.email,'stage',p.stage,'closed_reason',p.closed_reason),'program',(select to_jsonb(g) from programs g where id=coalesce(a.program_id,gid)),'qualification',(select to_jsonb(q)-'review_note'-'reviewed_by' from qualifications q where prospect_id=pid and cycle=p.cycle),'intakes',(select coalesce(jsonb_agg(to_jsonb(i) order by start_date),'[]') from intakes i where program_id=coalesce(a.program_id,gid) and (is_open or id=a.intake_id)),'application',case when a.id is not null then to_jsonb(a)-'decision_note'-'decided_by' else null end,'checklist',case when a.id is null then '[]'::jsonb else wf_checklist(a.id) end,'enrolment',(select to_jsonb(e) from enrolments e where application_id=a.id));
end $$;
create function public.student_action(operation text,input jsonb) returns jsonb language plpgsql security definer set search_path=public as $$
declare pid uuid:=student_prospect();p prospects;a applications;g uuid;v jsonb;outcome jsonb;aid uuid;did uuid;dtype uuid;old documents;begin
 select * into p from prospects where id=pid for update;select * into a from applications where id=p.current_application_id for update;
 case operation
 when 'qualification_draft','qualification_submit' then
 if p.stage<>'Enquiry' then raise exception 'Qualification already submitted';end if;
 v:=input;perform wf_validate_qualification(v,operation='qualification_submit');
 select program_id into g from enquiries where prospect_id=pid order by enquiry_date desc,id desc limit 1;
 if nullif(v->>'intake_id','') is not null and not exists(select 1 from intakes where id=(v->>'intake_id')::uuid and program_id=g and is_open) then raise exception 'Choose an open intake';end if;
 if v->>'language_test_type'='None taken' then v:=v-'language_score'-'test_date';end if;
 insert into qualifications(prospect_id,program_id,cycle,details) values(pid,g,p.cycle,v) on conflict(prospect_id,cycle) do update set details=excluded.details,program_id=excluded.program_id;
 if operation='qualification_submit' then
 perform wf_stage(pid,'Qualification review');outcome:=wf_eligibility(g,v);
 update qualifications set submitted_at=now(),auto_result=outcome->>'result',auto_reasons=outcome->'reasons' where prospect_id=pid and cycle=p.cycle;
 if outcome->>'result'='Pass' then perform wf_stage(pid,'Qualified');perform wf_application(pid,g,(v->>'intake_id')::uuid);perform wf_email(pid,'Qualified',pid::text||':'||p.cycle||':qualified');
 else perform wf_task(pid,case when outcome->>'result'='Fail' then 'Confirm eligibility outcome' else 'Review qualification' end,'Qualification',2);perform wf_email(pid,'Qualification review',pid::text||':'||p.cycle||':review');end if;
 end if;
 when 'application_draft','application_submit' then
 if p.stage<>'Qualified' then raise exception 'Application cannot be edited now';end if;
 if a.id is null then select program_id into g from enquiries where prospect_id=pid order by enquiry_date desc limit 1;aid:=wf_application(pid,g,null);select * into a from applications where id=aid;end if;
 if a.status<>'Draft' then raise exception 'Application already submitted';end if;
 perform wf_validate_application(input,operation='application_submit');
 if nullif(input->>'intake_id','') is not null and not exists(select 1 from intakes where id=(input->>'intake_id')::uuid and program_id=a.program_id and is_open) then raise exception 'Choose an open intake';end if;
 if operation='application_submit' then
 if not exists(select 1 from document_types where program_id=a.program_id and required) then raise exception 'Program document checklist is not configured';end if;
 if exists(select 1 from jsonb_array_elements(wf_checklist(a.id)) c where (c->>'required')::boolean and c->'document'='null'::jsonb) then raise exception 'Upload every required document';end if;
 update applications set status='Submitted',submitted_date=now() where id=a.id;perform wf_stage(pid,'Application');perform wf_task(pid,'Verify application documents','Documents',3);perform wf_email(pid,'Application received',a.id::text||':submitted');
 end if;
 update applications set details=input,intake_id=nullif(input->>'intake_id','')::uuid where id=a.id;
 when 'document_prepare' then
 dtype:=(input->>'document_type_id')::uuid;
 if a.id is null or not exists(select 1 from jsonb_array_elements(wf_checklist(a.id)) c where c->>'id'=dtype::text) then raise exception 'Invalid document type';end if;
 select * into old from documents where application_id=a.id and document_type_id=dtype and status in ('Pending','Verified','Rejected');
 if not ((p.stage='Qualified' and a.status='Draft') or (p.stage='Application' and old.status='Rejected')) then raise exception 'Document cannot be changed now';end if;
 if coalesce(length(input->>'file_name'),0) not between 1 and 120 then raise exception 'Invalid file name';end if;
 did:=gen_random_uuid();
 insert into documents(id,application_id,document_type_id,student_id,storage_path,file_name,mime_type,size_bytes) values(did,a.id,dtype,auth.uid(),auth.uid()::text||'/'||did::text,input->>'file_name',input->>'mime_type',(input->>'size_bytes')::int);
 return jsonb_build_object('id',did,'path',auth.uid()::text||'/'||did::text);
 when 'offer_accept' then
 if p.stage='Enrolled' then return '{"ok":true}'::jsonb;end if;
 if p.stage<>'Offer' or a.status<>'Accepted' or a.offer_snapshot is null or a.offer_expires_at is null or a.offer_expires_at<=now() then raise exception 'No valid offer is available';end if;
 insert into enrolments(application_id,enrolment_date) values(a.id,current_date) on conflict(application_id) do nothing;
 perform wf_stage(pid,'Enrolled');perform wf_email(pid,'Enrolment confirmation',a.id::text||':enrolled');
 when 'offer_decline' then if p.stage<>'Offer' then raise exception 'No open offer';end if;perform wf_stage(pid,'Closed','Offer declined');
 when 'withdraw' then perform wf_stage(pid,'Closed','Withdrawn');
 else raise exception 'Unknown student operation';end case;
 perform wf_audit(pid,operation,input-'language_score'-'date_of_birth');return '{"ok":true}'::jsonb;
end $$;
-- Finalization is callable only by the server after downloading and checking actual bytes.
create function public.finalize_document(did uuid,owner_uuid uuid) returns jsonb language plpgsql security definer set search_path=public as $$ declare d documents;p prospects;a applications;old documents;begin
 select p0.* into p from prospects p0 join applications a0 on a0.id=p0.current_application_id join documents d0 on d0.application_id=a0.id where d0.id=did for update of p0;
 select * into d from documents where id=did and student_id=owner_uuid for update;if d.id is null or p.id is null or d.status<>'Uploading' then raise exception 'Invalid upload';end if;
 select * into a from applications where id=d.application_id;
 select * into old from documents where application_id=a.id and document_type_id=d.document_type_id and status in ('Pending','Verified','Rejected') for update;
 if not ((p.stage='Qualified' and a.status='Draft') or (p.stage='Application' and old.status='Rejected')) then raise exception 'Upload no longer allowed';end if;
 if old.id is not null then update documents set status='Superseded' where id=old.id;end if;
 update documents set status='Pending' where id=did;
 if p.stage='Application' then perform wf_task(p.id,'Verify replacement documents','Documents',3);end if;
 perform wf_audit(p.id,'Document uploaded',jsonb_build_object('document_id',did,'student_id',owner_uuid));return '{"ok":true}'::jsonb;
end $$;
create or replace function public.crm_action(prospect_uuid uuid,operation text,input jsonb) returns jsonb language plpgsql security definer set search_path=public as $$
declare p prospects;a applications;q qualifications;d documents;v jsonb;g programs;i intakes;note_text text:=trim(coalesce(input->>'note',''));ready boolean;begin
 if crm_role() is null or crm_role() not in ('recruitment','administration','admin') then raise exception 'Forbidden';end if;
 select * into p from prospects where id=prospect_uuid for update;if p.id is null then raise exception 'Prospect not found';end if;
 select * into a from applications where id=p.current_application_id for update;
 case operation
 when 'update' then
 if coalesce(length(trim(input->>'full_name')),0) not between 2 and 120 or input->>'email' is null or input->>'email' !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' or length(input->>'email')>254 or coalesce(input->>'phone','') !~ '^\+?[0-9 ()-]{7,25}$' or coalesce(length(trim(input->>'address')),0) not between 5 and 500 then raise exception 'Invalid contact data';end if;
 if p.student_id is not null and lower(input->>'email')<>p.email then raise exception 'Linked account email changes require an administrator identity review';end if;
 if input->>'assigned_staff_id' is not null and not exists(select 1 from staff_users where id=(input->>'assigned_staff_id')::uuid and active and role in ('recruitment','administration','admin')) then raise exception 'Invalid assignee';end if;
 update prospects set full_name=trim(input->>'full_name'),email=lower(input->>'email'),phone=input->>'phone',address=trim(input->>'address'),assigned_staff_id=(input->>'assigned_staff_id')::uuid where id=p.id;
 update followups set staff_id=(input->>'assigned_staff_id')::uuid where prospect_id=p.id and not completed;
 when 'qualification_decision' then
 if p.stage<>'Qualification review' or input->>'decision' is null or input->>'decision' not in ('approve','reject') or length(note_text)>1000 then raise exception 'Invalid qualification decision';end if;
 select * into q from qualifications where prospect_id=p.id and cycle=p.cycle;
 if q.id is null or q.submitted_at is null then raise exception 'Qualification not submitted';end if;
 if input->>'decision'='approve' then perform wf_stage(p.id,'Qualified');perform wf_application(p.id,q.program_id,(q.details->>'intake_id')::uuid);perform wf_email(p.id,'Qualified',p.id::text||':'||p.cycle||':qualified');
 else if length(note_text)<3 then raise exception 'Rejection reason required';end if;perform wf_stage(p.id,'Closed','Not eligible');perform wf_email(p.id,'Not eligible',p.id::text||':'||p.cycle||':ineligible');end if;
 update qualifications set decision=input->>'decision',reviewed_by=auth.uid(),review_note=note_text where id=q.id;
 update followups set completed=true,completed_at=now() where prospect_id=p.id and kind='Qualification' and not completed;
 when 'document_review' then
 select * into d from documents where id=(input->>'document_id')::uuid and application_id=a.id for update;
 if p.stage<>'Application' or d.id is null or d.status<>'Pending' or input->>'status' is null or input->>'status' not in ('Verified','Rejected') then raise exception 'Document is not ready for review';end if;
 if input->>'status'='Rejected' and length(note_text)<3 then raise exception 'Explain what the student must fix';end if;
 if length(note_text)>500 then raise exception 'Reason too long';end if;
 update documents set status=input->>'status',rejection_reason=case when input->>'status'='Rejected' then note_text end,verified_by=auth.uid(),reviewed_at=now() where id=d.id;
 update applications set status='Under Review' where id=a.id and status='Submitted';
 if input->>'status'='Rejected' then perform wf_email(p.id,'Document rejected',d.id::text||':rejected',jsonb_build_object('document',d.file_name,'reason',note_text));end if;
 if not exists(select 1 from documents where application_id=a.id and status='Pending') then update followups set completed=true,completed_at=now() where prospect_id=p.id and kind='Documents' and not completed;end if;
 ready:=not exists(select 1 from jsonb_array_elements(wf_checklist(a.id)) c where (c->>'required')::boolean and coalesce(c->'document'->>'status','')<>'Verified');
 if ready then perform wf_task(p.id,'Decide application','Decision',1);end if;
 when 'application_decision' then
 if p.stage<>'Application' or a.id is null or a.status not in ('Submitted','Under Review') or input->>'decision' is null or input->>'decision' not in ('accept','reject') or length(note_text)>1000 then raise exception 'Invalid application decision';end if;
 if input->>'decision'='accept' then
 if not exists(select 1 from document_types where program_id=a.program_id and required) or exists(select 1 from jsonb_array_elements(wf_checklist(a.id)) c where (c->>'required')::boolean and coalesce(c->'document'->>'status','')<>'Verified') then raise exception 'Verify every required document before issuing an offer';end if;
 select * into g from programs where id=a.program_id;select * into i from intakes where id=a.intake_id;
 if i.id is null then raise exception 'Application intake is required';end if;
 update applications set status='Accepted',decision_note=note_text,decided_by=auth.uid(),decided_at=now(),offer_expires_at=now()+interval '14 days',offer_snapshot=jsonb_build_object('reference',a.id,'name',p.full_name,'address',p.address,'program',g.name,'intake',i.name,'intake_start',i.start_date,'study_mode',a.details->>'study_mode','issued_at',now(),'expires_at',now()+interval '14 days') where id=a.id;
 perform wf_stage(p.id,'Offer');perform wf_email(p.id,'Offer',a.id::text||':offer',jsonb_build_object('program',g.name,'expires_at',now()+interval '14 days'));
 update followups set completed=true,completed_at=now() where prospect_id=p.id and not completed;
 else if length(note_text)<3 then raise exception 'Rejection reason required';end if;
 update applications set status='Rejected',decision_note=note_text,decided_by=auth.uid(),decided_at=now() where id=a.id;perform wf_stage(p.id,'Closed','Application rejected');perform wf_email(p.id,'Application rejected',a.id::text||':rejected');end if;
 when 'close' then perform wf_stage(p.id,'Closed',input->>'reason');
 when 'note' then if coalesce(length(trim(input->>'body')),0) not between 1 and 2000 then raise exception 'Invalid note';end if;insert into notes(prospect_id,staff_id,body) values(p.id,auth.uid(),input->>'body');
 when 'followup' then if coalesce(length(trim(input->>'title')),0) not between 1 and 200 or input->>'due_at' is null then raise exception 'Invalid follow-up';end if;insert into followups(prospect_id,staff_id,title,due_at) values(p.id,coalesce(p.assigned_staff_id,auth.uid()),input->>'title',(input->>'due_at')::timestamptz);
 when 'complete_followup' then update followups set completed=true,completed_at=now() where id=(input->>'followup_id')::uuid and prospect_id=p.id;if not found then raise exception 'Task not found';end if;
 else raise exception 'Use the controlled qualification, document and offer workflow';end case;
 perform wf_audit(p.id,operation,input);return '{"ok":true}'::jsonb;
end $$;
-- RLS: staff keep existing permissions; students read only a sanitized workspace RPC.
alter table public.intakes enable row level security;
alter table public.document_types enable row level security;
alter table public.qualifications enable row level security;
alter table public.documents enable row level security;
alter table public.email_outbox enable row level security;
create policy intake_read on public.intakes for select to authenticated using(is_open or crm_role() in ('recruitment','administration','admin'));
create policy checklist_read on public.document_types for select to authenticated using(true);
create policy qualification_staff on public.qualifications for select to authenticated using(crm_role() in ('recruitment','administration','admin'));
create policy document_read on public.documents for select to authenticated using(crm_role() in ('recruitment','administration','admin') or student_id=auth.uid());
-- Email payloads contain no access tokens, but are still restricted to record readers.
create policy email_staff on public.email_outbox for select to authenticated using(crm_role() in ('recruitment','administration','admin'));
grant select on public.intakes,public.document_types,public.qualifications,public.documents,public.email_outbox to authenticated;
create function public.wf_storage_access(object_path text,uploading boolean) returns boolean language sql stable security definer set search_path=public as $$
 select exists(select 1 from documents d where d.storage_path=object_path and ((not uploading and crm_role() in ('recruitment','administration','admin')) or (d.student_id=auth.uid() and (not uploading or d.status='Uploading'))));
$$;
-- Privacy-safe aggregate inputs, including creation-date cohort filtering in API.
create or replace function public.recruitment_report() returns jsonb language plpgsql security definer set search_path=public as $$ begin
 if crm_role() is null or crm_role() not in ('recruitment','administration','management','admin') then raise exception 'Forbidden';end if;
 return jsonb_build_object('prospects',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'stage',stage,'created_at',created_at,'cycle',cycle)),'[]') from prospects),'history',(select coalesce(jsonb_agg(to_jsonb(h)-'actor_id'),'[]') from stage_history h));end $$;
create function public.run_workflow_jobs(run_at timestamptz default now()) returns jsonb language plpgsql security definer set search_path=public as $$
declare p prospects;a applications;d documents;t followups;m record;age numeric;reminders int:=0;closed int:=0;escalated int:=0;event_key text;due timestamptz;n int;begin
 perform pg_advisory_xact_lock(hashtext('nexus-jobs'));
 for p in select * from prospects where stage in ('Enquiry','Qualified','Application','Offer') for update loop
 select * into a from applications where id=p.current_application_id;age:=extract(epoch from run_at-p.stage_entered_at)/86400;
 if p.stage='Enquiry' and age>=14 or p.stage='Qualified' and age>=30 then
 perform wf_stage(p.id,'Closed','No response');perform wf_email(p.id,'Closed',p.id::text||':'||p.cycle||':closed');closed:=closed+1;
 elsif (p.stage='Enquiry' and age>=3) or (p.stage='Qualified' and age>=7) then
 event_key:=p.id::text||':'||p.cycle||':'||p.stage||':reminder';
 if not exists(select 1 from email_outbox where dedupe_key=event_key) then perform wf_email(p.id,case when p.stage='Enquiry' then 'Details reminder' else 'Application reminder' end,event_key);reminders:=reminders+1;end if;
 elsif p.stage='Offer' and a.offer_expires_at is not null then
 if a.offer_expires_at<=run_at then perform wf_stage(p.id,'Closed','Offer lapsed');perform wf_email(p.id,'Offer lapsed',a.id::text||':lapsed');closed:=closed+1;
 elsif a.offer_expires_at-run_at<=interval '7 days' and not exists(select 1 from email_outbox where dedupe_key=a.id::text||':offer-reminder') then perform wf_email(p.id,'Offer reminder',a.id::text||':offer-reminder',jsonb_build_object('expires_at',a.offer_expires_at));reminders:=reminders+1;end if;
 elsif p.stage='Application' then
 select * into d from documents where application_id=a.id and status='Rejected' order by reviewed_at limit 1;
 if d.id is not null then age:=extract(epoch from run_at-d.reviewed_at)/86400;
 if age>=21 then perform wf_stage(p.id,'Closed','No response');perform wf_email(p.id,'Closed',a.id::text||':docs-closed');closed:=closed+1;
 elsif age>=5 and not exists(select 1 from email_outbox where dedupe_key=d.id::text||':reminder') then perform wf_email(p.id,'Document reminder',d.id::text||':reminder',jsonb_build_object('document',d.file_name));reminders:=reminders+1;end if;end if;
 end if;
 end loop;
 for t in select * from followups where not completed and escalated_at is null and due_at<run_at for update loop
 due:=t.due_at;n:=0;while n<2 loop due:=due+interval '1 day';if extract(isodow from due at time zone 'Australia/Darwin')<6 then n:=n+1;end if;end loop;
 if due<=run_at then
 -- If no active manager exists, retain the task for the next run rather than losing the alert.
 for m in select u.email from staff_users s join auth.users u on u.id=s.id where s.active and s.role in ('management','admin') loop
 perform wf_email(t.prospect_id,'Task escalation',t.id::text||':'||m.email,jsonb_build_object('task',t.title,'due_at',t.due_at),m.email);
 end loop;
 if found then update followups set escalated_at=run_at where id=t.id;escalated:=escalated+1;end if;
 end if;
 end loop;
 return jsonb_build_object('reminders',reminders,'closed',closed,'escalated',escalated);
end $$;
create function public.claim_emails(batch_size int default 25) returns setof public.email_outbox language sql security definer set search_path=public as $$
 update email_outbox e set status='Sending',claim_token=gen_random_uuid(),attempts=attempts+1,next_attempt_at=now()+interval '10 minutes' where id in (select id from email_outbox where status in ('Queued','Failed','Sending') and next_attempt_at<=now() and attempts<5 order by created_at limit least(batch_size,25) for update skip locked) returning e.*;
$$;
create function public.finish_email(eid uuid,lease uuid,outcome text,error_text text default null) returns void language plpgsql security definer set search_path=public as $$ declare e email_outbox;begin
 if outcome not in ('Sent','Logged','Failed') then raise exception 'Invalid delivery outcome';end if;
 update email_outbox set status=outcome,last_error=left(error_text,300),sent_at=case when outcome='Sent' then now() end,next_attempt_at=now()+interval '15 minutes',claim_token=null where id=eid and claim_token=lease and status='Sending' returning * into e;
 if e.id is not null and outcome='Failed' and e.attempts>=5 then perform wf_task(e.prospect_id,'Email delivery failed: '||e.template,'Email '||e.id,1);end if;
end $$;
notify pgrst, 'reload schema';
-- Explicitly revoke PUBLIC execution on every helper, including SQL-only validators.
do $$ declare r record;begin for r in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on p.pronamespace=n.oid where n.nspname='public' and (p.proname like 'wf_%' or p.proname in ('student_prospect','student_workspace','student_action','finalize_document','run_workflow_jobs','claim_emails','finish_email')) loop execute 'revoke all on function '||r.signature||' from public,anon,authenticated';end loop;end $$;
grant execute on function public.student_workspace(),public.student_action(text,jsonb),public.wf_storage_access(text,boolean) to authenticated;
-- Service-only functions are used by the REST API and authenticated scheduled runner.
grant execute on function public.finalize_document(uuid,uuid),public.run_workflow_jobs(timestamptz),public.claim_emails(int),public.finish_email(uuid,uuid,text,text) to service_role;
grant select on public.documents,public.applications,public.prospects to service_role;
-- No criteria/intake defaults are fabricated for real RIC programs. Run demo-config.sql for fictional demonstrations only.
commit;
