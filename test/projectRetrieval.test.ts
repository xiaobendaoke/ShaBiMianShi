// Synthetic regression fixtures; these values do not describe a real candidate.
import assert from 'node:assert/strict';
import {KeywordIndex} from '../src/main/indexing/keywordIndex';
import {VectorIndex} from '../src/main/indexing/vectorIndex';
import {RetrievalService} from '../src/main/indexing/retrievalService';
import {resolveProjectFocus,caseSection,answeredCase,isIdentityOrResumeQuery} from '../src/main/services/projectFocus';
import {selectedProject,recentContext} from '../src/main/services/sessionMemory';
import {parseCompletionResponse} from '../src/main/services/queryCompletion';
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

// Regression v1.0.1 (a11040 audit): identity recall, resume mis-lock prevention, prior 99ms scrubbing, multi-project balanced retrieval, general-tech noise guard
const auditDocs=[
  {id:'audit_resume',fileName:'测试候选人 _ 嵌入式与端侧推理.pdf',fileType:'pdf' as const},
  {id:'audit_green',fileName:'青松视觉项目.md',fileType:'md' as const,headings:['青松视觉项目']},
  {id:'audit_red',fileName:'赤竹日志项目.md',fileType:'md' as const,headings:['赤竹日志项目']}
];
assert.ok(isIdentityOrResumeQuery('你是谁？'));
assert.ok(isIdentityOrResumeQuery('你是谁？你是谁？你是谁？'));
assert.ok(isIdentityOrResumeQuery('我是什么职业？我的工作方向是什么？'));
assert.ok(isIdentityOrResumeQuery('我的实际工作是什么？请说一下职位和主要职责。'));
assert.equal(isIdentityOrResumeQuery('嗯，好的，感谢同学您的自我介绍哈，那我们这边就先请高老师提问。'), false);
assert.equal(isIdentityOrResumeQuery('那我们现在开始，我先自我介绍一下啊，我是比亚迪电子马洪超，是这次技术面试官。'), false);
const forcedIdentity=parseCompletionResponse(JSON.stringify({intent:'chatter',rewrittenQuestion:'你是谁？',searchQuery:'你是谁？',targetDocIds:[]}),'你是谁？你是谁？你是谁？',new Set(['audit_resume','audit_green']));
assert.equal(forcedIdentity.intent,'project_or_resume','Identity question must never be downgraded to chatter');
assert.match(forcedIdentity.searchQuery,/个人简历/);

// Follow-up containing "推理" must inherit 青松视觉项目 instead of mis-locking onto "测试候选人 _ 嵌入式与端侧推理.pdf"
const greenFocus=resolveProjectFocus('青松视觉项目单帧推理最终是几毫秒？',auditDocs);
assert.deepEqual(greenFocus.documentIds,['audit_green']);
const followInferFocus=resolveProjectFocus('这项目最后单帧推理用了多少毫秒？',auditDocs,greenFocus);
assert.deepEqual(followInferFocus.documentIds,['audit_green'],'Word 推理 in follow-up must not mis-lock onto resume PDF');
assert.equal(followInferFocus.reason,'连续追问继承上一题项目');

// Multi-project comparison naming both 青松视觉项目 and 赤竹日志项目 must retain BOTH documents
const bothFocus=resolveProjectFocus('比较青松视觉项目和赤竹日志项目的用途，各自的项目编号是什么？',auditDocs);
assert.deepEqual(bothFocus.documentIds.sort(),['audit_green','audit_red'],'Both named non-numeric projects must be retained');
assert.equal(bothFocus.reason,'跨项目问题，分别使用各项目资料');

