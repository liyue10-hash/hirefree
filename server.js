const express = require("express");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const nodemailer = require("nodemailer");

const app = express();

const PORT = process.env.PORT || 3000;

const DATA_DIR = path.join(__dirname, "data");
const UPLOAD_DIR = path.join(__dirname, "uploads");
const DB_PATH = path.join(DATA_DIR, "database.json");

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

let ADMIN_EMAIL = process.env.ADMIN_EMAIL || "hr@ameleco.com";
let ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin123";

const SMTP_HOST = process.env.SMTP_HOST || "";
const SMTP_PORT = process.env.SMTP_PORT || "587";
const SMTP_USER = process.env.SMTP_USER || "";
const SMTP_PASS = process.env.SMTP_PASS || "";
const SMTP_FROM = process.env.SMTP_FROM || SMTP_USER || ADMIN_EMAIL;

const smtpConfigured = !!(SMTP_HOST && SMTP_PORT && SMTP_USER && SMTP_PASS && SMTP_FROM);

const recoveryRequests = {};

const upload = multer({
  dest: UPLOAD_DIR,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = [
      "application/pdf",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    ];

    if (!allowed.includes(file.mimetype)) {
      return cb(new Error("Only PDF, DOC, or DOCX files are allowed"));
    }

    cb(null, true);
  }
});

function id() {
  return crypto.randomUUID();
}

function now() {
  return new Date().toISOString();
}

function cleanText(v) {
  return String(v || "").trim();
}

function normalize(v) {
  return String(v || "").toLowerCase().trim();
}

function toSkills(text) {
  if (Array.isArray(text)) {
    return text.map(cleanText).filter(Boolean).map(s => s.toLowerCase());
  }

  return String(text || "")
    .split(",")
    .map(cleanText)
    .filter(Boolean)
    .map(s => s.toLowerCase());
}

function initialDb() {
  return {
    users: [],
    jobs: [
      {
        id: id(),
        employerUserId: null,
        title: "Electrical Counter Sales",
        company: "Ameleco Electric Supply",
        city: "Burnaby",
        province: "BC",
        jobType: "Full-time",
        salary: "$22-$30/hour",
        skills: ["electrical", "sales", "customer service", "inventory", "contractors"],
        description: "Serve walk-in contractors, prepare quotes, check stock, and support branch sales. Electrical material knowledge is preferred.",
        contactEmail: "hr@example.com",
        status: "active",
        featured: false,
        createdAt: now()
      },
      {
        id: id(),
        employerUserId: null,
        title: "Warehouse Associate",
        company: "West Canada Supply",
        city: "Calgary",
        province: "AB",
        jobType: "Full-time",
        salary: "$20-$26/hour",
        skills: ["warehouse", "forklift", "shipping", "receiving", "inventory"],
        description: "Pick, pack, receive, and organize electrical products in a warehouse/showroom branch.",
        contactEmail: "jobs@example.com",
        status: "active",
        featured: false,
        createdAt: now()
      }
    ],
    resumes: [
      {
        id: id(),
        userId: null,
        candidateName: "Jason L.",
        targetPosition: "Counter Sales / Inside Sales",
        city: "Burnaby",
        province: "BC",
        skills: ["sales", "customer service", "electrical", "quotes", "inventory"],
        summary: "3 years counter sales experience in construction supplies. Strong with contractor service and fast quoting.",
        contactEmail: "jason@example.com",
        fileUrl: "",
        status: "active",
        createdAt: now()
      },
      {
        id: id(),
        userId: null,
        candidateName: "Maria C.",
        targetPosition: "Warehouse / Shipping",
        city: "Calgary",
        province: "AB",
        skills: ["warehouse", "forklift", "receiving", "shipping", "inventory"],
        summary: "Warehouse associate with forklift experience, receiving, picking orders, and cycle counts.",
        contactEmail: "maria@example.com",
        fileUrl: "",
        status: "active",
        createdAt: now()
      }
    ],
    applications: [],
    passwordRequests: []
  };
}

