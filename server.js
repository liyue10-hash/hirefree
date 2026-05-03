const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');
const UPLOAD_DIR = path.join(__dirname, 'uploads');
const DB_PATH = path.join(DATA_DIR, 'database.json');

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const upload = multer({
  dest: UPLOAD_DIR,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = [
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/octet-stream'
    ];
    const ext = path.extname(file.originalname || '').toLowerCase();
    if (!allowed.includes(file.mimetype) && !['.pdf','.doc','.docx'].includes(ext)) {
      return cb(new Error('Only PDF, DOC, or DOCX files are allowed'));
    }
    cb(null, true);
  }
});

function id(){ return crypto.randomUUID(); }
function now(){ return new Date().toISOString(); }
function clean(v){ return String(v || '').trim(); }
function normalize(v){ return String(v || '').toLowerCase().trim(); }
function toSkills(text){ return String(text || '').split(',').map(s=>clean(s).toLowerCase()).filter(Boolean); }
function saveUploaded(file){
  if (!file) return { url:'', original:'' };
  const ext = path.extname(file.originalname || '').toLowerCase() || '.pdf';
  const newName = `${file.filename}${ext}`;
  fs.renameSync(file.path, path.join(UPLOAD_DIR, newName));
  return { url:`/uploads/${newName}`, original:file.originalname || newName };
}

function initialDb(){
  return {
    users: [],
    jobs: [
      { id:id(), employerUserId:null, title:'customer service sales', company:'AMELECO ELECTRIC INC.', city:'Burnaby', province:'BC', jobType:'full time', salary:'$22', skills:['electrical','service'], description:'greeting customers at the counter, help check out', contactEmail:'hr@ameleco.com', status:'active', featured:false, createdAt:now() },
      { id:id(), employerUserId:null, title:'Electrical Counter Sales', company:'Ameleco Electric Supply', city:'Burnaby', province:'BC', jobType:'Full-time', salary:'$22-$30/hour', skills:['electrical','sales','customer service','inventory','contractors'], description:'Serve walk-in contractors, prepare quotes, check stock, and support branch sales. Electrical material knowledge is preferred.', contactEmail:'hr@example.com', status:'active', featured:false, createdAt:now() },
      { id:id(), employerUserId:null, title:'Warehouse Associate', company:'West Canada Supply', city:'Calgary', province:'AB', jobType:'Full-time', salary:'$20-$26/hour', skills:['warehouse','forklift','shipping','receiving','inventory'], description:'Pick, pack, receive, and organize electrical products in a warehouse/showroom branch.', contactEmail:'jobs@example.com', status:'active', featured:false, createdAt:now() }
    ],
    resumes: [
      { id:id(), userId:null, candidateName:'Jason L.', targetPosition:'Counter Sales / Inside Sales', city:'Burnaby', province:'BC', skills:['sales','customer service','electrical','quotes','inventory'], summary:'3 years counter sales experience in construction supplies. Strong with contractor service and fast quoting.', contactEmail:'jason@example.com', fileUrl:'', originalFileName:'', status:'active', createdAt:now() },
      { id:id(), userId:null, candidateName:'Maria C.', targetPosition:'Warehouse / Shipping', city:'Calgary', province:'AB', skills:['warehouse','forklift','receiving','shipping','inventory'], summary:'Warehouse associate with forklift experience, receiving, picking orders, and cycle counts.', contactEmail:'maria@example.com', fileUrl:'', originalFileName:'', status:'active', createdAt:now() }
    ],
    applications: [],
    passwordRequests: []
  };
}
function readDb(){
  if (!fs.existsSync(DB_PATH)) writeDb(initialDb());
  const db = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
  db.users ||= []; db.jobs ||= []; db.resumes ||= []; db.applications ||= []; db.passwordRequests ||= [];
  return db;
}
function writeDb(db){ fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2)); }
function publicUser(u){ return u ? { id:u.id, email:u.email, role:u.role, name:u.name, company:u.company, createdAt:u.createdAt } : null; }
function currentUser(req){ const db=readDb(); return db.users.find(u=>u.id===req.session.userId) || null; }
function requireLogin(req,res,next){ if(!req.session.userId) return res.status(401).json({error:'Please log in first.'}); next(); }
function canSeeContact(req){ return !!req.session.userId; }
function safeJob(j,req){ return {...j, contactEmail: canSeeContact(req) ? j.contactEmail : 'Login to view contact'}; }
function safeResume(r,req){ return {...r, contactEmail: canSeeContact(req) ? r.contactEmail : 'Login to view contact', fileUrl: canSeeContact(req) ? r.fileUrl : ''}; }
function matchScore(job,resume){
  const js=(job.skills||[]).map(normalize), rs=(resume.skills||[]).map(normalize);
  const common=rs.filter(s=>js.includes(s));
  const skillScore=common.length/Math.max(js.length,1);
  const city=normalize(job.city)===normalize(resume.city)?0.2:0;
  const prov=normalize(job.province)===normalize(resume.province)?0.1:0;
  return {score:Math.min(100, Math.round((skillScore*0.7+city+prov)*100)), commonSkills:common};
}
function isAdmin(req){ return req.session.admin === true; }
function requireAdmin(req,res,next){ if(!isAdmin(req)) return res.status(401).json({error:'Admin login required'}); next(); }

