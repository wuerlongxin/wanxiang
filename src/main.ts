import './styles.css';
import { BODY_FONT_NAME, DISPLAY_FONT_NAME, FONT_FAMILY } from './theme';
import { getRecommendedDpr } from './utils';

const fontProbes = [
  `400 16px "${BODY_FONT_NAME}"`,
  `800 16px "${BODY_FONT_NAME}"`,
  `700 16px "${DISPLAY_FONT_NAME}"`,
];

function requireAppRoot(): HTMLElement {
  const element = document.querySelector<HTMLElement>('#app');
  if (!element) throw new Error('Missing #app root');
  return element;
}

const root = requireAppRoot();
const bootStatus = document.querySelector<HTMLElement>('#boot-status');
const bootMessage = document.querySelector<HTMLElement>('#boot-status-message');
const bootRetry = document.querySelector<HTMLButtonElement>('#boot-retry');
let bootComplete = false;
let bootStage = '准备本地资源';

function setBootMessage(message: string): void {
  if (bootMessage) bootMessage.textContent = message;
}

function errorSummary(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message.trim();
  if (typeof error === 'string' && error.trim()) return error.trim();
  return '未知启动错误';
}

function renderBootFailure(error: unknown): void {
  if (bootComplete) return;
  console.error(`[Wanxiang Deck] ${bootStage}失败`, error);
  bootStatus?.classList.add('boot-failed');
  if (bootStatus) bootStatus.hidden = false;
  setBootMessage(
    `${bootStage}未完成：${errorSummary(error)}。请重新加载；若仍失败，请确认正在使用最新安装包。`,
  );
  if (bootRetry) bootRetry.hidden = false;
}

async function prepareFonts(timeoutMs = 1600): Promise<void> {
  if (!document.fonts?.load) return;
  let timer: number | undefined;
  try {
    const settled = Promise.allSettled(
      fontProbes.map((font) => document.fonts.load(font, '万象卡域')),
    ).then(() => undefined);
    const timeout = new Promise<void>((resolve) => {
      timer = window.setTimeout(resolve, timeoutMs);
    });
    await Promise.race([settled, timeout]);
  } catch (error) {
    console.warn('[Wanxiang Deck] 字体预载失败，将使用本机字体继续启动。', error);
  } finally {
    if (timer !== undefined) window.clearTimeout(timer);
  }
}

async function bootstrap(): Promise<void> {
  bootStage = '准备东方字体';
  setBootMessage('正在准备东方字体...');
  await prepareFonts();

  bootStage = '准备安全渲染组件';
  setBootMessage('正在准备安全渲染组件...');
  const { AbstractRenderer, TextStyle } = await import('./pixi-runtime');
  const { WanxiangDeckApp } = await import('./app');

  TextStyle.defaultTextStyle.fontFamily = FONT_FAMILY;
  AbstractRenderer.defaultOptions.resolution = getRecommendedDpr(
    window.innerWidth,
    window.innerHeight,
    window.devicePixelRatio || 1,
  );
  AbstractRenderer.defaultOptions.roundPixels = true;

  bootStage = '初始化 WebGL 光影画布';
  setBootMessage('正在点亮 WebGL 光影画布...');
  const app = new WanxiangDeckApp();
  await app.init(root, (stage, message) => {
    bootStage = stage;
    setBootMessage(message);
  });

  let removeCloseGuard: (() => void) | undefined;
  if (window.__TAURI_INTERNALS__) {
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    const appWindow = getCurrentWindow();
    let closeInProgress = false;
    let allowDiscardOnNextClose = false;
    removeCloseGuard = await appWindow.onCloseRequested(async (event) => {
      if (allowDiscardOnNextClose) return;
      event.preventDefault();
      if (closeInProgress) return;
      closeInProgress = true;
      try {
        await app.flushPendingStorage();
        removeCloseGuard?.();
        await appWindow.destroy();
      } catch (error) {
        allowDiscardOnNextClose = true;
        app.reportClosePersistenceFailure(error);
      } finally {
        closeInProgress = false;
      }
    });
  }

  bootComplete = true;
  bootStatus?.remove();

  if (import.meta.hot) {
    import.meta.hot.dispose(() => {
      removeCloseGuard?.();
      app.destroy();
    });
  }
}

bootRetry?.addEventListener('click', () => window.location.reload());
window.addEventListener('error', (event) => renderBootFailure(event.error ?? event.message));
window.addEventListener('unhandledrejection', (event) => renderBootFailure(event.reason));

void bootstrap().catch(renderBootFailure);
