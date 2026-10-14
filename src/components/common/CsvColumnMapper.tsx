import React from 'react';

export interface CsvMappingField {key:string;label:string;detail?:string;required?:boolean}

export function CsvColumnMapper({headers,fields,mapping,onChange,disabled=false}:{
  headers:string[];fields:CsvMappingField[];mapping:Record<string,string|null>;onChange:(field:string,column:string|null)=>void;disabled?:boolean;
}) {
  return <fieldset disabled={disabled} className="grid min-w-0 gap-4 sm:grid-cols-2 lg:grid-cols-3">
    <legend className="mb-4 text-base font-semibold text-zinc-100">Match CSV columns</legend>
    {fields.map(field=><label key={field.key} className="block min-w-0 text-sm text-zinc-300">
      <span>{field.label}{field.required?' (required)':''}</span>
      <select aria-label={'CSV column for '+field.label} value={mapping[field.key]??''} onChange={event=>onChange(field.key,event.target.value||null)} className="mt-2 min-h-11 w-full min-w-0 rounded-lg border border-zinc-700 bg-zinc-950 px-3 text-zinc-100 disabled:opacity-50">
        <option value="">Not mapped</option>
        {headers.map((header,index)=><option key={`${index}-${header}`} value={header}>{header||`Empty header (column ${index+1})`}</option>)}
      </select>
      {field.detail&&<small className="mt-1 block text-xs leading-5 text-zinc-400">{field.detail}</small>}
    </label>)}
  </fieldset>;
}
