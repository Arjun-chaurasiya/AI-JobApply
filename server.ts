import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import multer from "multer";
import nodemailer from "nodemailer";
import dotenv from "dotenv";
import fs from "fs";
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const pdfParse = require("pdf-parse");
import { GoogleGenAI } from "@google/genai";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configure Gmail Transporter
const gmailTransporter = (process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD) 
  ? nodemailer.createTransport({
      service: "gmail",
      pool: true, // Use connection pooling
      maxConnections: 1, // Strictly one connection at a time
      maxMessages: 100, // Max messages per connection
      auth: {
        user: process.env.GMAIL_USER,
        pass: process.env.GMAIL_APP_PASSWORD,
      },
    })
  : null;

// Verify transporter on startup
if (gmailTransporter) {
  gmailTransporter.verify((error) => {
    if (error) {
      console.error("Gmail Transporter Verification Error:", error);
    } else {
      console.log("Gmail Transporter is ready to send emails");
    }
  });
}

// In-memory job store
const jobs: Record<string, {
  status: "pending" | "processing" | "completed" | "failed";
  results: { email: string; success: boolean; error?: string }[];
  total: number;
  processed: number;
  error?: string;
}> = {};

// Message Broker Implementation
interface EmailTask {
  jobId: string;
  to: string;
  subject: string;
  body: string;
  fromName: string;
  replyTo?: string;
  recipientName?: string;
}

interface JobResume {
  originalname: string;
  buffer: Buffer;
}

class MessageBroker {
  private queue: EmailTask[] = [];
  // Resume is stored once per job, not duplicated on every task -
  // duplicating it per-task previously bloated the persisted queue file
  // (500 recipients x ~200KB resume = ~99MB) and made every disk write
  // during sending block the event loop long enough that stop requests
  // never got a chance to run.
  private jobResumes: Record<string, JobResume> = {};
  private isProcessing = false;
  private queueFilePath = path.join(process.cwd(), "email_queue.json");

  constructor() {
    this.loadQueue();
  }

  private loadQueue() {
    try {
      if (fs.existsSync(this.queueFilePath)) {
        const data = fs.readFileSync(this.queueFilePath, "utf8");
        const parsed = JSON.parse(data);

        if (Array.isArray(parsed)) {
          // Legacy format: flat array of tasks, each carrying its own resume buffer.
          // Migrate to the compact per-job format.
          for (const task of parsed) {
            if (task.resume && !this.jobResumes[task.jobId]) {
              this.jobResumes[task.jobId] = {
                originalname: task.resume.originalname,
                buffer: Buffer.from(task.resume.buffer, "base64"),
              };
            }
            this.queue.push({
              jobId: task.jobId,
              to: task.to,
              subject: task.subject,
              body: task.body,
              fromName: task.fromName,
              replyTo: task.replyTo,
              recipientName: task.recipientName,
            });
          }
        } else {
          this.queue = parsed.tasks || [];
          for (const [jobId, r] of Object.entries(parsed.resumes || {}) as [string, any][]) {
            this.jobResumes[jobId] = { originalname: r.originalname, buffer: Buffer.from(r.buffer, "base64") };
          }
        }

        console.log(`Loaded ${this.queue.length} tasks from persistent queue.`);
        if (this.queue.length > 0) {
          this.saveQueue(); // rewrite immediately in the compact format
          this.process();
        }
      }
    } catch (err) {
      console.error("Failed to load queue from file:", err);
    }
  }

  private saveQueue() {
    try {
      const resumes: Record<string, { originalname: string; buffer: string }> = {};
      for (const [jobId, r] of Object.entries(this.jobResumes)) {
        if (this.queue.some(t => t.jobId === jobId)) {
          resumes[jobId] = { originalname: r.originalname, buffer: r.buffer.toString("base64") };
        }
      }
      fs.writeFileSync(this.queueFilePath, JSON.stringify({ tasks: this.queue, resumes }));
    } catch (err) {
      console.error("Failed to save queue to file:", err);
    }
  }

  pushBatch(tasks: EmailTask[], resume?: JobResume) {
    if (tasks.length === 0) return;
    if (resume) this.jobResumes[tasks[0].jobId] = resume;
    this.queue.push(...tasks);
    this.saveQueue();
    this.process();
  }

  cancelJob(jobId: string) {
    this.queue = this.queue.filter(t => t.jobId !== jobId);
    delete this.jobResumes[jobId];
    this.saveQueue();
  }

