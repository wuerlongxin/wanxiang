export type BackgroundQualityTier = 'minimal' | 'balanced' | 'rich';
export type BackgroundAdaptiveLevel = 0 | 1 | 2;

export const BACKGROUND_RESIZE_SETTLE_MS = 140;
export const BACKGROUND_FRAME_SAMPLE_COUNT = 90;
export const BACKGROUND_SLOW_FRAME_MS = 21;
export const BACKGROUND_FAST_FRAME_MS = 17.8;

export interface BackgroundQualityOptions {
  mobile?: boolean;
  reducedMotion?: boolean;
  /** DPR used by the renderer after the global pixel-budget cap. */
  devicePixelRatio?: number;
  /** Uncapped display DPR, used to detect native high-pixel pressure. */
  displayPixelRatio?: number;
  hardwareConcurrency?: number;
  deviceMemoryGb?: number;
}

export interface BackgroundQualityProfile {
  tier: BackgroundQualityTier;
  farFlecks: number;
  goldDust: number;
  fireflies: number;
  lightPetals: number;
  cloudLayers: number;
  updateEvery: number;
  motionScale: number;
}

export interface BackgroundAdaptiveState {
  level: BackgroundAdaptiveLevel;
  slowWindows: number;
  fastWindows: number;
}

const PROFILES: Record<BackgroundQualityTier, Omit<BackgroundQualityProfile, 'tier'>> = {
  minimal: {
    farFlecks: 12,
    goldDust: 8,
    fireflies: 4,
    lightPetals: 4,
    cloudLayers: 1,
    updateEvery: 2,
    motionScale: 0.72,
  },
  balanced: {
    farFlecks: 24,
    goldDust: 16,
    fireflies: 7,
    lightPetals: 8,
    cloudLayers: 2,
    updateEvery: 1,
    motionScale: 0.86,
  },
  rich: {
    farFlecks: 42,
    goldDust: 28,
    fireflies: 12,
    lightPetals: 14,
    cloudLayers: 3,
    updateEvery: 1,
    motionScale: 1,
  },
};

const TIER_PRESSURE: Record<BackgroundQualityTier, BackgroundAdaptiveLevel> = {
  rich: 0,
  balanced: 1,
  minimal: 2,
};

const PRESSURE_TIER: Record<BackgroundAdaptiveLevel, BackgroundQualityTier> = {
  0: 'rich',
  1: 'balanced',
  2: 'minimal',
};

export const INITIAL_BACKGROUND_ADAPTIVE_STATE: BackgroundAdaptiveState = {
  level: 0,
  slowWindows: 0,
  fastWindows: 0,
};

/** Applies runtime frame pressure without ever exceeding the device-derived budget. */
export function applyAdaptiveBackgroundQuality(
  base: BackgroundQualityProfile,
  level: BackgroundAdaptiveLevel,
): BackgroundQualityProfile {
  const pressure = Math.max(TIER_PRESSURE[base.tier], level) as BackgroundAdaptiveLevel;
  const tier = PRESSURE_TIER[pressure];
  return { tier, ...PROFILES[tier] };
}

/** Uses hysteresis so an isolated animation spike cannot make the background flicker between tiers. */
export function updateBackgroundAdaptiveState(
  state: BackgroundAdaptiveState,
  averageFrameMs: number,
): BackgroundAdaptiveState {
  if (!Number.isFinite(averageFrameMs) || averageFrameMs <= 0) return state;

  if (averageFrameMs >= BACKGROUND_SLOW_FRAME_MS) {
    const slowWindows = state.slowWindows + 1;
    if (slowWindows >= 2 && state.level < 2) {
      return {
        level: (state.level + 1) as BackgroundAdaptiveLevel,
        slowWindows: 0,
        fastWindows: 0,
      };
    }
    return { ...state, slowWindows, fastWindows: 0 };
  }

  if (averageFrameMs <= BACKGROUND_FAST_FRAME_MS) {
    const fastWindows = state.fastWindows + 1;
    if (fastWindows >= 6 && state.level > 0) {
      return {
        level: (state.level - 1) as BackgroundAdaptiveLevel,
        slowWindows: 0,
        fastWindows: 0,
      };
    }
    return { ...state, slowWindows: 0, fastWindows };
  }

  return { ...state, slowWindows: 0, fastWindows: 0 };
}

/** Selects a bounded background budget from viewport and device pressure. */
export function calculateBackgroundQuality(
  width: number,
  height: number,
  options: BackgroundQualityOptions = {},
): BackgroundQualityProfile {
  const safeWidth = Number.isFinite(width) ? Math.max(1, width) : 1;
  const safeHeight = Number.isFinite(height) ? Math.max(1, height) : 1;
  const dpr = Number.isFinite(options.devicePixelRatio)
    ? Math.min(3, Math.max(0.75, options.devicePixelRatio ?? 1))
    : 1;
  const displayDpr = Number.isFinite(options.displayPixelRatio)
    ? Math.min(3, Math.max(0.75, options.displayPixelRatio ?? dpr))
    : dpr;
  const physicalPixelLoad = safeWidth * safeHeight * dpr * dpr;
  const nativePixelLoad = safeWidth * safeHeight * displayDpr * displayDpr;
  const logicalPixelLoad = safeWidth * safeHeight;
  const lowHeight = safeHeight < 600;
  const constrainedCpu =
    options.hardwareConcurrency !== undefined && options.hardwareConcurrency <= 4;
  const constrainedMemory =
    options.deviceMemoryGb !== undefined && options.deviceMemoryGb <= 4;

  let tier: BackgroundQualityTier = 'rich';
  if (
    options.mobile ||
    options.reducedMotion ||
    lowHeight ||
    constrainedCpu ||
    constrainedMemory ||
    physicalPixelLoad > 5_250_000 ||
    nativePixelLoad > 18_000_000
  ) {
    tier = 'minimal';
  } else if (
    safeWidth < 1050 ||
    safeHeight < 720 ||
    physicalPixelLoad > 3_800_000 ||
    nativePixelLoad > 7_500_000 ||
    logicalPixelLoad > 2_400_000
  ) {
    tier = 'balanced';
  }

  const profile = PROFILES[tier];
  return { tier, ...profile };
}

export const MAX_BACKGROUND_PARTICLES =
  PROFILES.rich.farFlecks +
  PROFILES.rich.goldDust +
  PROFILES.rich.fireflies +
  PROFILES.rich.lightPetals;

/** Keeps a particle in the same relative place while a canvas is being resized. */
export function remapBackgroundCoordinate(
  value: number,
  previousExtent: number,
  nextExtent: number,
): number {
  if (!Number.isFinite(value)) return 0;
  if (!Number.isFinite(previousExtent) || previousExtent <= 0) return value;
  if (!Number.isFinite(nextExtent) || nextExtent <= 0) return value;
  return value * (nextExtent / previousExtent);
}
