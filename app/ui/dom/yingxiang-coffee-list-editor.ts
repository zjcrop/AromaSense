import { recognizeManualText } from "../../core/manual-text-recognizer";
import { SampleRecognitionService, type RecognizedSample } from "../../core/sample-recognition-service";
import { parseSpreadsheetFile, SPREADSHEET_ACCEPT } from "../../core/spreadsheet-import";
import type { ImportSampleDraft } from "../../core/import-bundle";
import type { YingxiangCoffeeDetail } from "../../core/yingxiang-event";
import { manageInteractionLayer } from "../interaction-foundation";
import { attachDragReorder } from "./drag-reorder";

interface CoffeeCandidate { id: string; detail: YingxiangCoffeeDetail; }
export interface YingxiangCoffeeListEditorOptions {
  sampleCodes: readonly string[];
  initial?: readonly (YingxiangCoffeeDetail | undefined)[];
  onChange?(details: readonly (YingxiangCoffeeDetail | undefined)[]): void;
}

const FIELD_KEYS: readonly (keyof YingxiangCoffeeDetail)[] = ["productName","country","region","farm","station","variety","roast","process","roaster","altitude","roastDate","notes"];
function clean(value: unknown): string | undefined { const text=String(value??"").normalize("NFKC").trim(); return text||undefined; }
function metadataString(metadata:Record<string,unknown>,...keys:string[]):string|undefined { for(const key of keys){const value=clean(metadata[key]);if(value)return value;}return undefined; }
function compactDetail(detail:YingxiangCoffeeDetail):YingxiangCoffeeDetail { const result:YingxiangCoffeeDetail={};for(const key of FIELD_KEYS){const value=clean(detail[key]);if(value)result[key]=value;}return result; }
function inferredAwardNote(rawText?:string):string|undefined { const text=clean(rawText);if(!text||!/(?:\bTOH\b|冠军|获奖|winner|award|competition|竞赛)/iu.test(text))return undefined;return text.slice(0,600); }
function detailFromDraft(sample:Pick<ImportSampleDraft,"label"|"metadata"|"rawText">):YingxiangCoffeeDetail {
  const metadata=sample.metadata??{};
  return compactDetail({
    productName:metadataString(metadata,"productName","sourceName")??clean(sample.label),
    country:metadataString(metadata,"country"),region:metadataString(metadata,"region","origin"),farm:metadataString(metadata,"farm"),station:metadataString(metadata,"station"),
    variety:metadataString(metadata,"variety"),roast:metadataString(metadata,"roast"),process:metadataString(metadata,"process"),roaster:metadataString(metadata,"roaster"),
    altitude:metadataString(metadata,"altitude"),roastDate:metadataString(metadata,"roastDate"),
    notes:metadataString(metadata,"notes","remark","remarks","award","awards","other","memo")??inferredAwardNote(sample.rawText)
  });
}
function detailFromRecognized(sample:RecognizedSample):YingxiangCoffeeDetail { return detailFromDraft({label:sample.label,metadata:sample.metadata,rawText:sample.rawText}); }
function summary(detail:YingxiangCoffeeDetail):{title:string;line:string}{const title=clean(detail.productName)??"未命名咖啡";const area=clean(detail.region)??clean(detail.farm)??clean(detail.station);const parts=[detail.country,area,detail.variety,detail.roast].map(clean).filter((v):v is string=>Boolean(v));if(clean(detail.notes))parts.push("……");return{title,line:parts.join("/")||"点击补充真实咖啡信息"};}
function button(label:string):HTMLButtonElement{const b=document.createElement("button");b.type="button";b.textContent=label;return b;}

