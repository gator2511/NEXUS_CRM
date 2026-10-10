import express from 'express';
import {createClient} from '@supabase/supabase-js';
import {z} from 'zod';
import {can,enquirySchema,report} from './rules.js';
export const app=express();
app.disable('x-powered-by');
app.use((req,res,next)=>{res.set({'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'same-origin'});next();});
app.use(express.json({limit:'64kb'}));
function db(token){if(!process.env.SUPABASE_URL||!process.env.SUPABASE_ANON_KEY)throw Object.assign(new Error('Database is not configured'),{status:503});return createClient(process.env.SUPABASE_URL,process.env.SUPABASE_ANON_KEY,{global:{headers:token?{Authorization:`Bearer ${token}`}:{ }},auth:{persistSession:false,autoRefreshToken:false}});}
function check(result){if(result.error)throw Object.assign(new Error('The request could not be completed. Check permissions and workflow requirements.'),{status:400});return result.data;}
const wrap=fn=>(req,res,next)=>Promise.resolve(fn(req,res,next)).catch(next);
app.get('/api/health',(req,res)=>res.json({status:'ok',configured:!!(process.env.SUPABASE_URL&&process.env.SUPABASE_ANON_KEY)}));
app.get('/api/programs',wrap(async(req,res)=>res.json(check(await db().from('programs').select('*').eq('active',true).order('name')))));
app.post('/api/enquiries',wrap(async(req,res)=>{const input=enquirySchema.parse(req.body);res.status(201).json(check(await db().rpc('submit_enquiry',{input})));}));
app.use('/api',wrap(async(req,res,next)=>{const token=req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];if(!token)return res.status(401).json({error:'Sign in required'});req.db=db(token);const {data,error}=await req.db.auth.getUser(token);if(error||!data.user)return res.status(401).json({error:'Session expired'});req.profile=check(await req.db.from('staff_users').select('*').eq('id',data.user.id).eq('active',true).single());next();}));
const permit=permission=>(req,res,next)=>can(req.profile.role,permission)?next():res.status(403).json({error:'You do not have permission for this action'});
app.get('/api/me',(req,res)=>res.json(req.profile));
app.get('/api/staff',permit('read'),wrap(async(req,res)=>res.json(check(await (req.profile.role==='admin'?req.db.from('staff_users').select('id,full_name,role,active'):req.db.from('staff_users').select('id,full_name,role,active').eq('active',true))))));
app.get('/api/prospects',permit('read'),wrap(async(req,res)=>res.json(check(await req.db.from('prospects').select('*,enquiries(*,programs(name)),applications(*,programs(name),enrolments(*)),followups(*),notes(*)').order('created_at',{ascending:false})))));
app.get('/api/audit',permit('audit'),wrap(async(req,res)=>res.json(check(await req.db.from('audit_log').select('*,staff_users(full_name)').order('logged_at',{ascending:false}).limit(500)))));
app.get('/api/reports',permit('report'),wrap(async(req,res)=>{const data=check(await req.db.rpc('recruitment_report'));res.json(report(data.prospects,data.history));}));
const actions={update:z.object({full_name:z.string().trim().min(2).max(120),email:z.email().transform(x=>x.toLowerCase()),phone:z.string().regex(/^\+?[\d ()-]{7,25}$/),address:z.string().trim().min(5).max(500),assigned_staff_id:z.uuid().nullable()}),stage:z.object({stage:z.enum(['Qualified','Withdrawn','Closed']),reason:z.string().trim().min(3).max(1000)}),application:z.object({program_id:z.uuid()}),application_status:z.object({application_id:z.uuid(),status:z.enum(['Submitted','Under Review','Accepted','Rejected'])}),enrol:z.object({application_id:z.uuid(),enrolment_date:z.iso.date()}),note:z.object({body:z.string().trim().min(1).max(2000)}),followup:z.object({title:z.string().trim().min(1).max(200),due_at:z.iso.datetime()}),complete_followup:z.object({followup_id:z.uuid()})};
app.post('/api/prospects/:id/:action',permit('write'),wrap(async(req,res)=>{const id=z.uuid().parse(req.params.id);const schema=actions[req.params.action];if(!schema)return res.status(404).json({error:'Unknown action'});const input=schema.parse(req.body);res.json(check(await req.db.rpc('crm_action',{prospect_uuid:id,operation:req.params.action,input})));}));
app.post('/api/staff/:id',permit('users'),wrap(async(req,res)=>{const id=z.uuid().parse(req.params.id);const input=z.object({role:z.enum(['recruitment','administration','management','admin']),active:z.boolean()}).parse(req.body);res.json(check(await req.db.rpc('manage_staff',{staff_uuid:id,input})));}));
app.use((req,res)=>res.status(404).json({error:'Not found'}));
app.use((err,req,res,next)=>res.status(err instanceof z.ZodError?422:err.status||500).json({error:err instanceof z.ZodError?err.issues.map(i=>`${i.path.join('.')}: ${i.message}`).join('; '):err.type==='entity.parse.failed'?'Invalid JSON request':err.status?err.message:'An unexpected error occurred. Please try again.'}));
