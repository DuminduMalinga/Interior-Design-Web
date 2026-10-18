import BrandMark from "./marketing/BrandMark";

/** The footer shared by the signed-in pages. */
export default function AppFooter() {
  return (
    <footer className="relative border-t border-lv-line px-4 md:px-8 py-5">
      <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-lv-muted">
        <BrandMark size={44} />
        <p>© {new Date().getFullYear()} roomscape. All rights reserved.</p>
      </div>
    </footer>
  );
}
