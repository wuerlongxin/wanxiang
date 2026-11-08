import {
  Container,
  Graphics,
  Particle,
  ParticleContainer,
  Sprite,
  Texture,
  Ticker,
} from 'pixi.js';
import {
  applyAdaptiveBackgroundQuality,
  BACKGROUND_FRAME_SAMPLE_COUNT,
  BACKGROUND_RESIZE_SETTLE_MS,
  calculateBackgroundQuality,
  INITIAL_BACKGROUND_ADAPTIVE_STATE,
  remapBackgroundCoordinate,
  updateBackgroundAdaptiveState,
  type BackgroundAdaptiveState,
  type BackgroundQualityProfile,
} from './background-quality';
import { COLORS } from './theme';
import { getRecommendedDpr } from './utils';
import { loadLocalTexture } from './services/local-texture';

type SpiritKind = 'far' | 'dust' | 'firefly' | 'petal';
type ParticleTextureKind = 'star' | 'dust' | 'glow' | 'petal';

interface SpiritParticle {
  view: Particle;
  kind: SpiritKind;
  x: number;
  y: number;
  velocityX: number;
  velocityY: number;
  sway: number;
  phase: number;
  phaseSpeed: number;
  baseAlpha: number;
  rotationSpeed: number;
  tone: number;
}

interface SpiritPool {
  container: ParticleContainer<Particle>;
  particles: SpiritParticle[];
  texture: Texture;
}

interface CloudLayer {
  view: Graphics;
  phase: number;
  speed: number;
  driftX: number;
  driftY: number;
  baseAlpha: number;
}

const POOL_CAPACITY = {
  far: 42,
  dust: 28,
  firefly: 12,
  petal: 14,
} as const;

function createParticleTexture(kind: ParticleTextureKind): Texture {
  if (typeof document === 'undefined') return Texture.WHITE;
  const canvas = document.createElement('canvas');
  const size = kind === 'glow' ? 48 : kind === 'petal' ? 36 : kind === 'star' ? 24 : 16;
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  if (!context) return Texture.WHITE;
  const center = size / 2;
  context.clearRect(0, 0, size, size);

  if (kind === 'glow' || kind === 'dust') {
    const radius = kind === 'glow' ? center : center * 0.72;
    const gradient = context.createRadialGradient(center, center, 0, center, center, radius);
    gradient.addColorStop(0, 'rgba(255,255,255,1)');
    gradient.addColorStop(kind === 'glow' ? 0.16 : 0.28, 'rgba(255,255,255,0.92)');
    gradient.addColorStop(0.5, 'rgba(255,255,255,0.26)');
    gradient.addColorStop(1, 'rgba(255,255,255,0)');
    context.fillStyle = gradient;
    context.fillRect(0, 0, size, size);
  } else if (kind === 'star') {
    const gradient = context.createRadialGradient(center, center, 0, center, center, center);
    gradient.addColorStop(0, 'rgba(255,255,255,1)');
    gradient.addColorStop(0.28, 'rgba(255,255,255,0.78)');
    gradient.addColorStop(1, 'rgba(255,255,255,0)');
    context.fillStyle = gradient;
    context.beginPath();
    context.moveTo(center, 0);
    context.quadraticCurveTo(center + 2, center - 2, size, center);
    context.quadraticCurveTo(center + 2, center + 2, center, size);
    context.quadraticCurveTo(center - 2, center + 2, 0, center);
    context.quadraticCurveTo(center - 2, center - 2, center, 0);
    context.fill();
  } else {
    const gradient = context.createLinearGradient(4, size - 4, size - 4, 4);
    gradient.addColorStop(0, 'rgba(255,255,255,0)');
    gradient.addColorStop(0.48, 'rgba(255,255,255,0.86)');
    gradient.addColorStop(1, 'rgba(255,255,255,0.08)');
    context.fillStyle = gradient;
    context.beginPath();
    context.moveTo(3, center + 2);
    context.bezierCurveTo(center * 0.8, 3, size - 5, 4, size - 3, center - 2);
    context.bezierCurveTo(center * 1.25, size - 3, 7, size - 4, 3, center + 2);
    context.fill();
  }

  return Texture.from(canvas);
}

function createSpiritPool(kind: SpiritKind, capacity: number, texture: Texture): SpiritPool {
  const container = new ParticleContainer<Particle>({
    texture,
    dynamicProperties: {
      position: true,
      rotation: kind === 'petal' || kind === 'far',
      vertex: false,
      uvs: false,
      color: true,
    },
    roundPixels: false,
  });
  container.blendMode = 'screen';
  const particles: SpiritParticle[] = [];
  for (let index = 0; index < capacity; index += 1) {
    const view = new Particle({
      texture,
      anchorX: 0.5,
      anchorY: 0.5,
      alpha: 0,
    });
    particles.push({
      view,
      kind,
      x: 0,
      y: 0,
      velocityX: 0,
      velocityY: 0,
      sway: 0,
      phase: 0,
      phaseSpeed: 0,
      baseAlpha: 0,
      rotationSpeed: 0,
      tone: 0,
    });
    container.addParticle(view);
  }
  return { container, particles, texture };
}

