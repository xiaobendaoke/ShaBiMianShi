// Synthetic regression fixtures; these values do not describe a real candidate.
import assert from 'node:assert/strict';
import {KeywordIndex} from '../src/main/indexing/keywordIndex';
import {VectorIndex} from '../src/main/indexing/vectorIndex';
import {RetrievalService} from '../src/main/indexing/retrievalService';
import {resolveProjectFocus,caseSection,answeredCase} from '../src/main/services/projectFocus';
import {selectedProject} from '../src/main/services/sessionMemory';
import {parseMarkdown} from '../src/main/parsers/mdParser';
import type {ChunkRecord} from '../src/main/types';
const docs=[{id:'sms',fileName:'8295 车载座舱离线短信分类.md'},{id:'vision',fileName:'RK3588 YOLOv11n.md'},{id:'audio',fileName:'RK3588 语音全链路.md'},{id:'other',fileName:'attention mappo.md'}];
assert.equal(answeredCase('我处理的是INT8量化校准问题',[{sectionPath:'项目 > 案例一：缓存 > 根因',text:'FastRPC缓存一致性问题',documentId:'s'},{sectionPath:'项目 > 案例二：量化 > 根因',text:'INT8量化校准代表集偏差',documentId:'s'}]),'项目 > 案例二：量化');
assert.deepEqual(resolveProjectFocus('比较8295和RK3588两个平台的项目',docs).documentIds.sort(),['audio','sms','vision']);
const focus=resolveProjectFocus('你在高通 8295 平台上踩过什么坑？',docs);
assert.deepEqual(focus.documentIds,['sms']);
assert.deepEqual(resolveProjectFocus('最后结果怎么样？',docs,focus).documentIds,['sms']);
assert.deepEqual(resolveProjectFocus('什么是TCP？',docs,focus).documentIds,[]);
assert.deepEqual(resolveProjectFocus('RK3588上的YOLO11n怎么优化？',docs,focus).documentIds,['vision']);
assert.deepEqual(resolveProjectFocus('RK3588的项目呢？',docs,focus).documentIds.sort(),['audio','vision']);
assert.equal(selectedProject({currentProject:'RK3588 YOLO项目',entries:[{project:'高通8295短信项目'},{project:'RK3588 YOLO项目'}]} as any,'8295上的部署结果呢？'),'高通8295短信项目');
const index=new KeywordIndex();
const parts=['1. 现象','2. 定位','3. 根因','4. 修复和验证'];
const texts=['INT8量化后置信度下降到0.21。','通过QNN逐层Dump排查问题。','校准集100条存在采样偏差。','扩到200条后置信度0.95，一致性98.5%。'];
const chunks:ChunkRecord[]=parts.map((part,i)=>({id:'sms_c'+i,documentId:'sms',documentVersion:1,libraryId:'lib',ordinal:i,sectionPath:'部署 > 5.2 案例二：INT8量化 > '+part,text:texts[i],pageStart:null,pageEnd:null,sourceStart:0,sourceEnd:1,tokenEstimate:1,contentHash:'x',createdAt:0}));
chunks.push({...chunks[0],id:'sms_next',ordinal:4,sectionPath:'部署 > 5.3 案例三 > 现象',text:'另一个案例，不应作为当前问题的证据。'});
chunks.push({...chunks[0],id:'other_c0',documentId:'other',text:'8295 QNN INT8量化案例结果并非短信项目。'});
for(const c of chunks)index.addChunk(c,['lib']);
const service=new RetrievalService(index,new VectorIndex(),{getDocument:id=>docs.find(d=>d.id===id) as any,getNeighborChunk:(id,offset)=>{const target=chunks.find(c=>c.id===id)!;return chunks.find(c=>c.documentId===target.documentId&&c.ordinal===target.ordinal+offset)||null;}});
const result=await service.retrieve({query:'QNN逐层Dump怎么排查？',libraryIds:['lib'],documentIds:['sms'],topK:1});
assert.equal(result.items.length,4);assert.ok(result.items.some(i=>i.text.includes('98.5%')));assert.ok(result.items.every(i=>i.documentId==='sms'&&caseSection(i.sectionPath)?.includes('5.2')));
assert.equal((await service.retrieve({query:'排查',libraryIds:[],documentIds:['sms']})).items.length,0);
assert.equal((await service.retrieve({query:'QNN逐层Dump',libraryIds:['lib'],documentIds:['sms'],topK:1,maxContextChars:10})).items.length,0);
assert.ok((await service.retrieve({query:'QNN逐层Dump',libraryIds:['lib'],documentIds:['sms'],topK:1,maxContextChars:10})).omitted?.length);
const genericDocs=[{id:'order-main',fileName:'订单服务架构.md'},{id:'order-test',fileName:'订单服务压测报告.md'},{id:'motor',fileName:'电机振动监测.md'},{id:'planner',fileName:'仓储机器人路径规划.md'}];
assert.deepEqual(resolveProjectFocus('订单服务怎么保证幂等？',genericDocs).documentIds.sort(),['order-main','order-test']);
assert.deepEqual(resolveProjectFocus('电机振动监测怎么定位异常？',genericDocs).documentIds,['motor']);
assert.deepEqual(resolveProjectFocus('仓储机器人路径规划怎么处理？',genericDocs).documentIds,['planner']);
assert.deepEqual(resolveProjectFocus('订单最后结果呢？',genericDocs,focus).documentIds.sort(),['order-main','order-test']);
assert.deepEqual(resolveProjectFocus('最后结果呢？',genericDocs,focus).documentIds,[],'Deleted/out-of-library prior document cannot be inherited');

