import type { CatalogItemKind } from './catalog';
import type { HistoryPage } from './history';

export interface RestaurantSection { id:string;name:string;active:boolean;version:number }
export interface RestaurantTable { id:string;name:string;sectionId:string|null;seats:number;active:boolean;version:number }
export interface RestaurantStation { id:string;name:string;kind:'KITCHEN'|'BAR'|'EXPO';charactersPerLine:number;active:boolean;version:number }
export interface RestaurantMenuRoute { productId:string;productName:string;sku:string;itemKind:CatalogItemKind;productVersion:number;productActive:boolean;currency:string;sellingPriceMinor:number;taxRateBps:number;stationIds:string[];preparationLabel:string;instructions:string;available:boolean;effectiveAvailable:boolean;version:number }
export interface RestaurantStationAssignment { deviceId:string;stationIds:string[];version:number;deviceVersion:number;effectiveActive:boolean }
export interface RestaurantDevice { id:string;label:string;active:boolean;version:number }
export interface RestaurantProduct { id:string;sku:string;name:string;itemKind:CatalogItemKind;version:number;active:boolean;currency:string;sellingPriceMinor:number;taxRateBps:number }
export interface RestaurantConfiguration {
  sections:RestaurantSection[];tables:RestaurantTable[];stations:RestaurantStation[];
  menuRoutes:RestaurantMenuRoute[];stationAssignments:RestaurantStationAssignment[];
  devices:RestaurantDevice[];products:RestaurantProduct[];
  productPage:HistoryPage|null;
  permissions:{manage:boolean;assignDevices:boolean};
  availability:{ordering:boolean;fire:boolean;kds:false;printing:false;roomCharge:false;recipeConsumption:false};
  limits:{sections:number;tables:number;stations:number;menuRoutes:number};
}
