// Pixi's CSP-safe implementations must patch the same module graph used by the app.
import 'pixi.js/unsafe-eval';
import { loadTextures } from 'pixi.js';

const textureLoaderConfig = loadTextures.config;

if ('__TAURI_INTERNALS__' in globalThis && textureLoaderConfig) {
  // WKWebView cannot reliably upload ImageBitmaps fetched through tauri://.
  textureLoaderConfig.preferWorkers = false;
  textureLoaderConfig.preferCreateImageBitmap = false;
}

export { AbstractRenderer, TextStyle } from 'pixi.js';
