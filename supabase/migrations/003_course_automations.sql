-- Apply after 002. Safe to reapply. Does not invent or overwrite course criteria.
begin;
create or replace function public.configure_program(program_uuid uuid,input jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$
declare g programs;old_config jsonb;level int;requirements jsonb;brochure text;entry record;score numeric;
begin
 if crm_role() is distinct from 'admin' then raise exception 'Admin access required';end if;
 select * into g from programs where id=program_uuid for update;
 if g.id is null then raise exception 'Program not found';end if;
 old_config:=to_jsonb(g);
 level:=(input->>'min_qualification_level')::int;
 requirements:=input->'language_requirements';brochure:=nullif(trim(input->>'brochure_url'),'');
 if level is null or level not between 1 and 5 or jsonb_typeof(requirements) is distinct from 'object' then raise exception 'Academic and language requirements are required';end if;
 for entry in select * from jsonb_each_text(requirements) loop
 if entry.key not in ('IELTS','PTE','TOEFL') then raise exception 'Unsupported language test';end if;
 score:=entry.value::numeric;
 if score is null or score < (case when entry.key='PTE' then 10 else 0 end) or score > (case entry.key when 'IELTS' then 9 when 'PTE' then 90 else 120 end) then raise exception 'Invalid language minimum';end if;
 end loop;
 if brochure is not null and (brochure !~ '^https://[^[:space:]]+$' or length(brochure)>2000) then raise exception 'Use a public HTTPS brochure URL';end if;
 update programs set min_qualification_level=level,language_requirements=requirements,brochure_url=brochure where id=program_uuid returning * into g;
 perform wf_audit(null,'Program automation configured',jsonb_build_object('before',old_config,'after',to_jsonb(g)));
 return to_jsonb(g);
end $$;
revoke all on function public.configure_program(uuid,jsonb) from public,anon;
grant execute on function public.configure_program(uuid,jsonb) to authenticated;
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
 if nullif(trim(g.brochure_url),'') is null then perform wf_task(pid,'Send missing course brochure: '||g.name,'Brochure missing: '||g.id::text,1);end if;
 perform wf_audit(pid,'Enquiry received',jsonb_build_object('reference',eid));
 return jsonb_build_object('reference',eid,'message','Your enquiry has been received. Create or sign in to your student account to continue.');
end $$;

commit;
