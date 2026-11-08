import type {
  Viewport,
  ViewportBreakpoint,
  ViewportDensity,
  ViewportInsets,
  ViewportMinimums,
  ViewportOptions,
  ViewportOrientation,
  ViewportProfile,
  ViewportProfileId,
  ViewportRect,
  ViewportRegionOptions,
  ViewportRegions,
  ViewportRenderDensity,
  ViewportSize,
} from './types';

export const VIEWPORT_BREAKPOINTS = {
  xs: 0,
  sm: 360,
  md: 620,
  lg: 900,
  xl: 1200,
  xxl: 1800,
} as const;

export const DEFAULT_MINIMUM_VIEWPORT: Readonly<ViewportSize> = {
  width: 320,
  height: 520,
};

export const DEFAULT_MINIMUM_CONTENT: Readonly<ViewportSize> = {
  width: 288,
  height: 400,
};

export const DEFAULT_RENDER_PIXEL_BUDGET = 5_500_000;

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function lerp(start: number, end: number, amount: number): number {
  return start + (end - start) * amount;
}

export function easeOutCubic(value: number): number {
  return 1 - Math.pow(1 - value, 3);
}

export function easeInOutCubic(value: number): number {
  return value < 0.5 ? 4 * value * value * value : 1 - Math.pow(-2 * value + 2, 3) / 2;
}

export function hexToNumber(value: string): number {
  return Number.parseInt(value.replace('#', ''), 16);
}

export function randomRange(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function finitePositive(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) && (value ?? 0) > 0 ? value as number : fallback;
}

function finiteNonNegative(value: number | undefined, fallback = 0): number {
  return Number.isFinite(value) && (value ?? -1) >= 0 ? value as number : fallback;
}

function getBreakpoint(width: number): ViewportBreakpoint {
  if (width < VIEWPORT_BREAKPOINTS.sm) return 'xs';
  if (width < VIEWPORT_BREAKPOINTS.md) return 'sm';
  if (width < VIEWPORT_BREAKPOINTS.lg) return 'md';
  if (width < VIEWPORT_BREAKPOINTS.xl) return 'lg';
  if (width < VIEWPORT_BREAKPOINTS.xxl) return 'xl';
  return 'xxl';
}

function getOrientation(width: number, height: number): ViewportOrientation {
  const squareTolerance = Math.max(width, height) * 0.05;
  if (Math.abs(width - height) <= squareTolerance) return 'square';
  return width > height ? 'landscape' : 'portrait';
}

interface ProfileMetrics {
  gutter: number;
  gap: number;
  navigationHeight: number;
  minimumTouchSize: number;
  maxContentWidth: number;
}

const PROFILE_METRICS: Record<ViewportProfileId, ProfileMetrics> = {
  'phone-portrait': {
    gutter: 12,
    gap: 8,
    navigationHeight: 56,
    minimumTouchSize: 44,
    maxContentWidth: 560,
  },
  'phone-landscape': {
    gutter: 12,
    gap: 8,
    navigationHeight: 56,
    minimumTouchSize: 44,
    maxContentWidth: 900,
  },
  tablet: {
    gutter: 20,
    gap: 12,
    navigationHeight: 64,
    minimumTouchSize: 44,
    maxContentWidth: 960,
  },
  'compact-desktop': {
    gutter: 20,
    gap: 12,
    navigationHeight: 64,
    minimumTouchSize: 42,
    maxContentWidth: 1120,
  },
  desktop: {
    gutter: 24,
    gap: 16,
    navigationHeight: 64,
    minimumTouchSize: 42,
    maxContentWidth: 1440,
  },
  wide: {
    gutter: 32,
    gap: 18,
    navigationHeight: 64,
    minimumTouchSize: 44,
    maxContentWidth: 1600,
  },
};

/**
 * Produces stable layout traits from logical CSS pixels. Width breakpoints and
 * height pressure stay independent, so a wide but shallow window remains dense.
 */
