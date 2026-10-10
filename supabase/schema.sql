-- Run once in a new Supabase project's SQL editor. All demo programs are fictional.
create extension if not exists pgcrypto;
create table public.staff_users(id uuid primary key references auth.users(id), full_name text not null, role text not null check(role in ('recruitment','administration','management','admin')),active boolean not null default true);
create table public.programs(id uuid primary key default gen_random_uuid(),name text not null unique,discipline text not null,active boolean not null default true);
create table public.prospects(id uuid primary key default gen_random_uuid(),assigned_staff_id uuid references public.staff_users(id),full_name text not null check(length(full_name) between 2 and 120),email text not null unique check(email ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),phone text not null check(phone ~ '^\+?[0-9 ()-]{7,25}$'),address text not null check(length(address) between 5 and 500),stage text not null default 'Enquiry' check(stage in ('Enquiry','Qualified','Application','Enrolled','Withdrawn','Closed')),created_at timestamptz not null default now());
create table public.enquiries(id uuid primary key default gen_random_uuid(),prospect_id uuid not null references public.prospects(id),program_id uuid not null references public.programs(id),source text not null default 'Website',message text not null default '',enquiry_date timestamptz not null default now(),consent_at timestamptz not null default now(),duplicate_flag boolean not null default false);
create table public.applications(id uuid primary key default gen_random_uuid(),prospect_id uuid not null references public.prospects(id),program_id uuid not null references public.programs(id),status text not null default 'Draft' check(status in ('Draft','Submitted','Under Review','Accepted','Rejected')),submitted_date timestamptz,created_at timestamptz not null default now(),unique(prospect_id,program_id));
create table public.enrolments(id uuid primary key default gen_random_uuid(),application_id uuid not null unique references public.applications(id),enrolment_date date not null);
create table public.notes(id uuid primary key default gen_random_uuid(),prospect_id uuid not null references public.prospects(id),staff_id uuid not null references public.staff_users(id),body text not null,created_at timestamptz not null default now());
create table public.followups(id uuid primary key default gen_random_uuid(),prospect_id uuid not null references public.prospects(id),staff_id uuid not null references public.staff_users(id),title text not null,due_at timestamptz not null,completed boolean not null default false);
create table public.audit_log(id uuid primary key default gen_random_uuid(),prospect_id uuid references public.prospects(id),staff_id uuid references public.staff_users(id),action text not null,detail jsonb not null default '{}',logged_at timestamptz not null default now());
create table public.stage_history(id uuid primary key default gen_random_uuid(),prospect_id uuid not null references public.prospects(id),from_stage text,to_stage text not null,changed_at timestamptz not null default now());
create index on public.prospects(stage);
create index on public.enquiries(prospect_id);
create index on public.applications(prospect_id);
create index on public.audit_log(prospect_id,logged_at);
create index on public.followups(due_at) where not completed;
create function public.crm_role() returns text language sql stable security definer set search_path=public as $$ select role from staff_users where id=auth.uid() and active $$;
revoke all on function public.crm_role() from public;
grant execute on function public.crm_role() to authenticated;
do $$ declare t text; begin foreach t in array array['staff_users','programs','prospects','enquiries','applications','enrolments','notes','followups','audit_log','stage_history'] loop execute format('alter table public.%I enable row level security',t); end loop; end $$;
create policy programs_read on public.programs for select to anon,authenticated using(active);
create policy staff_read on public.staff_users for select to authenticated using(id=auth.uid() or public.crm_role() in ('recruitment','administration','admin'));
create policy prospect_read on public.prospects for select to authenticated using(public.crm_role() in ('recruitment','administration','management','admin'));
create policy history_read on public.stage_history for select to authenticated using(public.crm_role() in ('recruitment','administration','management','admin'));
do $$ declare t text; begin foreach t in array array['enquiries','applications','enrolments','notes','followups','audit_log'] loop execute format('create policy staff_read on public.%I for select to authenticated using(public.crm_role() in (''recruitment'',''administration'',''admin''))',t);end loop;end $$;
-- Management receives aggregate inputs only through recruitment_report().
revoke all on public.prospects from anon,authenticated;
grant select on public.prospects to authenticated;
drop policy prospect_read on public.prospects;
create policy prospect_read on public.prospects for select to authenticated using(public.crm_role() in ('recruitment','administration','admin'));
grant select on public.programs to anon,authenticated;
grant select on public.staff_users,public.enquiries,public.applications,public.enrolments,public.notes,public.followups,public.audit_log,public.stage_history to authenticated;
create function public.recruitment_report() returns jsonb language plpgsql security definer set search_path=public as $$ begin if crm_role() not in ('recruitment','administration','management','admin') or crm_role() is null then raise exception 'Forbidden';end if;return jsonb_build_object('prospects',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'stage',stage)),'[]') from prospects),'history',(select coalesce(jsonb_agg(to_jsonb(h)),'[]') from stage_history h));end $$;
create function public.submit_enquiry(input jsonb) returns jsonb language plpgsql security definer set search_path=public as $$
declare pid uuid; existing boolean:=false; eid uuid; em text:=lower(trim(input->>'email'));
begin
 if input->>'consent' is distinct from 'true' or length(trim(input->>'full_name')) not between 2 and 120 or em !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' or length(em)>254 or input->>'phone' !~ '^\+?[0-9 ()-]{7,25}$' or length(trim(input->>'address')) not between 5 and 500 or length(coalesce(input->>'message',''))>2000 or input->>'full_name' is null or em is null or input->>'phone' is null or input->>'address' is null then raise exception 'Invalid enquiry'; end if;
 if not exists(select 1 from programs where id=(input->>'program_id')::uuid and active) then raise exception 'Invalid program';end if;
 -- Rate control shared by all API/direct RPC callers; no account information is returned.
 perform pg_advisory_xact_lock(hashtext(em));
 if exists(select 1 from enquiries e join prospects p on p.id=e.prospect_id where p.email=em and e.enquiry_date>now()-interval '1 minute') then raise exception 'Please wait before submitting again';end if;
 select id into pid from prospects where email=em; existing:=found;
 if pid is null then
 insert into prospects(full_name,email,phone,address) values(trim(input->>'full_name'),em,input->>'phone',trim(input->>'address')) returning id into pid;
 insert into stage_history(prospect_id,to_stage) values(pid,'Enquiry');
 end if;
 insert into enquiries(prospect_id,program_id,message,duplicate_flag) values(pid,(input->>'program_id')::uuid,coalesce(input->>'message',''),existing or exists(select 1 from prospects where phone=input->>'phone' and id<>pid)) returning id into eid;
 insert into audit_log(prospect_id,action) values(pid,'Enquiry received');
 return jsonb_build_object('reference',eid,'message','Thank you. Your enquiry has been received.');