function readDb() {
  if (!fs.existsSync(DB_PATH)) {
    writeDb(initialDb());
  }

  const db = JSON.parse(fs.readFileSync(DB_PATH, "utf8"));

  if (!Array.isArray(db.users)) db.users = [];
  if (!Array.isArray(db.jobs)) db.jobs = [];
  if (!Array.isArray(db.resumes)) db.resumes = [];
  if (!Array.isArray(db.applications)) db.applications = [];
  if (!Array.isArray(db.passwordRequests)) db.passwordRequests = [];

  return db;
}

function writeDb(db) {
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
}

function publicUser(user) {
  if (!user) return null;

  return {
    id: user.id,
    email: user.email,
    role: user.role,
    name: user.name,
    company: user.company
  };
}

function currentUser(req) {
  const db = readDb();
  return db.users.find(u => u.id === req.session.userId) || null;
}

function requireLogin(req, res, next) {
  if (!req.session.userId) {
    return res.status(401).json({ error: "Please log in first." });
  }

  next();
}

function canSeeContact(req) {
  return !!req.session.userId;
}

function safeJob(job, req) {
  return {
    ...job,
    contactEmail: canSeeContact(req) ? job.contactEmail : "Login to view contact"
  };
}

function safeResume(resume, req) {
  return {
    ...resume,
    contactEmail: canSeeContact(req) ? resume.contactEmail : "Login to view contact",
    fileUrl: canSeeContact(req) ? resume.fileUrl : ""
  };
}

function matchScore(job, resume) {
  const jobSkills = (job.skills || []).map(normalize);
  const resumeSkills = (resume.skills || []).map(normalize);
  const commonSkills = resumeSkills.filter(s => jobSkills.includes(s));

  const skillScore = commonSkills.length / Math.max(jobSkills.length, 1);
  const cityBonus = normalize(job.city) === normalize(resume.city) ? 0.2 : 0;
  const provinceBonus = normalize(job.province) === normalize(resume.province) ? 0.1 : 0;

  const titleText = `${resume.targetPosition || ""} ${resume.summary || ""}`.toLowerCase();
  const titleBonus = normalize(job.title)
    .split(/\s+/)
    .some(w => w.length > 3 && titleText.includes(w))
    ? 0.05
    : 0;

  const score = Math.min(100, Math.round((skillScore * 0.65 + cityBonus + provinceBonus + titleBonus) * 100));

  return { score, commonSkills };
}

async function sendRecoveryEmail(to, code) {
  if (!smtpConfigured) {
    throw new Error("SMTP is not configured.");
  }

  const transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT),
    secure: false,
    auth: {
      user: SMTP_USER,
      pass: SMTP_PASS
    },
    requireTLS: true
  });

  await transporter.sendMail({
    from: SMTP_FROM,
    to,
    subject: "HireFree Admin Recovery Code",
    text: `Your HireFree admin recovery code is: ${code}\n\nThis code expires in 15 minutes.`
  });
}

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: process.env.SESSION_SECRET || "hirefree-session-secret",
  resave: false,
  saveUninitialized: false
}));

app.use("/uploads", express.static(UPLOAD_DIR));
app.use(express.static(path.join(__dirname, "public")));

app.get("/api/me", (req, res) => {
  res.json({ user: publicUser(currentUser(req)) });
});

app.post("/api/register", async (req, res) => {
  const db = readDb();

  const email = normalize(req.body.email);
  const password = String(req.body.password || "");
  const role = ["employer", "jobseeker"].includes(req.body.role) ? req.body.role : "jobseeker";
  const name = cleanText(req.body.name);
  const company = cleanText(req.body.company);

  if (!email || password.length < 6) {
    return res.status(400).json({ error: "Email and at least 6-character password are required." });
  }

  if (db.users.some(u => u.email === email)) {
    return res.status(400).json({ error: "This email is already registered." });
  }

  const user = {
    id: id(),
    email,
    passwordHash: await bcrypt.hash(password, 10),
    role,
    name,
    company,
    status: "active",
    createdAt: now()
  };

  db.users.push(user);
  writeDb(db);

  req.session.userId = user.id;

  res.json({ user: publicUser(user) });
});

