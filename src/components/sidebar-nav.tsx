"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

const groups = [
  { label: "Workspace", items: [["/", "⌁", "Market Radar"], ["/paper", "▣", "Paper Portfolio"], ["/execution", "E", "Execution Guard"], ["/watchlist", "☆", "Watchlist"], ["/signals", "⌁", "Signals"]] },
  { label: "Intelligence", items: [["/research", "◎", "Research"], ["/agents", "◉", "Agent Center"], ["/data-collection", "D", "Data Operations"], ["/fast-flow", "ϟ", "Fast Flow"], ["/jackpot", "◇", "Jackpot Radar"]] },
  { label: "Labs & Replay", items: [["/systems", "▦", "System Map"], ["/simulation", "∿", "Simulation Lab"], ["/replay", "↶", "Historical Replay"], ["/strategy-lab", "⌬", "Strategy Lab"], ["/forecasts", "△", "Forecasts"]] },
] as const;

type GroupLabel = (typeof groups)[number]["label"];
type OpenGroups = Record<GroupLabel, boolean>;

const storageKey = "market-intelligence.sidebar-groups";
const defaultOpenGroups = Object.fromEntries(groups.map((group) => [group.label, true])) as OpenGroups;

function isActiveRoute(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

export function SidebarNav() {
  const pathname = usePathname();
  const [openGroups, setOpenGroups] = useState<OpenGroups>(defaultOpenGroups);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(storageKey);
      if (saved) {
        const restored = { ...defaultOpenGroups, ...JSON.parse(saved) } as OpenGroups;
        const activeGroup = groups.find((group) => group.items.some(([href]) => isActiveRoute(pathname, href)));
        if (activeGroup) restored[activeGroup.label] = true;
        setOpenGroups(restored);
      }
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
          return <Link aria-current={active ? "page" : undefined} className={active ? "active" : undefined} href={href} key={href}><span className="nav-icon">{icon}</span><span>{label}</span></Link>;
        })}
      </div>
    </div>;
  })}</nav>;
}