end $$;
create function public.crm_action(prospect_uuid uuid,operation text,input jsonb) returns jsonb language plpgsql security definer set search_path=public as $$
declare p prospects; a applications; target text; aid uuid; previous text;
begin
 if crm_role() is null or crm_role() not in ('recruitment','administration','admin') then raise exception 'Forbidden';end if;
 select * into p from prospects where id=prospect_uuid for update;if not found then raise exception 'Prospect not found';end if;
 previous:=p.stage;
 case operation
 when 'update' then
 if input->>'email' is null or input->>'email' !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' or length(input->>'full_name') not between 2 and 120 or input->>'full_name' is null or input->>'phone' is null or input->>'address' is null then raise exception 'Invalid data';end if;
 if input->>'assigned_staff_id' is not null and not exists(select 1 from staff_users where id=(input->>'assigned_staff_id')::uuid and active and role in ('recruitment','administration','admin')) then raise exception 'Invalid assignee';end if;
 update prospects set full_name=input->>'full_name',email=lower(input->>'email'),phone=input->>'phone',address=input->>'address',assigned_staff_id=(input->>'assigned_staff_id')::uuid where id=p.id;
 when 'stage' then
 target:=input->>'stage';
 if length(trim(coalesce(input->>'reason','')))<3 or length(input->>'reason')>1000 then raise exception 'Reason required';end if;
 if not ((p.stage='Enquiry' and target='Qualified') or (p.stage in ('Enquiry','Qualified','Application') and target in ('Withdrawn','Closed'))) then raise exception 'Invalid transition';end if;
 update prospects set stage=target where id=p.id;
 when 'application' then
 if p.stage not in ('Qualified','Application') then raise exception 'Qualification required';end if;
 if not exists(select 1 from programs where id=(input->>'program_id')::uuid and active) then raise exception 'Invalid program';end if;
 insert into applications(prospect_id,program_id) values(p.id,(input->>'program_id')::uuid);update prospects set stage='Application' where id=p.id;
 when 'application_status' then
 select * into a from applications where id=(input->>'application_id')::uuid and prospect_id=p.id for update;
 target:=input->>'status';
 if a.id is null or p.stage<>'Application' or not ((a.status='Draft' and target='Submitted') or (a.status='Submitted' and target='Under Review') or (a.status='Under Review' and target in ('Accepted','Rejected'))) then raise exception 'Invalid application transition';end if;
 update applications set status=target,submitted_date=case when target='Submitted' then now() else submitted_date end where id=a.id;
 when 'enrol' then
 select * into a from applications where id=(input->>'application_id')::uuid and prospect_id=p.id for update;
 if a.id is null or a.status<>'Accepted' or p.stage<>'Application' or input->>'enrolment_date' is null then raise exception 'Accepted application required';end if;
 insert into enrolments(application_id,enrolment_date) values(a.id,(input->>'enrolment_date')::date);update prospects set stage='Enrolled' where id=p.id;
 when 'note' then
 if length(trim(coalesce(input->>'body',''))) not between 1 and 2000 then raise exception 'Invalid note';end if;
 insert into notes(prospect_id,staff_id,body) values(p.id,auth.uid(),input->>'body');
 when 'followup' then
 if length(trim(coalesce(input->>'title',''))) not between 1 and 200 or input->>'due_at' is null then raise exception 'Invalid follow-up';end if;
 insert into followups(prospect_id,staff_id,title,due_at) values(p.id,auth.uid(),input->>'title',(input->>'due_at')::timestamptz);
 when 'complete_followup' then
 update followups set completed=true where id=(input->>'followup_id')::uuid and prospect_id=p.id;if not found then raise exception 'Follow-up not found';end if;
 else raise exception 'Unknown action';
 end case;
 select stage into target from prospects where id=p.id;
 if target<>previous then insert into stage_history(prospect_id,from_stage,to_stage) values(p.id,previous,target);end if;
 insert into audit_log(prospect_id,staff_id,action,detail) values(p.id,auth.uid(),operation,jsonb_build_object('from_stage',previous,'to_stage',target,'input',input));
 return jsonb_build_object('ok',true);
