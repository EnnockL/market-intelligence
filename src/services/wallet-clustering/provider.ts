import type{WalletRelationshipFeature}from"@/domain/wallet-clustering";
export interface WalletRelationshipDataProvider{readonly name:string;loadFeatures(cutoff:string,limit:number):Promise<WalletRelationshipFeature[]>;}
