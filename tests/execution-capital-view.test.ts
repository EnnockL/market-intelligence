import {describe,it,expect} from "vitest";
import {renderToStaticMarkup} from "react-dom/server";
import {AccountCapital} from "../src/app/execution/account-capital";

describe("execution capital presentation",()=>{
  async function render(status:string,error:boolean=false){
    const filters:unknown[]=[];
    const db={from:(table:string)=>{
      const query={select:()=>query,eq:(key:string,value:unknown)=>{filters.push([table,key,value]);return query;},maybeSingle:async()=>({
        error:table==="demo_account_captures"&&error?{message:"unavailable"}:null,
        data:table==="execution_accounts"?{account_key:"demo-test"}:{record:{evidence:{quoteCurrency:"EUR",balances:[{currency:"USD",available:999999},{currency:"EUR",available:4600}]}}},
      })};return query;
    }};
    const element=await AccountCapital({db:db as any,risk:{account_id:"account-a",demo_capture_id:"capture-a",status,available_cash_sek:51940.9,information_cutoff_at:"2026-09-19T19:00:00Z"}});
    return {html:renderToStaticMarkup(element),filters};
  }
  it("uses the risk snapshot capture and quote currency, never another cash balance",async()=>{
    const {html,filters}=await render("KNOWN");
    expect(filters).toContainEqual(["demo_account_captures","id","capture-a"]);
    expect(filters).toContainEqual(["demo_account_captures","account_id","account-a"]);
    expect(html).toContain("EUR");expect(html).toContain("51");expect(html).not.toContain("999999");
    expect(html).toContain("Total kontoequity i USD rapporteras inte");
  });
  it.each([["UNKNOWN",false],["KNOWN",true]])("does not present known cash when status=%s and capture error=%s",async(status,error)=>{
    const {html}=await render(status,error);expect(html).not.toContain("51");expect(html).toContain("Okänt");
  });
});
