export interface HistoryPage { nextCursor:string|null;asOf:string;totalCount:number;hasMore:boolean;limit:number }
export interface HistoryOptions { after?:string;limit?:number;q?:string }
export function historyUrl(path:string,options:HistoryOptions={}) {
  const query=new URLSearchParams();
  if(options.after)query.set('after',options.after);
  if(options.q)query.set('q',options.q);
  if(options.limit!==undefined)query.set('limit',String(options.limit));
  return path+(query.size?'?'+query:'');
}
