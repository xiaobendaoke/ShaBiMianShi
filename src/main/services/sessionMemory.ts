import crypto from 'node:crypto';
import type {SessionMemory,MemoryEntry,TurnRecord} from '../types';
import {projectAliases} from './projectFocus';
export interface MemorySource {id:string;type:'document'|'user';text:string;}
export function selectedProject(memory:SessionMemory,question:string) {
  const explicit=question.trim().match(/^(?:切换到|换到|回到)([^，。？！?]{1,60}?项目)/)?.[1];
  const projects=[...new Set(memory.entries.map(e=>e.project))].filter(p=>p&&p!=='未归类');
  const q=question.normalize('NFKC').toLowerCase().replace(/yolov(?=\d)/g,'yolo').replace(/[\s_\-]/g,'');
  const scores=projects.map(project=>({project,score:projectAliases(project).filter(a=>q.includes(a)).reduce((n,a)=>n+(/\d/.test(a)?8:3),0)})).filter(p=>p.score>0).sort((a,b)=>b.score-a.score);
  return explicit||projects.find(p=>question.includes(p))||scores[0]?.project||memory.currentProject;
}
export function verifiedMemoryPatch(current:SessionMemory,result:any,sources:MemorySource[],question:string):SessionMemory {
  const entries=[...current.entries];
  for(const fact of Array.isArray(result.facts)?result.facts:[]) {
    const source=sources.find(s=>s.id===fact.sourceId),quote=typeof fact.quote==='string'?fact.quote.trim():'';
    if(!source||quote.length<5||quote.length>1200||!source.text.includes(quote))continue;
    const project=String(fact.project||result.project||current.currentProject||'未归类').slice(0,120);
    const id=crypto.createHash('sha256').update(project+source.id+quote).digest('hex').slice(0,24);
    if(!entries.some(e=>e.id===id)) entries.push({id,project,topic:String(fact.topic||'').slice(0,120),kind:'fact',text:quote,source:{type:source.type,id:source.id,quote},confirmed:true,updatedAt:Date.now()});
  }
  for(const [field,kind] of [['working','working'],['uncertain','uncertain']] as const) {
    for(const value of Array.isArray(result[field])?result[field].slice(0,5):[]) {
      if(typeof value!=='string'||!value.trim())continue;
      entries.push({id:crypto.randomUUID(),project:String(result.project||current.currentProject||'未归类').slice(0,120),kind,text:value.slice(0,500),source:{type:'assistant',id:'generated-summary'},confirmed:false,updatedAt:Date.now()});
    }
  }
  // Only a direct user correction may supersede prior user facts, never an assistant draft.
  const correction=sources.find(s=>s.id==='user-correction');
  if(correction) {
    entries.push({id:crypto.randomUUID(),project:current.currentProject||String(result.project||'未归类'),kind:'fact',text:correction.text.slice(0,1500),source:{type:'user',id:'user-correction',quote:correction.text},confirmed:true,updatedAt:Date.now()});
  }
  return {...current,currentProject:current.currentProject||String(result.project||'').slice(0,120),entries:[...entries.filter(e=>e.kind==='fact').slice(-100),...entries.filter(e=>e.kind!=='fact').slice(-30)]};
}
export function memoryContext(memory:SessionMemory,question:string,documentIds?:string[]) {
  const project=documentIds?.length?memory.currentProject:selectedProject(memory,question);
  const keys=projectAliases(project);
  const relevant=memory.entries.filter(e=>{
    if(e.source.type==='document'&&documentIds?.length)return documentIds.some(id=>e.source.id.startsWith(id+'_c'));
    return !project||e.project===project||e.project==='未归类'||(keys.length>0&&keys.every(k=>projectAliases(e.project).includes(k)));
  });
  const corrected=relevant.filter(e=>e.confirmed&&e.source.type==='user').sort((a,b)=>b.updatedAt-a.updatedAt);
  return `当前项目：${project||'按本题及资料判断，禁止混用不同项目或故障'}\n用户确认/纠正（优先于旧文档）：${JSON.stringify(corrected).slice(0,7000)}\n项目来源事实：${JSON.stringify(relevant.filter(e=>e.kind==='fact'&&e.source.type==='document')).slice(0,10000)}\n会话进展与未确认推测（不是个人事实证据）：${JSON.stringify(relevant.filter(e=>e.kind!=='fact')).slice(0,4000)}`;
}
export function recentContext(turns:TurnRecord[],includeDrafts=true) {
  return turns.slice(-4).map(t=>({question:t.question.slice(0,2500),draft:includeDrafts&&t.answerPolicyVersion===2?t.answer.slice(0,9000):undefined,warning:t.answerPolicyVersion===2?'历史草稿不是本人事实证据':'旧版回答已隔离，不继承其格式或未经确认的细节'}));
}
export function isUserCorrection(text:string) {return /^(更正|纠正|修正|补充事实|实际上|我用的是|我负责的是)/.test(text.trim());}
