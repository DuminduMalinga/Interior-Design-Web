import { useState, useRef, DragEvent } from "react";
import {
  Box,
  Upload as UploadIcon,
  FileUp,
  X,
  CheckCircle2,
  AlertCircle,
  Loader2,
  ArrowRight,
  Image as ImageIcon,
  FileText,
  LogOut,
  LayoutDashboard,
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { useNavigate } from "react-router";
import { useCurrentUserProfile } from "../context/UserContext";
import { supabase } from "../lib/supabaseClient";

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
  const { profile, signOut } = useCurrentUserProfile();

  const handleLogout = async () => {
    const success = await signOut();
    if (success) {
      navigate("/");
    }
  };

  const username = profile.username;
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

      // ── 4. Get the public URL ────────────────────────────────────────────
      const { data: { publicUrl } } = supabase.storage
        .from("floorplans")
        .getPublicUrl(storagePath);

      setUploadProgress(80);

      // ── 5. Insert a record into the FloorPlan table ──────────────────────
      const { error: dbErr } = await supabase
        .from("FloorPlan")
        .insert({
          FloorPlanID: floorPlanId,
          UploadDateTime: new Date().toISOString(),
          ImagePath: publicUrl,
          Status: "Pending",
          UserID: user.id,
        });

      if (dbErr) throw new Error(`Database insert failed: ${dbErr.message}`);

      setUploadProgress(100);

      // ── 6. Navigate to processing page ───────────────────────────────────
      setTimeout(() => {
        setIsUploading(false);
        setSuccess("File uploaded successfully! Processing floor plan...");
        setTimeout(() => navigate("/processing", { state: { floorPlanId } }), 1500);
      }, 400);

    } catch (err: unknown) {
      setIsUploading(false);
      setUploadProgress(0);
      const message = err instanceof Error ? err.message : "Upload failed. Please try again.";
      setError(message);
    }
  };

  const steps = [
    { number: 1, label: "Upload", active: true },
    { number: 2, label: "Detect", active: false },
    { number: 3, label: "Layout", active: false },
    { number: 4, label: "3D View", active: false },
  ];

  const howItWorks = [
    { icon: FileUp, label: "1. Upload", desc: "Submit your 2D floor plan", color: "from-teal-400 to-teal-600", glow: "bg-teal-500/10 text-teal-400" },
    { icon: ImageIcon, label: "2. Detect", desc: "AI detects rooms & walls", color: "from-violet-400 to-violet-600", glow: "bg-violet-500/10 text-violet-400" },
    { icon: LayoutDashboard, label: "3. Layout", desc: "Optimize furniture placement", color: "from-amber-400 to-amber-600", glow: "bg-amber-500/10 text-amber-400" },
    { icon: Box, label: "4. 3D View", desc: "View interactive 3D model", color: "from-emerald-400 to-emerald-600", glow: "bg-emerald-500/10 text-emerald-400" },
  ];

  return (
    <div className="min-h-screen w-full bg-[#0a0a0f] relative" style={{ fontFamily: "'Inter', sans-serif" }}>
      <div className="absolute inset-0 dot-grid pointer-events-none" />
      <div className="absolute top-1/4 left-1/3 w-[400px] h-[400px] bg-teal-500/5 rounded-full blur-[100px] pointer-events-none" />

      {/* Nav */}
      <nav className="relative glass-nav z-10">
        <div className="px-4 md:px-8 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3 cursor-pointer" onClick={() => navigate("/dashboard")}>
            <div className="bg-gradient-to-br from-teal-400 to-teal-600 p-2 rounded-xl shadow-lg shadow-teal-500/20">
              <Box className="w-8 h-8 text-white" strokeWidth={1.5} />
            </div>
            <div className="hidden md:block">
              <h1 className="text-base font-bold text-white">3D Layout System</h1>
              <p className="text-xs text-zinc-500">AI-Powered Design</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="hidden md:block text-right">
              <p className="text-xs text-zinc-500">Welcome back,</p>
              <p className="font-semibold text-white text-sm">{username} 👋</p>
            </div>
            <motion.button whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}
              onClick={handleLogout}
              className="flex items-center gap-2 px-4 py-2 bg-red-500/10 text-red-400 hover:bg-red-500/20 rounded-lg transition-colors">
              <LogOut className="w-4 h-4" />
              <span className="hidden sm:inline text-sm font-medium">Logout</span>
            </motion.button>
          </div>
        </div>
      </nav>

      <main className="relative p-4 md:p-8">
        <div className="max-w-4xl mx-auto">
          {/* Header */}
          <motion.div initial={{ opacity: 0, y: -16 }} animate={{ opacity: 1, y: 0 }} className="mb-8">
            <h2 className="text-3xl md:text-4xl font-bold text-white mb-1">Upload Floor Plan</h2>
            <p className="text-zinc-500">Upload your 2D floor plan to begin automatic room detection and layout optimization.</p>
          </motion.div>

          {/* Step Indicator */}
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.2 }}
            className="glass-card rounded-2xl border border-white/5 px-6 py-4 flex items-center justify-center gap-2 md:gap-4 mb-8">
            {steps.map((step, i) => (
              <div key={step.number} className="flex items-center">
                <div className="flex flex-col items-center">
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm transition-all ${
                    step.active
                      ? "bg-gradient-to-br from-teal-400 to-teal-600 text-white shadow-lg shadow-teal-500/20"
                      : "bg-white/5 text-zinc-600 border border-white/10"
                  }`}>{step.number}</div>
                  <p className={`mt-1.5 text-xs font-medium ${step.active ? "text-teal-400" : "text-zinc-600"}`}>{step.label}</p>
                </div>
                {i < steps.length - 1 && <ArrowRight className="w-4 h-4 text-zinc-700 mx-2 md:mx-4 mb-5" />}
              </div>
            ))}
          </motion.div>

          {/* Upload Card */}
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}
            className="glass-card rounded-3xl border border-white/5 p-6 md:p-10 mb-6">

            {/* Error */}
            <AnimatePresence>
              {error && (
                <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}
                  className="flex items-start gap-2 p-4 mb-6 bg-red-500/10 border border-red-500/20 rounded-xl">
                  <AlertCircle className="w-5 h-5 text-red-400 mt-0.5 shrink-0" />
                  <span className="text-sm text-red-300">{error}</span>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Success */}
            <AnimatePresence>
              {success && !isUploading && (
                <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}
                  className="flex items-start gap-2 p-4 mb-6 bg-emerald-500/10 border border-emerald-500/20 rounded-xl">
                  <CheckCircle2 className="w-5 h-5 text-emerald-400 mt-0.5 shrink-0" />
                  <span className="text-sm text-emerald-300">{success}</span>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Drop Zone */}
            {!selectedFile && (
              <motion.div
                onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop}
                whileHover={{ scale: 1.01 }}
                className={`rounded-2xl p-8 md:p-12 text-center cursor-pointer transition-all duration-300 border-2 border-dashed ${
                  isDragging
                    ? "border-teal-500 bg-teal-500/5"
                    : "border-white/10 hover:border-teal-500/40 hover:bg-teal-500/[0.03]"
                }`}
                onClick={() => fileInputRef.current?.click()}>
                <div className="flex flex-col items-center space-y-5">
                  <div className={`p-6 rounded-2xl transition-all duration-300 ${
                    isDragging
                      ? "bg-gradient-to-br from-teal-400 to-teal-600 scale-110 shadow-lg shadow-teal-500/25"
                      : "bg-gradient-to-br from-teal-500/20 to-teal-600/10 border border-teal-500/20"
                  }`}>
                    <FileUp className={`w-12 h-12 md:w-16 md:h-16 ${isDragging ? "text-white" : "text-teal-400"}`} strokeWidth={1.5} />
                  </div>
                  <div>
                    <h3 className="text-xl md:text-2xl font-bold text-white mb-2">
                      {isDragging ? "Drop your file here" : "Drag & drop your floor plan"}
                    </h3>
                    <p className="text-zinc-600 mb-5">or</p>
                    <span className="px-6 py-3 bg-gradient-to-r from-teal-500 to-teal-600 text-white font-semibold rounded-xl shadow-lg shadow-teal-500/20 hover:shadow-teal-500/30 transition-all cursor-pointer">
                      Choose File
                    </span>
                  </div>
                  <div className="pt-5 border-t border-white/5 w-full">
                    <p className="text-sm text-zinc-500"><span className="font-semibold text-zinc-400">Supported formats:</span> PNG, JPG, PDF</p>
                    <p className="text-sm text-zinc-600 mt-1">Maximum file size: 10MB</p>
                  </div>
                </div>
              </motion.div>
            )}

            {/* File Preview */}
            {selectedFile && !isUploading && (
              <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="space-y-5">
                <div className="relative bg-white/[0.03] rounded-2xl p-6 border border-white/10">
                  <div className="flex flex-col md:flex-row items-center gap-6">
                    <div className="flex-shrink-0">
                      {previewUrl ? (
                        <img src={previewUrl} alt="Floor plan preview"
                          className="w-32 h-32 md:w-40 md:h-40 object-cover rounded-xl border border-white/10 shadow-md" />
                      ) : (
                        <div className="w-32 h-32 md:w-40 md:h-40 bg-teal-500/10 rounded-xl flex items-center justify-center border border-teal-500/20">
                          <FileText className="w-16 h-16 text-teal-400" />
                        </div>
                      )}
                    </div>
                    <div className="flex-1 text-center md:text-left">
                      <h4 className="text-base font-bold text-zinc-200 mb-1 break-all">{selectedFile.name}</h4>
                      <p className="text-sm text-zinc-500 mb-3">{(selectedFile.size / 1024 / 1024).toFixed(2)} MB</p>
                      <div className="flex items-center gap-2 justify-center md:justify-start">
                        <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                        <span className="text-sm text-emerald-400 font-medium">Ready to upload</span>
                      </div>
                    </div>
                    <button onClick={handleRemoveFile}
                      className="absolute top-4 right-4 p-2 bg-red-500/10 hover:bg-red-500/20 text-red-400 rounded-lg transition-colors border border-red-500/20">
                      <X className="w-5 h-5" />
                    </button>
                  </div>
                </div>
                <button onClick={() => fileInputRef.current?.click()}
                  className="text-sm text-teal-400 hover:text-teal-300 font-semibold transition-colors">
                  Change File
                </button>
              </motion.div>
            )}

            {/* Uploading state */}
            {isUploading && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-5">
                <div className="flex items-center justify-center gap-3 mb-4">
                  <Loader2 className="w-7 h-7 text-teal-400 animate-spin" />
                  <span className="text-lg font-semibold text-zinc-200">Uploading and processing...</span>
                </div>
                <div className="w-full bg-white/10 rounded-full h-2.5 overflow-hidden">
                  <motion.div initial={{ width: 0 }} animate={{ width: `${uploadProgress}%` }} transition={{ duration: 0.3 }}
                    className="h-full bg-gradient-to-r from-teal-400 to-cyan-400 rounded-full" />
                </div>
                <p className="text-center text-sm text-zinc-500">{uploadProgress}% complete</p>
                <div className="bg-teal-500/5 border border-teal-500/10 rounded-xl p-4 mt-4">
                  <div className="space-y-2">
                    {["Uploading file to server...", "Detecting rooms and boundaries...", "Generating 3D layout..."].map((step, i) => (
                      <div key={step} className="flex items-center gap-2 text-sm">
                        <div className={`w-2 h-2 rounded-full ${i === 0 ? "bg-teal-400 animate-pulse" : "bg-white/10"}`} />
                        <span className={i === 0 ? "text-teal-300" : "text-zinc-600"}>{step}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </motion.div>
            )}

            {/* Hidden input */}
            <input ref={fileInputRef} type="file" accept=".png,.jpg,.jpeg,image/png,image/jpeg" onChange={handleFileInputChange} className="hidden" />

            {/* Upload Button */}
            {selectedFile && !isUploading && (
              <motion.button initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
                whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
                onClick={handleUpload} disabled={!selectedFile}
                className="w-full mt-6 px-6 py-4 bg-gradient-to-r from-teal-500 to-teal-600 text-white text-lg font-bold rounded-xl shadow-lg shadow-teal-500/20 hover:shadow-teal-500/30 transition-all flex items-center justify-center gap-2 disabled:opacity-50">
                <UploadIcon className="w-5 h-5" /> Upload & Process
              </motion.button>
            )}
          </motion.div>

          {/* How It Works */}
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.5 }}
            className="glass-card rounded-3xl border border-white/5 p-6 md:p-8 mb-8">
            <h3 className="text-lg font-bold text-white mb-6 text-center">How It Works</h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-5">
              {howItWorks.map(({ icon: Icon, label, desc, color, glow }) => (
                <div key={label} className="flex flex-col items-center text-center">
                  <div className={`bg-gradient-to-br ${color} p-4 rounded-xl mb-3 shadow-lg`}>
                    <Icon className="w-7 h-7 text-white" />
                  </div>
                  <h4 className="font-bold text-zinc-200 mb-1 text-sm">{label}</h4>
                  <p className="text-xs text-zinc-600">{desc}</p>
                </div>
              ))}
            </div>
          </motion.div>

          <div className="text-center">
            <button onClick={() => navigate("/dashboard")}
              className="text-zinc-600 hover:text-zinc-400 font-medium transition-colors text-sm">
              ← Back to Dashboard
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}
