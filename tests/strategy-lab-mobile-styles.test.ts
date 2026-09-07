import { readFileSync } from "node:fs";
import postcss, { type AtRule, type Rule } from "postcss";
import { describe, expect, it } from "vitest";

const panels = postcss.parse(readFileSync("src/app/strategy-lab/strategy-lab.module.css", "utf8"));
const controls = postcss.parse(readFileSync("src/app/strategy-lab/backtest-workspace.module.css", "utf8"));

// Checks source-order contracts for these exact module selectors, not browser
// computed layout, specificity across stylesheets, touch behavior or Web Vitals.
function declarationsAt(sheet: postcss.Root, selector: string, width: number) {
  const result: Record<string, string> = {};
  sheet.walkRules((rule: Rule) => {
    if (!rule.selectors.includes(selector)) return;
    for (let parent: postcss.Node | undefined = rule.parent; parent; parent = parent.parent) {
      if (parent.type !== "atrule" || (parent as AtRule).name !== "media") continue;
      const params = (parent as AtRule).params;
      const max = params.match(/max-width:\s*(\d+)px/), min = params.match(/min-width:\s*(\d+)px/);
      if (max && width > Number(max[1]) || min && width < Number(min[1])) return;
    }
    rule.walkDecls(declaration => { result[declaration.prop] = declaration.value; });
  });
  return result;
}

describe("Strategy Lab responsive stylesheet contracts (not visual QA)", () => {
  it.each([320, 379, 768])("allows long status values to wrap in bounded columns at %ipx", width => {
    expect(declarationsAt(panels, ".page", width)["overflow-wrap"]).toBe("anywhere");
    expect(declarationsAt(panels, ".metrics", width)["grid-template-columns"]).toBe("repeat(2, minmax(0, 1fr))");
  });
  it.each([320, 379, 768])("keeps mobile form text readable at %ipx", width => {
    for (const selector of [".controlCard input", ".controlCard select", ".resultPicker select"]) {
      expect(declarationsAt(controls, selector, width)["font-size"]).toBe("16px");
    }
    expect(declarationsAt(controls, ".controlCard input", width).font).toBeUndefined();
  });
  it("retains desktop form sizes and bounded metric columns", () => {
    expect(declarationsAt(controls, ".controlCard input", 1440)["font-size"]).toBe("13px");
    expect(declarationsAt(panels, ".metrics", 1440)["grid-template-columns"]).toBe("repeat(3, minmax(0, 1fr))");
  });
  it.each([320, 379])("does not override compact chart padding with later base rules at %ipx", width => {
    expect(declarationsAt(panels, ".visualGrid", width).padding).toBe("14px");
    expect(declarationsAt(panels, ".chart", width).padding).toBe("18px");
    expect(declarationsAt(panels, ".tradeLedger", width).padding).toBe("18px");
    expect(declarationsAt(panels, ".ranking div", width)["flex-direction"]).toBe("column");
  });
  it("preserves normal chart spacing at tablet and desktop widths", () => {
    for (const width of [768, 1440]) {
      expect(declarationsAt(panels, ".visualGrid", width).padding).toBe("20px");
      expect(declarationsAt(panels, ".chart", width).padding).toBe("24px");
    }
  });
  it("shows full selection details and wraps action messages without ellipsis", () => {
    const detail = declarationsAt(controls, ".selectionDetail", 320);
    expect(detail.display).toBe("block");
    expect(detail["overflow-wrap"]).toBe("anywhere");
    expect(detail["white-space"]).toBe("normal");
    expect(detail["text-overflow"]).toBeUndefined();
    for (const selector of [".actionSuccess", ".actionWarning", ".actionError"]) {
      expect(declarationsAt(controls, selector, 320)["overflow-wrap"]).toBe("anywhere");
    }
  });
  it("keeps ledger values separate from wrapped timestamps", () => {
    expect(declarationsAt(panels, ".tradeLedger div", 320)["grid-template-columns"]).toBe("minmax(0, 1fr) auto");
    expect(declarationsAt(panels, ".tradeLedger", 320).overflow).toBe("auto");
  });
});