app.post("/api/login", async (req, res) => {
  const db = readDb();

  const email = normalize(req.body.email);
  const password = String(req.body.password || "");

  const user = db.users.find(u => u.email === email);

  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
    return res.status(401).json({ error: "Wrong email or password." });
  }

  req.session.userId = user.id;

  res.json({ user: publicUser(user) });
});

app.post("/api/logout", (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get("/api/jobs", (req, res) => {
  const db = readDb();

  const city = normalize(req.query.city);
  const province = normalize(req.query.province);
  const q = normalize(req.query.q);

  let jobs = db.jobs.filter(j => j.status !== "deleted" && j.status !== "hidden");

  if (city) jobs = jobs.filter(j => normalize(j.city) === city);
  if (province) jobs = jobs.filter(j => normalize(j.province) === province);

  if (q) {
    jobs = jobs.filter(j =>
      normalize(`${j.title} ${j.company} ${j.city} ${j.province} ${(j.skills || []).join(" ")} ${j.description}`).includes(q)
    );
  }

  jobs.sort((a, b) => {
    if (!!b.featured !== !!a.featured) return Number(!!b.featured) - Number(!!a.featured);
    return new Date(b.createdAt || 0) - new Date(a.createdAt || 0);
  });

  res.json({ jobs: jobs.map(j => safeJob(j, req)) });
});

app.post("/api/jobs", requireLogin, (req, res) => {
  const user = currentUser(req);
  const db = readDb();

  const job = {
    id: id(),
    employerUserId: user.id,
    title: cleanText(req.body.title),
    company: cleanText(req.body.company || user.company || user.name),
    city: cleanText(req.body.city),
    province: cleanText(req.body.province),
    jobType: cleanText(req.body.jobType || "Full-time"),
    salary: cleanText(req.body.salary),
    skills: toSkills(req.body.skills),
    description: cleanText(req.body.description),
    contactEmail: cleanText(req.body.contactEmail || user.email),
    status: "active",
    featured: false,
    createdAt: now()
  };

  if (!job.title || !job.company || !job.city || !job.province || !job.skills.length) {
    return res.status(400).json({ error: "Title, company, city, province, and skills are required." });
  }

  db.jobs.push(job);
  writeDb(db);

  res.json({ job: safeJob(job, req) });
});

app.get("/api/resumes", (req, res) => {
  const db = readDb();

  const city = normalize(req.query.city);
  const province = normalize(req.query.province);
  const q = normalize(req.query.q);

  let resumes = db.resumes.filter(r => r.status !== "deleted" && r.status !== "hidden");

  if (city) resumes = resumes.filter(r => normalize(r.city) === city);
  if (province) resumes = resumes.filter(r => normalize(r.province) === province);

  if (q) {
    resumes = resumes.filter(r =>
      normalize(`${r.candidateName} ${r.targetPosition} ${r.city} ${r.province} ${(r.skills || []).join(" ")} ${r.summary}`).includes(q)
    );
  }

  resumes.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));

  res.json({ resumes: resumes.map(r => safeResume(r, req)) });
});

app.post("/api/resumes", requireLogin, upload.single("resumeFile"), (req, res) => {
  const user = currentUser(req);
  const db = readDb();

  let fileUrl = "";

  if (req.file) {
    const ext = path.extname(req.file.originalname || "").toLowerCase() || ".pdf";
    const newName = `${req.file.filename}${ext}`;
    fs.renameSync(req.file.path, path.join(UPLOAD_DIR, newName));
    fileUrl = `/uploads/${newName}`;
  }

  const resume = {
    id: id(),
    userId: user.id,
    candidateName: cleanText(req.body.candidateName || user.name),
    targetPosition: cleanText(req.body.targetPosition),
    city: cleanText(req.body.city),
    province: cleanText(req.body.province),
    skills: toSkills(req.body.skills),
    summary: cleanText(req.body.summary),
    contactEmail: cleanText(req.body.contactEmail || user.email),
    fileUrl,
    status: "active",
    createdAt: now()
  };

  if (!resume.candidateName || !resume.targetPosition || !resume.city || !resume.province || !resume.skills.length) {
    return res.status(400).json({ error: "Name, target position, city, province, and skills are required." });
  }

  db.resumes.push(resume);
  writeDb(db);

  res.json({ resume: safeResume(resume, req) });
});

