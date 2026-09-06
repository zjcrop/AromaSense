import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { NodeSQLiteDriver } from "../app/storage/node-sqlite-driver";
import { LocalCuppingRepository } from "../app/storage/local-cupping-repository";
import { YingxiangParticipationService } from "../app/core/yingxiang-participation-service";
import { YingxiangDeliveryService } from "../app/core/yingxiang-delivery-service";
import { YingxiangClientError, type YingxiangParticipantStatus } from "../app/core/yingxiang-client";
import { buildYingxiangManifest, defaultYingxiangEventPolicy } from "../app/core/yingxiang-event";
import type { SubmissionBundle } from "../app/core/submission-bundle";

test("guest delivery survives a lost ACK and database reopen without changing revision or losing local records",async()=>{
  const dir=mkdtempSync(join(tmpdir(),"yx-delivery-"));let db=NodeSQLiteDriver.open(join(dir,"test.db"));
  const now="2026-09-06T10:00:00.000Z";const token="b".repeat(64);
  try{
    for(const f of readdirSync("app/storage").filter(f=>/^\d{4}.*\.sql$/.test(f)).sort())db.exec(readFileSync(`app/storage/${f}`,"utf8"));
    const event={schemaVersion:"yingxiang-event/0.1" as const,eventId:"event",eventRevision:1,title:"Guest session",status:"published" as const,policy:defaultYingxiangEventPolicy(),manifest:buildYingxiangManifest({organizerName:"Lab",cuppingMode:"blind",sampleCodes:["A01"]}),createdAt:now,updatedAt:now};
    const principal={schemaVersion:"yingxiang-principal/0.1" as const,participantId:"p1",eventId:"event",identityKind:"guest" as const,displayName:"Guest",accountDisplayNameHidden:true as const,status:"active" as const,boundAt:now};
    const joined={event,principal,replayed:false,accessToken:token};
    const joiner=new YingxiangParticipationService(db,{async previewInvite(){return{event,invite:{inviteId:"i1",remainingUses:1,expiresAt:now}};},async joinInvite(){return joined;}},{now:()=>now,createSessionId:()=>"session",createSampleId:()=>"sample"});
    await joiner.join({token:"a".repeat(48),joinRequestId:`join:${crypto.randomUUID()}`,displayName:"Guest"});
    const repo=new LocalCuppingRepository(db);const session=await repo.getSession("session");await repo.saveObservation({observationId:"o1",sessionId:"session",sampleId:"sample",stageId:"scoring",fieldKey:"score_confirmed",value:true,dictionaryVersion:"v1",updatedAt:now});
    await repo.saveSession({...session,status:"completed",completedAt:now});
    let lost=true;let state:"active"|"released"="active";const sent:SubmissionBundle[]=[];
    const remote={
      async participantStatus():Promise<YingxiangParticipantStatus>{return{event,participant:{participantId:"p1",displayName:"Guest",status:state,releasedAt:state==="released"?now:undefined},ack:null};},
      async sendProgress(){return{};},
      async submit(_id:string,credential:string,bundle:SubmissionBundle){assert.equal(credential,token);sent.push(bundle);if(lost)throw new YingxiangClientError("NETWORK_ERROR",0,"响应途中断网");return{revision:bundle.revision,contentHash:bundle.contentHash};},
      async leave(){return{};}
    };
    await new YingxiangDeliveryService(db,remote,()=>now).sync();assert.equal(sent.length,1);
    assert.match((await db.get<{last_error:string}>("SELECT last_error FROM yingxiang_delivery"))!.last_error,/断网/);
    db.close();db=NodeSQLiteDriver.open(join(dir,"test.db"));lost=false;
    const resumed=new YingxiangDeliveryService(db,remote,()=>"2026-09-06T10:10:00.000Z");await resumed.sync();assert.equal(sent.length,2);assert.equal(sent[1].revision,sent[0].revision);assert.equal(sent[1].contentHash,sent[0].contentHash);
    const delivery=(await resumed.list())[0];assert.equal(delivery.ack_hash,sent[1].contentHash);assert.equal(delivery.last_error,null);
    state="released";await resumed.sync();assert.equal(sent.length,2);
    assert.equal((await db.get<{status:string}>("SELECT status FROM yingxiang_event_principals"))!.status,"released");
    assert.equal((await new LocalCuppingRepository(db).listObservationsForSession("session")).length,1);
  }finally{db.close();rmSync(dir,{recursive:true,force:true});}
});
