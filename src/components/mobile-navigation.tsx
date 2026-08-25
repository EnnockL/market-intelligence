"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { ThemeToggle } from "@/components/theme-toggle";

function setDocumentMenuState(open: boolean) {
  document.documentElement.toggleAttribute("data-mobile-nav-open", open);
}

export function MobileSidebarClose() {
  return <button className="mobile-sidebar-close" type="button" aria-label="Close navigation" onClick={() => window.dispatchEvent(new Event("mobile-nav-close"))}>
    <span aria-hidden="true">×</span>
  </button>;
}

export function MobileNavigation() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setOpen(false);
    setDocumentMenuState(false);
  }, [pathname]);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    const closeMenu = () => setOpen(false);
    window.addEventListener("keydown", closeOnEscape);
    window.addEventListener("mobile-nav-close", closeMenu);
    setDocumentMenuState(open);
    return () => {
      window.removeEventListener("keydown", closeOnEscape);
      window.removeEventListener("mobile-nav-close", closeMenu);
    };
  }, [open]);

  return <>
    <header className="mobile-header">
      <button className="mobile-menu-button" type="button" aria-label="Open navigation" aria-expanded={open} aria-controls="primary-sidebar" onClick={() => setOpen((current) => !current)}>
        <span aria-hidden="true" /><span aria-hidden="true" /><span aria-hidden="true" />
      </button>
      <Link href="/" className="brand"><span className="brand-mark">M</span><span className="brand-copy"><strong>Market Intelligence</strong><small>Research workspace</small></span></Link>
      <div className="mobile-header-actions"><ThemeToggle /><span className="profile-button" aria-hidden="true">EN</span></div>
    </header>
    <button className="mobile-nav-backdrop" type="button" aria-label="Close navigation" onClick={() => setOpen(false)} />
  </>;
}
