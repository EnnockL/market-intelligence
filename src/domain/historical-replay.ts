import { deterministicDigest } from "./events";

export const HISTORICAL_REPLAY_VERSION = "historical-replay-v1";
export const REPLAY_ORDERING_VERSION = "available-at-kind-id-v1";
export type ReplayItemKind = "EVENT" | "CANDIDATE_REVISION" | "QUALIFICATION";
export interface ReplaySourceItem { kind:ReplayItemKind; sourceId:string; availableAt:string; occurredAt:string; assetId:string|null; entityId:string; summary:string; state:string|null; dataQuality:number|null; evidenceRefs:string[]; }
export interface ReplayCursor { availableAt:string; kind:ReplayItemKind; sourceId:string; }
export interface ReplayState { replayTime:string; processed:number; counts:Record<ReplayItemKind,number>; latestCandidateState:Record<string,string>; unknownCount:number; cursor:ReplayCursor|null; }
const priority:Record<ReplayItemKind,number>={EVENT:0,CANDIDATE_REVISION:1,QUALIFICATION:2};
export function compareReplayItems(a:ReplaySourceItem,b:ReplaySourceItem){return a.availableAt.localeCompare(b.availableAt)||priority[a.kind]-priority[b.kind]||a.sourceId.localeCompare(b.sourceId)}
export function replayDatasetHash(items:ReplaySourceItem[]){return deterministicDigest([...items].sort(compareReplayItems).map(x=>({kind:x.kind,id:x.sourceId,availableAt:x.availableAt,evidence:x.evidenceRefs})));}
export function advanceReplay(items:ReplaySourceItem[],previous:ReplayState|null,until:string,limit=500){
  const sorted=[...items].filter(x=>x.availableAt<=until).sort(compareReplayItems), remaining=previous?.cursor?sorted.filter(x=>compareCursor(x,previous.cursor!)>0):sorted, batch=remaining.slice(0,Math.max(1,limit));
  const state:ReplayState=previous?{...previous,counts:{...previous.counts},latestCandidateState:{...previous.latestCandidateState}}:{replayTime:until,processed:0,counts:{EVENT:0,CANDIDATE_REVISION:0,QUALIFICATION:0},latestCandidateState:{},unknownCount:0,cursor:null};
  for(const item of batch){state.processed++;state.counts[item.kind]++;if(item.kind!=="EVENT"&&item.state)state.latestCandidateState[item.entityId]=item.state;if(item.dataQuality===null)state.unknownCount++;state.cursor={availableAt:item.availableAt,kind:item.kind,sourceId:item.sourceId};}
  state.replayTime=until;return{state,batch,hasMore:remaining.length>batch.length,stateHash:deterministicDigest(state)};
}
function compareCursor(item:ReplaySourceItem,cursor:ReplayCursor){return item.availableAt.localeCompare(cursor.availableAt)||priority[item.kind]-priority[cursor.kind]||item.sourceId.localeCompare(cursor.sourceId)}
