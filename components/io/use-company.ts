"use client";

import { useEffect, useMemo, useState } from "react";
import type { IoCompanyView } from "@/lib/io/view";
import { IO_VIEW } from "@/lib/io/view-version";
import { sharesPerReceipt } from "@/lib/adr";
import { rememberCompany } from "@/lib/io/last-company";
import { priceForStatements, type IoQuote } from "./quote";

/**
 * One company's filings and price, as the page that draws them needs them.
 *
 * Shared by the document page (components/io/Company.tsx) and the terminal
 * (components/term/TermCompany.tsx), so the two layouts of one company can never
 * read two different answers: one request for the filings, one for the quote,
 * and the same conversion of that quote into the statements' currency.
 *
 * The two halves arrive separately and on purpose. Filings are settled for a
 * quarter and cached for a day; a price is settled for no time at all and
 * cached for five minutes. Waiting for both would mean the slower one decides
 * when the page appears, so the statements draw as soon as they land and the
 * headline price fills in beside them.
 *
 * A company nobody has opened here before has to be normalized from raw XBRL
 * first, which is far too expensive to do inside a reader's request — so the
 * endpoint answers "being prepared" and hands the work to a second invocation.
 * This polls for it rather than pretending the wait is not happening.
 */

const POLL_MS = 2_000;
/*
 * Three minutes. A company nobody has opened can take a minute and a half to
 * normalize from raw XBRL, and at sixty seconds the page used to give up and
 * tell the reader to come back while the build was still on its way.
 */
const POLL_LIMIT = 90;

/**
 * Every state names the company it is about.
 *
 * A reader moving from one company to the next keeps the page mounted, so
 * without that name the previous company's statements would stay on screen
 * under the new company's ticker until the fetch landed. Carrying the ticker
 * means the stale state simply is not this ticker's, and the loading view is
 * what renders.
 */
export type CompanyState =
  | { kind: "loading"; ticker: string; progress: number }
  | { kind: "building"; ticker: string; progress: number }
  | { kind: "failed"; ticker: string; message: string }
  | { kind: "ready"; ticker: string; view: IoCompanyView };

export interface CompanyData {
  state: CompanyState;
  /** The quote as it trades. */
  quote: IoQuote | null;
  /** The quote per ordinary share, in the statements' currency, for valuation. */
  valuationQuote: IoQuote | null;
}

export function useCompany(ticker: string): CompanyData {
  const [loaded, setLoaded] = useState<CompanyState>({ kind: "loading", ticker, progress: 6 });
  const [quoted, setQuoted] = useState<IoQuote | null>(null);

  const state: CompanyState = loaded.ticker === ticker ? loaded : { kind: "loading", ticker, progress: 6 };
  const quote = quoted?.ticker === ticker ? quoted : null;

  useEffect(() => {
    const controller = new AbortController();
    let attempts = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const load = async () => {
      try {
        // The answer is cached by URL — at the edge and in the reader's own
        // browser — as well as keyed in KV. The token carries both the shape
        // the page draws and the version the figures were built under, so a
        // deployment can never pair a new client with an older answer.
        const response = await fetch(`/api/io/${encodeURIComponent(ticker)}?view=${IO_VIEW}`, { signal: controller.signal });
        if (response.status === 202) {
          attempts += 1;
          if (attempts <= POLL_LIMIT) {
            // Cloudflare exposes readiness, not byte-level build progress. The
            // percentage therefore follows the bounded polling window and is
            // explicitly labelled as an estimate; it never claims completion
            // before a real dataset arrives.
            const progress = Math.min(95, 12 + Math.round((attempts / POLL_LIMIT) * 83));
            setLoaded({ kind: "building", ticker, progress });
            timer = setTimeout(load, POLL_MS);
          } else {
            setLoaded({ kind: "failed", ticker, message: "This company is taking longer than expected to prepare. Ask for it again in a minute." });
          }
          return;
        }
        const body = await response.json() as Record<string, unknown>;
        if (!response.ok) {
          const stated = body?.error;
          setLoaded({ kind: "failed", ticker, message: typeof stated === "string" ? stated : `${ticker} could not be loaded.` });
          return;
        }
        const view = body as unknown as IoCompanyView;
        rememberCompany(view.company.ticker);
        setLoaded({ kind: "ready", ticker, view });
      } catch (error) {
        if (controller.signal.aborted) return;
        setLoaded({ kind: "failed", ticker, message: error instanceof Error ? error.message : "Unreachable." });
      }
    };

    load();

    fetch(`/api/io/${encodeURIComponent(ticker)}/quote`, { signal: controller.signal })
      .then((response) => (response.ok ? response.json() : null))
      .then((body) => { if (body && !controller.signal.aborted) setQuoted(body as IoQuote); })
      .catch(() => { /* The page states a price when there is one and nothing when there is not. */ });

    return () => { controller.abort(); if (timer) clearTimeout(timer); };
  }, [ticker]);

  /*
   * The price the statements can be valued at.
   *
   * A foreign company's quote may be in another currency than its accounts, for
   * a receipt that is not one ordinary share. Today's rate is asked for only
   * when the currencies differ; the price per ordinary share goes to the
   * statistics and the price-against-growth reading, and the header keeps the
   * quote as it trades (components/io/quote.ts).
   */
  const statementCurrency = state.kind === "ready" ? state.view.basis?.currency ?? null : null;
  const fxPair = quote?.currency && statementCurrency && quote.currency !== statementCurrency ? `${quote.currency}${statementCurrency}` : null;
  const [fx, setFx] = useState<{ pair: string; rate: number; asOf: string | null } | null>(null);
  useEffect(() => {
    if (!fxPair) return;
    const controller = new AbortController();
    fetch(`/api/fx?from=${fxPair.slice(0, 3)}&to=${fxPair.slice(3)}`, { signal: controller.signal })
      .then((response) => (response.ok ? response.json() as Promise<{ rate?: number; asOf?: string | null }> : null))
      .then((body) => { if (body?.rate && !controller.signal.aborted) setFx({ pair: fxPair, rate: body.rate, asOf: body.asOf ?? null }); })
      .catch(() => { /* Without a rate the valuation stays withheld, and says why. */ });
    return () => controller.abort();
  }, [fxPair]);
  const valuationQuote = useMemo(
    () => priceForStatements(quote, statementCurrency, fx?.pair === fxPair ? fx : null, sharesPerReceipt(ticker)),
    [quote, statementCurrency, fx, fxPair, ticker],
  );

  return { state, quote, valuationQuote };
}