function setPoolSize(pool: SpiritPool, count: number): void {
  pool.container.particleChildren.length = 0;
  const safeCount = Math.min(pool.particles.length, Math.max(0, count));
  for (let index = 0; index < safeCount; index += 1) {
    pool.container.particleChildren.push(pool.particles[index].view);
  }
  pool.container.update();
}

export class BackgroundField extends Container {
  private readonly fill = new Graphics();
  private readonly backdrop = new Sprite({ texture: Texture.EMPTY });
  private readonly imageVeil = new Graphics();
  private readonly atmosphere = new Graphics();
  private readonly grid = new Graphics();
  private readonly traces = new Graphics();
  private readonly lightSweep = new Graphics();
  private readonly cloudLayers: CloudLayer[] = [
    { view: new Graphics(), phase: 0.15, speed: 0.052, driftX: 0.022, driftY: 0.006, baseAlpha: 0.64 },
    { view: new Graphics(), phase: 2.3, speed: 0.073, driftX: 0.032, driftY: 0.009, baseAlpha: 0.76 },
    { view: new Graphics(), phase: 4.4, speed: 0.095, driftX: 0.044, driftY: 0.012, baseAlpha: 0.88 },
  ];
  private readonly farPool: SpiritPool;
  private readonly dustPool: SpiritPool;
  private readonly fireflyPool: SpiritPool;
  private readonly petalPool: SpiritPool;
  private readonly particleTextures: Texture[];
  private readonly motionQuery =
    typeof window !== 'undefined' ? window.matchMedia('(prefers-reduced-motion: reduce)') : undefined;
  private widthPx = 0;
  private heightPx = 0;
  private elapsed = 0;
  private pendingDelta = 0;
  private backdropScale = 1;
  private frameCounter = 0;
  private staticWidthPx = 0;
  private staticHeightPx = 0;
  private staticRedrawTimer?: number;
  private staticRedrawDeadline = 0;
  private randomState = 0x6d2b79f5;
  private disposed = false;
  private mobileLayout = false;
  private pageVisible = typeof document === 'undefined' || document.visibilityState !== 'hidden';
  private motionReduced = this.motionQuery?.matches ?? false;
  private accent: number = COLORS.jade;
  private secondary: number = COLORS.gold;
  private baseQuality: BackgroundQualityProfile = calculateBackgroundQuality(1, 1);
  private quality: BackgroundQualityProfile = this.baseQuality;
  private adaptiveState: BackgroundAdaptiveState = { ...INITIAL_BACKGROUND_ADAPTIVE_STATE };
  private sampledFrameMs = 0;
  private sampledFrames = 0;

  constructor() {
    super();
    const farTexture = createParticleTexture('star');
    const dustTexture = createParticleTexture('dust');
    const fireflyTexture = createParticleTexture('glow');
    const petalTexture = createParticleTexture('petal');
    this.particleTextures = [farTexture, dustTexture, fireflyTexture, petalTexture];
    this.farPool = createSpiritPool('far', POOL_CAPACITY.far, farTexture);
    this.dustPool = createSpiritPool('dust', POOL_CAPACITY.dust, dustTexture);
    this.fireflyPool = createSpiritPool('firefly', POOL_CAPACITY.firefly, fireflyTexture);
    this.petalPool = createSpiritPool('petal', POOL_CAPACITY.petal, petalTexture);

    this.eventMode = 'none';
    this.atmosphere.blendMode = 'screen';
    this.lightSweep.blendMode = 'screen';
    this.backdrop.anchor.set(0.5);
    this.backdrop.alpha = 0.86;
    for (let index = 0; index < this.cloudLayers.length; index += 1) {
      this.cloudLayers[index].view.blendMode = 'screen';
    }
    this.addChild(
      this.fill,
      this.backdrop,
      this.imageVeil,
      this.cloudLayers[0].view,
      this.farPool.container,
      this.atmosphere,
      this.cloudLayers[1].view,
      this.grid,
      this.traces,
      this.dustPool.container,
      this.cloudLayers[2].view,
      this.lightSweep,
      this.petalPool.container,
      this.fireflyPool.container,
    );
    Ticker.shared.add(this.tick);
    document.addEventListener('visibilitychange', this.handleVisibilityChange);
    this.motionQuery?.addEventListener('change', this.handleMotionPreference);
    void this.loadBackdrop();
  }