export function getViewportProfile(width: number, height: number): ViewportProfile {
  const safeWidth = finitePositive(width, 1);
  const safeHeight = finitePositive(height, 1);
  const breakpoint = getBreakpoint(safeWidth);
  const orientation = getOrientation(safeWidth, safeHeight);
  const aspectRatio = safeWidth / safeHeight;
  const lowHeight = safeHeight < 600;
  const ultraWide = safeWidth >= 1440 && aspectRatio >= 2;
  const phoneLandscape = orientation === 'landscape' && safeHeight < 500 && safeWidth < 900;
  const phone = safeWidth < VIEWPORT_BREAKPOINTS.md || phoneLandscape;
  const tablet = !phone && (
    safeWidth < VIEWPORT_BREAKPOINTS.lg
    || (orientation === 'portrait' && safeWidth < 1024)
  );

  let id: ViewportProfileId;
  if (phone) {
    id = orientation === 'landscape' ? 'phone-landscape' : 'phone-portrait';
  } else if (tablet) {
    id = 'tablet';
  } else if (safeWidth >= VIEWPORT_BREAKPOINTS.xxl || ultraWide) {
    id = 'wide';
  } else if (safeWidth < VIEWPORT_BREAKPOINTS.xl || safeHeight < 720) {
    id = 'compact-desktop';
  } else {
    id = 'desktop';
  }

  const compact = phone || tablet || safeWidth < 1050 || safeHeight < 720;
  let density: ViewportDensity = 'regular';
  if (phone || lowHeight || id === 'compact-desktop') density = 'dense';
  else if (id === 'desktop' || id === 'wide') density = 'spacious';

  return {
    id,
    breakpoint,
    orientation,
    density,
    phone,
    tablet,
    desktop: !phone && !tablet,
    compact,
    lowHeight,
    ultraWide,
    ...PROFILE_METRICS[id],
  };
}

function normalizeInsets(
  value: Partial<ViewportInsets> | number | undefined,
  fallback: ViewportInsets,
): ViewportInsets {
  const requested = typeof value === 'number'
    ? { top: value, right: value, bottom: value, left: value }
    : value;
  return {
    top: Math.max(fallback.top, finiteNonNegative(requested?.top)),
    right: Math.max(fallback.right, finiteNonNegative(requested?.right)),
    bottom: Math.max(fallback.bottom, finiteNonNegative(requested?.bottom)),
    left: Math.max(fallback.left, finiteNonNegative(requested?.left)),
  };
}

function createRect(x: number, y: number, width: number, height: number): ViewportRect {
  const normalizedWidth = Math.max(0, finiteNonNegative(width));
  const normalizedHeight = Math.max(0, finiteNonNegative(height));
  return {
    x,
    y,
    width: normalizedWidth,
    height: normalizedHeight,
    right: x + normalizedWidth,
    bottom: y + normalizedHeight,
  };
}

function calculateMinimums(
  availableWidth: number,
  availableHeight: number,
  minimumSize: Partial<ViewportSize> | undefined,
  fallback: Readonly<ViewportSize>,
): ViewportMinimums {
  const width = finitePositive(minimumSize?.width, fallback.width);
  const height = finitePositive(minimumSize?.height, fallback.height);
  const widthDeficit = Math.max(0, width - availableWidth);
  const heightDeficit = Math.max(0, height - availableHeight);
  const fitScale = Math.min(1, availableWidth / width, availableHeight / height);
  return {
    width,
    height,
    widthDeficit,
    heightDeficit,
    fitScale: Math.max(0, fitScale),
    met: widthDeficit === 0 && heightDeficit === 0,
  };
}

/** Caps DPR by form factor and a physical-pixel budget to keep WebGL fill cost bounded. */
export function getRecommendedDpr(
  width: number,
  height: number,
  devicePixelRatio: number,
  pixelBudget = DEFAULT_RENDER_PIXEL_BUDGET,
): number {
  const safeWidth = finitePositive(width, 1);
  const safeHeight = finitePositive(height, 1);
  const safeDeviceDpr = finitePositive(devicePixelRatio, 1);
  const safePixelBudget = finitePositive(pixelBudget, DEFAULT_RENDER_PIXEL_BUDGET);
  const profile = getViewportProfile(safeWidth, safeHeight);
  const profileCap = profile.phone ? 1.5 : profile.tablet || profile.compact ? 1.75 : 2;
  const budgetCap = Math.sqrt(safePixelBudget / (safeWidth * safeHeight));
  const recommendation = Math.min(safeDeviceDpr, profileCap, budgetCap);
  const quantized = Math.floor(recommendation * 4) / 4;
  return quantized > 0 ? quantized : recommendation;
}

function getRenderDensity(dpr: number): ViewportRenderDensity {
  if (dpr >= 1.75) return 'high';
  if (dpr >= 1.25) return 'balanced';
  return 'economy';
}

