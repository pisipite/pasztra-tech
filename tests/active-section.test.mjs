import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source = await readFile(new URL("../src/activeSection.ts", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext } });
const { activeSectionAt } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`);

test("the cover does not mark the first section as active prematurely", () => {
  assert.equal(activeSectionAt([{ id: "energia", top: 600 }], 84), undefined);
  assert.equal(activeSectionAt([], 84), undefined);
});
test("the heading passing the sticky toolbar activates its section", () => {
  assert.equal(activeSectionAt([{ id: "energia", top: 84 }, { id: "klima", top: 500 }], 84), "energia");
});
test("selection follows scrolling down and back up, including inter-section space", () => {
  assert.equal(activeSectionAt([{ id: "energia", top: -800 }, { id: "klima", top: 80 }], 84), "klima");
  assert.equal(activeSectionAt([{ id: "energia", top: -700 }, { id: "klima", top: 180 }], 84), "energia");
});
test("actual visual order wins over registry order and invalid positions are ignored", () => {
  assert.equal(activeSectionAt([{ id: "klima", top: 10 }, { id: "bad", top: NaN }, { id: "energia", top: -800 }], 84), "klima");
});
test("a taller active status bar is included in the reading line", () => {
  const positions = [{ id: "energia", top: -600 }, { id: "klima", top: 110 }];
  assert.equal(activeSectionAt(positions, 84), "energia");
  assert.equal(activeSectionAt(positions, 124), "klima");
});
