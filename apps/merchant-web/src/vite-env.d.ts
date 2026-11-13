/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
  readonly VITE_CUSTOMER_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