  setPalette(accent: number, secondary: number): void {
    this.accent = accent;
    this.secondary = secondary;
    this.recolorParticles();
    this.redrawStaticImmediately();
  }

  layout(width: number, height: number, mobile = false): void {
    const nextWidth = Math.max(1, width);
    const nextHeight = Math.max(1, height);
    const previousWidth = this.widthPx;
    const previousHeight = this.heightPx;
    const firstLayout = previousWidth <= 0 || previousHeight <= 0;
    const dimensionsChanged = previousWidth !== nextWidth || previousHeight !== nextHeight;
    this.widthPx = nextWidth;
    this.heightPx = nextHeight;
    this.mobileLayout = mobile;
    this.layoutBackdrop();
    const qualityChanged = this.refreshQuality();

    if (firstLayout) {
      this.initializePool(this.farPool);
      this.initializePool(this.dustPool);
      this.initializePool(this.fireflyPool);
      this.initializePool(this.petalPool);
      this.applyQualityBudget();
      this.recolorParticles();
      this.redrawStaticImmediately();
      return;
    }

    if (dimensionsChanged) {
      this.remapParticles(previousWidth, previousHeight, nextWidth, nextHeight);
      this.scaleStaticGraphicsToViewport();
      this.scheduleStaticRedraw();
    }
    if (qualityChanged) this.applyQualityBudget();
  }

  private refreshQuality(): boolean {
    const previousTier = this.quality.tier;
    const displayDpr = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1;
    const renderDpr = getRecommendedDpr(this.widthPx, this.heightPx, displayDpr);
    const runtimeNavigator = typeof navigator === 'undefined'
      ? undefined
      : (navigator as Navigator & { deviceMemory?: number });
    this.baseQuality = calculateBackgroundQuality(this.widthPx, this.heightPx, {
      mobile: this.mobileLayout,
      reducedMotion: this.motionReduced,
      devicePixelRatio: renderDpr,
      displayPixelRatio: displayDpr,
      hardwareConcurrency: runtimeNavigator?.hardwareConcurrency || undefined,
      deviceMemoryGb: runtimeNavigator?.deviceMemory,
    });
    this.quality = applyAdaptiveBackgroundQuality(this.baseQuality, this.adaptiveState.level);
    return previousTier !== this.quality.tier;
  }

  private sampleFrameBudget(deltaMs: number): void {
    if (!Number.isFinite(deltaMs) || deltaMs <= 0) return;
    this.sampledFrameMs += Math.min(50, deltaMs);
    this.sampledFrames += 1;
    if (this.sampledFrames < BACKGROUND_FRAME_SAMPLE_COUNT) return;

    const nextState = updateBackgroundAdaptiveState(
      this.adaptiveState,
      this.sampledFrameMs / this.sampledFrames,
    );
    this.sampledFrameMs = 0;
    this.sampledFrames = 0;
    if (nextState.level === this.adaptiveState.level) {
      this.adaptiveState = nextState;
      return;
    }

    const previousTier = this.quality.tier;
    this.adaptiveState = nextState;
    this.quality = applyAdaptiveBackgroundQuality(this.baseQuality, nextState.level);
    if (this.quality.tier !== previousTier) this.applyQualityBudget();
  }

  private resetFrameSample(): void {
    this.sampledFrameMs = 0;
    this.sampledFrames = 0;
  }

  private remapParticles(
    previousWidth: number,
    previousHeight: number,
    nextWidth: number,
    nextHeight: number,
  ): void {
    this.remapPool(this.farPool, previousWidth, previousHeight, nextWidth, nextHeight);
    this.remapPool(this.dustPool, previousWidth, previousHeight, nextWidth, nextHeight);
    this.remapPool(this.fireflyPool, previousWidth, previousHeight, nextWidth, nextHeight);
    this.remapPool(this.petalPool, previousWidth, previousHeight, nextWidth, nextHeight);
  }

  private remapPool(
    pool: SpiritPool,
    previousWidth: number,
    previousHeight: number,
    nextWidth: number,
    nextHeight: number,
  ): void {
    for (let index = 0; index < pool.particles.length; index += 1) {
      const particle = pool.particles[index];
      particle.x = remapBackgroundCoordinate(particle.x, previousWidth, nextWidth);
      particle.y = remapBackgroundCoordinate(particle.y, previousHeight, nextHeight);
      particle.view.x = remapBackgroundCoordinate(particle.view.x, previousWidth, nextWidth);
      particle.view.y = remapBackgroundCoordinate(particle.view.y, previousHeight, nextHeight);
      particle.x = Math.min(nextWidth + 32, Math.max(-32, particle.x));
      particle.y = Math.min(nextHeight + 32, Math.max(-32, particle.y));
      particle.view.x = Math.min(nextWidth + 40, Math.max(-40, particle.view.x));
      particle.view.y = Math.min(nextHeight + 40, Math.max(-40, particle.view.y));
    }
  }

