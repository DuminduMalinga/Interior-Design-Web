import { useState, useRef, DragEvent } from "react";
import { Upload as UploadIcon, FileUp, X, CheckCircle2, AlertCircle, Loader2, FileText } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { useNavigate } from "react-router";
import SiteNavbar from "../components/SiteNavbar";
import PageGlows from "../components/marketing/PageGlows";
import AppFooter from "../components/AppFooter";
import FlowStepper, { rememberFlowState } from "../components/FlowStepper";
import { supabase } from "../lib/supabaseClient";
import { detectFloorPlan } from "../lib/wallDetector";
import { saveDetectionAnalysis } from "../lib/floorPlanAnalysis";
import { emailMe, notifyBrowser } from "../lib/notifications";

export default function UploadFloorPlan() {
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const SUPPORTED_FORMATS = ["image/png", "image/jpeg", "image/jpg"];
  const SUPPORTED_EXTENSIONS = ["png", "jpg", "jpeg"];
  const MAX_FILE_SIZE = 10 * 1024 * 1024;

  const validateFile = (file: File): boolean => {
    setError(null); setSuccess(null);
    const fileExtension = file.name.split(".").pop()?.toLowerCase() ?? "";

    if (!SUPPORTED_FORMATS.includes(file.type) && !SUPPORTED_EXTENSIONS.includes(fileExtension)) {
      setError("Unsupported file format. Please upload PNG, JPG, or JPEG files only.");
      return false;
    }
    if (file.size >= MAX_FILE_SIZE) {
      setError("File size exceeds the 10MB limit. Please upload a smaller image.");
      return false;
    }
    return true;
  };

  const handleFileSelect = (file: File) => {
    if (validateFile(file)) {
      setSelectedFile(file);
      if (file.type.startsWith("image/")) {
        const reader = new FileReader();
        reader.onloadend = () => setPreviewUrl(reader.result as string);
        reader.readAsDataURL(file);
      } else {
        setPreviewUrl(null);
      }
      setSuccess("File selected successfully!");
    }
  };

  const handleDragOver = (e: DragEvent<HTMLDivElement>) => { e.preventDefault(); setIsDragging(true); };
  const handleDragLeave = (e: DragEvent<HTMLDivElement>) => { e.preventDefault(); setIsDragging(false); };
  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault(); setIsDragging(false);
    const files = e.dataTransfer.files;
    if (files.length > 0) handleFileSelect(files[0]);
  };
  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) handleFileSelect(files[0]);
  };
  const handleRemoveFile = () => {
    setSelectedFile(null); setPreviewUrl(null); setError(null); setSuccess(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };
  const handleUpload = async () => {
    if (!selectedFile) return;

    setIsUploading(true);
    setError(null);
    setSuccess(null);
    setUploadProgress(0);

    try {
      // ── 1. Get current authenticated user ───────────────────────────────
      const { data: { user }, error: authErr } = await supabase.auth.getUser();
      if (authErr || !user) throw new Error("You must be signed in to upload.");

      setUploadProgress(20);

      // ── 2. Build a unique storage path ──────────────────────────────────
      const ext = selectedFile.name.split(".").pop()?.toLowerCase() ?? "jpg";
      const floorPlanId = crypto.randomUUID();
      const storagePath = `${user.id}/${floorPlanId}.${ext}`;

      // ── 3. Upload file to Supabase Storage ──────────────────────────────
      const { error: uploadErr } = await supabase.storage
        .from("floorplans")
        .upload(storagePath, selectedFile, {
          cacheControl: "3600",
          upsert: false,
          contentType: selectedFile.type || "image/jpeg",
        });

      if (uploadErr) throw new Error(`Storage upload failed: ${uploadErr.message}`);

      setUploadProgress(60);

      // ── 4. The bucket is private; only the path is stored, and viewing links are signed when needed ──
      setUploadProgress(80);

      // ── 5. Insert a record into the FloorPlan table ──────────────────────
      const { error: dbErr } = await supabase
        .from("FloorPlan")
        .insert({
          FloorPlanID: floorPlanId,
          UploadDateTime: new Date().toISOString(),
          ImagePath: storagePath,
          Status: "Pending",
          UserID: user.id,
        });

      if (dbErr) throw new Error(`Database insert failed: ${dbErr.message}`);

      setUploadProgress(90);

      // ── 6. Run wall / room detection + label OCR -------------------------
      setSuccess("Detecting walls and rooms, reading room labels...");
      const detection = await detectFloorPlan(selectedFile, {
        conf: 0.25,
        floorPlanId,
      });
      await saveDetectionAnalysis(floorPlanId, detection);
      void notifyBrowser("Floor plan ready", `${detection.rooms.length} rooms found. Pick a room to furnish.`);
      void emailMe("plan_ready", { rooms: detection.rooms.length });

      rememberFlowState({ floorPlanId, detection });
      setUploadProgress(100);

      // ── 7. Navigate to processing, carrying results in router state ──────
      setTimeout(() => {
        setIsUploading(false);
        setSuccess("Analysis complete! Opening results...");
        setTimeout(
          () => navigate("/processing", { state: { floorPlanId, detection } }),
          900,
        );
      }, 300);

    } catch (err: unknown) {
      setIsUploading(false);
      setUploadProgress(0);
      const message = err instanceof Error ? err.message : "Upload failed. Please try again.";
      setError(message);
    }
  };

  const nextSteps = [
    { title: "Rooms are detected", desc: "Walls, doors and room names are read from your plan." },
    { title: "You pick a room", desc: "Choose which room to furnish first." },
    { title: "Layouts are scored", desc: "Compare the ranked options and open one in 3D." },
  ];

  return (
    <div className="min-h-screen w-full bg-background relative isolate flex flex-col">
      <PageGlows />
      <SiteNavbar />

      <main className="relative flex-1 w-full px-4 md:px-8 pt-2 pb-12">
        <div className="max-w-5xl mx-auto">
          <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} className="max-w-2xl mx-auto">
            <FlowStepper current="upload" />
          </motion.div>

          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }} className="mt-10 md:mt-12 max-w-2xl">
            <h1 className="text-4xl md:text-5xl leading-[1.05] tracking-tight text-lv-ink">Upload a floor plan</h1>
            <p className="mt-3 text-base md:text-lg text-lv-muted">
              Add a 2D plan as an image and we'll find its rooms and walls for you.
            </p>
          </motion.div>

          <div className="mt-8 grid gap-5 lg:grid-cols-[1.6fr_1fr] lg:items-start">
            {/* Upload card */}
            <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}
              className="rounded-[28px] bg-lv-surface border border-lv-line p-4 md:p-5">

              <AnimatePresence>
                {error && (
                  <motion.div role="alert" initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}
                    className="flex items-start gap-2 p-4 mb-4 bg-red-500/10 border border-red-500/20 rounded-2xl">
                    <AlertCircle className="w-5 h-5 text-red-400 mt-0.5 shrink-0" />
                    <span className="text-sm text-red-300">{error}</span>
                  </motion.div>
                )}
              </AnimatePresence>

              <AnimatePresence>
                {success && !isUploading && (
                  <motion.div role="status" initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}
                    className="flex items-start gap-2 p-4 mb-4 bg-emerald-500/10 border border-emerald-500/20 rounded-2xl">
                    <CheckCircle2 className="w-5 h-5 text-emerald-400 mt-0.5 shrink-0" />
                    <span className="text-sm text-emerald-300">{success}</span>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Drop zone */}
              {!selectedFile && (
                <div
                  onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop}
                  onClick={() => fileInputRef.current?.click()}
                  className={`rounded-[20px] px-6 py-12 md:py-16 text-center cursor-pointer transition-colors duration-200 border-2 border-dashed ${
                    isDragging ? "border-lv-accent bg-lv-wash/60" : "border-lv-line hover:border-lv-accent/60 hover:bg-lv-wash/30"
                  }`}>
                  <div className="flex flex-col items-center">
                    <span className={`grid h-16 w-16 place-items-center rounded-full transition-colors ${
                      isDragging ? "bg-lv-ink text-lv-on-ink" : "bg-lv-wash text-lv-ink"
                    }`}>
                      <FileUp className="w-7 h-7" strokeWidth={1.5} aria-hidden="true" />
                    </span>
                    <h2 className="mt-5 text-2xl leading-tight text-lv-ink">
                      {isDragging ? "Drop your file here" : "Drag and drop your floor plan"}
                    </h2>
                    <p className="mt-1.5 text-sm text-lv-muted">PNG or JPG, up to 10 MB</p>
                    <span className="lv-btn mt-6">
                      <UploadIcon className="w-4 h-4" aria-hidden="true" /> Choose a file
                    </span>
                  </div>
                </div>
              )}

              {/* Selected file */}
              {selectedFile && !isUploading && (
                <motion.div initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }}>
                  <div className="relative rounded-[20px] bg-lv-wash/40 border border-lv-line p-5">
                    <div className="flex flex-col sm:flex-row items-center gap-5">
                      {previewUrl ? (
                        <img src={previewUrl} alt="Floor plan preview"
                          className="w-32 h-32 md:w-40 md:h-40 shrink-0 object-cover rounded-2xl border border-lv-line bg-white" />
                      ) : (
                        <div className="w-32 h-32 md:w-40 md:h-40 shrink-0 grid place-items-center rounded-2xl bg-lv-wash">
                          <FileText className="w-12 h-12 text-lv-ink" aria-hidden="true" />
                        </div>
                      )}
                      <div className="flex-1 min-w-0 text-center sm:text-left">
                        <p className="text-base font-medium text-lv-ink break-all">{selectedFile.name}</p>
                        <p className="mt-1 text-sm text-lv-muted">{(selectedFile.size / 1024 / 1024).toFixed(2)} MB</p>
                        <button onClick={() => fileInputRef.current?.click()} className="lv-link mt-3 text-sm">
                          Choose a different file
                        </button>
                      </div>
                    </div>
                    <button onClick={handleRemoveFile} aria-label="Remove file"
                      className="absolute top-3 right-3 grid h-10 w-10 place-items-center rounded-full text-lv-muted hover:text-lv-ink hover:bg-lv-ink/8 transition-colors cursor-pointer">
                      <X className="w-5 h-5" aria-hidden="true" />
                    </button>
                  </div>
                  <button onClick={handleUpload} disabled={!selectedFile} className="lv-btn w-full min-h-12 text-base mt-4">
                    <UploadIcon className="w-5 h-5" aria-hidden="true" /> Upload and analyse
                  </button>
                </motion.div>
              )}

              {/* Uploading */}
              {isUploading && (
                <div className="px-4 py-10 md:py-14" role="status" aria-live="polite">
                  <div className="flex items-center justify-center gap-3">
                    <Loader2 className="w-6 h-6 text-lv-accent animate-spin" aria-hidden="true" />
                    <span className="text-lg text-lv-ink">Uploading and analysing your plan</span>
                  </div>
                  <div className="mt-6 w-full bg-lv-line rounded-full h-2 overflow-hidden">
                    <motion.div initial={{ width: 0 }} animate={{ width: `${uploadProgress}%` }} transition={{ duration: 0.3 }}
                      className="h-full bg-lv-accent rounded-full" />
                  </div>
                  <p className="mt-3 text-center text-sm text-lv-muted tabular-nums">{uploadProgress}% complete</p>
                </div>
              )}

              <input ref={fileInputRef} type="file" accept=".png,.jpg,.jpeg,image/png,image/jpeg" onChange={handleFileInputChange} className="hidden" />
            </motion.div>

            {/* What happens next */}
            <motion.aside initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.18 }}
              className="rounded-[28px] bg-lv-deep text-lv-on-deep p-6 md:p-7">
              <h2 className="text-xl leading-tight">What happens next</h2>
              <ol className="mt-5 space-y-5">
                {nextSteps.map((step, i) => (
                  <li key={step.title} className="flex gap-3.5">
                    <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-lv-on-deep/15 text-xs font-semibold tabular-nums">
                      {i + 1}
                    </span>
                    <div>
                      <p className="text-sm font-medium">{step.title}</p>
                      <p className="mt-0.5 text-sm text-lv-on-deep/70 leading-relaxed">{step.desc}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </motion.aside>
          </div>
        </div>
      </main>

      <AppFooter />
    </div>
  );
}