app.get("/api/matches", (req, res) => {
  const db = readDb();
  const city = normalize(req.query.city);

  const rows = [];

  db.jobs.filter(j => j.status === "active").forEach(job => {
    db.resumes.filter(r => r.status === "active").forEach(resume => {
      if (city && normalize(job.city) !== city && normalize(resume.city) !== city) return;

      const result = matchScore(job, resume);

      if (result.score >= 35) {
        rows.push({
          score: result.score,
          commonSkills: result.commonSkills,
          job: safeJob(job, req),
          resume: safeResume(resume, req)
        });
      }
    });
  });

  rows.sort((a, b) => b.score - a.score);

  res.json({ matches: rows.slice(0, 50) });
});

app.get("/api/cities", (req, res) => {
  const db = readDb();

  const cities = Array.from(new Set([
    ...db.jobs.map(j => j.city),
    ...db.resumes.map(r => r.city)
  ].filter(Boolean))).sort();

  const provinces = Array.from(new Set([
    ...db.jobs.map(j => j.province),
    ...db.resumes.map(r => r.province)
  ].filter(Boolean))).sort();

  res.json({ cities, provinces });
});

app.post("/api/applications", requireLogin, upload.single("resumeFile"), (req, res) => {
  const user = currentUser(req);
  const db = readDb();

  const job = db.jobs.find(j => j.id === req.body.jobId && j.status === "active");

  if (!job) {
    return res.status(404).json({ error: "Job not found." });
  }

  let fileUrl = "";
  let originalFileName = "";

  if (req.file) {
    originalFileName = req.file.originalname || "resume";
    const ext = path.extname(req.file.originalname || "").toLowerCase() || ".pdf";
    const newName = `${req.file.filename}${ext}`;
    fs.renameSync(req.file.path, path.join(UPLOAD_DIR, newName));
    fileUrl = `/uploads/${newName}`;
  }

  const application = {
    id: id(),
    jobId: job.id,
    jobTitle: job.title,
    employerUserId: job.employerUserId || null,
    applicantUserId: user.id,
    name: cleanText(req.body.name || user.name),
    email: normalize(req.body.email || user.email),
    message: cleanText(req.body.message),
    resumeFileUrl: fileUrl,
    originalFileName,
    status: "new",
    createdAt: now()
  };

  if (!application.name || !application.email || !application.message) {
    return res.status(400).json({ error: "Name, email, and message are required." });
  }

  db.applications.push(application);
  writeDb(db);

  res.json({ application });
});

app.get("/api/applications", (req, res) => {
  const db = readDb();

  const applications = db.applications
    .filter(a => a.status !== "deleted")
    .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));

  res.json({ applications });
});

app.get("/api/employer-dashboard", requireLogin, (req, res) => {
  const user = currentUser(req);
  const db = readDb();

  const userEmail = normalize(user.email);

  const myJobs = db.jobs
    .filter(j => j.employerUserId === user.id || normalize(j.contactEmail) === userEmail)
    .filter(j => j.status !== "deleted")
    .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));

  const jobIds = new Set(myJobs.map(j => j.id));

  const applications = db.applications
    .filter(a => jobIds.has(a.jobId) && a.status !== "deleted")
    .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))
    .map(a => ({
      ...a,
      job: myJobs.find(j => j.id === a.jobId) || null
    }));

  res.json({
    user: publicUser(user),
    jobs: myJobs,
    applications,
    totals: {
      jobs: myJobs.length,
      applications: applications.length,
      newApplications: applications.filter(a => a.status === "new").length
    }
  });
});

