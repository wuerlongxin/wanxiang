import { Assets, Texture } from 'pixi.js';

export interface LocalTextureRuntime {
  isTauri: () => boolean;
  loadWithAssets: (source: string) => Promise<Texture>;
  createImage: () => HTMLImageElement;
  textureFromImage: (image: HTMLImageElement) => Texture;
}

const defaultRuntime: LocalTextureRuntime = {
  isTauri: () => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window,
  loadWithAssets: (source) => Assets.load<Texture>(source),
  createImage: () => new Image(),
  textureFromImage: (image) => Texture.from(image, true),
};

export function normalizeLocalTextureSource(source: string): string {
  if (source.startsWith('./assets/')) return source.slice(1);
  if (source.startsWith('assets/')) return `/${source}`;
  return source;
}

function loadWithNativeImage(
  source: string,
  runtime: LocalTextureRuntime,
): Promise<Texture> {
  return new Promise<Texture>((resolve, reject) => {
    const image = runtime.createImage();
    const clearHandlers = (): void => {
      image.onload = null;
      image.onerror = null;
    };

    image.onload = () => {
      clearHandlers();
      try {
        resolve(runtime.textureFromImage(image));
      } catch (error) {
        reject(error);
      }
    };
    image.onerror = () => {
      clearHandlers();
      reject(new Error(`Failed to load local texture: ${source}`));
    };
    image.src = source;
  });
}

export function createLocalTextureLoader(
  runtime: LocalTextureRuntime = defaultRuntime,
): (source: string) => Promise<Texture> {
  const textures = new Map<string, Texture>();
  const requests = new Map<string, Promise<Texture>>();

  return (source: string): Promise<Texture> => {
    const normalizedSource = normalizeLocalTextureSource(source);
    const texture = textures.get(normalizedSource);
    if (texture && !texture.destroyed) return Promise.resolve(texture);
    if (texture) textures.delete(normalizedSource);

    const cached = requests.get(normalizedSource);
    if (cached) return cached;

    const request = (async (): Promise<Texture> => {
      if (runtime.isTauri()) {
        return loadWithNativeImage(normalizedSource, runtime);
      }
      return runtime.loadWithAssets(normalizedSource);
    })()
      .then((loadedTexture) => {
        if (!loadedTexture.destroyed) textures.set(normalizedSource, loadedTexture);
        return loadedTexture;
      })
      .finally(() => {
        if (requests.get(normalizedSource) === request) {
          requests.delete(normalizedSource);
        }
      });
    requests.set(normalizedSource, request);
    return request;
  };
}

export const loadLocalTexture = createLocalTextureLoader();