export function getViewport(
  width: number,
  height: number,
  resolution: number,
  options: ViewportOptions = {},
): Viewport {
  const safeWidth = finitePositive(width, 1);
  const safeHeight = finitePositive(height, 1);
  const dpr = finitePositive(resolution, 1);
  const profile = getViewportProfile(safeWidth, safeHeight);
  const defaultSafeArea: ViewportInsets = {
    top: profile.phone ? 12 : 20,
    right: profile.gutter,
    bottom: profile.phone ? 16 : 20,
    left: profile.gutter,
  };
  const safeArea = normalizeInsets(options.safeArea, defaultSafeArea);
  const safeRect = createRect(
    Math.min(safeWidth, safeArea.left),
    Math.min(safeHeight, safeArea.top),
    Math.max(0, safeWidth - safeArea.left - safeArea.right),
    Math.max(0, safeHeight - safeArea.top - safeArea.bottom),
  );
  const recommendedDpr = getRecommendedDpr(
    safeWidth,
    safeHeight,
    options.devicePixelRatio ?? dpr,
    options.pixelBudget,
  );
  const minimums = calculateMinimums(
    safeWidth,
    safeHeight,
    options.minimumSize,
    DEFAULT_MINIMUM_VIEWPORT,
  );

  return {
    width: safeWidth,
    height: safeHeight,
    dpr,
    recommendedDpr,
    renderDensity: getRenderDensity(recommendedDpr),
    compact: profile.compact,
    phone: profile.phone,
    tablet: profile.tablet,
    desktop: profile.desktop,
    lowHeight: profile.lowHeight,
    ultraWide: profile.ultraWide,
    breakpoint: profile.breakpoint,
    orientation: profile.orientation,
    density: profile.density,
    profile,
    safeTop: safeArea.top,
    safeRight: safeArea.right,
    safeBottom: safeArea.bottom,
    safeLeft: safeArea.left,
    safeArea,
    safeRect,
    usableWidth: safeRect.width,
    usableHeight: safeRect.height,
    minimums,
  };
}

/**
 * Splits a viewport into navigation, content, and optional footer regions. The
 * returned content rectangle always stays on-screen; layoutSize and fitScale
 * describe the virtual minimum a complex scene may render before scaling down.
 */
export function getViewportRegions(
  viewport: Viewport,
  options: ViewportRegionOptions = {},
): ViewportRegions {
  const canvas = createRect(0, 0, viewport.width, viewport.height);
  const safe = createRect(
    viewport.safeRect.x,
    viewport.safeRect.y,
    viewport.safeRect.width,
    viewport.safeRect.height,
  );
  const gap = finiteNonNegative(options.gap, viewport.profile.gap);
  const headerHeight = Math.min(
    viewport.height,
    finiteNonNegative(options.headerHeight, viewport.profile.navigationHeight),
  );
  const footerHeight = Math.min(
    safe.height,
    finiteNonNegative(options.footerHeight),
  );
  const header = createRect(safe.x, 0, safe.width, headerHeight);
  const footer = createRect(
    safe.x,
    safe.bottom - footerHeight,
    safe.width,
    footerHeight,
  );
  const bodyTop = Math.min(safe.bottom, Math.max(safe.y, header.bottom + gap));
  const footerGap = footerHeight > 0 ? gap : 0;
  const bodyBottom = Math.max(bodyTop, footer.y - footerGap);
  const body = createRect(safe.x, bodyTop, safe.width, bodyBottom - bodyTop);
  const inset = normalizeInsets(options.inset, { top: 0, right: 0, bottom: 0, left: 0 });
  const insetX = Math.min(body.width, inset.left);
  const insetY = Math.min(body.height, inset.top);
  const insetWidth = Math.max(0, body.width - inset.left - inset.right);
  const insetHeight = Math.max(0, body.height - inset.top - inset.bottom);
  const maxContentWidth = finitePositive(options.maxContentWidth, viewport.profile.maxContentWidth);
  const contentWidth = Math.min(insetWidth, maxContentWidth);
  const content = createRect(
    body.x + insetX + Math.max(0, (insetWidth - contentWidth) / 2),
    body.y + insetY,
    contentWidth,
    insetHeight,
  );
  const minimums = calculateMinimums(
    content.width,
    content.height,
    options.minimumContentSize,
    DEFAULT_MINIMUM_CONTENT,
  );

  return {
    canvas,
    safe,
    header,
    body,
    content,
    footer,
    layoutSize: {
      width: Math.max(content.width, minimums.width),
      height: Math.max(content.height, minimums.height),
    },
    fitScale: minimums.fitScale,
    meetsMinimum: minimums.met,
  };
}

export function announce(message: string): void {
  const status = document.querySelector<HTMLDivElement>('#a11y-status');
  if (status) status.textContent = message;
}

export function getReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