app.post("/api/applications/:id/status", requireLogin, (req, res) => {
  const user = currentUser(req);
  const db = readDb();

  const application = db.applications.find(a => a.id === req.params.id);

  if (!application) {
    return res.status(404).json({ error: "Application not found." });
  }

  const job = db.jobs.find(j => j.id === application.jobId);

  if (!job || (job.employerUserId !== user.id && normalize(job.contactEmail) !== normalize(user.email))) {
    return res.status(403).json({ error: "You do not have access to this application." });
  }

  const allowed = ["new", "reviewed", "shortlisted", "rejected"];

  application.status = allowed.includes(req.body.status) ? req.body.status : "reviewed";
  application.updatedAt = now();

  writeDb(db);

  res.json({ application });
});

app.post("/api/upload-application-resume", requireLogin, upload.single("resumeFile"), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "Please choose a resume file first." });
  }

  const ext = path.extname(req.file.originalname || "").toLowerCase() || ".pdf";
  const newName = `${req.file.filename}${ext}`;

  fs.renameSync(req.file.path, path.join(UPLOAD_DIR, newName));

  res.json({ fileUrl: `/uploads/${newName}` });
});

app.post("/api/password-request", (req, res) => {
  const db = readDb();

  const email = normalize(req.body.email);

  if (!email) {
    return res.status(400).json({ error: "Email is required." });
  }

  const request = {
    id: id(),
    email,
    status: "new",
    createdAt: now()
  };

  db.passwordRequests.push(request);
  writeDb(db);

  res.json({
    ok: true,
    message: "Password reset request submitted. Admin will contact you."
  });
});

app.post("/api/admin-login", (req, res) => {
  const email = normalize(req.body.email);
  const password = String(req.body.password || "");

  if (email === normalize(ADMIN_EMAIL) && password === ADMIN_PASSWORD) {
    req.session.isAdmin = true;
    return res.json({ ok: true });
  }

  res.status(401).json({ error: "Invalid admin login." });
});

app.post("/api/admin-logout", (req, res) => {
  req.session.isAdmin = false;
  res.json({ ok: true });
});

function requireAdmin(req, res, next) {
  if (!req.session.isAdmin) {
    return res.status(401).json({ error: "Admin login required." });
  }

  next();
}

app.get("/api/admin/summary", requireAdmin, (req, res) => {
  const db = readDb();

  res.json({
    jobs: db.jobs.filter(j => j.status !== "deleted").length,
    resumes: db.resumes.filter(r => r.status !== "deleted").length,
    applications: db.applications.filter(a => a.status !== "deleted").length,
    users: db.users.length,
    passwordRequests: db.passwordRequests.length
  });
});

app.get("/api/users", requireAdmin, (req, res) => {
  const db = readDb();
  res.json({ users: db.users.map(publicUser) });
});

app.get("/api/admin/all", requireAdmin, (req, res) => {
  const db = readDb();

  res.json({
    jobs: db.jobs.filter(j => j.status !== "deleted"),
    resumes: db.resumes.filter(r => r.status !== "deleted"),
    applications: db.applications.filter(a => a.status !== "deleted"),
    users: db.users.map(publicUser),
    passwordRequests: db.passwordRequests || []
  });
});

app.delete("/api/admin/delete-job/:id", requireAdmin, (req, res) => {
  const db = readDb();

  const job = db.jobs.find(j => j.id === req.params.id);

  if (!job) {
    return res.status(404).json({ error: "Job not found." });
  }

  job.status = "deleted";
  job.updatedAt = now();

  writeDb(db);

  res.json({ ok: true });
});

app.delete("/api/admin/delete-resume/:id", requireAdmin, (req, res) => {
  const db = readDb();

  const resume = db.resumes.find(r => r.id === req.params.id);

  if (!resume) {
    return res.status(404).json({ error: "Resume not found." });
  }

  resume.status = "deleted";
  resume.updatedAt = now();

  writeDb(db);

  res.json({ ok: true });
});

