import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getExchangeActivityGrid,
  getExchangeIdentityControls,
  getExchangeLayout,
  getExchangeOfferControls,
  getExchangePeerCapacity,
  getExchangePeerRowLayout,
  getLegacyExchangeMainHeight,
  type ExchangeRect,
} from '../src/scenes/exchange-layout.ts';
import { getViewport } from '../src/utils.ts';

const VIEWPORT_MATRIX = [
  [320, 568, true],
  [390, 640, true],
  [390, 844, true],
  [768, 1024, true],
  [960, 640, true],
  [896, 414, true],
  [1280, 540, true],
  [1440, 900, false],
] as const;

function assertFiniteRect(rect: ExchangeRect, label: string): void {
  for (const [key, value] of Object.entries(rect)) {
    assert.ok(Number.isFinite(value), `${label}.${key} must be finite`);
  }
  assert.ok(rect.width >= 0, `${label}.width must be non-negative`);
  assert.ok(rect.height >= 0, `${label}.height must be non-negative`);
  assert.equal(rect.right, rect.x + rect.width, `${label}.right`);
  assert.equal(rect.bottom, rect.y + rect.height, `${label}.bottom`);
}

function assertInside(rect: ExchangeRect, bounds: ExchangeRect, label: string): void {
  assertFiniteRect(rect, label);
  assert.ok(rect.x >= bounds.x - 1e-6, `${label}.x must stay inside`);
  assert.ok(rect.y >= bounds.y - 1e-6, `${label}.y must stay inside`);
  assert.ok(rect.right <= bounds.right + 1e-6, `${label}.right must stay inside`);
  assert.ok(rect.bottom <= bounds.bottom + 1e-6, `${label}.bottom must stay inside`);
}

function localBounds(width: number, height: number): ExchangeRect {
  return { x: 0, y: 0, width, height, right: width, bottom: height };
}

test('switches the exchange scene to tabs whenever width or legacy height is constrained', () => {
  for (const [width, height, responsive] of VIEWPORT_MATRIX) {
    const viewport = getViewport(width, height, 1);
    const layout = getExchangeLayout(viewport);
    assert.equal(layout.responsive, responsive, `${width}x${height}`);
  }
});

test('keeps the 900px and 420px thresholds strict', () => {
  assert.equal(getExchangeLayout(getViewport(899, 900, 1)).responsive, true);
  assert.equal(getExchangeLayout(getViewport(900, 900, 1)).responsive, false);

  const heightAt420 = (420 + 178) / 0.81;
  assert.ok(Math.abs(getLegacyExchangeMainHeight(heightAt420) - 420) < 1e-9);
  assert.equal(getExchangeLayout(getViewport(1200, heightAt420 - 1, 1)).responsive, true);
  assert.equal(getExchangeLayout(getViewport(1200, heightAt420 + 1, 1)).responsive, false);
});

test('keeps headers, tabs, and every section inside the canvas', () => {
  for (const [width, height, responsive] of VIEWPORT_MATRIX) {
    const viewport = getViewport(width, height, 1);
    const layout = getExchangeLayout(viewport);
    const canvas = localBounds(width, height);
    assertInside(layout.header, canvas, `${width}x${height} header`);
    assertInside(layout.main, canvas, `${width}x${height} main`);

    if (responsive) {
      assert.ok(layout.tabs, `${width}x${height} tabs`);
      assertInside(layout.tabs, canvas, `${width}x${height} tabs`);
      assert.ok(layout.header.bottom <= layout.tabs.y, `${width}x${height} header/tabs overlap`);
      assert.ok(layout.tabs.bottom <= layout.main.y, `${width}x${height} tabs/main overlap`);
      assert.ok(
        layout.tabs.width / 4 >= viewport.profile.minimumTouchSize,
        `${width}x${height} tab segments must remain clickable`,
      );
      for (const section of Object.values(layout.sections)) {
        assert.deepEqual(section, layout.main, `${width}x${height} responsive sections share the panel`);
      }
    } else {
      assert.equal(layout.tabs, undefined);
      for (const [name, section] of Object.entries(layout.sections)) {
        assertInside(section, canvas, `${width}x${height} ${name}`);
      }
    }
  }
});

