import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_RENDER_PIXEL_BUDGET,
  getRecommendedDpr,
  getViewport,
  getViewportProfile,
  getViewportRegions,
} from '../src/utils.ts';

test('classifies the supported viewport matrix without conflating width and height pressure', () => {
  const cases = [
    [320, 568, 'xs', 'phone-portrait', 'dense', true, false],
    [390, 640, 'sm', 'phone-portrait', 'dense', true, false],
    [390, 844, 'sm', 'phone-portrait', 'dense', true, false],
    [768, 1024, 'md', 'tablet', 'regular', true, false],
    [960, 640, 'lg', 'compact-desktop', 'dense', true, false],
    [1440, 900, 'xl', 'desktop', 'spacious', false, false],
    [2560, 1080, 'xxl', 'wide', 'spacious', false, true],
  ] as const;

  for (const [width, height, breakpoint, id, density, compact, ultraWide] of cases) {
    const profile = getViewportProfile(width, height);
    assert.equal(profile.breakpoint, breakpoint, `${width}x${height} breakpoint`);
    assert.equal(profile.id, id, `${width}x${height} profile`);
    assert.equal(profile.density, density, `${width}x${height} density`);
    assert.equal(profile.compact, compact, `${width}x${height} compact mode`);
    assert.equal(profile.ultraWide, ultraWide, `${width}x${height} ultrawide mode`);
  }
});

test('recognizes landscape phones and short desktop windows as distinct profiles', () => {
  const phone = getViewportProfile(896, 414);
  assert.equal(phone.id, 'phone-landscape');
  assert.equal(phone.phone, true);
  assert.equal(phone.orientation, 'landscape');
  assert.equal(phone.minimumTouchSize, 44);

  const shortDesktop = getViewportProfile(1280, 540);
  assert.equal(shortDesktop.id, 'compact-desktop');
  assert.equal(shortDesktop.phone, false);
  assert.equal(shortDesktop.lowHeight, true);
  assert.equal(shortDesktop.density, 'dense');
});

test('merges platform safe-area insets with the profile breathing room', () => {
  const viewport = getViewport(390, 844, 1.5, {
    safeArea: { top: 47, right: 22, bottom: 34, left: 0 },
  });

  assert.deepEqual(viewport.safeArea, {
    top: 47,
    right: 22,
    bottom: 34,
    left: 12,
  });
  assert.deepEqual(viewport.safeRect, {
    x: 12,
    y: 47,
    width: 356,
    height: 763,
    right: 368,
    bottom: 810,
  });
  assert.equal(viewport.usableWidth, 356);
  assert.equal(viewport.usableHeight, 763);
});

test('reports minimum-size pressure without falsifying the physical canvas size', () => {
  const viewport = getViewport(280, 480, 2);

  assert.equal(viewport.width, 280);
  assert.equal(viewport.height, 480);
  assert.deepEqual(viewport.minimums, {
    width: 320,
    height: 520,
    widthDeficit: 40,
    heightDeficit: 40,
    fitScale: 0.875,
    met: false,
  });
});

test('partitions a 320x568 canvas into non-overlapping navigation and content regions', () => {
  const viewport = getViewport(320, 568, 1.5);
  const regions = getViewportRegions(viewport);

  assert.deepEqual(regions.safe, {
    x: 12,
    y: 12,
    width: 296,
    height: 540,
    right: 308,
    bottom: 552,
  });
  assert.deepEqual(regions.header, {
    x: 12,
    y: 0,
    width: 296,
    height: 56,
    right: 308,
    bottom: 56,
  });
  assert.deepEqual(regions.body, {
    x: 12,
    y: 64,
    width: 296,
    height: 488,
    right: 308,
    bottom: 552,
  });
  assert.deepEqual(regions.content, regions.body);
  assert.equal(regions.meetsMinimum, true);
  assert.equal(regions.fitScale, 1);
});

test('centers capped content and exposes a virtual minimum for complex scenes', () => {
  const viewport = getViewport(1440, 900, 2);
  const regions = getViewportRegions(viewport, {
    headerHeight: 64,
    footerHeight: 72,
    gap: 16,
    inset: { top: 12, right: 20, bottom: 12, left: 20 },
    maxContentWidth: 1000,
    minimumContentSize: { width: 1100, height: 760 },
  });

  assert.deepEqual(regions.footer, {
    x: 24,
    y: 808,
    width: 1392,
    height: 72,
    right: 1416,
    bottom: 880,
  });
  assert.deepEqual(regions.content, {
    x: 220,
    y: 92,
    width: 1000,
    height: 688,
    right: 1220,
    bottom: 780,
  });
  assert.deepEqual(regions.layoutSize, { width: 1100, height: 760 });
  assert.equal(regions.meetsMinimum, false);
  assert.ok(Math.abs(regions.fitScale - (688 / 760)) < Number.EPSILON);
});

test('low-height regions collapse safely and return a usable fit scale', () => {
  const viewport = getViewport(1280, 420, 1.5);
  const regions = getViewportRegions(viewport);

  assert.equal(viewport.lowHeight, true);
  assert.equal(regions.content.y, 76);
  assert.equal(regions.content.bottom, 400);
  assert.equal(regions.content.height, 324);
  assert.equal(regions.meetsMinimum, false);
  assert.equal(regions.fitScale, 0.81);
});

test('recommends a DPR that respects phone caps and the ultrawide pixel budget', () => {
  assert.equal(getRecommendedDpr(320, 568, 3), 1.5);
  assert.equal(getRecommendedDpr(1440, 900, 3), 2);
  assert.equal(getRecommendedDpr(1440, 900, 0.5), 0.5);

  const ultrawideDpr = getRecommendedDpr(2560, 1080, 3);
  assert.equal(ultrawideDpr, 1.25);
  assert.ok(2560 * 1080 * ultrawideDpr ** 2 <= DEFAULT_RENDER_PIXEL_BUDGET);

  const viewport = getViewport(2560, 1080, 2, { devicePixelRatio: 3 });
  assert.equal(viewport.recommendedDpr, ultrawideDpr);
  assert.equal(viewport.renderDensity, 'balanced');
});
