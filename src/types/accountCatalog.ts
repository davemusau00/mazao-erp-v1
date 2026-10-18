export interface AccountCatalog {
  version:number;generatedAt:string;labelPolicy:'CURRENT_VERSIONED_LABELS';
  accounts:Array<{accountCode:string;label:string;classification:string;systemDefined:true}>;
  permissions:{manage:boolean};
  coverage:string;
}
