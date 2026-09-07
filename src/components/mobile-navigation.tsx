"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ThemeToggle } from "@/components/theme-toggle";

function setDocumentMenuState(open: boolean) {
  document.documentElement.toggleAttribute("data-mobile-nav-open", open);
}

export function trapSidebarTab(event: Pick<KeyboardEvent, "key" | "shiftKey" | "preventDefault">, sidebar: HTMLElement) {
  if (event.key !== "Tab") return;
  const focusable = Array.from(sidebar.querySelectorAll<HTMLElement>(
    'a[href],button:not([disabled]),input:not([disabled]):not(.sidebar-toggle),[tabindex]:not([tabindex="-1"])',
  )).filter(element => element.tabIndex >= 0 && !element.matches(":disabled") && element.getClientRects().length > 0 && !element.closest("[inert]"));
  const first = focusable[0], last = focusable[focusable.length - 1], active = sidebar.ownerDocument.activeElement;
  if (!first) { event.preventDefault(); sidebar.focus(); return; }
  if (event.shiftKey && (active === first || active === sidebar || !sidebar.contains(active))) { event.preventDefault(); last.focus(); }
  else if (!event.shiftKey && (active === last || active === sidebar || !sidebar.contains(active))) { event.preventDefault(); first.focus(); }
}

export function MobileSidebarClose() {
  return <button className="mobile-sidebar-close" type="button" aria-label="Close navigation" onClick={() => window.dispatchEvent(new Event("mobile-nav-close"))}>
    <span aria-hidden="true">×</span>
  </button>;
}

export function MobileNavigation() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    setOpen(false);
    setDocumentMenuState(false);
  }, [pathname]);

  useEffect(() => {
    const sidebar = document.getElementById("primary-sidebar"), mobile = window.matchMedia("(max-width: 900px)");
    const closeMenu = () => { setOpen(false); trigger.current?.focus(); };
    const syncViewport = () => {
      const mobileOpen = mobile.matches && open;
      setDocumentMenuState(mobileOpen);
      if (sidebar) {
        sidebar.inert = mobile.matches && !open;
        if (mobile.matches && !open) sidebar.setAttribute("aria-hidden", "true");
        else sidebar.removeAttribute("aria-hidden");
        if (mobileOpen) {
          sidebar.setAttribute("role", "dialog"); sidebar.setAttribute("aria-modal", "true");
          sidebar.setAttribute("aria-label", "Navigation menu"); sidebar.tabIndex = -1;
        } else {
          sidebar.removeAttribute("role"); sidebar.removeAttribute("aria-modal");
          sidebar.removeAttribute("aria-label"); sidebar.removeAttribute("tabindex");
        }
      }
      if (!mobile.matches && open) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (!mobile.matches || !open) return;
      if (event.key === "Escape") { event.preventDefault(); closeMenu(); }
      else if (sidebar) trapSidebarTab(event, sidebar);
    };
    syncViewport();
    if (mobile.matches && open) sidebar?.querySelector<HTMLButtonElement>(".mobile-sidebar-close")?.focus();
    mobile.addEventListener("change", syncViewport);
    window.addEventListener("keydown", closeOnEscape);
    window.addEventListener("mobile-nav-close", closeMenu);
    return () => {
      mobile.removeEventListener("change", syncViewport);
      window.removeEventListener("keydown", closeOnEscape);
      window.removeEventListener("mobile-nav-close", closeMenu);
      setDocumentMenuState(false);
      if (sidebar) {
        sidebar.inert = false; sidebar.removeAttribute("aria-hidden"); sidebar.removeAttribute("role");
        sidebar.removeAttribute("aria-modal"); sidebar.removeAttribute("aria-label"); sidebar.removeAttribute("tabindex");
      }
    };
  }, [open]);

  return <>
    <header className="mobile-header">
      <button ref={trigger} className="mobile-menu-button" type="button" aria-label={open ? "Close navigation" : "Open navigation"} aria-expanded={open} aria-controls="primary-sidebar" onClick={() => setOpen((current) => !current)}>
        <span aria-hidden="true" /><span aria-hidden="true" /><span aria-hidden="true" />
      </button>
      <Link href="/" className="brand"><span className="brand-mark">M</span><span className="brand-copy"><strong>Market Intelligence</strong><small>Research workspace</small></span></Link>
      <div className="mobile-header-actions"><ThemeToggle /><span className="profile-button" aria-hidden="true">EN</span></div>
    </header>
    <button className="mobile-nav-backdrop" type="button" tabIndex={-1} aria-hidden="true" onClick={() => { setOpen(false); trigger.current?.focus(); }} />
  </>;
}
