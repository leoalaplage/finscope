"use client";

import { useState } from "react";
import {
  DEFAULT_TICKERS, WATCHLIST_COUNT_LIMIT, parseTickers, useWatchlistCollection,
  writeWatchlistCollection, type PersonalWatchlist,
} from "./watchlist";
import { useModalDialog } from "./use-modal-dialog";

/**
 * The one editor for the one list.
 *
 * It writes to the store every page reads, so editing the list here edits it on
 * the home page, in the screener and in the portfolio at the same time — not
 * because they are kept in step, but because there is only one list and this is
 * the only thing that writes it.
 *
 * Lifted out of the home page when the market page needed it too. A second copy
 * would have been two editors that agree until one of them is changed.
 */
export function WatchlistEditor({ tickers, onClose, onSaved }: {
  tickers: string[];
  onClose: () => void;
  onSaved?: (tickers: string[]) => void;
}) {
  const stored = useWatchlistCollection();
  const [collection, setCollection] = useState(() => stored);
  const active = collection.lists.find((list) => list.id === collection.activeId) ?? collection.lists[0];
  const [draft, setDraft] = useState(() => (active?.tickers ?? tickers).join("\n"));
  const [name, setName] = useState(() => active?.name ?? "Core");
  const [tags, setTags] = useState(() => active?.tags.join(", ") ?? "");
  const parsed = parseTickers(draft);
  const { dialogRef, initialFocusRef } = useModalDialog(onClose);

  const select = (id: string) => {
    const list = collection.lists.find((candidate) => candidate.id === id);
    if (!list) return;
    setCollection((current) => ({ ...current, activeId: id }));
    setDraft(list.tickers.join("\n"));
    setName(list.name);
    setTags(list.tags.join(", "));
  };

  const newList = () => {
    if (collection.lists.length >= WATCHLIST_COUNT_LIMIT) return;
    const id = `list-${Date.now().toString(36)}`;
    const list: PersonalWatchlist = { id, name: `List ${collection.lists.length + 1}`, tags: [], tickers: [] };
    setCollection((current) => ({ activeId: id, lists: [...current.lists, list] }));
    setName(list.name); setTags(""); setDraft("");
  };

  const removeList = () => {
    if (collection.lists.length <= 1) return;
    const lists = collection.lists.filter((list) => list.id !== collection.activeId);
    setCollection({ activeId: lists[0].id, lists });
    const next = lists[0]; setName(next.name); setTags(next.tags.join(", ")); setDraft(next.tickers.join("\n"));
  };

  const save = () => {
    if (!parsed.length) return;
    const next = {
      ...collection,
      lists: collection.lists.map((list) => list.id === collection.activeId ? {
        ...list,
        name: name.trim().slice(0, 40) || "Untitled",
        tags: [...new Set(tags.split(",").map((tag) => tag.trim().slice(0, 24)).filter(Boolean))].slice(0, 8),
        tickers: parsed,
      } : list),
    };
    writeWatchlistCollection(next);
    onSaved?.(parsed);
    onClose();
  };

  return (
    <div
      className="watchlist-backdrop"
      role="presentation"
      onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}
    >
      <section ref={dialogRef} className="watchlist-editor" role="dialog" aria-modal="true" aria-labelledby="watchlist-editor-title" aria-describedby="watchlist-editor-help" tabIndex={-1}>
        <div className="watchlist-editor-head">
          <div>
            <p className="label">Kept on this device</p>
            <h2 id="watchlist-editor-title">Watchlists</h2>
          </div>
          <button type="button" className="watchlist-close" onClick={onClose} aria-label="Close watchlist editor">×</button>
        </div>
        <div className="watchlist-manager-row">
          <label><span>List</span><select value={collection.activeId} onChange={(event) => select(event.target.value)}>{collection.lists.map((list) => <option key={list.id} value={list.id}>{list.name}</option>)}</select></label>
          <button type="button" className="watchlist-reset" onClick={newList} disabled={collection.lists.length >= WATCHLIST_COUNT_LIMIT}>New list</button>
          <button type="button" className="watchlist-reset" onClick={removeList} disabled={collection.lists.length <= 1}>Delete</button>
        </div>
        <div className="watchlist-manager-fields">
          <label><span>Name</span><input value={name} onChange={(event) => setName(event.target.value)} maxLength={40} /></label>
          <label><span>Tags · comma separated</span><input value={tags} onChange={(event) => setTags(event.target.value)} maxLength={160} placeholder="Income, AI, Review" /></label>
        </div>
        <label className="watchlist-input">
          <span id="watchlist-editor-help">Tickers · separated by spaces, commas or lines</span>
          <textarea ref={initialFocusRef} value={draft} onChange={(event) => setDraft(event.target.value)} spellCheck={false} />
        </label>
        <div className="watchlist-editor-foot">
          <span className="label">{parsed.length} {parsed.length === 1 ? "stock" : "stocks"}</span>
          <div>
            <button type="button" className="watchlist-reset" onClick={() => setDraft(DEFAULT_TICKERS.join("\n"))}>
              Reset {DEFAULT_TICKERS.length}
            </button>
            <button type="button" className="watchlist-save" onClick={save} disabled={!parsed.length}>Save</button>
          </div>
        </div>
      </section>
    </div>
  );
}