const auditIdx=new KeywordIndex();
const auditVec=new VectorIndex();
auditIdx.addChunk({id:'audit_resume_1',documentId:'audit_resume',documentVersion:1,libraryId:'audit',ordinal:1,sectionPath:'第 1 页',text:'姓名：测试候选人。求职方向：嵌入式软件与端侧AI部署，熟悉C/C++、Linux驱动接口与UDP传感器采集。',pageStart:1,pageEnd:1,sourceStart:0,sourceEnd:40,tokenEstimate:25,contentHash:'ar1',createdAt:0},['audit'],'测试候选人 _ 嵌入式与端侧推理.pdf');
auditIdx.addChunk({id:'audit_green_1',documentId:'audit_green',documentVersion:1,libraryId:'audit',ordinal:1,sectionPath:'青松视觉项目 > 一、职责概况',text:'项目编号 GREEN-742，负责单路摄像头图像采集与端侧目标检测。',pageStart:null,pageEnd:null,sourceStart:0,sourceEnd:40,tokenEstimate:25,contentHash:'ag1',createdAt:0},['audit'],'青松视觉项目.md');
auditIdx.addChunk({id:'audit_green_2',documentId:'audit_green',documentVersion:1,libraryId:'audit',ordinal:2,sectionPath:'青松视觉项目 > 二、部署验收',text:'青松视觉项目单帧推理最终耗时 17ms，线程排队和预处理都没有计入。',pageStart:null,pageEnd:null,sourceStart:0,sourceEnd:40,tokenEstimate:25,contentHash:'ag2',createdAt:0},['audit'],'青松视觉项目.md');
auditIdx.addChunk({id:'audit_red_1',documentId:'audit_red',documentVersion:1,libraryId:'audit',ordinal:1,sectionPath:'赤竹日志项目 > 一、项目说明',text:'项目编号 RED-319，负责边缘网关掉电保护环形日志落盘与检索。',pageStart:null,pageEnd:null,sourceStart:0,sourceEnd:40,tokenEstimate:25,contentHash:'ard1',createdAt:0},['audit'],'赤竹日志项目.md');
auditVec.setProfile({profileId:'p',model:'embed',spaceKey:'https://fixture.invalid/v1|embed|3',dimensions:3,createdAt:0});
auditVec.addVector('audit_resume_1',['audit'],[0.31,0.95,0]);
auditVec.addVector('audit_green_1',['audit'],[0.25,0,0.97]);
auditVec.addVector('audit_green_2',['audit'],[0.27,0,0.96]);
auditVec.addVector('audit_red_1',['audit'],[0.26,0,0.96]);
const auditService=new RetrievalService(auditIdx,auditVec,{getDocument:id=>auditDocs.find(d=>d.id===id) as any});

const whoAmI=await auditService.retrieve({query:'你是谁？',libraryIds:['audit']},[1,0,0]);
assert.ok(whoAmI.items.some(i=>i.documentId==='audit_resume'),'Bare "你是谁？" must recall resume chunks despite <0.46 vector similarity and zero literal keyword overlap');
assert.equal((await auditService.retrieve({query:'你是谁？',libraryIds:['empty_lib']},[1,0,0])).items.length,0,'Empty/isolated library returns 0 resume chunks');

const multiRetrieved=await auditService.retrieve({query:'比较青松视觉项目和赤竹日志项目的用途，各自的项目编号是什么？',libraryIds:['audit'],documentIds:bothFocus.documentIds,topK:2});
assert.ok(multiRetrieved.items.some(i=>i.text.includes('GREEN-742')),'First named project retrieved');
assert.ok(multiRetrieved.items.some(i=>i.text.includes('RED-319')),'Second named project retrieved via balanced multi-doc seeding');

const coroutineTech=await auditService.retrieve({query:'协程 线程 区别',libraryIds:['audit'],intent:'general_tech'},[1,0,0]);
assert.equal(coroutineTech.items.length,0,'General tech question about 协程/线程 must not pull 青松视觉项目 just because it mentions 线程排队');
const tcpUdpTech=await auditService.retrieve({query:'TCP 和 UDP 有什么区别？',libraryIds:['audit']},[1,0,0]);
assert.equal(tcpUdpTech.items.length,0,'General tech TCP vs UDP must not pull resume just because it mentions UDP with low vector score');

// Unverified 99ms in prior draft is scrubbed while citation-backed 17ms and non-metric markers stay intact
const scrubbed=recentContext([
  {question:'上一题',answer:'青松视觉单帧耗时是**99ms**，另有标记 SECRET_DRAFT_37，真实核实 17ms。',answerPolicyVersion:2,citations:[{snippet:'单帧推理最终耗时 17ms'}]} as any
]);
assert.ok(!scrubbed[0].draft!.includes('99ms'),'Unverified 99ms metric must be scrubbed from historical draft');
assert.ok(scrubbed[0].draft!.includes('17ms'),'Citation-verified 17ms stays intact');
assert.ok(scrubbed[0].draft!.includes('SECRET_DRAFT_37'),'Non-metric scope tokens stay intact');

console.log('PASS Project aliases, explicit switch, follow-up scope, ambiguity, whole-case evidence, NFKC, .md authority, library boundary and budget diagnostics');

