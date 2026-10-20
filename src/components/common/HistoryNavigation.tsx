import React,{useState} from 'react';
import type {HistoryPage} from '../../types/history';

export function HistoryNavigation({page,loaded,busy,onMore,onSearch,label='history'}:{
  page?:HistoryPage;loaded:number;busy:boolean;onMore:()=>void;onSearch?:(value:string)=>void;label?:string;
}) {
  const [search,setSearch]=useState('');
  return <div className="flex flex-wrap items-end gap-3 border-t border-zinc-800 p-4 text-xs text-zinc-400">
    <p role="status">{loaded} shown{page?` of ${page.totalCount} matching records`:' records'}{page?.hasMore?' · older records available':''}</p>
    {onSearch&&<form className="flex flex-wrap items-end gap-2" onSubmit={event=>{event.preventDefault();onSearch(search);}}>
      <label>Search {label}<input aria-label={`Search ${label}`} maxLength={128} value={search} onChange={event=>setSearch(event.target.value)} className="mt-1 block min-h-11 rounded-lg border border-zinc-700 bg-zinc-900 px-3 text-white"/></label>
      <button type="submit" disabled={busy} className="min-h-11 rounded-lg border border-zinc-700 px-3 disabled:opacity-50">Search records</button>
    </form>}
    {page?.nextCursor&&<button type="button" disabled={busy} onClick={onMore} className="min-h-11 rounded-lg border border-zinc-700 px-3 text-zinc-200 disabled:opacity-50">{busy?'Loading records…':'Load older records'}</button>}
  </div>;
}
