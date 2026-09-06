import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { buildSync } from "esbuild";
import { buildSubmissionBundle } from "../app/core/submission-bundle";
import { defaultYingxiangEventPolicy, buildYingxiangManifest } from "../app/core/yingxiang-event";
import { aggregateYingxiangResults, validateYingxiangSubmission } from "../shared/yingxiang-results";
import type { CuppingRecordSnapshot } from "../app/core/session-record-service";

const dir=mkdtempSync(join(tmpdir(),"yingxiang-api-test-"));
buildSync({entryPoints:["cloud/worker/src/yingxiang-api.ts","cloud/worker/src/yingxiang-management-api.ts"],bundle:true,platform:"node",format:"cjs",outdir:dir,outExtension:{".js":".cjs"}});
const api=require(join(dir,"yingxiang-api.cjs"));
const management=require(join(dir,"yingxiang-management-api.cjs"));
rmSync(dir,{recursive:true,force:true});

class D1 {
  readonly sqlite=new DatabaseSync(":memory:");
  constructor(){this.sqlite.exec("PRAGMA foreign_keys=ON;CREATE TABLE users(user_id TEXT PRIMARY KEY,email TEXT);");for(const f of ["0007_yingxiang_events.sql","0008_account_display_name.sql","0009_yingxiang_collection.sql"])this.sqlite.exec(readFileSync(`cloud/worker/migrations/${f}`,"utf8"));this.sqlite.exec("INSERT INTO users(user_id,email) VALUES ('host','host@example.invalid'),('other','other@example.invalid')");}
  prepare(sql:string){const db=this.sqlite;let params:any[]=[];const bound=()=>{const values:any[]=[];const text=sql.replace(/\?(\d+)/g,(_,n)=>{values.push(params[Number(n)-1]);return "?";});return {s:db.prepare(text),values};};return {
    bind(...args:any[]){params=args;return this;},
    async first(){const {s,values}=bound();return s.get(...values)??null;},
    async all(){const {s,values}=bound();return {results:s.all(...values)};},
    async run(){const {s,values}=bound();const r=s.run(...values);return {success:true,meta:{changes:Number(r.changes)}};}
  };}
  async batch(statements:any[]){this.sqlite.exec("BEGIN");try{const r=[];for(const s of statements)r.push(await s.run());this.sqlite.exec("COMMIT");return r;}catch(e){this.sqlite.exec("ROLLBACK");throw e;}}
}
async function call(db:D1,path:string,body?:unknown,owner="host",token?:string){const request=new Request(`https://example.invalid/api/v1/yingxiang/${path}`,{method:body===undefined?"GET":"POST",headers:{"content-type":"application/json",...(token?{authorization:`Bearer ${token}`}:{})},body:body===undefined?undefined:JSON.stringify(body)});const url=new URL(request.url);const user={userId:owner,email:`${owner}@example.invalid`};const response:Response=await management.handleYingxiangParticipantRoute(request,url,db)??await api.handleYingxiangPublicRoute(request,url,db)??await management.handleYingxiangManagementRoute(request,url,db,user)??await api.handleYingxiangAuthenticatedRoute(request,url,db,user,"https://example.invalid");return {status:response.status,body:await response.json() as any};}

function record(eventId:string,revision=1,offset=0):CuppingRecordSnapshot {
  const now="2026-09-06T01:00:00.000Z";const sessionId=`local-${offset}`;
  const samples=[1,2].map(i=>({sampleId:`s${i}`,sessionId,displayNumber:i,sortOrder:i,label:`S${i}`,metadata:{eventSampleId:`slot-00${i}`,sampleCode:`S${i}`},createdAt:now,updatedAt:now}));
  return {version:"AromaSense-B0.2.a",exportedAt:now,session:{sessionId,status:"completed",metadata:{date:"2026-09-06",time:"09:00",organizer:"Lab",eventId,eventRevision:revision},taxonomyVersion:"sensory-flow/2.0",createdAt:now,updatedAt:now,completedAt:now},samples,stageStates:[],observations:samples.flatMap((s,i)=>[
    {observationId:`${s.sampleId}-a`,sessionId,sampleId:s.sampleId,stageId:"high_temp" as const,fieldKey:"acidity_intensity",value:4+i*2+offset,dictionaryVersion:"v1",updatedAt:now},
    {observationId:`${s.sampleId}-s`,sessionId,sampleId:s.sampleId,stageId:"scoring" as const,fieldKey:"score_confirmed",value:true,dictionaryVersion:"v1",updatedAt:now}
  ])};
}

