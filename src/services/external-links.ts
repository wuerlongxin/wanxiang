export const PROJECT_REPOSITORY_URL = 'https://github.com/wuerlongxin/artificer-deck';

function isDesktopRuntime(): boolean {
  return typeof window !== 'undefined' && Boolean(window.__TAURI_INTERNALS__);
}

export async function openProjectRepository(): Promise<void> {
  if (isDesktopRuntime()) {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('open_project_repository');
    return;
  }

  if (typeof window === 'undefined') return;
  window.open(PROJECT_REPOSITORY_URL, '_blank', 'noopener,noreferrer');
}