  private async process() {
    if (this.isProcessing || this.queue.length === 0) return;
    this.isProcessing = true;

    while (this.queue.length > 0) {
      const task = this.queue[0]; // Peek at the first task
      const job = jobs[task.jobId];

      // If job object is missing (e.g. server restarted), recreate a minimal one
      if (!job) {
        jobs[task.jobId] = {
          status: "processing",
          results: [],
          total: this.queue.filter(t => t.jobId === task.jobId).length,
          processed: 0
        };
      } else if ((job.status as string) === "failed") {
        this.queue.shift();
        this.saveQueue();
        continue;
      }

      const currentJob = jobs[task.jobId];
      currentJob.status = "processing";

      try {
        if (gmailTransporter) {
          const resume = this.jobResumes[task.jobId];
          const personalizedBody = task.recipientName
            ? task.body.replace(/\{Name\}/g, task.recipientName)
            : task.body.replace(/\{Name\}/g, "");
          await gmailTransporter.sendMail({
            from: `"${task.fromName || "Job Applicant"}" <${process.env.GMAIL_USER}>`,
            to: task.to,
            subject: task.subject,
            text: personalizedBody,
            replyTo: task.replyTo || undefined,
            headers: {
              "X-JobApply-AI": "SentViaApp",
              "X-Category": "Job-Application"
            },
            attachments: resume ? [
              {
                filename: resume.originalname,
                content: resume.buffer,
              }
            ] : [],
          });
          currentJob.results.push({ email: task.to, success: true });
        } else {
          currentJob.results.push({ email: task.to, success: false, error: "Gmail service not configured." });
        }
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        console.error(`Broker failed to send to ${task.to}:`, err);
        currentJob.results.push({ email: task.to, success: false, error: errorMessage });

        if (errorMessage.includes("454-4.7.0") || errorMessage.includes("Too many login attempts")) {
          console.warn("Broker stopping job due to Gmail login throttling.");
          currentJob.status = "failed";
          currentJob.error = "Gmail throttling block detected.";
          this.cancelJob(task.jobId);
          continue; // cancelJob already shifts/filters and saves
        }
      } finally {
        // Remove the task we just processed
        this.queue.shift();
        this.saveQueue();

        currentJob.processed++;
        if (currentJob.processed >= currentJob.total && (currentJob.status as string) !== "failed") {
          currentJob.status = "completed";
          delete this.jobResumes[task.jobId];
        }
        
        // Respect Gmail throttling
        if (this.queue.length > 0) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }
    }

    this.isProcessing = false;
  }
}

const broker = new MessageBroker();