  private scaleStaticGraphicsToViewport(): void {
    if (this.staticWidthPx <= 0 || this.staticHeightPx <= 0) return;
    this.setStaticGraphicsScale(
      this.widthPx / this.staticWidthPx,
      this.heightPx / this.staticHeightPx,
    );
  }

  private setStaticGraphicsScale(scaleX: number, scaleY: number): void {
    this.fill.scale.set(scaleX, scaleY);
    this.imageVeil.scale.set(scaleX, scaleY);
    this.atmosphere.scale.set(scaleX, scaleY);
    this.grid.scale.set(scaleX, scaleY);
    this.traces.scale.set(scaleX, scaleY);
    this.lightSweep.scale.set(scaleX, scaleY);
    for (let index = 0; index < this.cloudLayers.length; index += 1) {
      this.cloudLayers[index].view.scale.set(scaleX, scaleY);
    }
  }

  private scheduleStaticRedraw(): void {
    this.staticRedrawDeadline = performance.now() + BACKGROUND_RESIZE_SETTLE_MS;
    if (this.staticRedrawTimer !== undefined) return;
    this.staticRedrawTimer = window.setTimeout(this.flushStaticRedraw, BACKGROUND_RESIZE_SETTLE_MS);
  }

  private flushStaticRedraw = (): void => {
    this.staticRedrawTimer = undefined;
    if (this.disposed) return;
    const remaining = this.staticRedrawDeadline - performance.now();
    if (remaining > 8) {
      this.staticRedrawTimer = window.setTimeout(this.flushStaticRedraw, Math.ceil(remaining));
      return;
    }
    this.staticRedrawDeadline = 0;
    this.redrawStaticImmediately();
  };

  private redrawStaticImmediately(): void {
    if (this.staticRedrawTimer !== undefined) {
      window.clearTimeout(this.staticRedrawTimer);
      this.staticRedrawTimer = undefined;
    }
    this.staticRedrawDeadline = 0;
    this.setStaticGraphicsScale(1, 1);
    this.drawStatic();
    if (this.widthPx > 0 && this.heightPx > 0) {
      this.staticWidthPx = this.widthPx;
      this.staticHeightPx = this.heightPx;
    }
  }

  private applyQualityBudget(): void {
    setPoolSize(this.farPool, this.quality.farFlecks);
    setPoolSize(this.dustPool, this.quality.goldDust);
    setPoolSize(this.fireflyPool, this.quality.fireflies);
    setPoolSize(this.petalPool, this.quality.lightPetals);
    for (let index = 0; index < this.cloudLayers.length; index += 1) {
      this.cloudLayers[index].view.visible = index < this.quality.cloudLayers;
    }
  }

  private nextRandom(): number {
    this.randomState += 0x6d2b79f5;
    let value = this.randomState;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  }

  private range(min: number, max: number): number {
    return min + (max - min) * this.nextRandom();
  }

  private initializePool(pool: SpiritPool): void {
    const width = this.widthPx;
    const height = this.heightPx;
    const textureWidth = Math.max(1, pool.texture.width);
    const textureHeight = Math.max(1, pool.texture.height);
    for (let index = 0; index < pool.particles.length; index += 1) {
      const particle = pool.particles[index];
      particle.x = this.range(0, width);
      particle.y = this.range(0, height);
      particle.phase = this.range(0, Math.PI * 2);
      particle.tone = index % 9 === 0 ? 3 : index % 4 === 0 ? 1 : index % 3 === 0 ? 2 : 0;
      particle.view.rotation = this.range(-Math.PI, Math.PI);

      if (particle.kind === 'far') {
        const size = this.range(1.2, 3.8);
        particle.velocityX = this.range(0.35, 1.3);
        particle.velocityY = this.range(0.15, 0.65);
        particle.sway = this.range(1.2, 4.8);
        particle.phaseSpeed = this.range(0.12, 0.3);
        particle.baseAlpha = this.range(0.09, 0.27);
        particle.rotationSpeed = this.range(-0.035, 0.035);
        particle.view.scaleX = size / textureWidth;
        particle.view.scaleY = size / textureHeight;
      } else if (particle.kind === 'dust') {
        const size = this.range(3, 7.5);
        particle.velocityX = this.range(-0.45, 0.7);
        particle.velocityY = -this.range(1.5, 4.1);
        particle.sway = this.range(3, 10);
        particle.phaseSpeed = this.range(0.28, 0.62);
        particle.baseAlpha = this.range(0.12, 0.34);
        particle.rotationSpeed = 0;
        particle.view.scaleX = size / textureWidth;
        particle.view.scaleY = size / textureHeight;
      } else if (particle.kind === 'firefly') {
        const size = this.range(16, 29);
        particle.velocityX = this.range(-0.35, 0.35);
        particle.velocityY = -this.range(2.2, 5.6);
        particle.sway = this.range(10, 27);
        particle.phaseSpeed = this.range(0.48, 0.92);
        particle.baseAlpha = this.range(0.22, 0.48);
        particle.rotationSpeed = 0;
        particle.view.scaleX = size / textureWidth;
        particle.view.scaleY = size / textureHeight;
      } else {
        const widthPx = this.range(7, 13);
        const heightPx = widthPx * this.range(0.42, 0.68);
        particle.velocityX = this.range(4.5, 11.5);
        particle.velocityY = this.range(-1.8, 2.6);
        particle.sway = this.range(4, 12);
        particle.phaseSpeed = this.range(0.22, 0.5);
        particle.baseAlpha = this.range(0.1, 0.26);
        particle.rotationSpeed = this.range(-0.28, 0.28);
        particle.view.scaleX = widthPx / textureWidth;
        particle.view.scaleY = heightPx / textureHeight;
      }

      particle.view.x = particle.x;
      particle.view.y = particle.y;
      particle.view.alpha = particle.baseAlpha;
    }
    pool.container.update();
  }

