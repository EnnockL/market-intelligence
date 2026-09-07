import { PanelLoading } from "@/components/dashboard/panel-loading";

// A prefetchable shell for dynamic pages. The shared menu remains interactive;
// no automatic refresh or form reset is needed.
export default function Loading() {
  return <main>
    <section className="hero"><div><span className="eyebrow">MARKET INTELLIGENCE</span><h1>Laddar sidan…</h1><p>Hämtar sparad information. Du kan fortsätta använda menyn.</p></div></section>
    <PanelLoading title="Sidinnehåll" rows={4} />
  </main>;
}
