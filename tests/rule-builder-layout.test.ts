import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  planRuleStackMetaLayout,
  planRuleStackRowLayout,
  type RuleStackControl,
} from '../src/scenes/rule-builder-layout.ts';

const ruleBuilderSource = readFileSync(
  new URL('../src/scenes/rule-builder.ts', import.meta.url),
  'utf8',
);

interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

function overlaps(left: Rect, right: Rect): boolean {
  return !(
    left.right <= right.left
    || right.right <= left.left
    || left.bottom <= right.top
    || right.bottom <= left.top
  );
}

test('keeps all four rule-stack category labels visible and responsive', () => {
  for (const panelWidth of [160, 180, 292, 296, 326, 327, 332, 372]) {
    const layout = planRuleStackMetaLayout(panelWidth);
    const bounds = layout.positions.map((position) => ({
      left: position.x,
      top: position.y,
      right: position.x + layout.buttonWidth,
      bottom: position.y + layout.buttonHeight,
    }));

    assert.equal(bounds.length, 4);
    assert.ok(layout.buttonWidth >= 72, `${panelWidth}px panel retains readable button width`);
    assert.ok(bounds.every((bound) => bound.left >= 12 && bound.right <= panelWidth - 12));
    assert.ok(bounds.every((bound) => bound.bottom < layout.rowsTop));
    for (let leftIndex = 0; leftIndex < bounds.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < bounds.length; rightIndex += 1) {
        assert.equal(overlaps(bounds[leftIndex], bounds[rightIndex]), false);
      }
    }
  }

  assert.equal(planRuleStackMetaLayout(372).columns, 4);
  assert.equal(planRuleStackMetaLayout(372).rowsTop, 112);
  assert.equal(planRuleStackMetaLayout(296).columns, 2);
  assert.equal(planRuleStackMetaLayout(296).rowsTop, 151);
  assert.equal(planRuleStackMetaLayout(160).columns, 1);

  for (const button of ['playerButton', 'durationButton', 'ageButton', 'teamButton']) {
    const constructorStart = ruleBuilderSource.indexOf(`this.${button} = new CanvasButton({`);
    const constructorEnd = ruleBuilderSource.indexOf('\n    });', constructorStart);
    assert.ok(constructorStart >= 0 && constructorEnd > constructorStart);
    const constructorSource = ruleBuilderSource.slice(constructorStart, constructorEnd);
    assert.match(constructorSource, /label: '',\s*iconOnly: false/u);
  }
});

test('keeps rule-stack text readable and controls separated across responsive panel widths', () => {
  const controlNames: RuleStackControl[] = ['edit', 'toggle', 'up', 'down', 'remove'];

  for (const panelWidth of [292, 296, 332, 372]) {
    const layout = planRuleStackRowLayout(panelWidth);
    assert.ok(layout.contentWidth >= 98, `${panelWidth}px panel should retain readable text width`);
    assert.ok(layout.rowStride >= layout.rowHeight + 6);

    const textBounds: Rect = {
      left: layout.contentX,
      top: 0,
      right: layout.contentX + layout.contentWidth,
      bottom: layout.rowHeight,
    };
    const controls = controlNames.map((name) => {
      const position = layout.controls[name];
      const bounds = {
        left: position.x,
        top: position.y,
        right: position.x + layout.controlSize,
        bottom: position.y + layout.controlSize,
      };
      assert.ok(bounds.left >= 0 && bounds.top >= 0, `${name} starts inside the row`);
      assert.ok(bounds.right <= layout.rowWidth, `${name} ends inside the row`);
      assert.ok(bounds.bottom <= layout.rowHeight, `${name} fits vertically`);
      assert.equal(overlaps(textBounds, bounds), false, `${name} does not cover text`);
      return { name, bounds };
    });

    for (let leftIndex = 0; leftIndex < controls.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < controls.length; rightIndex += 1) {
        assert.equal(
          overlaps(controls[leftIndex].bounds, controls[rightIndex].bounds),
          false,
          `${controls[leftIndex].name} and ${controls[rightIndex].name} do not overlap`,
        );
      }
    }
  }
});

test('keeps enabled and disabled rule-stack copy at a legible game-UI treatment', () => {
  assert.match(
    ruleBuilderSource,
    /makeText\(module\.name, 13, COLORS\.paper, '700', true\)/u,
  );
  assert.match(
    ruleBuilderSource,
    /makeText\(module\.summary, 10, COLORS\.paperMuted, '500'\)/u,
  );
  assert.match(ruleBuilderSource, /row\.root\.alpha = 1;/u);
  assert.match(
    ruleBuilderSource,
    /row\.name\.style\.fill = row\.module\.enabled \? COLORS\.paper : COLORS\.paperMuted/u,
  );
  assert.match(ruleBuilderSource, /row\.summary\.style\.fill = COLORS\.paperMuted/u);
});