test("Yingxiang cloud: owner isolation, guest credentials, immutable submissions, progress, release and edit locks",async()=>{
  const db=new D1();try{
    const manifest=buildYingxiangManifest({organizerName:"Lab",cuppingMode:"blind",sampleCodes:["S1","S2"]});
    const policy=defaultYingxiangEventPolicy();const created=await call(db,"events",{title:"Test",policy,manifest:{...manifest,samples:manifest.samples.map(s=>({...s,label:"Hidden coffee"}))}});assert.equal(created.status,201);const event=created.body.event;
    assert.equal((await call(db,`events/${event.eventId}/dashboard`,undefined,"other")).status,404);
    const invite=(await call(db,`events/${event.eventId}/invites`,{maxUses:1})).body;
    const preview=await call(db,`invites/${invite.token}`);assert.equal(preview.body.event.manifest.samples[0].label,undefined);
    const joinId=`join:${crypto.randomUUID()}`;const joined=await call(db,`invites/${invite.token}/join`,{joinRequestId:joinId,displayName:"P1"});assert.equal(joined.status,201);const p=joined.body.principal.participantId,token=joined.body.accessToken;assert.match(token,/^[a-f0-9]{64}$/);
    const replay=await call(db,`invites/${invite.token}/join`,{joinRequestId:joinId,displayName:"Changed"});assert.equal(replay.body.accessToken,token);assert.equal(replay.body.principal.displayName,"P1");assert.equal(replay.body.replayed,true);
    assert.equal((await call(db,`invites/${invite.token}/join`,{joinRequestId:`join:${crypto.randomUUID()}`,displayName:"P2"})).status,410);
    assert.equal((await call(db,`participants/${p}/status`,undefined,"host","a".repeat(64))).status,401);
    const locked=await call(db,`events/${event.eventId}/republish`,{expectedRevision:1,title:"Other",policy,manifest});assert.equal(locked.body.error,"YINGXIANG_EVENT_STRUCTURE_LOCKED");
    const rename=await call(db,`events/${event.eventId}/republish`,{expectedRevision:1,title:"Renamed",policy,manifest:event.manifest});assert.equal(rename.status,200);assert.equal(rename.body.event.eventRevision,2);
    const replayAfterRename=await call(db,`invites/${invite.token}/join`,{joinRequestId:joinId,displayName:"Changed again"});assert.equal(replayAfterRename.body.event.eventRevision,1);assert.equal(replayAfterRename.body.accessToken,token);
    const participantStatus=await call(db,`participants/${p}/status`,undefined,"host",token);assert.equal(participantStatus.body.event.eventRevision,1);
    assert.equal((await call(db,`events/${event.eventId}/republish`,{expectedRevision:1,title:"Stale",policy,manifest:event.manifest})).status,409);
    const progress={sessionId:"local-0",sequence:2,completedSamples:1,totalSamples:2};assert.equal((await call(db,`participants/${p}/progress`,progress,"host",token)).status,200);
    await call(db,`participants/${p}/progress`,{...progress,sequence:1,completedSamples:0},"host",token);
    assert.equal((await call(db,`events/${event.eventId}/dashboard`)).body.participants[0].completedSamples,1);
    const bundle=await buildSubmissionBundle(record(event.eventId));
    assert.equal((await call(db,`participants/${p}/submissions`,{bundle},"host",token)).status,201);
    assert.equal((await call(db,`participants/${p}/submissions`,{bundle},"host",token)).body.status,"already_present");
    const forged=structuredClone(bundle);forged.record.observations[0].value=14;
    assert.equal((await call(db,`participants/${p}/submissions`,{bundle:forged},"host",token)).body.error,"YINGXIANG_SUBMISSION_HASH_MISMATCH");
    const changed=await buildSubmissionBundle({...bundle.record,observations:bundle.record.observations.map(o=>o.fieldKey==="acidity_intensity"?{...o,value:10}:o)},1);
    assert.equal((await call(db,`participants/${p}/submissions`,{bundle:changed},"host",token)).body.error,"YINGXIANG_SUBMISSION_CONFLICT");
    const group=await call(db,`events/${event.eventId}/calibration-groups`,{canonicalSampleId:"Coffee A",eventSampleIds:["slot-001","slot-002"],revealPolicy:"organizer_only"});assert.equal(group.status,201);
    const dash=(await call(db,`events/${event.eventId}/dashboard`)).body;assert.equal(dash.results.submissions,1);assert.equal(dash.results.calibration[0].mean,5);assert.equal(dash.results.calibration[0].offsetFromPeers,null);
    assert.doesNotMatch(JSON.stringify(dash),new RegExp(`${token}|${joinId}|token_hash|join_request_id|account_user_id|host@example`));
    await call(db,`events/${event.eventId}/complete`,{});const status=(await call(db,`participants/${p}/status`,undefined,"host",token)).body;assert.equal(status.participant.status,"released");
    assert.equal((await call(db,`participants/${p}/submissions`,{bundle},"host",token)).status,200);
    assert.equal((await call(db,`participants/${p}/submissions`,{bundle:{...changed,revision:2}},"host",token)).status,410);
    const secondComplete=await call(db,`events/${event.eventId}/complete`,{});assert.equal(secondComplete.body.eventRevision,3);
  }finally{db.sqlite.close();}
});

