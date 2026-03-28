import { useState, useRef, useEffect, ChangeEvent } from "react";
import { GoogleGenAI } from "@google/genai";
import { motion, AnimatePresence } from "motion/react";
import {
  Mail,
  Upload,
  Send,
  User,
  FileText,
  Sparkles,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Plus,
  X,
  History,
  Trash2,
  FileJson,
  Copy,
  Users
} from "lucide-react";
import { cn } from "./lib/utils";

interface Recruiter {
  name: string;
  email: string;
}

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

export default function App() {
  const [fromName, setFromName] = useState("Arjun Chaurasiya");
  const [replyTo, setReplyTo] = useState("arjunkmr1997@gmail.com");
  const [subject, setSubject] = useState("Application for Senior QA Engineer Position – Arjun Chaurasiya (6+ Years Experience)");
  const [body, setBody] = useState(`Hi {Name},

I got to know that you are hiring. I am looking for a Senior QA / Test Automation position. Please find my details below:

• Current Role: Senior SQA Engineer / QA Engineer II
• Current Location: Bangalore, India
• Experience: 6+ Years
• Skills: API Testing, UI Automation, Functional & Regression Testing
• Tools: REST Assured, Postman, Selenium, Playwright, TestNG, Jira, Jenkins

I have hands-on experience in both API and UI automation, along with end-to-end testing and release ownership.

Attached is my resume for your reference. Kindly share it with your team or relevant colleagues. Please let me know if any further information is required.

Thanks & regards,
Arjun Chaurasiya
Contact No: +91-7906973405`);
  const [emails, setEmails] = useState("");
  const [recruiters, setRecruiters] = useState<Recruiter[]>([]);
  const [isExtractingPDF, setIsExtractingPDF] = useState(false);
  const [resume, setResume] = useState<File | null>(null);
  const [resumeData, setResumeData] = useState<{ name: string; type: string; data: string } | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [currentJobId, setCurrentJobId] = useState<string | null>(null);
  const [jobProgress, setJobProgress] = useState<{ processed: number; total: number } | null>(null);
  const [results, setResults] = useState<{ email: string; success: boolean; error?: string }[] | null>(null);
  const [viewMode, setViewMode] = useState<"list" | "plain">("list");
  const [history, setHistory] = useState<{ email: string; success: boolean; timestamp: string; error?: string }[]>([]);
  const [apiStatus, setApiStatus] = useState<{ ok: boolean; gmail: boolean; gmailUser: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const recruiterPdfRef = useRef<HTMLInputElement>(null);

  // Load remembered resume and history on mount
  useEffect(() => {
    const savedResume = localStorage.getItem("default_resume");
    if (savedResume) {
      try {
        const parsed = JSON.parse(savedResume);
        setResumeData(parsed);
      } catch (e) {
        console.error("Failed to load saved resume", e);
      }
    }

    const savedHistory = localStorage.getItem("send_history");
    if (savedHistory) {
      try {
        setHistory(JSON.parse(savedHistory));
      } catch (e) {
        console.error("Failed to load history", e);
      }
    }
  }, []);

  useEffect(() => {
    let retryCount = 0;
    const maxRetries = 5;

    const checkApi = async () => {
      try {
        const res = await fetch("/api/health");
        if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
        const data = await res.json();
        setApiStatus({ 
          ok: data.status === "ok", 
          gmail: data.gmailConfigured,
          gmailUser: data.gmailUser
        });
        setError(null);
      } catch (err) {
        console.error("API check failed:", err);
        if (retryCount < maxRetries) {
          retryCount++;
          setTimeout(checkApi, 2000); // Retry after 2 seconds
        } else {
          setApiStatus({ ok: false, gmail: false, gmailUser: null });
          setError("Could not connect to the backend API. Please try refreshing the page.");
        }
      }
    };
    checkApi();
  }, []);

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      setResume(file);
      setResumeData(null); // Clear remembered resume if a new one is picked
      
      // Save to localStorage for persistence
      const reader = new FileReader();
      reader.onload = (event) => {
        const base64 = event.target?.result as string;
        const data = {
          name: file.name,
          type: file.type,
          data: base64
        };
        localStorage.setItem("default_resume", JSON.stringify(data));
      };
      reader.readAsDataURL(file);
    }
  };

  const handleRecruiterPDF = async (e: ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files?.[0]) return;
    setIsExtractingPDF(true);
    setError(null);
    const formData = new FormData();
    formData.append("pdf", e.target.files[0]);
    try {
      const res = await fetch("/api/extract-recruiters", { method: "POST", body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Extraction failed");
      const extracted: Recruiter[] = data.recruiters || [];
      setRecruiters(extracted);
      setEmails(extracted.map(r => r.email).join(", "));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to extract recruiters from PDF");
    } finally {
      setIsExtractingPDF(false);
      // Reset input so same file can be re-uploaded
      if (recruiterPdfRef.current) recruiterPdfRef.current.value = "";
    }
  };

  const removeRecruiter = (idx: number) => {
    const updated = recruiters.filter((_, i) => i !== idx);
    setRecruiters(updated);
    setEmails(updated.map(r => r.email).join(", "));
  };

  const generateAIBody = async () => {
    if (!fromName) {
      setError("Please enter your name first.");
      return;
    }
    setIsGenerating(true);
    setError(null);
    try {
      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: `Write a professional and concise job application email body for ${fromName}. 
        The email should be adaptable for various job opportunities. 
        Mention that the resume is attached. 
        Keep it under 200 words. 
        Include placeholders like [Company Name] and [Job Title] where appropriate.`,
      });
      setBody(response.text || "");
    } catch (err) {
      console.error(err);
      setError("Failed to generate AI content. Please try again.");
    } finally {
      setIsGenerating(false);
    }
  };

  const stopJob = async () => {
    if (!currentJobId) return;
    try {
      await fetch(`/api/jobs/${currentJobId}`, { method: "DELETE" });
      setError("Email sending stopped by user.");
    } catch (err) {
      console.error("Failed to stop job:", err);
    }
  };
  const sendEmails = async (retryList?: string[]) => {
    const targetEmails = Array.isArray(retryList) ? retryList.join(", ") : emails;
    
    if (!targetEmails || !subject || !body || !fromName) {
      setError("Please fill in all required fields.");
      return;
    }
    setIsSending(true);
    setError(null);
    if (!retryList) setResults(null);

    const formData = new FormData();
    if (recruiters.length > 0 && !retryList) {
      formData.append("recipientsJson", JSON.stringify(recruiters));
    } else {
      formData.append("emails", targetEmails);
    }
    formData.append("subject", subject);
    formData.append("body", body);
    formData.append("fromName", fromName);
    if (replyTo) {
      formData.append("replyTo", replyTo);
    }
    if (resume) {
      formData.append("resume", resume);
    } else if (resumeData) {
      // Convert base64 back to Blob for sending
      const base64 = resumeData.data.split(",")[1];
      const binary = atob(base64);
      const array = [];
      for (let i = 0; i < binary.length; i++) {
        array.push(binary.charCodeAt(i));
      }
      const blob = new Blob([new Uint8Array(array)], { type: resumeData.type });
      formData.append("resume", blob, resumeData.name);
    }

    try {
      const response = await fetch("/api/send-emails", {
        method: "POST",
        body: formData,
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Failed to start email job");
      }
      
      const { jobId } = data;
      setCurrentJobId(jobId);
      
      // Start polling for job status
      const pollJob = async () => {
        try {
          const jobRes = await fetch(`/api/jobs/${jobId}`);
          if (!jobRes.ok) throw new Error("Failed to fetch job status");
          const jobData = await jobRes.json();
          
          setJobProgress({ processed: jobData.processed, total: jobData.total });
          setResults(prev => {
            if (retryList) {
              const updatedResults = prev ? [...prev] : [];
              jobData.results.forEach((r: any) => {
                const idx = updatedResults.findIndex(pr => pr.email === r.email);
                if (idx !== -1) updatedResults[idx] = r;
                else updatedResults.push(r);
              });
              return updatedResults;
            }
            return jobData.results;
          });

          if (jobData.status === "completed" || jobData.status === "failed") {
            setIsSending(false);
            setJobProgress(null);
            setCurrentJobId(null);
            
            // Update history only when finished
            const newHistoryItems = jobData.results.map((r: any) => ({
              ...r,
              timestamp: new Date().toISOString()
            }));
            setHistory(prevHistory => {
              const updatedHistory = [...newHistoryItems, ...prevHistory].slice(0, 100);
              localStorage.setItem("send_history", JSON.stringify(updatedHistory));
              return updatedHistory;
            });
            return;
          }
          
          // Poll again in 2 seconds
          setTimeout(pollJob, 2000);
        } catch (err) {
          console.error("Polling error:", err);
          setError("Lost connection to the email job. Results may be incomplete.");
          setIsSending(false);
          setJobProgress(null);
          setCurrentJobId(null);
        }
      };
      
      pollJob();
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : "An unexpected error occurred.");
      setIsSending(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#F8F9FA] text-[#212529] font-sans selection:bg-blue-100">
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="bg-blue-600 p-2 rounded-lg">
              <Mail className="text-white w-5 h-5" />
            </div>
            <h1 className="text-xl font-bold tracking-tight text-gray-900">JobApply AI</h1>
          </div>
          <div className="flex items-center gap-4">
            {apiStatus && (
              <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-gray-50 border border-gray-100 text-[10px] font-bold uppercase tracking-wider">
                <div className={cn("w-2 h-2 rounded-full", apiStatus.ok ? "bg-green-500" : "bg-red-500")} />
                API {apiStatus.ok ? "Online" : "Offline"}
                <div className="w-px h-3 bg-gray-200 mx-1" />
                <div className={cn("w-2 h-2 rounded-full", apiStatus.gmail ? "bg-green-500" : "bg-orange-500")} />
                {apiStatus.gmail ? "Gmail Ready" : "No Service"}
              </div>
            )}
            <div className="text-sm text-gray-500 font-medium hidden sm:block">
              Personalized Job Outreach
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-12">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Left Column: Configuration */}
          <div className="lg:col-span-2 space-y-8">
            <section className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
              <div className="p-6 border-b border-gray-100 bg-gray-50/50">
                <h2 className="text-lg font-semibold flex items-center gap-2">
                  <User className="w-5 h-5 text-blue-600" />
                  Personal Information
                </h2>
              </div>
              <div className="p-6 space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Your Full Name</label>
                    <input 
                      type="text" 
                      value={fromName}
                      onChange={(e) => setFromName(e.target.value)}
                      placeholder="e.g. John Doe"
                      className="w-full px-4 py-2 rounded-xl border border-gray-200 focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Reply-To Email</label>
                    <input 
                      type="email" 
                      value={replyTo}
                      onChange={(e) => setReplyTo(e.target.value)}
                      placeholder="e.g. arjunkmr1997@gmail.com"
                      className="w-full px-4 py-2 rounded-xl border border-gray-200 focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all outline-none"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Email Subject</label>
                  <input 
                    type="text" 
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                    placeholder="Job Application - [Your Name]"
                    className="w-full px-4 py-2 rounded-xl border border-gray-200 focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all outline-none"
                  />
                </div>
              </div>
            </section>

            <section className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
              <div className="p-6 border-b border-gray-100 bg-gray-50/50 flex items-center justify-between">
                <h2 className="text-lg font-semibold flex items-center gap-2">
                  <FileText className="w-5 h-5 text-blue-600" />
                  Email Content
                </h2>
                <button 
                  onClick={generateAIBody}
                  disabled={isGenerating}
                  className="text-sm flex items-center gap-1.5 text-blue-600 hover:text-blue-700 font-medium disabled:opacity-50 transition-colors"
                >
                  {isGenerating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                  Generate with AI
                </button>
              </div>
              <div className="p-6">
                <textarea 
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  placeholder="Write your email body here or use the AI generator..."
                  rows={8}
                  className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all outline-none resize-none"
                />
              </div>
            </section>

            <section className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
              <div className="p-6 border-b border-gray-100 bg-gray-50/50 flex items-center justify-between">
                <h2 className="text-lg font-semibold flex items-center gap-2">
                  <Users className="w-5 h-5 text-blue-600" />
                  Recipients
                </h2>
                <div className="flex items-center gap-2">
                  <input
                    type="file"
                    ref={recruiterPdfRef}
                    onChange={handleRecruiterPDF}
                    accept=".pdf"
                    className="hidden"
                  />
                  <button
                    onClick={() => recruiterPdfRef.current?.click()}
                    disabled={isExtractingPDF}
                    className="flex items-center gap-1.5 text-sm text-blue-600 hover:text-blue-700 font-medium disabled:opacity-50 transition-colors border border-blue-200 px-3 py-1.5 rounded-xl bg-blue-50 hover:bg-blue-100"
                  >
                    {isExtractingPDF ? (
                      <><Loader2 className="w-4 h-4 animate-spin" /> Extracting...</>
                    ) : (
                      <><Upload className="w-4 h-4" /> Upload Recruiter PDF</>
                    )}
                  </button>
                </div>
              </div>
              <div className="p-6 space-y-4">
                {recruiters.length > 0 ? (
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <label className="text-sm font-medium text-gray-700">
                        Extracted Recruiters ({recruiters.length})
                      </label>
                      <button
                        onClick={() => { setRecruiters([]); setEmails(""); }}
                        className="text-xs text-red-500 hover:text-red-600 font-medium"
                      >
                        Clear All
                      </button>
                    </div>
                    <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                      {recruiters.map((r, idx) => (
                        <div key={idx} className="flex items-center justify-between p-2.5 rounded-xl bg-blue-50/50 border border-blue-100">
                          <div className="min-w-0">
                            {r.name && <p className="text-sm font-medium text-gray-800 truncate">{r.name}</p>}
                            <p className="text-xs text-gray-500 truncate">{r.email}</p>
                          </div>
                          <button onClick={() => removeRecruiter(idx)} className="text-gray-300 hover:text-red-400 ml-2 shrink-0">
                            <X className="w-4 h-4" />
                          </button>
                        </div>
                      ))}
                    </div>
                    <p className="mt-2 text-xs text-blue-600 font-medium">
                      ✨ Use <code className="bg-blue-100 px-1 rounded">{"{Name}"}</code> in your email body — it will be replaced with each recruiter's name.
                    </p>
                  </div>
                ) : (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Email Addresses (comma separated)</label>
                    <textarea
                      value={emails}
                      onChange={(e) => setEmails(e.target.value)}
                      placeholder="hr@company.com, jobs@startup.io, recruiter@agency.net"
                      rows={3}
                      className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all outline-none resize-none"
                    />
                    <p className="mt-2 text-xs text-gray-400">Or upload a PDF above to auto-extract recruiter names & emails.</p>
                  </div>
                )}
              </div>
            </section>
          </div>

          {/* Right Column: Resume & Actions */}
          <div className="space-y-8">
            <section className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
              <div className="p-6 border-b border-gray-100 bg-gray-50/50">
                <h2 className="text-lg font-semibold flex items-center gap-2">
                  <Upload className="w-5 h-5 text-blue-600" />
                  Resume Attachment
                </h2>
              </div>
              <div className="p-6">
                <div 
                  onClick={() => fileInputRef.current?.click()}
                  className={cn(
                    "border-2 border-dashed rounded-2xl p-8 flex flex-col items-center justify-center cursor-pointer transition-all",
                    resume || resumeData ? "border-blue-500 bg-blue-50/30" : "border-gray-200 hover:border-blue-400 hover:bg-gray-50"
                  )}
                >
                  <input 
                    type="file" 
                    ref={fileInputRef}
                    onChange={handleFileChange}
                    className="hidden"
                    accept=".pdf,.doc,.docx"
                  />
                  {(resume || resumeData) ? (
                    <div className="text-center">
                      <FileText className="w-10 h-10 text-blue-600 mx-auto mb-2" />
                      <p className="text-sm font-medium text-gray-900 truncate max-w-[200px]">
                        {resume ? resume.name : resumeData?.name}
                      </p>
                      {resumeData && !resume && (
                        <p className="text-[10px] text-green-600 font-bold uppercase tracking-tighter mt-1">
                          ✨ Remembered Resume
                        </p>
                      )}
                      <button 
                        onClick={(e) => { 
                          e.stopPropagation(); 
                          setResume(null); 
                          setResumeData(null);
                          localStorage.removeItem("default_resume");
                        }}
                        className="mt-2 text-xs text-red-500 hover:text-red-600 font-medium"
                      >
                        Remove / Forget
                      </button>
                    </div>
                  ) : (
                    <div className="text-center">
                      <Plus className="w-10 h-10 text-gray-300 mx-auto mb-2" />
                      <p className="text-sm text-gray-500">Click to upload PDF or Word</p>
                    </div>
                  )}
                </div>
              </div>
            </section>

            <div className="space-y-4">
              {error && (
                <motion.div 
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="p-4 bg-red-50 border border-red-100 rounded-xl flex items-start gap-3 text-red-700 text-sm"
                >
                  <AlertCircle className="w-5 h-5 shrink-0" />
                  <div className="space-y-1">
                    <p>{error}</p>
                    {error.includes("Too many login attempts") && (
                      <p className="text-[11px] font-medium opacity-80 bg-red-100/50 p-2 rounded-lg mt-2">
                        💡 <strong>Tip:</strong> Gmail has temporarily blocked your account for bulk sending. 
                        Please wait <strong>15-30 minutes</strong> before trying again. 
                        To avoid this, send smaller batches (e.g., 10-15 emails) at a time.
                      </p>
                    )}
                  </div>
                </motion.div>
              )}

              {isSending && jobProgress && (
                <div className="w-full bg-gray-100 rounded-full h-2 overflow-hidden">
                  <motion.div 
                    initial={{ width: 0 }}
                    animate={{ width: `${(jobProgress.processed / jobProgress.total) * 100}%` }}
                    className="bg-blue-600 h-full"
                  />
                </div>
              )}

              <button 
                onClick={() => sendEmails()}
                disabled={isSending}
                className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-4 rounded-2xl shadow-lg shadow-blue-200 flex items-center justify-center gap-2 transition-all active:scale-[0.98] disabled:opacity-70 disabled:cursor-not-allowed"
              >
                {isSending ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    {jobProgress ? `Sending (${jobProgress.processed}/${jobProgress.total})...` : "Initializing Queue..."}
                  </>
                ) : (
                  <>
                    <Send className="w-5 h-5" />
                    Send Applications
                  </>
                )}
              </button>

              {isSending && (
                <button 
                  onClick={stopJob}
                  className="w-full bg-red-50 hover:bg-red-100 text-red-600 font-bold py-3 rounded-2xl border border-red-100 flex items-center justify-center gap-2 transition-all active:scale-[0.98]"
                >
                  <X className="w-4 h-4" />
                  Stop Sending
                </button>
              )}
            </div>

            <AnimatePresence>
              {results && (
                <motion.section 
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden"
                >
                  <div className="p-4 border-b border-gray-100 bg-gray-50/50 flex items-center justify-between">
                    <div className="flex flex-col gap-1">
                      <h3 className="font-semibold text-sm">Send Results</h3>
                      <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider">
                        <span className="text-green-600">{results.filter(r => r.success).length} Sent</span>
                        <span className="text-gray-300">|</span>
                        <span className="text-red-600">{results.filter(r => !r.success).length} Failed</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button 
                        onClick={() => setViewMode(viewMode === "list" ? "plain" : "list")}
                        className="text-[10px] bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full font-bold hover:bg-gray-200 transition-colors flex items-center gap-1"
                      >
                        {viewMode === "list" ? <FileJson className="w-3 h-3" /> : <Mail className="w-3 h-3" />}
                        {viewMode === "list" ? "Plain Text" : "List View"}
                      </button>
                      {results.some(r => !r.success) && (
                        <div className="flex items-center gap-1">
                          <button 
                            onClick={() => {
                              const failed = results.filter(r => !r.success).map(r => r.email).join(", ");
                              navigator.clipboard.writeText(failed);
                            }}
                            className="text-[10px] bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full font-bold hover:bg-gray-200 transition-colors"
                            title="Copy failed emails"
                          >
                            Copy Failed
                          </button>
                          <button 
                            onClick={() => sendEmails(results.filter(r => !r.success).map(r => r.email))}
                            disabled={isSending}
                            className="text-[10px] bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full font-bold hover:bg-blue-200 transition-colors disabled:opacity-50"
                          >
                            Retry Failed
                          </button>
                        </div>
                      )}
                      <button onClick={() => setResults(null)} className="text-gray-400 hover:text-gray-600">
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                  <div className="p-4 max-h-[300px] overflow-y-auto space-y-4">
                    {viewMode === "list" ? (
                      <div className="space-y-2">
                        {[...results].sort((a, b) => (a.success === b.success ? 0 : a.success ? 1 : -1)).map((res, idx) => (
                          <div key={idx} className={cn(
                            "flex flex-col gap-1 p-2 rounded-lg border transition-colors",
                            res.success ? "bg-gray-50 border-transparent" : "bg-red-50/50 border-red-100"
                          )}>
                            <div className="flex items-center justify-between text-sm">
                              <span className={cn(
                                "truncate flex-1 mr-2 font-medium",
                                res.success ? "text-gray-600" : "text-red-700"
                              )}>{res.email}</span>
                              {res.success ? (
                                <CheckCircle2 className="w-4 h-4 text-green-500 shrink-0" />
                              ) : (
                                <AlertCircle className="w-4 h-4 text-red-500 shrink-0" />
                              )}
                            </div>
                            {!res.success && res.error && (
                              <p className="text-[10px] text-red-500 leading-tight font-medium">{res.error}</p>
                            )}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="space-y-4">
                        {results.some(r => r.success) && (
                          <div className="space-y-1">
                            <div className="flex items-center justify-between">
                              <label className="text-[10px] font-bold uppercase text-green-600">Sent Emails</label>
                              <div className="flex items-center gap-2">
                                <button 
                                  onClick={() => {
                                    const text = results.filter(r => r.success).map(r => r.email).join(", ");
                                    navigator.clipboard.writeText(text);
                                  }}
                                  className="text-[10px] text-gray-400 hover:text-gray-600 flex items-center gap-1"
                                >
                                  <Copy className="w-3 h-3" /> CSV
                                </button>
                                <button 
                                  onClick={() => {
                                    const text = JSON.stringify(results.filter(r => r.success).map(r => r.email), null, 2);
                                    navigator.clipboard.writeText(text);
                                  }}
                                  className="text-[10px] text-gray-400 hover:text-gray-600 flex items-center gap-1"
                                >
                                  <FileJson className="w-3 h-3" /> JSON
                                </button>
                              </div>
                            </div>
                            <textarea 
                              readOnly
                              className="w-full h-20 text-xs p-2 bg-gray-50 border border-gray-100 rounded-lg font-mono resize-none focus:outline-none"
                              value={results.filter(r => r.success).map(r => r.email).join(", ")}
                            />
                          </div>
                        )}
                        {results.some(r => !r.success) && (
                          <div className="space-y-1">
                            <div className="flex items-center justify-between">
                              <label className="text-[10px] font-bold uppercase text-red-600">Failed Emails</label>
                              <div className="flex items-center gap-2">
                                <button 
                                  onClick={() => {
                                    const text = results.filter(r => !r.success).map(r => r.email).join(", ");
                                    navigator.clipboard.writeText(text);
                                  }}
                                  className="text-[10px] text-gray-400 hover:text-gray-600 flex items-center gap-1"
                                >
                                  <Copy className="w-3 h-3" /> CSV
                                </button>
                                <button 
                                  onClick={() => {
                                    const text = JSON.stringify(results.filter(r => !r.success).map(r => r.email), null, 2);
                                    navigator.clipboard.writeText(text);
                                  }}
                                  className="text-[10px] text-gray-400 hover:text-gray-600 flex items-center gap-1"
                                >
                                  <FileJson className="w-3 h-3" /> JSON
                                </button>
                              </div>
                            </div>
                            <textarea 
                              readOnly
                              className="w-full h-20 text-xs p-2 bg-red-50/30 border border-red-100 rounded-lg font-mono resize-none focus:outline-none text-red-700"
                              value={results.filter(r => !r.success).map(r => r.email).join(", ")}
                            />
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </motion.section>
              )}
            </AnimatePresence>
            <AnimatePresence>
              {history.length > 0 && (
                <motion.section 
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden"
                >
                  <div className="p-4 border-b border-gray-100 bg-gray-50/50 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <History className="w-4 h-4 text-blue-600" />
                      <h3 className="font-semibold text-sm">Send History</h3>
                    </div>
                    <button 
                      onClick={() => {
                        if (confirm("Clear all history?")) {
                          setHistory([]);
                          localStorage.removeItem("send_history");
                        }
                      }}
                      className="text-gray-400 hover:text-red-500 transition-colors"
                      title="Clear History"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                  <div className="p-4 max-h-[300px] overflow-y-auto space-y-2">
                    {history.map((item, idx) => (
                      <div key={idx} className="flex flex-col gap-1 p-2 rounded-lg bg-gray-50/50 border border-gray-100">
                        <div className="flex items-center justify-between text-[11px]">
                          <span className="truncate flex-1 mr-2 text-gray-600 font-medium">{item.email}</span>
                          <span className="text-gray-400 shrink-0">
                            {new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className={cn(
                            "text-[10px] font-bold uppercase tracking-wider",
                            item.success ? "text-green-600" : "text-red-600"
                          )}>
                            {item.success ? "Sent" : "Failed"}
                          </span>
                          {item.success ? (
                            <CheckCircle2 className="w-3 h-3 text-green-500" />
                          ) : (
                            <AlertCircle className="w-3 h-3 text-red-500" />
                          )}
                        </div>
                        {!item.success && item.error && (
                          <p className="text-[9px] text-red-500 leading-tight italic">{item.error}</p>
                        )}
                      </div>
                    ))}
                  </div>
                </motion.section>
              )}
            </AnimatePresence>
          </div>
        </div>
      </main>

      <footer className="max-w-5xl mx-auto px-6 py-12 border-t border-gray-100 mt-12">
        <div className="flex flex-col md:flex-row items-center justify-between gap-4 text-sm text-gray-400">
          <p>© 2026 JobApply AI. All rights reserved.</p>
          <div className="flex items-center gap-6">
            <a href="#" className="hover:text-gray-600 transition-colors">Privacy Policy</a>
            <a href="#" className="hover:text-gray-600 transition-colors">Terms of Service</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