function styles():void{
  if(document.head.querySelector("style[data-yingxiang-coffee-editor]"))return;
  const s=document.createElement("style");s.dataset.yingxiangCoffeeEditor="true";s.textContent=`
  .yx-coffee-editor{display:grid;gap:11px}.yx-coffee-editor [hidden]{display:none!important}.yx-coffee-editor__tools{display:flex;flex-wrap:wrap;gap:8px}.yx-coffee-editor__tools button{min-height:38px;padding:6px 11px;border:1px solid rgba(185,153,90,.3);border-radius:7px;background:#1d1b17;color:#d8c7a7;font:700 12px/1.2 system-ui,sans-serif}.yx-coffee-editor__status{min-height:18px;margin:0;color:#9f988c;font-size:11px;line-height:1.5;white-space:pre-wrap}
  .yx-coffee-editor__list{display:grid;gap:8px;touch-action:pan-y}.yx-coffee-card{display:grid;grid-template-columns:46px minmax(0,1fr) 28px;gap:9px;align-items:center;min-height:58px;padding:7px;border:1px solid rgba(185,153,90,.2);border-radius:9px;background:#121212;user-select:none}.yx-coffee-card__slot{display:grid;place-items:center;width:46px;height:46px;box-sizing:border-box;border:1px solid rgba(214,173,99,.38);border-radius:7px;background:#1e1b15;color:#e6cf9f;font:700 11px/1 ui-monospace,SFMono-Regular,Consolas,monospace;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.yx-coffee-card__body{min-width:0;cursor:pointer}.yx-coffee-card__title,.yx-coffee-card__detail{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.yx-coffee-card__title{color:#eee7da;font-size:12.5px;font-weight:700}.yx-coffee-card__detail{margin-top:3px;color:#958e84;font-size:10.5px;line-height:1.35}.yx-coffee-card__drag{display:grid;place-items:center;width:28px;height:38px;color:#847a69;cursor:grab;font-size:18px}
  .drag-reorder__placeholder{box-sizing:border-box;border:1px dashed rgba(214,173,99,.42)!important;border-radius:9px!important;background:rgba(214,173,99,.06)!important;transition:transform .16s ease,opacity .16s ease}.drag-reorder__ghost{position:fixed!important;z-index:5000!important;pointer-events:none!important;opacity:.86!important;box-shadow:0 12px 28px rgba(0,0,0,.42)!important;transform:scale(1.015)!important}.drag-reorder--active{cursor:grabbing!important}
  .yx-coffee-editor__paste{display:grid;gap:7px;padding:10px;border:1px solid rgba(185,153,90,.18);border-radius:8px;background:#101010}.yx-coffee-editor__paste textarea{min-height:100px!important}.yx-coffee-edit{position:fixed;inset:0;z-index:5100;display:grid;place-items:center;padding:14px;background:transparent}.yx-coffee-edit__panel{display:grid;gap:11px;width:min(620px,calc(100vw - 28px));max-height:90dvh;overflow:auto;padding:16px;border:1px solid rgba(214,173,99,.3);border-radius:11px;background:#171717}.yx-coffee-edit__grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px}.yx-coffee-edit label{display:grid;gap:5px;color:#a7a095;font-size:11px}.yx-coffee-edit input,.yx-coffee-edit textarea{box-sizing:border-box;width:100%;min-height:40px;padding:7px 9px;border:1px solid rgba(185,153,90,.28);border-radius:7px;background:#101010;color:#eee;font:13px/1.35 system-ui,sans-serif}.yx-coffee-edit textarea{min-height:82px;resize:vertical}.yx-coffee-edit__wide{grid-column:1/-1}.yx-coffee-edit__actions{display:flex;justify-content:flex-end;gap:8px}.yx-coffee-edit button{min-height:40px;padding:7px 12px;border:1px solid rgba(185,153,90,.35);border-radius:7px;background:#211e18;color:#ead8b3;font-weight:700}@media(max-width:520px){.yx-coffee-card{grid-template-columns:42px minmax(0,1fr) 26px}.yx-coffee-card__slot{width:42px;height:42px}.yx-coffee-edit__grid{grid-template-columns:1fr}.yx-coffee-edit__wide{grid-column:auto}}`;
  document.head.append(s);
}

export class YingxiangCoffeeListEditor {
  private readonly recognizer=new SampleRecognitionService();
  private sampleCodes:string[];
  private candidates:(CoffeeCandidate|undefined)[]=[];
  private readonly list=document.createElement("div");
  private readonly status=document.createElement("p");
  private detachDrag?:()=>void;

