export interface BackendSession {
  user:{id:string;name:string;email:string;role:string};
  tenant:{id:string;name:string;currency:string;timeZone:string};
  outlet:{id:string;name:string}; deviceId:string; csrfToken:string;
}
export interface BackendProduct { id:string;sku:string;name:string;unit:string;currency:string;sellingPriceMinor:number;costPriceMinor:number;taxRateBps:number;quantity:string;version:number }
export interface BackendShift { id:string;status:'OPEN';openingFloatMinor:number;cashSalesMinor:number;expectedCashMinor:number;version:number;openedAt:string }
export interface BackendCommand { protocolVersion:1;commandId:string;tenantId?:string;deviceId:string;type:string;occurredAt:string;expectedVersions:Record<string,number>;payload:Record<string,unknown> }

class ApiClient {
  private csrf=''; private session:BackendSession|null=null; private listeners=new Set<(session:BackendSession|null)=>void>();
  subscribe(listener:(session:BackendSession|null)=>void){this.listeners.add(listener);return()=>this.listeners.delete(listener)}
  getSession(){return this.session}
  private publish(session:BackendSession|null){this.session=session;this.listeners.forEach(listener=>listener(session))}
  private async request<T>(path:string,init:RequestInit={}):Promise<T>{
    const headers=new Headers(init.headers); if(init.body)headers.set('content-type','application/json');
    if(['POST','PUT','PATCH','DELETE'].includes(init.method??'GET')&&this.csrf)headers.set('x-csrf-token',this.csrf);
    let response:Response; try { response=await fetch(`/api/v1${path}`,{...init,headers,credentials:'include'}); }
    catch { throw new Error('Connection outcome is unknown. Keep the command ID and check its status before retrying.'); }
    const body=await response.json().catch(()=>({}));
    if(!response.ok)throw Object.assign(new Error(body?.error?.message??`Request failed (${response.status}).`),{status:response.status,code:body?.error?.code});
    return body as T;
  }
  async login(email:string,password:string){const s=await this.request<BackendSession>('/auth/login',{method:'POST',body:JSON.stringify({email,password})});this.csrf=s.csrfToken;this.publish(s);return s}
  async restore(){try{const s=await this.request<BackendSession>('/auth/me');this.csrf=s.csrfToken;this.publish(s);return s}catch{this.csrf='';this.publish(null);return null}}
  async logout(){try{await this.request('/auth/logout',{method:'POST'})}finally{this.csrf='';this.publish(null)}}
  listCatalog(){return this.request<{items:BackendProduct[]}>('/catalog/items')}
  getCurrentShift(){return this.request<{shift:BackendShift|null}>('/shifts/current')}
  submitCommand(command:BackendCommand){return this.request<{commandId:string;status:string;value?:Record<string,unknown>;message?:string;code?:string}>('/commands',{method:'POST',body:JSON.stringify(command)})}
  checkCommandStatus(commandId:string){return this.request<{commandId:string;status:string;response:Record<string,unknown>}>('/commands/'+encodeURIComponent(commandId))}
}
export const apiClient=new ApiClient();