  private recolorParticles(): void {
    this.recolorPool(this.farPool);
    this.recolorPool(this.dustPool);
    this.recolorPool(this.fireflyPool);
    this.recolorPool(this.petalPool);
  }

  private recolorPool(pool: SpiritPool): void {
    for (let index = 0; index < pool.particles.length; index += 1) {
      const particle = pool.particles[index];
      if (particle.kind === 'dust') {
        particle.view.tint = particle.tone === 1
          ? this.accent
          : particle.tone === 2
            ? this.secondary
            : particle.tone === 3
              ? COLORS.amber
              : COLORS.gold;
      } else if (particle.kind === 'firefly') {
        particle.view.tint = particle.tone === 1 ? this.accent : particle.tone === 2 ? this.secondary : COLORS.gold;
      } else if (particle.kind === 'petal') {
        particle.view.tint = particle.tone === 1
          ? this.accent
          : particle.tone === 2
            ? this.secondary
            : particle.tone === 3
              ? COLORS.cinnabar
              : COLORS.paper;
      } else {
        particle.view.tint = particle.tone === 1 ? this.accent : particle.tone === 2 ? this.secondary : COLORS.paper;
      }
    }
  }

  private drawStatic(): void {
    const width = this.widthPx;
    const height = this.heightPx;
    if (!width || !height) return;

    this.fill.clear().rect(0, 0, width, height).fill(COLORS.ink);

    this.imageVeil.clear().rect(0, 0, width, height).fill({ color: COLORS.ink, alpha: 0.66 });
    this.imageVeil
      .rect(0, 0, width, Math.min(190, height * 0.23))
      .fill({ color: COLORS.ink, alpha: 0.24 });
    this.imageVeil
      .rect(0, height * 0.72, width, height * 0.28)
      .fill({ color: COLORS.cinnabar, alpha: 0.07 });
    const sideFade = Math.min(width * 0.2, 280);
    for (let step = 0; step < 6; step += 1) {
      const inset = (sideFade * step) / 6;
      const alpha = 0.024 + (5 - step) * 0.009;
      this.imageVeil
        .rect(inset, 0, sideFade - inset, height)
        .fill({ color: COLORS.ink, alpha });
      this.imageVeil
        .rect(width - sideFade + inset, 0, sideFade - inset, height)
        .fill({ color: COLORS.ink, alpha });
    }
    this.imageVeil
      .rect(0, Math.min(108, height * 0.16), width, 1)
      .fill({ color: COLORS.bronze, alpha: 0.22 });

    this.drawCloudLayers(width, height);
    this.atmosphere.clear();
    this.atmosphere
      .moveTo(-width * 0.16, height * 0.28)
      .bezierCurveTo(width * 0.18, height * 0.05, width * 0.46, height * 0.4, width * 0.72, height * 0.18)
      .bezierCurveTo(width * 0.88, height * 0.05, width * 1.02, height * 0.12, width * 1.16, height * 0.02)
      .stroke({ color: COLORS.cinnabar, width: Math.max(80, height * 0.2), alpha: 0.028 });
    this.atmosphere
      .moveTo(-width * 0.12, height * 0.72)
      .bezierCurveTo(width * 0.24, height * 0.52, width * 0.47, height * 0.88, width * 0.78, height * 0.61)
      .bezierCurveTo(width * 0.94, height * 0.48, width * 1.06, height * 0.58, width * 1.14, height * 0.45)
      .stroke({ color: this.accent, width: Math.max(70, height * 0.17), alpha: 0.024 });
    this.atmosphere
      .moveTo(-width * 0.08, height * 0.94)
      .bezierCurveTo(width * 0.28, height * 0.7, width * 0.56, height * 1.02, width * 1.08, height * 0.76)
      .stroke({ color: this.secondary, width: Math.max(38, height * 0.08), alpha: 0.02 });

    const top = Math.min(112, height * 0.18);
    const cell = width < 620 ? 72 : 104;
    this.grid.clear();
    for (let x = 0; x <= width; x += cell) {
      this.grid
        .moveTo(x, top)
        .lineTo(x, height)
        .stroke({ color: COLORS.bronze, width: 0.7, alpha: 0.038 });
    }
    for (let y = top; y < height; y += cell) {
      this.grid
        .moveTo(0, y)
        .lineTo(width, y)
        .stroke({ color: COLORS.paper, width: 0.6, alpha: 0.024 });
      for (let x = 0; x < width; x += cell) {
        this.grid
          .rect(x + cell * 0.18, y + cell * 0.18, cell * 0.64, cell * 0.64)
          .stroke({ color: this.accent, width: 0.55, alpha: 0.016 });
      }
    }
    const fret = width < 620 ? 34 : 46;
    for (let x = -fret; x < width + fret; x += fret) {
      this.grid
        .moveTo(x, top + 13)
        .lineTo(x + fret * 0.62, top + 13)
        .lineTo(x + fret * 0.62, top + fret * 0.38)
        .lineTo(x + fret * 0.32, top + fret * 0.38)
        .lineTo(x + fret * 0.32, top + fret * 0.23)
        .lineTo(x + fret * 0.48, top + fret * 0.23)
        .stroke({ color: COLORS.gold, width: 0.7, alpha: 0.075 });
    }

    this.traces.clear();
    this.traces
      .moveTo(-width * 0.03, height * 0.82)
      .bezierCurveTo(width * 0.16, height * 0.66, width * 0.32, height * 0.9, width * 0.51, height * 0.72)
      .bezierCurveTo(width * 0.7, height * 0.54, width * 0.82, height * 0.72, width * 1.03, height * 0.56)
      .stroke({ color: this.accent, width: 1.2, alpha: 0.12 });
    this.traces
      .moveTo(-width * 0.02, height * 0.85)
      .bezierCurveTo(width * 0.18, height * 0.69, width * 0.35, height * 0.95, width * 0.54, height * 0.76)
      .stroke({ color: this.secondary, width: 0.8, alpha: 0.12 });
    for (let index = 0; index < 7; index += 1) {
      const x = width * (0.05 + index * 0.155);
      const y = height * (0.9 - (index % 2) * 0.025);
      const size = Math.min(38, width * 0.032);
      this.traces
        .moveTo(x, y)
        .quadraticCurveTo(x + size * 0.2, y - size * 0.55, x + size * 0.62, y - size * 0.3)
        .quadraticCurveTo(x + size * 1.05, y - size * 0.7, x + size * 1.35, y - size * 0.18)
        .quadraticCurveTo(x + size * 1.12, y + size * 0.08, x + size * 0.72, y)
        .stroke({ color: index % 2 === 0 ? COLORS.gold : COLORS.jade, width: 0.8, alpha: 0.095 });
    }

    this.lightSweep.clear();
    this.lightSweep
      .moveTo(-width * 0.2, height * 0.35)
      .bezierCurveTo(width * 0.16, height * 0.14, width * 0.46, height * 0.48, width * 0.82, height * 0.24)
      .bezierCurveTo(width * 0.96, height * 0.15, width * 1.08, height * 0.22, width * 1.2, height * 0.12)
      .stroke({ color: COLORS.gold, width: Math.max(18, height * 0.035), alpha: 0.035 });
    this.lightSweep
      .moveTo(-width * 0.14, height * 0.67)
      .bezierCurveTo(width * 0.18, height * 0.48, width * 0.52, height * 0.82, width * 1.15, height * 0.5)
      .stroke({ color: this.accent, width: Math.max(12, height * 0.022), alpha: 0.032 });
  }