end $$;
create function public.manage_staff(staff_uuid uuid,input jsonb) returns jsonb language plpgsql security definer set search_path=public as $$ begin
 if crm_role() is distinct from 'admin' then raise exception 'Forbidden';end if;
 if staff_uuid=auth.uid() then raise exception 'Cannot alter own administrator access';end if;
 if input->>'role' not in ('recruitment','administration','management','admin') or input->>'active' not in ('true','false') or input->>'role' is null or input->>'active' is null then raise exception 'Invalid role';end if;
 update staff_users set role=input->>'role',active=(input->>'active')::boolean where id=staff_uuid;if not found then raise exception 'Staff not found';end if;
 insert into audit_log(staff_id,action,detail) values(auth.uid(),'Staff access changed',jsonb_build_object('staff_id',staff_uuid,'input',input));return '{"ok":true}'::jsonb;end $$;
revoke all on function public.submit_enquiry(jsonb),public.crm_action(uuid,text,jsonb),public.manage_staff(uuid,jsonb),public.recruitment_report() from public;
grant execute on function public.submit_enquiry(jsonb) to anon,authenticated;
grant execute on function public.crm_action(uuid,text,jsonb),public.manage_staff(uuid,jsonb),public.recruitment_report() to authenticated;
-- No direct writes: every permitted mutation passes through a transactional function.
revoke insert,update,delete on all tables in schema public from anon,authenticated;
insert into programs(name,discipline) values('Diploma of Business','Business'),('Diploma of Information Technology','Technology'),('Certificate III in Early Childhood Education and Care','Education'),('Diploma of Community Services','Community');
