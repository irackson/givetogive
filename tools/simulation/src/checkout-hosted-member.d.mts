import type {validateInput} from './hosted-checkout-policy.ts';
export function validateMemberStart(raw:unknown,environment:unknown,platform:string,nodeMajor:number,now:number):{
 protocol:1;kind:'checkout-member-start';expectedHead:string;
 binding:{manifestDigest:string;connectionNonce:string};input:ReturnType<typeof validateInput>;
};
export function executeCheckoutMember():Promise<void>;