app.use(express.json());
app.use(express.urlencoded({ extended:true }));
app.use(session({ secret:process.env.SESSION_SECRET || 'hirefree-change-this-secret', resave:false, saveUninitialized:false }));
app.use('/uploads', express.static(UPLOAD_DIR));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/me',(req,res)=>res.json({user:publicUser(currentUser(req))}));
app.post('/api/register', async (req,res)=>{
  const db=readDb(); const email=normalize(req.body.email); const password=String(req.body.password||'');
  if(!email || password.length<6) return res.status(400).json({error:'Email and at least 6-character password are required.'});
  if(db.users.some(u=>u.email===email)) return res.status(400).json({error:'This email is already registered.'});
  const user={id:id(), email, passwordHash:await bcrypt.hash(password,10), role:['employer','jobseeker'].includes(req.body.role)?req.body.role:'jobseeker', name:clean(req.body.name), company:clean(req.body.company), createdAt:now(), status:'active'};
  db.users.push(user); writeDb(db); req.session.userId=user.id; res.json({user:publicUser(user)});
});
app.post('/api/login', async (req,res)=>{
  const db=readDb(); const email=normalize(req.body.email); const user=db.users.find(u=>u.email===email);
  if(!user || !(await bcrypt.compare(String(req.body.password||''), user.passwordHash))) return res.status(401).json({error:'Wrong email or password.'});
  req.session.userId=user.id; res.json({user:publicUser(user)});
});
app.post('/api/logout',(req,res)=>req.session.destroy(()=>res.json({ok:true})));