  private drawCloudLayers(width: number, height: number): void {
    const colors = [COLORS.paper, this.accent, this.secondary];
    for (let index = 0; index < this.cloudLayers.length; index += 1) {
      const graphics = this.cloudLayers[index].view;
      const y = height * (0.18 + index * 0.3);
      const thickness = Math.max(28, height * (0.07 + index * 0.015));
      const color = colors[index];
      graphics.clear();
      graphics
        .moveTo(-width * 0.3, y + thickness * 0.35)
        .bezierCurveTo(width * 0.02, y - thickness, width * 0.22, y + thickness, width * 0.47, y - thickness * 0.14)
        .bezierCurveTo(width * 0.7, y - thickness, width * 0.92, y + thickness * 0.7, width * 1.3, y - thickness * 0.3)
        .stroke({ color, width: thickness, alpha: 0.018 + index * 0.006 });
      graphics
        .moveTo(-width * 0.2, y + thickness * 0.18)
        .bezierCurveTo(width * 0.08, y - thickness * 0.42, width * 0.3, y + thickness * 0.52, width * 0.56, y - thickness * 0.16)
        .bezierCurveTo(width * 0.78, y - thickness * 0.62, width, y + thickness * 0.45, width * 1.22, y - thickness * 0.22)
        .stroke({ color, width: Math.max(1, 1.2 + index * 0.35), alpha: 0.085 + index * 0.015 });
      for (let wisp = 0; wisp < 4; wisp += 1) {
        const startX = width * (-0.08 + wisp * 0.31);
        const wispY = y + (wisp % 2 === 0 ? -1 : 1) * thickness * 0.25;
        graphics
          .moveTo(startX, wispY)
          .bezierCurveTo(
            startX + width * 0.08,
            wispY - thickness * 0.35,
            startX + width * 0.15,
            wispY + thickness * 0.3,
            startX + width * 0.24,
            wispY - thickness * 0.08,
          )
          .stroke({ color, width: 0.8 + index * 0.25, alpha: 0.05 + index * 0.012 });
      }
    }
  }

