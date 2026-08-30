"use client";

import { useEffect, useState } from "react";
import { Check, Loader2, Plus, RefreshCw, Search, Trash2, X } from "lucide-react";
import { getJson } from "@/lib/fetch-json";
import type { CompanyDataset, CompanyProfile } from "@/lib/types";

/** How long to wait after the last keystroke before asking the SEC. */
const RESOLVE_MS = 250;

export const IMPORT_STAGES = ["Queued","Resolving company","Loading company profile","Loading annual statements","Loading quarterly statements","Loading market prices","Normalizing data","Calculating metrics","Validating data","Complete"] as const;
export type ImportState = typeof IMPORT_STAGES[number] | "Partial" | "Failed";
interface Job { ticker:string;state:ImportState;progress:number;error?:string;updatedAt:string }

/**
 * The watchlist belongs to the application, not to this dialog.
 *
 * This used to keep its own copy — read from `localStorage` when it opened and
 * written back on every change — while the application kept another under the
 * same key. Two owners of one list is one owner too many: a company added here
 * whose import then failed existed only in this copy, and the next thing the
 * application saved overwrote it. The company was gone from the watchlist the
 * moment the dialog closed, which is why "Load all" never reached it and why it
 * appeared not to load at all.
 */
export function CompanyManager({ watchlist, setWatchlist, onSelect, onClose }: { watchlist:CompanyProfile[]; setWatchlist:(update:(current:CompanyProfile[])=>CompanyProfile[])=>void; onSelect:(dataset:CompanyDataset)=>void; onClose:()=>void }) {
  const [jobs,setJobs]=useState<Record<string,Job>>(()=>{if(typeof window==="undefined")return{};try{return JSON.parse(localStorage.getItem("finscope.importJobs")??"{}") }catch{return{}}});
  const [query,setQuery]=useState("");
  /*
   * What came back, and the query it came back for.
   *
   * The search used to run only when the button was pressed or Enter was hit,
   * and said nothing at all when it failed or found nothing — a failed lookup
   * and an empty one both left the dialog exactly as it was, which is why
   * "add a company" read as a feature that does not work. It searches as you
   * type now, and every outcome has words.
   *
   * Keeping the query beside the results is what lets a stale answer be
   * ignored while rendering rather than cleared by an effect.
   */
  const [resolved,setResolved]=useState<{needle:string;companies:CompanyProfile[];error:string}>({needle:"",companies:[],error:""});
  useEffect(()=>{localStorage.setItem("finscope.importJobs",JSON.stringify(jobs));},[jobs]);
  const needle=query.trim();
  const answered=resolved.needle===needle;
  const results=answered?resolved.companies:[];
  const searchError=answered?resolved.error:"";
  const resolving=needle.length>=2&&!answered;
  useEffect(()=>{
    if(needle.length<2)return;
    let active=true;
    const timer=setTimeout(()=>{
      getJson<CompanyProfile[]>(`/api/resolve?q=${encodeURIComponent(needle)}`,{what:`companies matching “${needle}”`})
        .then((payload)=>{if(active)setResolved({needle,companies:Array.isArray(payload)?payload:[],error:""})})
        .catch((cause)=>{if(active)setResolved({needle,companies:[],error:cause instanceof Error?cause.message:"The search could not be completed."})});
    },RESOLVE_MS);
    return()=>{active=false;clearTimeout(timer)};
  },[needle]);
  async function runImport(company:CompanyProfile){if(jobs[company.ticker]?.state==="Complete")return;const update=(state:ImportState,progress:number,error?:string)=>setJobs((current)=>({...current,[company.ticker]:{ticker:company.ticker,state,progress,error,updatedAt:new Date().toISOString()}}));update("Queued",2);for(const [state,progress] of [["Resolving company",8],["Loading company profile",15],["Loading annual statements",28],["Loading quarterly statements",43]] as [ImportState,number][]){await new Promise((resolve)=>setTimeout(resolve,80));update(state,progress)}try{const payload=await getJson<CompanyDataset>(`/api/company/${encodeURIComponent(company.ticker)}`,{what:company.ticker});for(const [state,progress] of [["Loading market prices",58],["Normalizing data",70],["Calculating metrics",82],["Validating data",92]] as [ImportState,number][]){await new Promise((resolve)=>setTimeout(resolve,70));update(state,progress)}const partial=payload.periods.length===0||payload.warnings.some((warning)=>warning.toLowerCase().includes("unavailable"));update(partial?"Partial":"Complete",100,partial?"Some standardized metrics are unavailable; existing facts were retained.":undefined);onSelect(payload)}catch(error){const message=error instanceof Error?error.message:"Import failed";update(company.resolutionStatus==="unresolved"?"Partial":"Failed",100,message)}}
  // Added first and imported second, and deliberately in that order: a company
  // the reader chose belongs on their list whether or not the SEC answers for
  // it this minute, and a failed import must leave a card they can retry rather
  // than nothing at all.
  function add(company:CompanyProfile){setWatchlist((current)=>current.some((item)=>item.ticker===company.ticker)?current:[...current,company]);runImport(company)}
  return <div className="manager-backdrop" role="dialog" aria-modal="true" aria-label="Company watchlist manager"><section className="company-manager"><div className="selector-head"><div><span className="panel-kicker">WATCHLIST & BACKGROUND IMPORTS</span><h2>Add company</h2></div><button className="icon-button" onClick={onClose}><X size={16}/></button></div><div className="company-search"><Search size={15}/><input value={query} onChange={(event)=>setQuery(event.target.value)} placeholder="Search SEC ticker or company name…" aria-label="Search every SEC filer"/>{resolving&&<Loader2 className="spin" size={14}/>}</div>
    {needle.length>0&&needle.length<2&&<p className="simple-state">Keep typing…</p>}
    {searchError&&<p className="notice">{searchError}</p>}
    {answered&&!searchError&&results.length===0&&<p className="simple-state">Nothing in the SEC register matches “{needle}”. Try a ticker, or the name as it appears on the filing.</p>}
    {results.length>0&&<div className="resolve-results">{results.map((company)=><div key={company.ticker}><div><b>{company.name}</b><small>{company.ticker} · {company.exchange} · {company.currency} · {company.regulatoryId}</small></div><button className="button secondary" onClick={()=>add(company)} disabled={watchlist.some((item)=>item.ticker===company.ticker)}><Plus size={13}/> {watchlist.some((item)=>item.ticker===company.ticker)?"Added":"Add"}</button></div>)}</div>}<div className="watchlist-list"><div className="selected-head"><b>Watchlist · {watchlist.length}</b><small>Initial list contains exactly the 22 requested instruments</small></div>{watchlist.map((company)=>{const job=jobs[company.ticker];return <div className="watchlist-row" key={company.ticker}><button className="watch-company" onClick={()=>runImport(company)}><span className="ticker-avatar">{company.ticker[0]}</span><span><b>{company.name}</b><small>{company.ticker} · {company.exchange} · {company.currency} · {company.regulatoryId||"No regulatory ID"}</small></span></button><div className="import-progress"><span>{job?.state??(company.resolutionStatus==="unresolved"?"Partial":"Not imported")}</span><i><b style={{width:`${job?.progress??0}%`}}/></i><small>{job?.error??company.resolutionNote??"Ready for background import"}</small></div><button className="icon-button" title="Retry import" onClick={()=>runImport(company)}><RefreshCw size={13}/></button><button className="icon-button" title="Remove from watchlist" onClick={()=>setWatchlist((current)=>current.filter((item)=>item.ticker!==company.ticker))}><Trash2 size={13}/></button>{job?.state==="Complete"&&<Check size={14} className="positive-text"/>}</div>})}</div></section></div>;
}