app.get('/api/jobs',(req,res)=>{
  const db=readDb(); const city=normalize(req.query.city); const q=normalize(req.query.q);
  let jobs=db.jobs.filter(j=>j.status==='active');
  if(city) jobs=jobs.filter(j=>normalize(j.city)===city);
  if(q) jobs=jobs.filter(j=>normalize(`${j.title} ${j.company} ${j.city} ${j.province} ${(j.skills||[]).join(' ')} ${j.description}`).includes(q));
  jobs.sort((a,b)=>(b.featured===true)-(a.featured===true)||new Date(b.createdAt)-new Date(a.createdAt));
  res.json({jobs:jobs.map(j=>safeJob(j,req))});
});
app.post('/api/jobs', requireLogin, (req,res)=>{
  const db=readDb(), user=currentUser(req);
  const job={id:id(), employerUserId:user.id, title:clean(req.body.title), company:clean(req.body.company||user.company||user.name), city:clean(req.body.city), province:clean(req.body.province), jobType:clean(req.body.jobType||'Full-time'), salary:clean(req.body.salary), skills:toSkills(req.body.skills), description:clean(req.body.description), contactEmail:clean(req.body.contactEmail||user.email), status:'active', featured:false, createdAt:now()};
  if(!job.title||!job.company||!job.city||!job.province||!job.skills.length) return res.status(400).json({error:'Title, company, city, province, and skills are required.'});
  db.jobs.push(job); writeDb(db); res.json({job:safeJob(job,req)});
});
app.get('/api/resumes',(req,res)=>{
  const db=readDb(); const city=normalize(req.query.city); const q=normalize(req.query.q);
  let resumes=db.resumes.filter(r=>r.status==='active');
  if(city) resumes=resumes.filter(r=>normalize(r.city)===city);
  if(q) resumes=resumes.filter(r=>normalize(`${r.candidateName} ${r.targetPosition} ${r.city} ${r.province} ${(r.skills||[]).join(' ')} ${r.summary}`).includes(q));
  resumes.sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt));
  res.json({resumes:resumes.map(r=>safeResume(r,req))});
});
app.post('/api/resumes', requireLogin, upload.single('resumeFile'), (req,res)=>{
  const db=readDb(), user=currentUser(req); const file=saveUploaded(req.file);
  const resume={id:id(), userId:user.id, candidateName:clean(req.body.candidateName||user.name), targetPosition:clean(req.body.targetPosition), city:clean(req.body.city), province:clean(req.body.province), skills:toSkills(req.body.skills), summary:clean(req.body.summary), contactEmail:clean(req.body.contactEmail||user.email), fileUrl:file.url, originalFileName:file.original, status:'active', createdAt:now()};
  if(!resume.candidateName||!resume.targetPosition||!resume.city||!resume.province||!resume.skills.length) return res.status(400).json({error:'Name, target position, city, province, and skills are required.'});
  db.resumes.push(resume); writeDb(db); res.json({resume:safeResume(resume,req)});
});
app.get('/api/matches',(req,res)=>{
  const db=readDb(); const city=normalize(req.query.city); const rows=[];
  db.jobs.filter(j=>j.status==='active').forEach(job=>db.resumes.filter(r=>r.status==='active').forEach(resume=>{
    if(city && normalize(job.city)!==city && normalize(resume.city)!==city) return;
    const m=matchScore(job,resume); if(m.score>=35) rows.push({score:m.score, commonSkills:m.commonSkills, job:safeJob(job,req), resume:safeResume(resume,req)});
  }));
  res.json({matches:rows.sort((a,b)=>b.score-a.score).slice(0,50)});
});
app.get('/api/cities',(req,res)=>{ const db=readDb(); const cities=Array.from(new Set([...db.jobs.map(j=>j.city),...db.resumes.map(r=>r.city)].filter(Boolean))).sort(); res.json({cities}); });
app.post('/api/applications', requireLogin, upload.single('resumeFile'), (req,res)=>{
  const db=readDb(), user=currentUser(req); const job=db.jobs.find(j=>j.id===req.body.jobId && j.status==='active'); if(!job) return res.status(404).json({error:'Job not found.'});
  const file=saveUploaded(req.file); const appn={id:id(), jobId:job.id, employerUserId:job.employerUserId||null, applicantUserId:user.id, name:clean(req.body.name||user.name), email:normalize(req.body.email||user.email), message:clean(req.body.message), resumeFileUrl:file.url, originalFileName:file.original, status:'new', createdAt:now()};
  if(!appn.name||!appn.email||!appn.message) return res.status(400).json({error:'Name, email, and message are required.'});
  db.applications.push(appn); writeDb(db); res.json({application:appn});
});
app.get('/api/employer-dashboard', requireLogin, (req,res)=>{
  const db=readDb(), user=currentUser(req), email=normalize(user.email); const myJobs=db.jobs.filter(j=>j.employerUserId===user.id || normalize(j.contactEmail)===email).sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt));
  const ids=new Set(myJobs.map(j=>j.id)); const applications=db.applications.filter(a=>ids.has(a.jobId)).sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt)).map(a=>({...a, job:myJobs.find(j=>j.id===a.jobId)||null}));
  res.json({user:publicUser(user), jobs:myJobs, applications, totals:{jobs:myJobs.length, applications:applications.length, newApplications:applications.filter(a=>a.status==='new').length}});
});
app.post('/api/applications/:id/status', requireLogin, (req,res)=>{
  const db=readDb(), user=currentUser(req); const a=db.applications.find(x=>x.id===req.params.id); if(!a) return res.status(404).json({error:'Application not found.'}); const job=db.jobs.find(j=>j.id===a.jobId);
  if(!job || (job.employerUserId!==user.id && normalize(job.contactEmail)!==normalize(user.email))) return res.status(403).json({error:'No access'});
  a.status=['new','reviewed','shortlisted','rejected'].includes(req.body.status)?req.body.status:'reviewed'; a.updatedAt=now(); writeDb(db); res.json({application:a});
});
app.post('/api/password-request',(req,res)=>{ const db=readDb(); const email=normalize(req.body.email); if(!email) return res.status(400).json({error:'Email required'}); db.passwordRequests.push({id:id(), email, status:'new', createdAt:now()}); writeDb(db); res.json({ok:true}); });