async function startServer() {
  console.log("Starting server...");
  const app = express();
  const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;

  // Configure multer for memory storage
  const storage = multer.memoryStorage();
  const upload = multer({ storage: storage });

  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // Health check
  app.get("/api/health", (req, res) => {
    res.json({ 
      status: "ok", 
      gmailConfigured: !!gmailTransporter,
      gmailUser: process.env.GMAIL_USER || null
    });
  });

  // API Routes
  console.log("Registering /api/send-emails route...");

  app.get("/api/jobs/:jobId", (req, res) => {
    const { jobId } = req.params;
    const job = jobs[jobId];
    if (!job) {
      return res.status(404).json({ error: "Job not found" });
    }
    res.json(job);
  });

  app.delete("/api/jobs/:jobId", (req, res) => {
    const { jobId } = req.params;
    const job = jobs[jobId];
    if (!job) {
      return res.status(404).json({ error: "Job not found" });
    }
    job.status = "failed";
    job.error = "Stopped by user";
    broker.cancelJob(jobId);
    res.json({ status: "ok" });
  });

  // Generic/role-based email local parts that are not personal names
  const GENERIC_LOCAL_PARTS = new Set([
    "careers", "career", "hr", "jobs", "job", "info", "recruit", "recruiting",
    "recruiter", "hiring", "talent", "apply", "applications", "application",
    "contact", "hello", "team", "staff", "people", "work", "employment",
    "resumes", "resume", "cvs", "cv", "opportunity", "opportunities", "hello",
  ]);

  function deriveNameFromEmail(email: string): string {
    const [localPart, domain] = email.split("@");
    const localWords = localPart
      .replace(/[._\-]+/g, " ")
      .replace(/\d+/g, "")
      .trim()
      .split(" ")
      .filter(w => w.length > 1);

    // If local part looks like a real name (2+ parts, none are generic), use it
    if (
      localWords.length >= 2 &&
      localWords.every(w => !GENERIC_LOCAL_PARTS.has(w.toLowerCase()))
    ) {
      return localWords.map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(" ");
    }

    // If single word and not generic, still use it as a name
    if (
      localWords.length === 1 &&
      !GENERIC_LOCAL_PARTS.has(localWords[0].toLowerCase())
    ) {
      const w = localWords[0];
      return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
    }

    // Fallback: extract company name from domain (e.g. sybroxtech.com → Sybroxtech)
    const company = domain.split(".")[0];
    const companyName = company.charAt(0).toUpperCase() + company.slice(1).toLowerCase();
    return `${companyName} Recruiter`;
  }

  // Regex-based fallback: extract emails and derive names from the email itself
  function extractRecruitersFromText(text: string): { name: string; email: string }[] {
    const emailRegex = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;
    const seen = new Set<string>();
    const results: { name: string; email: string }[] = [];
    let match;
    while ((match = emailRegex.exec(text)) !== null) {
      const email = match[0];
      if (seen.has(email)) continue;
      seen.add(email);
      results.push({ email, name: deriveNameFromEmail(email) });
    }
    return results;
  }

  app.post("/api/extract-recruiters", upload.single("pdf"), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: "No PDF uploaded" });
    try {
      const pdfData = await pdfParse(req.file.buffer);
      const text = pdfData.text;

      // Try Gemini AI first, fall back to regex if quota exceeded or unavailable
      if (process.env.GEMINI_API_KEY) {
        try {
          const genai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
          const response = await genai.
          
          
          models.generateContent({
            model: "gemini-2.0-flash",
            contents: `Extract all recruiter/contact names and email addresses from the text below.
Return ONLY a valid JSON array in this format: [{"name": "Full Name", "email": "email@example.com"}]
If no name is found for an email, use an empty string for name.
Do not include any explanation, just the JSON array.

Text:
${text}`,
          });

          const raw = response.text || "";
          const jsonMatch = raw.match(/\[[\s\S]*\]/);
          if (jsonMatch) {
            const recruiters = JSON.parse(jsonMatch[0]).map((r: any) => ({
              ...r,
              name: deriveNameFromEmail(r.email),
            }));
            return res.json({ recruiters, source: "ai" });
          }
        } catch (aiErr: any) {
          const is429 = aiErr?.status === 429 || String(aiErr).includes("429") || String(aiErr).includes("RESOURCE_EXHAUSTED");
          if (!is429) throw aiErr;
          console.warn("Gemini quota exceeded, falling back to regex extraction.");
        }
      }

      // Regex fallback
      const recruiters = extractRecruitersFromText(text);
      if (recruiters.length === 0) return res.status(422).json({ error: "No email addresses found in PDF" });
      res.json({ recruiters, source: "regex" });

    } catch (err) {
      console.error("PDF extraction error:", err);
      res.status(500).json({ error: "Failed to parse PDF" });
    }
  });

  app.post("/api/send-emails", upload.single("resume"), async (req, res) => {
    console.log("Received request to /api/send-emails");
    try {
      const { emails, subject, body, fromName, replyTo, recipientsJson } = req.body;
      const resume = req.file;

      if (!gmailTransporter) {
        return res.status(500).json({
          error: "No email service configured. Please add GMAIL_USER and GMAIL_APP_PASSWORD to your environment variables."
        });
      }

      // Support both personalized recipients (from PDF) and plain email list
      let recipientList: { email: string; name?: string }[] = [];
      if (recipientsJson) {
        recipientList = JSON.parse(recipientsJson).filter((r: any) => r.email?.trim());
      } else {
        recipientList = emails.split(",").map((e: string) => ({ email: e.trim() })).filter((r: any) => r.email);
      }

      if (recipientList.length === 0) {
        return res.status(400).json({ error: "No valid email addresses provided" });
      }

      const jobId = Date.now().toString();
      jobs[jobId] = {
        status: "pending",
        results: [],
        total: recipientList.length,
        processed: 0
      };

      const taggedBody = `${body}\n\n---\nSent via JobApply AI`;

      // Build all tasks in memory and push as a single batch (one disk write),
      // with the resume stored once per job instead of once per recipient.
      const tasks = recipientList.map(recipient => ({
        jobId,
        to: recipient.email,
        subject,
        body: taggedBody,
        fromName,
        replyTo,
        recipientName: recipient.name || undefined,
      }));
      broker.pushBatch(tasks, resume ? { originalname: resume.originalname, buffer: resume.buffer } : undefined);

      res.json({ jobId });
    } catch (error) {
      console.error("Server error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