test("participant creation and capability creation roll back together",async()=>{
  const db=new D1();try{
    const manifest=buildYingxiangManifest({organizerName:"Lab",cuppingMode:"blind",sampleCodes:["S1","S2"]});
    const created=await call(db,"events",{title:"Atomic join",policy:defaultYingxiangEventPolicy(),manifest});
    const invite=(await call(db,`events/${created.body.event.eventId}/invites`,{maxUses:1})).body;
    db.sqlite.exec("DROP TABLE yingxiang_participant_access");
    const joined=await call(db,`invites/${invite.token}/join`,{joinRequestId:`join:${crypto.randomUUID()}`,displayName:"P1"});
    assert.equal(joined.status,409);
    assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS n FROM yingxiang_participants").get()!.n,0);
    assert.equal(db.sqlite.prepare("SELECT use_count FROM yingxiang_invites WHERE invite_id=?").get(invite.inviteId)!.use_count,0);
  }finally{db.sqlite.close();}
});

test("results separate stages, use latest revisions, keep zeros, and require complete repeat sets for peer offsets",async()=>{
  const first=await buildSubmissionBundle(record("event"));const second=await buildSubmissionBundle(record("event",1,2));const third=await buildSubmissionBundle({...record("event"),observations:record("event").observations.map(o=>o.fieldKey==="acidity_intensity"?{...o,value:0}:o)},2);
  const rows=[{participantId:"p1",displayName:"A",bundle:first},{participantId:"p2",displayName:"B",bundle:second},{participantId:"p1",displayName:"A",bundle:third}];
  const groups=[{groupId:"g",canonicalSampleId:"coffee",eventSampleIds:["slot-001","slot-002"],revealPolicy:"organizer_only" as const}];
  const result=aggregateYingxiangResults(rows,first.eventBindings,groups);assert.equal(result.submissions,2);assert.equal(result.metrics[0].count,2);assert.equal(result.metrics[0].mean,3);
  assert.equal(result.calibration.find(r=>r.participantId==="p1")!.offsetFromPeers,-7);
  const missing=structuredClone(second);missing.record.observations=missing.record.observations.filter(o=>o.sampleId!=="s2");assert.equal(aggregateYingxiangResults([{...rows[1],bundle:missing}],first.eventBindings,groups).calibration.length,0);
  const invalid=structuredClone(first);invalid.record.samples[1].metadata.eventSampleId="slot-001";await assert.rejects(validateYingxiangSubmission(invalid,"event",1,first.eventBindings),/SUBMISSION_INVALID/);
  const noScore=structuredClone(first);noScore.record.observations=noScore.record.observations.filter(o=>o.fieldKey!=="score_confirmed");await assert.rejects(validateYingxiangSubmission(noScore,"event",1,first.eventBindings),/FINAL_SCORES_REQUIRED/);
  const invalidScale=await buildSubmissionBundle({...record("event"),observations:[...record("event").observations,{observationId:"invalid-quality",sessionId:"local-0",sampleId:"s1",stageId:"overall",fieldKey:"quality_balance",value:10,dictionaryVersion:"v1",updatedAt:"2026-09-06T01:00:00.000Z"}]});
  await assert.rejects(validateYingxiangSubmission(invalidScale,"event",1,first.eventBindings),/SUBMISSION_INVALID/);
});