  private tick = (ticker: Ticker): void => {
    if (!this.widthPx || !this.heightPx || !this.pageVisible || this.motionReduced) return;
    this.sampleFrameBudget(ticker.deltaMS);
    const frameDelta = Math.min(50, ticker.deltaMS) / 1000;
    this.pendingDelta += frameDelta;
    this.frameCounter += 1;
    if (this.frameCounter % this.quality.updateEvery !== 0) return;
    const delta = this.pendingDelta * this.quality.motionScale;
    this.pendingDelta = 0;
    this.elapsed += delta;

    this.updateFarParticles(delta);
    this.updateRisingParticles(this.dustPool, delta, false);
    this.updateRisingParticles(this.fireflyPool, delta, true);
    this.updatePetals(delta);
    this.updateAtmosphere();
  };

  private updateFarParticles(delta: number): void {
    const particles = this.farPool.container.particleChildren;
    for (let index = 0; index < particles.length; index += 1) {
      const particle = this.farPool.particles[index];
      particle.x += particle.velocityX * delta;
      particle.y += particle.velocityY * delta;
      if (particle.x > this.widthPx + 12) particle.x = -12;
      if (particle.y > this.heightPx + 12) particle.y = -12;
      particle.view.x = particle.x + Math.sin(this.elapsed * particle.phaseSpeed + particle.phase) * particle.sway;
      particle.view.y = particle.y;
      particle.view.rotation += particle.rotationSpeed * delta;
      particle.view.alpha = particle.baseAlpha * (0.62 + Math.sin(this.elapsed * 0.72 + particle.phase) * 0.28);
    }
  }

  private updateRisingParticles(pool: SpiritPool, delta: number, fireflies: boolean): void {
    const particles = pool.container.particleChildren;
    for (let index = 0; index < particles.length; index += 1) {
      const particle = pool.particles[index];
      particle.x += particle.velocityX * delta;
      particle.y += particle.velocityY * delta;
      if (particle.y < -32) {
        particle.y = this.heightPx + 24;
        particle.x = (particle.x + this.widthPx * 0.381966) % this.widthPx;
      }
      if (particle.x < -32) particle.x = this.widthPx + 24;
      if (particle.x > this.widthPx + 32) particle.x = -24;
      const wave = Math.sin(this.elapsed * particle.phaseSpeed + particle.phase);
      particle.view.x = particle.x + wave * particle.sway;
      particle.view.y = particle.y + (fireflies ? Math.cos(this.elapsed * 0.44 + particle.phase) * 2.4 : 0);
      const pulse = fireflies
        ? 0.48 + Math.max(0, Math.sin(this.elapsed * 1.7 + particle.phase)) * 0.52
        : 0.58 + wave * 0.3;
      particle.view.alpha = particle.baseAlpha * pulse;
    }
  }

