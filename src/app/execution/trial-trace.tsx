import type { SupabaseClient } from "@supabase/supabase-js";
import styles from "./execution.module.css";

const time=(v:unknown)=>typeof v==="string"?`${new Date(v).toLocaleString("sv-SE",{timeZone:"Europe/Stockholm"})} (Stockholm)`:"Saknas";
export async function TrialTrace({db,trialId}:{db:SupabaseClient;trialId:string}) {
  const orders=await db.from("demo_trial_orders").select("*").eq("trial_id",trialId).order("created_at",{ascending:false}).limit(10);
  if(orders.error)return <p>Orderhistoriken kunde inte hämtas.</p>;
  return <article className={styles.panel}>
    <header><div><small>EXPERIMENT · SPÅRBARHET</small><h2>Signal till demoresultat</h2></div><span>Senaste 10 order</span></header>
    <p>Separat experimentflöde: signal → experimentbeslut → säkerhetskontroll → demoorder → fill → exit → testresultat. Ordinarie proposal, Trade Eligibility och validerad strategiattribution ingår inte.</p>
    {!orders.data?.length?<p>Ingen demoorder ännu. Tidslinjen fylls från sparade beslut och börsens order- och fillhistorik när en order skapas.</p>:orders.data.map(order=><OrderTrace key={order.id} db={db} trialId={trialId} order={order}/>)}
    <p>PnL ovan avser hela experimentet efter bokförda avgifter, inte en enskild trade. Modellerad fill och validerad strategiattribution saknas i detta experiment.</p>
  </article>;
}

async function OrderTrace({db,trialId,order}:{db:SupabaseClient;trialId:string;order:any}) {
  const intent=order.execution_intents;
  const [action,fills,events]=await Promise.all([
    db.from("demo_trial_decisions").select("created_at,reason,candle_id").eq("trial_id",trialId).eq("id",intent.source_id).maybeSingle(),
    db.from("demo_trial_fills").select("id,occurred_at,price,quantity,fee_amount,fee_currency,provenance_status").eq("trial_id",trialId).eq("order_id",order.id).order("occurred_at").limit(101),
    db.from("execution_order_events").select("id,next_state,occurred_at,reason").eq("order_id",order.id).order("occurred_at").limit(101),
  ]);
  const candle=action.data?.candle_id?await db.from("market_candles").select("closed_at,available_at").eq("id",action.data.candle_id).maybeSingle():null;
  const incomplete=action.error||fills.error||events.error||candle?.error;
  return <section className={styles.trace}>
    <h3>{intent.side} BTC-EUR · {order.current_state}</h3>
    <p>Order-ID: {order.id}. Börsens order-ID: {order.provider_order_id??"Saknas"}.</p>
    {incomplete&&<p>Historiken är ofullständig: en datakälla kunde inte hämtas.</p>}
    <dl>
      <dt>Signalens candle stängd / tillgänglig</dt><dd>{time(candle?.data?.closed_at)} / {time(candle?.data?.available_at)}</dd>
      <dt>Experimentbeslut / execution intent</dt><dd>{time(action.data?.created_at)} / {time(intent.created_at)}</dd>
      <dt>Proposal / eligibility</dt><dd>Ingår inte i experimentflödet</dd>
      <dt>Beslut / exitorsak</dt><dd>{action.data?.reason??"Saknas"}{intent.side==="BUY"?" (entry; ingen exit för denna order)":""}</dd>
      <dt>Orderns limitpris</dt><dd>{intent.limit_price??"Saknas"} EUR — ordervillkor, inte modellerad fill</dd>
      <dt>Modellerad fill / strategiattribution</dt><dd>Saknas / OVALIDERAD STRATEGI</dd>
    </dl>
    <p>Orderhändelserna visar systemets registrerade tider; börsens ursprungliga ordertid redovisas inte som ett separat verifierat fält.</p>
    <ul>{events.data?.slice(0,100).map(event=><li key={event.id}>{time(event.occurred_at)} · {event.next_state} · {event.reason}</li>)}</ul>
    {!fills.error&&!fills.data?.length&&<p>Ingen registrerad fill.</p>}
    <ul>{fills.data?.slice(0,100).map(fill=><li key={fill.id}>{time(fill.occurred_at)} · {fill.quantity} BTC × {fill.price} EUR · avgift {fill.fee_amount??"okänd"} {fill.fee_currency??""} · {fill.provenance_status}</li>)}</ul>
    {(fills.data?.length===101||events.data?.length===101)&&<p>Första 100 poster visas per källa. Historiken är längre.</p>}
  </section>;
}