test('keeps nearby and manual identity actions mutually exclusive and on-panel', () => {
  for (const [width, height, responsive] of VIEWPORT_MATRIX.filter((entry) => entry[2])) {
    const layout = getExchangeLayout(getViewport(width, height, 1));
    const panel = layout.sections.identity;
    const bounds = localBounds(panel.width, panel.height);
    const nearby = getExchangeIdentityControls(panel.width, panel.height, false, responsive);
    const manual = getExchangeIdentityControls(panel.width, panel.height, true, responsive);

    assert.ok(nearby.copyCode, `${width}x${height} nearby copy action`);
    assert.equal(nearby.manualInput, undefined);
    assert.equal(nearby.connectButton, undefined);
    assert.equal(manual.copyCode, undefined);
    assert.ok(manual.manualInput, `${width}x${height} manual input`);
    assert.ok(manual.connectButton, `${width}x${height} manual connect action`);

    assertInside(nearby.connectionMode, bounds, `${width}x${height} nearby mode`);
    assertInside(nearby.nodeToggle, bounds, `${width}x${height} nearby node toggle`);
    assertInside(nearby.copyCode, bounds, `${width}x${height} copy`);
    assertInside(manual.nodeToggle, bounds, `${width}x${height} manual node toggle`);
    assertInside(manual.connectionMode, bounds, `${width}x${height} manual mode`);
    assertInside(manual.manualInput, bounds, `${width}x${height} input`);
    assertInside(manual.connectButton, bounds, `${width}x${height} connect`);
    assert.equal(nearby.copyCode.x, nearby.connectionMode.x);
    assert.equal(manual.manualInput.x, manual.connectionMode.x);
    assert.equal(manual.connectButton.x, manual.connectionMode.x);
    assert.ok(nearby.nodeToggle.bottom <= nearby.connectionMode.y);
    assert.ok(manual.nodeToggle.bottom <= manual.connectionMode.y);
    assert.ok(manual.connectionMode.bottom <= manual.manualInput.y);
    assert.ok(manual.manualInput.bottom <= manual.connectButton.y);
    assert.ok(manual.connectButton.height >= 44);
    assert.ok(nearby.nodeToggle.height >= 38);
  }
});

test('keeps the responsive card and all send actions visible without overlap', () => {
  for (const [width, height, responsive] of VIEWPORT_MATRIX.filter((entry) => entry[2])) {
    const layout = getExchangeLayout(getViewport(width, height, 1));
    const panel = layout.sections.offer;
    const bounds = localBounds(panel.width, panel.height);
    const controls = getExchangeOfferControls(panel.width, panel.height);

    assert.ok(controls.card.width > 0, `${width}x${height} card width`);
    assertInside(controls.card, bounds, `${width}x${height} card`);
    assertInside(controls.details, bounds, `${width}x${height} details`);
    assertInside(controls.deckSelect, bounds, `${width}x${height} deck select`);
    assertInside(controls.recipient, bounds, `${width}x${height} recipient`);
    assertInside(controls.send, bounds, `${width}x${height} send`);
    assert.ok(controls.card.right <= controls.details.x, `${width}x${height} card/details overlap`);
    assert.ok(controls.deckSelect.bottom <= controls.recipient.y, `${width}x${height} select/recipient overlap`);
    assert.ok(controls.recipient.bottom <= controls.send.y, `${width}x${height} recipient/send overlap`);
    assert.ok(controls.send.height >= 44, `${width}x${height} send touch height`);
  }
});

test('sizes peer rows and responsive activity actions from the real panel bounds', () => {
  for (const [width, height, responsive] of VIEWPORT_MATRIX) {
    const layout = getExchangeLayout(getViewport(width, height, 1));
    const peerPanel = layout.sections.peers;
    const peerBounds = localBounds(peerPanel.width, peerPanel.height);
    const peerCapacity = getExchangePeerCapacity(peerPanel.height, responsive);
    if (peerCapacity > 0) {
      const lastPeer = getExchangePeerRowLayout(peerPanel.width, peerCapacity - 1, responsive);
      assertInside(lastPeer.row, peerBounds, `${width}x${height} last peer row`);
      assertInside(lastPeer.selectButton, peerBounds, `${width}x${height} peer select`);
    }

    const activityPanel = layout.sections.activity;
    const activityBounds = localBounds(activityPanel.width, activityPanel.height);
    const grid = getExchangeActivityGrid(activityPanel.width, activityPanel.height, responsive);
    if (responsive && activityPanel.width <= 520) assert.equal(grid.columns, 1);
    for (let index = 0; index < grid.capacity; index += 1) {
      const column = index % grid.columns;
      const rowX = grid.side + column * (grid.rowWidth + grid.columnGap);
      const rowY = grid.rowsTop + Math.floor(index / grid.columns) * grid.rowStride;
      const row = {
        x: rowX,
        y: rowY,
        width: grid.rowWidth,
        height: 62,
        right: rowX + grid.rowWidth,
        bottom: rowY + 62,
      };
      assertInside(row, activityBounds, `${width}x${height} activity row ${index}`);
      if (responsive) {
        const decline = {
          x: row.right - 152,
          y: row.y + 29,
          width: 72,
          height: 34,
          right: row.right - 80,
          bottom: row.y + 63,
        };
        const accept = {
          x: row.right - 72,
          y: row.y + 29,
          width: 72,
          height: 34,
          right: row.right,
          bottom: row.y + 63,
        };
        assertInside(decline, activityBounds, `${width}x${height} decline ${index}`);
        assertInside(accept, activityBounds, `${width}x${height} accept ${index}`);
        assert.ok(decline.x >= row.x, `${width}x${height} decline must not use a negative row offset`);
      }
    }
  }
});
