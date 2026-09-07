"use client";
import Link, { useLinkStatus } from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

const groups = [
  { label: "Workspace", items: [["/", "⌁", "Market Radar"], ["/paper", "▣", "Paper Portfolio"], ["/execution", "E", "Execution Guard"], ["/watchlist", "☆", "Watchlist"], ["/signals", "⌁", "Signals"]] },
  { label: "Intelligence", items: [["/research", "◎", "Research"], ["/agents", "◉", "Agent Center"], ["/data-collection", "D", "Data Operations"], ["/fast-flow", "ϟ", "Fast Flow"], ["/jackpot", "◇", "Jackpot Radar"]] },
  { label: "Labs & Replay", items: [["/systems", "▦", "System Map"], ["/simulation", "∿", "Simulation Lab"], ["/replay", "↶", "Historical Replay"], ["/strategy-lab", "⌬", "Strategy Lab"], ["/strategy-validation", "V", "Strategy Validation"], ["/forecasts", "△", "Forecasts"]] },
] as const;

type GroupLabel = (typeof groups)[number]["label"];
type OpenGroups = Record<GroupLabel, boolean>;

const storageKey = "market-intelligence.sidebar-groups";
const defaultOpenGroups = Object.fromEntries(groups.map((group) => [group.label, true])) as OpenGroups;

function isActiveRoute(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

export function restoreSidebarGroups(saved: string | null, pathname: string): OpenGroups {
  const restored = { ...defaultOpenGroups };
  try {
    const parsed: unknown = saved ? JSON.parse(saved) : null;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      for (const group of groups) {
        const value = (parsed as Record<string, unknown>)[group.label];
        if (typeof value === "boolean") restored[group.label] = value;
      }
    }
  } catch {
    // Malformed storage must not remove navigation or turn strings into booleans.
  }
  const activeGroup = groups.find((group) => group.items.some(([href]) => isActiveRoute(pathname, href)));
  if (activeGroup) restored[activeGroup.label] = true;
  return restored;
}

/** Must be rendered below Link: Next owns completion, cancellation and prefetch. */
export function SidebarLinkContent({ icon, label }: { icon: string; label: string }) {
  const { pending } = useLinkStatus();
  return <>
    <span className="nav-icon" aria-hidden="true">{icon}</span>
    <span className="sidebar-link-label">{label}</span>
    <span className="sidebar-link-status" role="status" aria-live="polite" aria-atomic="true">
      <span className="sidebar-link-progress" data-pending={pending} aria-hidden="true" />
      <span className="sidebar-sr-only">{pending ? `Loading ${label}` : ""}</span>
    </span>
  </>;
}

export function SidebarNav() {
  const pathname = usePathname();
  const [openGroups, setOpenGroups] = useState<OpenGroups>(defaultOpenGroups);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(storageKey);
      setOpenGroups(restoreSidebarGroups(saved, pathname));
    } catch {
      // The navigation remains fully open if browser storage is unavailable.
    }
  }, [pathname]);

  useEffect(() => {
    const activeGroup = groups.find((group) => group.items.some(([href]) => isActiveRoute(pathname, href)));
    if (!activeGroup) return;
    setOpenGroups((current) => current[activeGroup.label] ? current : { ...current, [activeGroup.label]: true });
  }, [pathname]);

  function toggleGroup(label: GroupLabel) {
    setOpenGroups((current) => {
      const next = { ...current, [label]: !current[label] };
      try {
        window.localStorage.setItem(storageKey, JSON.stringify(next));
      } catch {
        // Storage is an enhancement, not a requirement for navigation.
      }
      return next;
    });
  }

  return <nav className="sidebar-nav" aria-label="Primary navigation">{groups.map((group, index) => {
    const open = openGroups[group.label];
    const controlsId = `sidebar-group-${group.label.toLowerCase().replaceAll(" ", "-").replace("&", "and")}`;
    return <div className="sidebar-nav-group" key={group.label}>
      <button
        type="button"
        className={`nav-label sidebar-group-toggle${index ? " nav-label--spaced" : ""}`}
        aria-expanded={open}
        aria-controls={controlsId}
        onClick={() => toggleGroup(group.label)}
      >
        <span>{group.label}</span>
        <span className="sidebar-group-chevron" aria-hidden="true">⌄</span>
      </button>
      <div className="sidebar-nav-items" data-open={open} id={controlsId}>
        {group.items.map(([href, icon, label]) => {
          const active = isActiveRoute(pathname, href);
          return <Link aria-label={label} title={label} aria-current={active ? "page" : undefined} className={active ? "active" : undefined} href={href} key={href}><SidebarLinkContent icon={icon} label={label} /></Link>;
        })}
      </div>
    </div>;
  })}</nav>;
}
