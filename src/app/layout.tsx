import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Market Intelligence Engine",
  description: "Evidence-first market intelligence for stocks and crypto.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>
    <header className="topbar">
      <Link href="/" className="brand"><span className="brand-mark">M</span><span className="brand-copy"><strong>Market Intelligence</strong><small>Investment platform</small></span></Link>
      <nav><Link className="active" href="/">Radar</Link><a href="#watchlist">Watchlist</a><a href="#signals">Signals</a><a href="#research">Research</a></nav>
      <div className="topbar-actions"><div className="system-status"><i /> Systems operational</div><button className="command-button" aria-label="Open command palette">⌘ K</button><button className="profile-button" aria-label="Open profile">EN</button></div>
    </header>
    {children}
  </body></html>;
}
