export function validateCurrentOperatorSnapshot(data:unknown,plan:unknown,prepared?:boolean):{
 targets:{actorId:string;customerAccountId:string;clockId:string}[];frozenTime:number;payments:Record<string,unknown>[]};
export function inspectCurrentCheckoutPrerequisites(boundary?:'unused'|{financialState:'unadmitted'|'reserved'|'submitted';noticeConsumed:boolean;headSha:string}):Promise<{
 budget:unknown;target:{actorId:string;customerAccountId:string;clockId:string;frozenTime:number;sessionId?:string};summary:Record<string,unknown>}>;