  constructor(private readonly root:HTMLElement,private readonly options:YingxiangCoffeeListEditorOptions){styles();this.sampleCodes=[...options.sampleCodes];this.candidates=(options.initial??[]).map((detail)=>detail?{id:crypto.randomUUID(),detail:compactDetail(detail)}:undefined);}
  render():void{
    this.root.replaceChildren();this.root.classList.add("yx-coffee-editor");
    const tools=document.createElement("div");tools.className="yx-coffee-editor__tools";const camera=button("拍摄录入"),photos=button("上传图片"),sheet=button("导入表格"),paste=button("粘贴录入"),clear=button("清空真实咖啡");
    const cameraInput=document.createElement("input");cameraInput.type="file";cameraInput.accept="image/*";cameraInput.multiple=true;cameraInput.setAttribute("capture","environment");cameraInput.hidden=true;
    const photoInput=document.createElement("input");photoInput.type="file";photoInput.accept="image/*";photoInput.multiple=true;photoInput.hidden=true;
    const sheetInput=document.createElement("input");sheetInput.type="file";sheetInput.accept=SPREADSHEET_ACCEPT;sheetInput.hidden=true;
    const pasteBox=document.createElement("div");pasteBox.className="yx-coffee-editor__paste";pasteBox.hidden=true;const textarea=document.createElement("textarea");textarea.placeholder="一行一只真实咖啡，可直接粘贴产品名、国家、产区/庄园、豆种、烘焙度、备注等信息。";const apply=button("识别粘贴内容");pasteBox.append(textarea,apply);
    tools.append(camera,photos,sheet,paste,clear,cameraInput,photoInput,sheetInput);this.list.className="yx-coffee-editor__list";this.status.className="yx-coffee-editor__status";this.root.append(tools,pasteBox,this.status,this.list);
    camera.onclick=()=>cameraInput.click();photos.onclick=()=>photoInput.click();sheet.onclick=()=>sheetInput.click();paste.onclick=()=>{pasteBox.hidden=!pasteBox.hidden;if(!pasteBox.hidden)textarea.focus();};clear.onclick=()=>{this.candidates=[];this.status.textContent="已清空真实咖啡对应关系。";this.renderList();this.emit();};
    cameraInput.onchange=()=>void this.importPhotos([...(cameraInput.files??[])]);photoInput.onchange=()=>void this.importPhotos([...(photoInput.files??[])]);sheetInput.onchange=()=>{const file=sheetInput.files?.[0];if(file)void this.importSheet(file);};
    apply.onclick=()=>{const text=textarea.value.trim();if(!text)return;try{const bundle=recognizeManualText(text);this.accept(bundle.sessions.flatMap((session)=>session.samples).map(detailFromDraft),"粘贴内容");pasteBox.hidden=true;}catch(error){this.status.textContent=error instanceof Error?error.message:String(error);}};this.renderList();
  }
  setSampleCodes(codes:readonly string[]):void{this.sampleCodes=[...codes];this.renderList();this.emit();}
  values():readonly(YingxiangCoffeeDetail|undefined)[]{return this.sampleCodes.map((_,index)=>this.candidates[index]?.detail);}
  dispose():void{this.detachDrag?.();this.detachDrag=undefined;}
  private async importPhotos(files:readonly File[]):Promise<void>{if(!files.length)return;this.status.textContent=`正在识别 ${files.length} 张图片…`;const results=await this.recognizer.recognizeBatch(files,(p)=>{this.status.textContent=`${p.index}/${p.total} ${p.fileName} · ${p.message??p.status}`;});const details=results.flatMap((page)=>page instanceof Error?[]:page.samples.map(detailFromRecognized));if(!details.length){this.status.textContent="图片未形成可用的咖啡条目，请补拍或改用粘贴录入。";return;}this.accept(details,"图片");}
  private async importSheet(file:File):Promise<void>{this.status.textContent=`正在读取 ${file.name}…`;try{const bundle=await parseSpreadsheetFile(file);this.accept(bundle.sessions.flatMap((session)=>session.samples).map(detailFromDraft),file.name);if(bundle.warnings.length)this.status.textContent+=`\n${bundle.warnings.join("\n")}`;}catch(error){this.status.textContent=error instanceof Error?error.message:String(error);}}
  private accept(details:readonly YingxiangCoffeeDetail[],source:string):void{this.candidates=details.map((detail)=>({id:crypto.randomUUID(),detail:compactDetail(detail)}));const mapped=Math.min(this.sampleCodes.length,details.length);this.status.textContent=`${source}录入 ${details.length} 条；当前按顺序对应 ${mapped}/${this.sampleCodes.length} 个样品。长按（触屏）或拖动右侧手柄可调整顺序。`;this.renderList();this.emit();}
  private renderList():void{
    this.detachDrag?.();this.list.replaceChildren();const count=Math.max(this.sampleCodes.length,this.candidates.length);
    for(let index=0;index<count;index+=1){const candidate=this.candidates[index],code=this.sampleCodes[index]??`+${index+1}`;const card=document.createElement("div");card.className="yx-coffee-card";card.dataset.coffeeId=candidate?.id??`empty-${index}`;const slot=document.createElement("div");slot.className="yx-coffee-card__slot";slot.textContent=code;slot.title=code;const body=document.createElement("div");body.className="yx-coffee-card__body";
      if(candidate){const text=summary(candidate.detail),title=document.createElement("div"),detail=document.createElement("div");title.className="yx-coffee-card__title";title.textContent=text.title;detail.className="yx-coffee-card__detail";detail.textContent=text.line;body.append(title,detail);body.onclick=()=>this.edit(candidate);}else{const title=document.createElement("div"),detail=document.createElement("div");title.className="yx-coffee-card__title";title.textContent="尚未对应真实咖啡";detail.className="yx-coffee-card__detail";detail.textContent="可继续拍照、导入表格或粘贴录入";body.append(title,detail);}const drag=document.createElement("div");drag.className="yx-coffee-card__drag";drag.dataset.dragHandle="true";drag.textContent=candidate?"↕":"";card.append(slot,body,drag);this.list.append(card);}
    const movable=this.candidates.filter((v):v is CoffeeCandidate=>Boolean(v));if(movable.length>1){this.detachDrag=attachDragReorder(this.list,{itemSelector:".yx-coffee-card",itemIdAttribute:"data-coffee-id",handleSelector:"[data-drag-handle]",onReorder:(ids)=>{const byId=new Map(movable.map((candidate)=>[candidate.id,candidate] as const));const ordered=ids.flatMap((id)=>byId.get(id)?[byId.get(id)!]:[]);if(ordered.length===movable.length)this.candidates=ordered;this.renderList();this.emit();}});}
  }
  private edit(candidate:CoffeeCandidate):void{
    const overlay=document.createElement("div");overlay.className="yx-coffee-edit";const panel=document.createElement("div");panel.className="yx-coffee-edit__panel";panel.append(Object.assign(document.createElement("strong"),{textContent:"编辑真实咖啡"}));const grid=document.createElement("div");grid.className="yx-coffee-edit__grid";
    const labels:Record<keyof YingxiangCoffeeDetail,string>={productName:"产品名",country:"国家",region:"产区",farm:"庄园/农场",station:"处理站",variety:"豆种",roast:"烘焙度",process:"处理法",roaster:"烘焙商",altitude:"海拔",roastDate:"烘焙日期",notes:"其他信息 / 备注"};const fields=new Map<keyof YingxiangCoffeeDetail,HTMLInputElement|HTMLTextAreaElement>();
    for(const key of FIELD_KEYS){const wrapper=document.createElement("label");if(key==="notes")wrapper.className="yx-coffee-edit__wide";wrapper.append(document.createTextNode(labels[key]));const control=key==="notes"?document.createElement("textarea"):document.createElement("input");control.value=candidate.detail[key]??"";wrapper.append(control);fields.set(key,control);grid.append(wrapper);}const actions=document.createElement("div");actions.className="yx-coffee-edit__actions";const remove=button("删除条目"),cancel=button("取消"),save=button("保存");actions.append(remove,cancel,save);panel.append(grid,actions);overlay.append(panel);document.body.append(overlay);manageInteractionLayer(overlay,"dialog");cancel.onclick=()=>overlay.remove();remove.onclick=()=>{this.candidates=this.candidates.map((item)=>item?.id===candidate.id?undefined:item);overlay.remove();this.renderList();this.emit();};save.onclick=()=>{const next:YingxiangCoffeeDetail={};for(const key of FIELD_KEYS){const value=clean(fields.get(key)?.value);if(value)next[key]=value;}candidate.detail=next;overlay.remove();this.renderList();this.emit();};overlay.addEventListener("pointerdown",(event)=>{if(event.target===overlay)overlay.remove();});overlay.addEventListener("aromasense:request-overlay-dismiss",(event)=>{event.preventDefault();overlay.remove();});
  }
  private emit():void{this.options.onChange?.(this.values());}
}
