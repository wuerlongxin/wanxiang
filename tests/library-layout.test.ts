import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  LIBRARY_PAGINATION_RESERVE,
  LIBRARY_ROW_HEIGHT,
  LIBRARY_ROW_PITCH,
  LIBRARY_ROWS_TOP,
  LIBRARY_THUMBNAIL_WIDTH,
  getLibraryPageSize,
  getLibraryRowLayout,
  getLibraryRowsHeight,
  type LibraryLayoutRect,
} from '../src/scenes/library-layout.ts';

function overlaps(left: LibraryLayoutRect, right: LibraryLayoutRect): boolean {
  return !(
    left.x + left.width <= right.x
    || right.x + right.width <= left.x
    || left.y + left.height <= right.y
    || right.y + right.height <= left.y
  );
}

function assertInside(
  inner: LibraryLayoutRect,
  width: number,
  height: number,
  label: string,
): void {
  assert.ok(inner.x >= 0, `${label} left`);
  assert.ok(inner.y >= 0, `${label} top`);
  assert.ok(inner.x + inner.width <= width, `${label} right`);
  assert.ok(inner.y + inner.height <= height, `${label} bottom`);
}

test('uses CardView minimum dimensions and separates every row region at wide and narrow widths', () => {
  const cardViewSource = readFileSync(
    new URL('../src/card-view.ts', import.meta.url),
    'utf8',
  );
  const minimumWidthMatch = cardViewSource.match(/const MIN_CARD_WIDTH = (\d+);/u);
  assert.ok(minimumWidthMatch, 'CardView minimum width remains discoverable');
  assert.equal(Number(minimumWidthMatch[1]), LIBRARY_THUMBNAIL_WIDTH);
  assert.equal(LIBRARY_ROW_HEIGHT, 112);
  assert.equal(LIBRARY_ROW_PITCH, 118);

  for (const listWidth of [372, 320, 280]) {
    const layout = getLibraryRowLayout(listWidth);
    const row = { x: 0, y: 0, width: layout.rowWidth, height: layout.rowHeight };
    const regions = [
      ['thumbnail', layout.thumbnail],
      ['name', layout.name],
      ['meta', layout.meta],
      ['source', layout.source],
      ['divider', layout.divider],
      ['showcase', layout.showcase],
      ['open', layout.open],
      ['selection', layout.selectionBar],
    ] as const;
    regions.forEach(([label, region]) => assertInside(region, row.width, row.height, `${listWidth}:${label}`));

    assert.equal(layout.thumbnail.width, LIBRARY_THUMBNAIL_WIDTH);
    assert.ok(
      Math.abs(layout.thumbnail.height - LIBRARY_THUMBNAIL_WIDTH * 88 / 63) < 1e-9,
      `${listWidth}: thumbnail keeps the CardView aspect ratio`,
    );
    assert.ok(
      Math.abs(
        layout.thumbnail.y + layout.thumbnail.height / 2 - layout.rowHeight / 2,
      ) < 1e-9,
      `${listWidth}: thumbnail is vertically centered`,
    );
    assert.ok(
      layout.name.x >= layout.thumbnail.x + layout.thumbnail.width + 12,
      `${listWidth}: information clears thumbnail`,
    );
    assert.equal(layout.meta.x, layout.name.x);
    assert.equal(layout.source.x, layout.name.x);
    assert.ok(layout.showcase.x >= layout.name.x, `${listWidth}: showcase stays in information column`);
    assert.ok(layout.open.x >= layout.name.x, `${listWidth}: open stays in information column`);

    for (let leftIndex = 0; leftIndex < regions.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < regions.length; rightIndex += 1) {
        const [leftLabel, left] = regions[leftIndex];
        const [rightLabel, right] = regions[rightIndex];
        assert.equal(
          overlaps(left, right),
          false,
          `${listWidth}: ${leftLabel}/${rightLabel}`,
        );
      }
    }
  }
});

test('fits complete rows above pagination at 1920x1280 and shorter windows', () => {
  for (const listHeight of [1128, 748, 488, 410]) {
    const pageSize = getLibraryPageSize(listHeight);
    const rowsHeight = getLibraryRowsHeight(pageSize);
    const available = listHeight - LIBRARY_ROWS_TOP - LIBRARY_PAGINATION_RESERVE;

    assert.ok(pageSize >= 1, `${listHeight}: at least one row`);
    assert.ok(rowsHeight <= available || pageSize === 1, `${listHeight}: rows fit`);
    if (pageSize > 1) {
      assert.ok(
        getLibraryRowsHeight(pageSize + 1) > available,
        `${listHeight}: page size uses the available height`,
      );
    }
  }

  assert.deepEqual(
    [1128, 748, 488, 410].map((height) => getLibraryPageSize(height)),
    [8, 5, 3, 2],
  );
});

test('library scene applies the stable layout, clips every text row, and emphasizes selection', () => {
  const source = readFileSync(
    new URL('../src/scenes/library.ts', import.meta.url),
    'utf8',
  );

  assert.match(source, /const nextPageSize = getLibraryPageSize\(listHeight\)/u);
  assert.match(source, /const layout = getLibraryRowLayout\(width\)/u);
  assert.match(source, /fitTextWidth\(row\.name, row\.nameValue, layout\.name\.width\)/u);
  assert.match(source, /fitTextWidth\(row\.meta, row\.metaValue, layout\.meta\.width\)/u);
  assert.match(source, /fitTextWidth\(row\.source, row\.sourceValue, layout\.source\.width\)/u);
  assert.match(source, /stroke\(\{ color: selected \? accent : COLORS\.line, width: selected \? 1\.5 : 1/u);
  assert.match(source, /layout\.selectionBar\.height/u);
  assert.match(source, /row\.root\.alpha = selected \? 1 : 0\.94/u);
});
