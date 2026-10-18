export type Area={id:string;name:string;crimeTown:string;total:number;counts:Record<string,number>;areaKm2:number;density:number;score:number};
export type AreaContext={metadata:{periodStart:string;periodEnd:string;fetchedAt:string;boundaryYear:number;comparisonAreaCount:number;crimePage:string;boundaryPage:string;scope:string};areas:Area[];assignments:Record<string,{areaId:string;coverage:number;method:string}>};
export function resolveArea(context:AreaContext|null,buildingId:string):Area|undefined{
 const id=context?.assignments[buildingId]?.areaId;
 return id?context?.areas.find(area=>area.id===id):undefined;
}