  private updatePetals(delta: number): void {
    const particles = this.petalPool.container.particleChildren;
    for (let index = 0; index < particles.length; index += 1) {
      const particle = this.petalPool.particles[index];
      particle.x += particle.velocityX * delta;
      particle.y += particle.velocityY * delta;
      if (particle.x > this.widthPx + 28) {
        particle.x = -28;
        particle.y = (particle.y + this.heightPx * 0.618034) % this.heightPx;
      }
      if (particle.y < -28) particle.y = this.heightPx + 20;
      if (particle.y > this.heightPx + 28) particle.y = -20;
      const wave = Math.sin(this.elapsed * particle.phaseSpeed + particle.phase);
      particle.view.x = particle.x;
      particle.view.y = particle.y + wave * particle.sway;
      particle.view.rotation += particle.rotationSpeed * delta;
      particle.view.alpha = particle.baseAlpha * (0.64 + wave * 0.24);
    }
  }

  private updateAtmosphere(): void {
    const scrollTravel = Math.sin(this.elapsed * 0.075);
    const scrollLift = Math.sin(this.elapsed * 0.041 + 1.2);
    this.atmosphere.position.set(
      -scrollTravel * this.widthPx * 0.022,
      scrollLift * this.heightPx * 0.006,
    );
    this.atmosphere.alpha = 0.8 + Math.sin(this.elapsed * 0.16) * 0.13;
    const backdropBreath = 1 + Math.sin(this.elapsed * 0.045) * 0.009;
    this.backdrop.scale.set(this.backdropScale * backdropBreath);
    this.backdrop.position.set(
      this.widthPx * 0.5 + scrollTravel * this.widthPx * 0.032,
      this.heightPx * 0.5 + scrollLift * this.heightPx * 0.009,
    );
    this.traces.x = -scrollTravel * this.widthPx * 0.012;
    this.lightSweep.x = scrollTravel * this.widthPx * 0.048;
    this.lightSweep.y = Math.cos(this.elapsed * 0.14) * 4;
    this.lightSweep.alpha = 0.68 + Math.sin(this.elapsed * 0.31) * 0.18;

    for (let index = 0; index < this.cloudLayers.length; index += 1) {
      const cloud = this.cloudLayers[index];
      if (!cloud.view.visible) continue;
      const phase = this.elapsed * cloud.speed + cloud.phase;
      cloud.view.position.set(
        Math.sin(phase) * this.widthPx * cloud.driftX,
        Math.cos(phase * 0.74) * this.heightPx * cloud.driftY,
      );
      cloud.view.alpha = cloud.baseAlpha + Math.sin(phase * 1.8) * 0.12;
    }
  }

  private handleVisibilityChange = (): void => {
    this.pageVisible = document.visibilityState !== 'hidden';
    if (!this.pageVisible) {
      this.pendingDelta = 0;
      this.resetFrameSample();
    }
  };

  private handleMotionPreference = (): void => {
    this.motionReduced = this.motionQuery?.matches ?? false;
    this.pendingDelta = 0;
    this.resetFrameSample();
    if (!this.widthPx || !this.heightPx) return;
    if (this.refreshQuality()) this.applyQualityBudget();
  };

  private async loadBackdrop(): Promise<void> {
    try {
      const texture = await loadLocalTexture('/assets/ui/eastern-scroll-bg.jpg');
      if (this.disposed || !texture || texture.width <= 0 || texture.height <= 0) return;
      this.backdrop.texture = texture;
      this.layoutBackdrop();
    } catch {
      // The procedural ink-and-gold field remains available if the local asset fails.
    }
  }

  private layoutBackdrop(): void {
    const texture = this.backdrop.texture;
    if (!this.widthPx || !this.heightPx || texture === Texture.EMPTY || texture.width <= 0 || texture.height <= 0) {
      return;
    }
    this.backdropScale =
      Math.max(this.widthPx / texture.width, this.heightPx / texture.height) * 1.12;
    this.backdrop.scale.set(this.backdropScale);
    this.backdrop.position.set(this.widthPx * 0.5, this.heightPx * 0.5);
  }

  override destroy(options?: Parameters<Container['destroy']>[0]): void {
    this.disposed = true;
    Ticker.shared.remove(this.tick);
    if (this.staticRedrawTimer !== undefined) {
      window.clearTimeout(this.staticRedrawTimer);
      this.staticRedrawTimer = undefined;
    }
    this.staticRedrawDeadline = 0;
    document.removeEventListener('visibilitychange', this.handleVisibilityChange);
    this.motionQuery?.removeEventListener('change', this.handleMotionPreference);
    this.backdrop.texture = Texture.EMPTY;
    for (let index = 0; index < this.particleTextures.length; index += 1) {
      const texture = this.particleTextures[index];
      if (texture !== Texture.WHITE) texture.destroy(true);
    }
    super.destroy(options ?? { children: true });
  }
}