// Regression: de-poisoned real document names, Kangxi NFKC normalization, root H1 retention, and .md authority over .pdf resume
const realDocs=[
  {id:'resume',fileName:'候选人 _ 嵌入式软件 · 边缘AI.pdf',fileType:'pdf' as const},
  {id:'d8295',fileName:'8295 车载座舱 NPU 离线短信四分类系统.md',fileType:'md' as const},
  {id:'dmappo',fileName:'attention mappo项目.md',fileType:'md' as const},
  {id:'daudio',fileName:'RK3588全链路集成.md',fileType:'md' as const,headings:['RK3588 全链路端侧本地语音 AI 系统技术全景与面试指南']},
  {id:'dyolo',fileName:'RK3588YOLOv11n.md',fileType:'md' as const,headings:['基于 RK3588 NPU + YOLO11n 实时桌面安全监控系统']}
];
assert.deepEqual(resolveProjectFocus('FastAPI推流是怎么做并发控制的？',realDocs).documentIds,[],'Generic words like API/并发 must not mislock to 8295 or YOLO');
assert.deepEqual(resolveProjectFocus('语音唤醒的关键词是怎么检测的？',realDocs).documentIds,['daudio'],'关键词 must not mislock to YOLOv11n; 语音 matches audio project');
assert.deepEqual(resolveProjectFocus('你的AI推理只有65帧吗？',realDocs).documentIds,[],'AI from 边缘AI.pdf must not lock out YOLO');
assert.deepEqual(resolveProjectFocus('嗯，那整体帧率大概能跑多少？',realDocs,{documentIds:['dyolo'],name:'RK3588YOLOv11n',reason:'本题项目标识匹配',anchor:'RK3588上的YOLO11n'}).documentIds,['dyolo'],'Spoken filler prefix still inherits active project on follow-up');

const mdParsed=parseMarkdown('# RK3588 全链路语音系统\n简介\n# 一、系统架构\n架构正文\n# 二、性能优化\n优化正文');
assert.ok(mdParsed.sections.some(s=>s.title==='RK3588 全链路语音系统 > 二、性能优化'),'Root H1 title stays anchored across subsequent numbered H1 chapters');

const nfkcIdx=new KeywordIndex();
nfkcIdx.addChunk({id:'res_c1',documentId:'resume',documentVersion:1,libraryId:'lib',ordinal:1,sectionPath:'第 1 页',text:'中⼭⼤学硕⼠ · ⼼语⼼⾔ · ⾳频延时降低40% · 兵装集团 Procise 与 BootLoader 调优 · 8295 短信分类 TFLite 99KB',pageStart:1,pageEnd:1,sourceStart:0,sourceEnd:50,tokenEstimate:30,contentHash:'r1',createdAt:0},['lib'],'候选人 _ 嵌入式软件 · 边缘AI.pdf');
nfkcIdx.addChunk({id:'md8295_c1',documentId:'d8295',documentVersion:1,libraryId:'lib',ordinal:1,sectionPath:'8295 > 模型部署',text:'8295 短信四分类采用 Qualcomm QNN SDK 部署在 Hexagon HTP，INT8 模型大小 101KB。',pageStart:null,pageEnd:null,sourceStart:0,sourceEnd:50,tokenEstimate:30,contentHash:'m1',createdAt:0},['lib'],'8295 车载座舱 NPU 离线短信四分类系统.md');
const nfkcService=new RetrievalService(nfkcIdx,new VectorIndex(),{getDocument:id=>realDocs.find(d=>d.id===id) as any});
assert.equal((await nfkcService.retrieve({query:'中山大学 心语心言 音频延时',libraryIds:['lib']})).items[0]?.documentId,'resume','Kangxi radicals match standard UTF-8 queries via NFKC');
assert.equal((await nfkcService.retrieve({query:'8295 短信分类 模型大小',libraryIds:['lib']})).items[0]?.documentId,'d8295','.md project detail document outranks conflicting .pdf resume chunk');
assert.equal((await nfkcService.retrieve({query:'兵装 BootLoader Procise',libraryIds:['lib']})).items[0]?.documentId,'resume','Resume-exclusive internship experience still ranks #1');

console.log('PASS Project aliases, explicit switch, follow-up scope, ambiguity, whole-case evidence, NFKC, .md authority, library boundary and budget diagnostics');

