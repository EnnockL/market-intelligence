import { readFileSync } from "node:fs";
import { createElement, type AnchorHTMLAttributes } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import postcss, { type AtRule } from "postcss";

const navigation = vi.hoisted(() => ({ pathname: "/", pending: false }));
vi.mock("next/navigation", () => ({ usePathname: () => navigation.pathname }));
vi.mock("next/link", () => ({
  default: (props: AnchorHTMLAttributes<HTMLAnchorElement>) => createElement("a", props),
  useLinkStatus: () => ({ pending: navigation.pending }),
}));
import { restoreSidebarGroups, SidebarLinkContent, SidebarNav } from "@/components/sidebar-nav";
import { MobileNavigation, trapSidebarTab } from "@/components/mobile-navigation";

const css = postcss.parse(readFileSync("src/app/globals.css", "utf8"));
beforeEach(() => { navigation.pathname = "/"; navigation.pending = false; });

describe("sidebar navigation rendering and persisted groups", () => {
  it("preserves every workspace, intelligence and lab destination", () => {
    const html = renderToStaticMarkup(<SidebarNav />);
    const hrefs = [...html.matchAll(/href="([^"]+)"/g)].map(match => match[1]);
    expect(hrefs).toEqual(["/", "/paper", "/execution", "/watchlist", "/signals", "/research", "/agents", "/data-collection", "/fast-flow", "/jackpot", "/systems", "/simulation", "/replay", "/strategy-lab", "/strategy-validation", "/forecasts"]);
    expect(html).toContain('aria-label="Primary navigation"');
    expect(html.match(/aria-controls="sidebar-group-/g)).toHaveLength(3);
    expect(html.match(/role="status"/g)).toHaveLength(16);
  });
  it("keeps an accessible label when CSS collapses link text", () => {
    const html = renderToStaticMarkup(<SidebarNav />);
    expect(html).toContain('aria-label="Execution Guard" title="Execution Guard"');
    expect(html).toContain('class="nav-icon" aria-hidden="true"');
  });
  it("marks only the correct nested destination active", () => {
    navigation.pathname = "/strategy-validation/runs/123";
    const html = renderToStaticMarkup(<SidebarNav />);
    expect(html.match(/aria-current="page"/g)).toHaveLength(1);
    expect(html).toContain('aria-label="Strategy Validation" title="Strategy Validation" aria-current="page"');
  });
  it("does not confuse a common path prefix with a route segment", () => {
    navigation.pathname = "/paperwork";
    expect(renderToStaticMarkup(<SidebarNav />)).not.toContain('aria-current="page"');
  });
  it.each([null, "{invalid", "null", "[]", "false"])("invalid saved groups %s leave navigation usable", value => {
    expect(restoreSidebarGroups(value, "/unknown")).toEqual({ Workspace: true, Intelligence: true, "Labs & Replay": true });
  });
  it("accepts only known boolean settings and opens the active route's group", () => {
    expect(restoreSidebarGroups('{"Workspace":false,"Intelligence":"false","Labs & Replay":false,"unknown":false}', "/paper/123"))
      .toEqual({ Workspace: true, Intelligence: true, "Labs & Replay": false });
  });
  it("renders a fixed status slot with no spurious loading announcement when idle", () => {
    const html = renderToStaticMarkup(<SidebarLinkContent icon="E" label="Execution Guard" />);
    expect(html).toContain('class="sidebar-link-status" role="status" aria-live="polite" aria-atomic="true"');
    expect(html).toContain('data-pending="false"'); expect(html).not.toContain("Loading Execution Guard");
  });
  it("announces the pending destination and clears when Next finishes or cancels", () => {
    navigation.pending = true;
    expect(renderToStaticMarkup(<SidebarLinkContent icon="E" label="Execution Guard" />)).toContain("Loading Execution Guard");
    navigation.pending = false;
    expect(renderToStaticMarkup(<SidebarLinkContent icon="E" label="Execution Guard" />)).not.toContain("Loading Execution Guard");
  });
  it("retains native Link/prefetch behavior without a separate manual router transition", () => {
    const source = readFileSync("src/components/sidebar-nav.tsx", "utf8");
    expect(source).toContain("useLinkStatus");
    expect(source).not.toMatch(/prefetch=\{false\}|router\.push|preventDefault|setTimeout/);
  });
});

describe("mobile drawer keyboard boundary", () => {
  const node = (options: { hidden?: boolean; inert?: boolean; disabled?: boolean; tabIndex?: number } = {}) => ({
    tabIndex: options.tabIndex ?? 0, focus: vi.fn(), getClientRects: () => options.hidden ? [] : [{}],
    closest: () => options.inert ? {} : null, matches: () => !!options.disabled,
  });
  function fixture(activeIndex: number, options: Parameters<typeof node>[0][] = [{}, {}, {}]) {
    const nodes = options.map(node), sidebar = {
      querySelectorAll: () => nodes, ownerDocument: { activeElement: nodes[activeIndex] ?? null },
      contains: (value: unknown) => nodes.includes(value as ReturnType<typeof node>), focus: vi.fn(),
    };
    return { nodes, sidebar: sidebar as unknown as HTMLElement };
  }
  it("wraps Tab from last visible control to first", () => {
    const h = fixture(2), event = { key: "Tab", shiftKey: false, preventDefault: vi.fn() };
    trapSidebarTab(event, h.sidebar); expect(h.nodes[0].focus).toHaveBeenCalledOnce(); expect(event.preventDefault).toHaveBeenCalledOnce();
  });
  it("wraps Shift-Tab from first to last", () => {
    const h = fixture(0), event = { key: "Tab", shiftKey: true, preventDefault: vi.fn() };
    trapSidebarTab(event, h.sidebar); expect(h.nodes[2].focus).toHaveBeenCalledOnce();
  });
  it("leaves ordinary interior tabbing to the browser", () => {
    const h = fixture(1), event = { key: "Tab", shiftKey: false, preventDefault: vi.fn() };
    trapSidebarTab(event, h.sidebar); expect(event.preventDefault).not.toHaveBeenCalled();
  });
  it("excludes hidden, disabled, inert and negative-tabindex controls", () => {
    const h = fixture(-1, [{ hidden: true }, { disabled: true }, { inert: true }, { tabIndex: -1 }, {}]);
    trapSidebarTab({ key: "Tab", shiftKey: false, preventDefault: vi.fn() }, h.sidebar);
    expect(h.nodes[4].focus).toHaveBeenCalledOnce(); h.nodes.slice(0, 4).forEach(item => expect(item.focus).not.toHaveBeenCalled());
  });
  it("retains focus on the drawer if no controls are focusable", () => {
    const h = fixture(-1, [{ hidden: true }]);
    trapSidebarTab({ key: "Tab", shiftKey: false, preventDefault: vi.fn() }, h.sidebar); expect(h.sidebar.focus).toHaveBeenCalledOnce();
  });
  it("ignores keys other than Tab", () => {
    const h = fixture(2), event = { key: "ArrowDown", shiftKey: false, preventDefault: vi.fn() };
    trapSidebarTab(event, h.sidebar); expect(event.preventDefault).not.toHaveBeenCalled();
  });
  it("keeps the inactive backdrop out of keyboard and screen-reader navigation", () => {
    const html = renderToStaticMarkup(<MobileNavigation />);
    expect(html).toContain('aria-label="Open navigation" aria-expanded="false" aria-controls="primary-sidebar"');
    expect(html).toContain('class="mobile-nav-backdrop" type="button" tabindex="-1" aria-hidden="true"');
  });
});

describe("shared responsive CSS contracts (not a browser layout test)", () => {
  it("parses and never masks whole document/main horizontal overflow", () => {
    css.walkRules(rule => {
      if (rule.selectors.some(selector => ["html", "body", "main"].includes(selector.trim()))) {
        rule.walkDecls(/^overflow(?:-x)?$/, declaration => expect(["hidden", "clip"]).not.toContain(declaration.value));
      }
    });
  });
  it("applies all collapsed-checkbox rules only on desktop", () => {
    let count = 0;
    css.walkRules(rule => {
      if (rule.selector.includes(".sidebar-toggle:checked")) {
        count++; const media = rule.parent as AtRule;
        expect(media.type).toBe("atrule"); expect(media.name).toBe("media"); expect(media.params).toBe("(min-width:901px)");
      }
    });
    expect(count).toBeGreaterThan(5);
  });
  it("reserves pending space, delays visual hints and respects reduced motion", () => {
    const source = css.toString();
    expect(source).toContain("width:12px;height:12px");
    expect(source).toContain("sidebar-nav-reveal .15s ease .1s forwards");
    expect(source).toContain("@media(prefers-reduced-motion:reduce)");
    expect(source).toContain('.sidebar-link-progress[data-pending="true"]{animation:none;opacity:1}');
  });
  it("uses local scrolling/wrapping and removes clipping from summary values", () => {
    const source = css.toString();
    expect(source).toContain("max-width:100%;overflow-x:auto;overscroll-behavior-x:contain");
    expect(source).toContain(".pulse-grid strong,.paper-summary strong,.paper-kpis strong,.wallet-kpis strong{overflow-wrap:anywhere}");
    expect(source).not.toContain(".pulse-grid article,.paper-summary a,.paper-kpis article,.wallet-kpis article{overflow:hidden}");
    expect(source).toContain(".wallet-table .row-metric:nth-of-type(n),.transaction-table .row-metric:nth-of-type(n){display:grid}");
  });
});