app.post('/api/admin/login',(req,res)=>{ const ok=normalize(req.body.email)===normalize(process.env.ADMIN_EMAIL||'hr@ameleco.com') && String(req.body.password||'')===String(process.env.ADMIN_PASSWORD||'admin123'); if(!ok) return res.status(401).json({error:'Invalid admin login'}); req.session.admin=true; res.json({ok:true}); });
app.post('/api/admin/logout',(req,res)=>{ req.session.admin=false; res.json({ok:true}); });
app.get('/api/admin/overview', requireAdmin, (req,res)=>{ const db=readDb(); res.json({jobs:db.jobs, resumes:db.resumes, applications:db.applications.map(a=>({...a, job:db.jobs.find(j=>j.id===a.jobId)||null})), users:db.users.map(publicUser), passwordRequests:db.passwordRequests, totals:{jobs:db.jobs.length,resumes:db.resumes.length,applications:db.applications.length,users:db.users.length,passwordRequests:db.passwordRequests.length}}); });
app.delete('/api/admin/jobs/:id', requireAdmin, (req,res)=>{ const db=readDb(); db.jobs=db.jobs.filter(j=>j.id!==req.params.id); db.applications=db.applications.filter(a=>a.jobId!==req.params.id); writeDb(db); res.json({ok:true}); });
app.patch('/api/admin/jobs/:id', requireAdmin, (req,res)=>{ const db=readDb(); const j=db.jobs.find(x=>x.id===req.params.id); if(!j) return res.status(404).json({error:'Job not found'}); if(req.body.status) j.status=req.body.status; if(typeof req.body.featured==='boolean') j.featured=req.body.featured; writeDb(db); res.json({job:j}); });
app.delete('/api/admin/resumes/:id', requireAdmin, (req,res)=>{ const db=readDb(); db.resumes=db.resumes.filter(r=>r.id!==req.params.id); writeDb(db); res.json({ok:true}); });
app.delete('/api/admin/applications/:id', requireAdmin, (req,res)=>{ const db=readDb(); db.applications=db.applications.filter(a=>a.id!==req.params.id); writeDb(db); res.json({ok:true}); });
app.delete('/api/admin/password-requests/:id', requireAdmin, (req,res)=>{ const db=readDb(); db.passwordRequests=db.passwordRequests.filter(r=>r.id!==req.params.id); writeDb(db); res.json({ok:true}); });
app.post('/api/admin/reset-password', requireAdmin, async (req,res)=>{ const db=readDb(); const user=db.users.find(u=>normalize(u.email)===normalize(req.body.email)); if(!user) return res.status(404).json({error:'User not found'}); if(String(req.body.password||'').length<6) return res.status(400).json({error:'Password must be at least 6 characters'}); user.passwordHash=await bcrypt.hash(String(req.body.password),10); user.updatedAt=now(); writeDb(db); res.json({ok:true}); });

app.use((err,req,res,next)=>res.status(400).json({error:err.message||'Something went wrong'}));
app.listen(PORT, () => console.log('HireFree is running on port ' + PORT));
