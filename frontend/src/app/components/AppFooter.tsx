import { Box } from "lucide-react";

/** The footer shared by the signed-in pages. */
export default function AppFooter() {
  return (
    <footer className="relative border-t border-white/5 px-4 md:px-8 py-4">
      <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-zinc-500">
        <div className="flex items-center gap-3">
          <div className="bg-gradient-to-br from-teal-400 to-teal-600 p-1.5 rounded-lg">
            <Box className="w-4 h-4 text-white" strokeWidth={1.75} />
          </div>
          <span className="font-semibold text-zinc-200">3D Layout System</span>
          <span className="hidden md:inline">Transforming 2D floor plans into realistic 3D spaces with AI.</span>
        </div>
        <p>© {new Date().getFullYear()} 3D Layout System. All rights reserved.</p>
      </div>
    </footer>
  );
}
