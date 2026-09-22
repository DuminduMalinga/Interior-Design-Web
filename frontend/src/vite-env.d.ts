/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_ANON_KEY: string;
  readonly VITE_DETECTOR_URL?: string;
  readonly VITE_LIVING_ROOM_LAYOUT_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}