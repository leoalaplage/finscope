"use client";

import { useEffect, useState } from "react";
import { Check, Loader2, Plus, RefreshCw, Search, Trash2, X } from "lucide-react";
import type { CompanyDataset, CompanyProfile } from "@/lib/types";

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
  const [query,setQuery]=useState("");const [results,setResults]=useState<CompanyProfile[]>([]);const [resolving,setResolving]=useState(false);
  useEffect(()=>{localStorage.setItem("finscope.importJobs",JSON.stringify(jobs));},[jobs]);
  async function search(){setResolving(true);try{const response=await fetch(`/api/resolve?q=${encodeURIComponent(query)}`);const payload=await response.json();setResults(Array.isArray(payload)?payload:[])}finally{setResolving(false)}}
  async function runImport(company:CompanyProfile){if(jobs[company.ticker]?.state==="Complete")return;const update=(state:ImportState,progress:number,error?:string)=>setJobs((current)=>({...current,[company.ticker]:{ticker:company.ticker,state,progress,error,updatedAt:new Date().toISOString()}}));update("Queued",2);for(const [state,progress] of [["Resolving company",8],["Loading company profile",15],["Loading annual statements",28],["Loading quarterly statements",43]] as [ImportState,number][]){await new Promise((resolve)=>setTimeout(resolve,80));update(state,progress)}try{const response=await fetch(`/api/company/${encodeURIComponent(company.ticker)}`);const payload=await response.json() as CompanyDataset&{error?:string};if(!response.ok)throw new Error(payload.error||"Import failed");for(const [state,progress] of [["Loading market prices",58],["Normalizing data",70],["Calculating metrics",82],["Validating data",92]] as [ImportState,number][]){await new Promise((resolve)=>setTimeout(resolve,70));update(state,progress)}const partial=payload.periods.length===0||payload.warnings.some((warning)=>warning.toLowerCase().includes("unavailable"));update(partial?"Partial":"Complete",100,partial?"Some standardized metrics are unavailable; existing facts were retained.":undefined);onSelect(payload)}catch(error){const message=error instanceof Error?error.message:"Import failed";update(company.resolutionStatus==="unresolved"?"Partial":"Failed",100,message)}}
  // Added first and imported second, and deliberately in that order: a company
  // the reader chose belongs on their list whether or not the SEC answers for
  // it this minute, and a failed import must leave a card they can retry rather
  // than nothing at all.
  function add(company:CompanyProfile){setWatchlist((current)=>current.some((item)=>item.ticker===company.ticker)?current:[...current,company]);runImport(company)}
  return <div className="manager-backdrop" role="dialog" aria-modal="true" aria-label="Company watchlist manager"><section className="company-manager"><div className="selector-head"><div><span className="panel-kicker">WATCHLIST & BACKGROUND IMPORTS</span><h2>Add company</h2></div><button className="icon-button" onClick={onClose}><X size={16}/></button></div><div className="company-search"><Search size={15}/><input value={query} onChange={(event)=>setQuery(event.target.value)} onKeyDown={(event)=>event.key==="Enter"&&search()} placeholder="Search SEC ticker or company name…"/><button className="button secondary" onClick={search} disabled={!query||resolving}>{resolving?<Loader2 className="spin" size={14}/>:<Search size={14}/>} Search</button></div>{results.length>0&&<div className="resolve-results">{results.map((company)=><div key={company.ticker}><div><b>{company.name}</b><small>{company.ticker} · {company.exchange} · {company.currency} · {company.regulatoryId}</small></div><button className="button secondary" onClick={()=>add(company)} disabled={watchlist.some((item)=>item.ticker===company.ticker)}><Plus size={13}/> {watchlist.some((item)=>item.ticker===company.ticker)?"Added":"Add"}</button></div>)}</div>}<div className="watchlist-list"><div className="selected-head"><b>Watchlist · {watchlist.length}</b><small>Initial list contains exactly the 22 requested instruments</small></div>{watchlist.map((company)=>{const job=jobs[company.ticker];return <div className="watchlist-row" key={company.ticker}><button className="watch-company" onClick={()=>runImport(company)}><span className="ticker-avatar">{company.ticker[0]}</span><span><b>{company.name}</b><small>{company.ticker} · {company.exchange} · {company.currency} · Yahoo {company.yahooTicker} · {company.regulatoryId||"No regulatory ID"}</small></span></button><div className="import-progress"><span>{job?.state??(company.resolutionStatus==="unresolved"?"Partial":"Not imported")}</span><i><b style={{width:`${job?.progress??0}%`}}/></i><small>{job?.error??company.resolutionNote??"Ready for background import"}</small></div><button className="icon-button" title="Retry import" onClick={()=>runImport(company)}><RefreshCw size={13}/></button><button className="icon-button" title="Remove from watchlist" onClick={()=>setWatchlist((current)=>current.filter((item)=>item.ticker!==company.ticker))}><Trash2 size={13}/></button>{job?.state==="Complete"&&<Check size={14} className="positive-text"/>}</div>})}</div></section></div>;
}