app.delete("/api/admin/delete-application/:id", requireAdmin, (req, res) => {
  const db = readDb();

  const application = db.applications.find(a => a.id === req.params.id);

  if (!application) {
    return res.status(404).json({ error: "Application not found." });
  }

  application.status = "deleted";
  application.updatedAt = now();

  writeDb(db);

  res.json({ ok: true });
});

app.post("/api/admin/job/:id/status", requireAdmin, (req, res) => {
  const db = readDb();

  const job = db.jobs.find(j => j.id === req.params.id);

  if (!job) {
    return res.status(404).json({ error: "Job not found." });
  }

  const allowed = ["active", "hidden"];

  job.status = allowed.includes(req.body.status) ? req.body.status : "active";
  job.updatedAt = now();

  writeDb(db);

  res.json({ job });
});

app.post("/api/admin/job/:id/featured", requireAdmin, (req, res) => {
  const db = readDb();

  const job = db.jobs.find(j => j.id === req.params.id);

  if (!job) {
    return res.status(404).json({ error: "Job not found." });
  }

  job.featured = !!req.body.featured;
  job.updatedAt = now();

  writeDb(db);

  res.json({ job });
});

app.post("/api/admin/password-request/:id/status", requireAdmin, (req, res) => {
  const db = readDb();

  const request = db.passwordRequests.find(r => r.id === req.params.id);

  if (!request) {
    return res.status(404).json({ error: "Password request not found." });
  }

  request.status = cleanText(req.body.status || "reviewed");
  request.updatedAt = now();

  writeDb(db);

  res.json({ request });
});

app.post("/api/admin-recovery/request", async (req, res) => {
  try {
    const email = normalize(req.body.email);

    if (!email || email !== normalize(ADMIN_EMAIL)) {
      return res.status(400).json({ error: "Invalid admin email." });
    }

    if (!smtpConfigured) {
      return res.status(500).json({
        error: "Verification code could not be sent. Please configure SMTP in Render Environment Variables."
      });
    }

    const requestId = Date.now().toString();
    const emailCode = Math.floor(100000 + Math.random() * 900000).toString();

    recoveryRequests[requestId] = {
      email,
      emailCode,
      createdAt: Date.now()
    };

    await sendRecoveryEmail(email, emailCode);

    res.json({
      ok: true,
      requestId
    });
  } catch (err) {
    console.error("Admin recovery request error:", err);

    res.status(500).json({
      error: err.message || "Failed to send verification code."
    });
  }
});

app.post("/api/admin-recovery/verify", async (req, res) => {
  try {
    const requestId = cleanText(req.body.requestId);
    const emailCode = cleanText(req.body.emailCode);
    const newPassword = String(req.body.newPassword || "");

    const request = recoveryRequests[requestId];

    if (!request) {
      return res.status(400).json({ error: "Recovery request not found or expired." });
    }

    if (Date.now() - request.createdAt > 15 * 60 * 1000) {
      delete recoveryRequests[requestId];
      return res.status(400).json({ error: "Verification code expired. Please request again." });
    }

    if (!emailCode || emailCode !== request.emailCode) {
      return res.status(400).json({ error: "Invalid email verification code." });
    }

    if (!newPassword || newPassword.length < 8) {
      return res.status(400).json({ error: "Password must be at least 8 characters." });
    }

    ADMIN_PASSWORD = newPassword;

    delete recoveryRequests[requestId];

    res.json({
      ok: true,
      message: "Admin password reset successfully."
    });
  } catch (err) {
    console.error("Admin recovery verify error:", err);

    res.status(500).json({
      error: err.message || "Password reset failed."
    });
  }
});

app.use((err, req, res, next) => {
  console.error(err);

  res.status(400).json({
    error: err.message || "Something went wrong."
  });
});

app.listen(PORT, () => {
  console.log("HireFree is running on port " + PORT);
});