/// <reference types="vite/client" />

declare module '*.svg?raw' {
  const content: string;
  export default content;
}

interface Window {
  __TAURI_INTERNALS__?: unknown;
}
