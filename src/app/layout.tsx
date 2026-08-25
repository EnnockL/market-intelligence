import type { Metadata } from "next";
import Link from "next/link";
import { ThemeToggle } from "@/components/theme-toggle";
import { SidebarScrollState } from "@/components/sidebar-scroll-state";
import { SidebarNav } from "@/components/sidebar-nav";
import "./globals.css";

export const metadata: Metadata = { title: "Market Intelligence Engine", description: "Evidence-first market intelligence for stocks and crypto." };
const THEME_INIT_SCRIPT = `try{if(localStorage.getItem('mi-theme')==='terminal')document.documentElement.setAttribute('data-theme','terminal')}catch(e){}`;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><head><script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} /></head><body><SidebarScrollState />
    <aside className="app-sidebar">
      <input className="sidebar-toggle" id="sidebar-toggle" type="checkbox" aria-label="Collapse sidebar" />
      <div className="sidebar-top"><Link href="/" className="brand"><span className="brand-mark">M</span><span className="brand-copy"><strong>Market Intelligence</strong><small>Research workspace</small></span></Link><label className="sidebar-collapse" htmlFor="sidebar-toggle" title="Collapse sidebar">‹</label></div>
      <SidebarNav />
      <div className="sidebar-bottom">
        <Link href="/agents" className="system-status"><i /><span><strong>Agent status</strong><small>Open operational view</small></span></Link>
        <div className="sidebar-controls"><ThemeToggle /><button className="command-button" aria-label="Open command palette">⌘ K</button></div>
        <button className="sidebar-profile" aria-label="Open profile"><span className="profile-button">EN</span><span><strong>Research account</strong><small>Local workspace</small></span><b>•••</b></button>
      </div>
    </aside>
    <div className="mobile-header"><Link href="/" className="brand"><span className="brand-mark">M</span><span className="brand-copy"><strong>Market Intelligence</strong></span></Link><div><ThemeToggle /><button className="profile-button" aria-label="Open profile">EN</button></div></div>
    {children}
  </body></html>;
}
