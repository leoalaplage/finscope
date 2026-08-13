import { NextResponse } from "next/server";
import { fetchYahooPrice } from "@/lib/adapters/yahoo";

export async function GET(request: Request) {
  const url = new URL(request.url); const from=(url.searchParams.get("from")??"").toUpperCase(); const to=(url.searchParams.get("to")??"").toUpperCase(); const date=url.searchParams.get("date")??"";
  if(!/^[A-Z]{3}$/.test(from)||!/^[A-Z]{3}$/.test(to)||!/^\d{4}-\d{2}-\d{2}$/.test(date))return NextResponse.json({error:"from, to and date are required."},{status:400});
  if(from===to)return NextResponse.json({rate:1,date,requestedDate:date,source:"Identity conversion"});
  try { const point=await fetchYahooPrice({name:`${from}/${to}`,ticker:`${from}${to}=X`,yahooTicker:`${from}${to}=X`,cik:"",exchange:"FX",currency:to,sector:"FX",description:"Historical FX pair"},date); return NextResponse.json({rate:point.close,date:point.date,requestedDate:date,source:point.sourceUrl,fallback:point.fallback}); }
  catch(error){return NextResponse.json({error:error instanceof Error?error.message:"FX unavailable"},{status:502});}
}
