// Synthetic regression fixtures; these values do not describe a real candidate.
import assert from 'node:assert/strict';
import {KeywordIndex} from '../src/main/indexing/keywordIndex';
import {VectorIndex} from '../src/main/indexing/vectorIndex';
import {RetrievalService} from '../src/main/indexing/retrievalService';
import {resolveProjectFocus,caseSection,answeredCase,isIdentityOrResumeQuery} from '../src/main/services/projectFocus';
import {selectedProject,recentContext} from '../src/main/services/sessionMemory';
import {buildCompletionMessages,parseCompletionResponse} from '../src/main/services/queryCompletion';
import {parseMarkdown} from '../src/main/parsers/mdParser';
import {AppDatabase} from '../src/main/db/database';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
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

// Regression: Session targetRole, jobDescription, single-resume hard isolation (allowedDocumentIds), and cross-role chunk ranking
assert.ok(isIdentityOrResumeQuery('你为什么想转岗做产品经理？'));
assert.ok(isIdentityOrResumeQuery('你觉得你应聘销售岗位的优势是什么？'));
assert.equal(isIdentityOrResumeQuery('为什么做数据库读写分离？'), false, 'Technical why-question must never trigger identity query');

const pmCompletionMsgs = buildCompletionMessages({
  question: '聊聊你的核心优势',
  fromAudio: true,
  targetRole: '产品经理',
  jobDescription: '负责B端CRM需求调研、PRD撰写与迭代上线',
  recentTurns: [],
  documents: [{id: 'sales_sw_resume', fileName: '销售软件个人简历.pdf', kind: 'pdf'}]
});
assert.match(pmCompletionMsgs[1].content, /本场目标岗位：产品经理/);
assert.match(pmCompletionMsgs[1].content, /岗位要求摘要：负责B端CRM需求调研/);
const pmCompletionParsed = parseCompletionResponse(
  JSON.stringify({intent: 'project_or_resume', rewrittenQuestion: '聊聊你的核心优势', searchQuery: '核心优势', targetDocIds: []}),
  '聊聊你的核心优势',
  new Set(['sales_sw_resume']),
  '产品经理'
);
assert.match(pmCompletionParsed.searchQuery, /产品经理/, 'Identity/strength completion dynamically injects targetRole');

const crossRoleDocs = [
  {id: 'sales_sw_resume', fileName: '候选人_CRM销售软件经历.pdf', fileType: 'pdf' as const},
  {id: 'other_cpp_resume', fileName: '另一份_嵌入式C++简历.pdf', fileType: 'pdf' as const}
];
const crossIdx = new KeywordIndex();
crossIdx.addChunk({
  id: 'sw_sales_c1', documentId: 'sales_sw_resume', documentVersion: 1, libraryId: 'shared_lib', ordinal: 1,
  sectionPath: '第 1 页 > 商务拓展',
  text: '负责CRM销售软件大客户开拓、客户痛点挖掘、报价异议处理与年度回款成交转化，签约额提升35%。',
  pageStart: 1, pageEnd: 1, sourceStart: 0, sourceEnd: 60, tokenEstimate: 35, contentHash: 'cs1', createdAt: 0
}, ['shared_lib'], crossRoleDocs[0].fileName);
crossIdx.addChunk({
  id: 'sw_pm_c2', documentId: 'sales_sw_resume', documentVersion: 1, libraryId: 'shared_lib', ordinal: 2,
  sectionPath: '第 1 页 > 产品迭代',
  text: '主导客户需求调研与业务流程抽象，输出PRD需求文档并协同推动线索漏斗模块功能迭代，留存率提升18%。',
  pageStart: 1, pageEnd: 1, sourceStart: 61, sourceEnd: 120, tokenEstimate: 35, contentHash: 'cs2', createdAt: 0
}, ['shared_lib'], crossRoleDocs[0].fileName);
crossIdx.addChunk({
  id: 'sw_tech_c3', documentId: 'sales_sw_resume', documentVersion: 1, libraryId: 'shared_lib', ordinal: 3,
  sectionPath: '第 2 页 > 技术实现',
  text: '参与CRM后端接口开发、SQL慢查询优化与Webhook异步队列排障，接口P99延迟降低50%。',
  pageStart: 2, pageEnd: 2, sourceStart: 121, sourceEnd: 180, tokenEstimate: 35, contentHash: 'cs3', createdAt: 0
}, ['shared_lib'], crossRoleDocs[0].fileName);
crossIdx.addChunk({
  id: 'other_cpp_c1', documentId: 'other_cpp_resume', documentVersion: 1, libraryId: 'shared_lib', ordinal: 1,
  sectionPath: '第 1 页',
  text: '负责STM32电机控制与CAN总线驱动开发，不应出现在仅勾选CRM销售软件简历的会话中。',
  pageStart: 1, pageEnd: 1, sourceStart: 0, sourceEnd: 50, tokenEstimate: 30, contentHash: 'oc1', createdAt: 0
}, ['shared_lib'], crossRoleDocs[1].fileName);
const crossService = new RetrievalService(crossIdx, new VectorIndex(), {
  getDocument: id => crossRoleDocs.find(d => d.id === id) as any
});

// 1) Hard isolation: picking only 'sales_sw_resume' in shared_lib never leaks 'other_cpp_resume'
const isolatedSelfIntro = await crossService.retrieve({
  query: '先做个自我介绍',
  libraryIds: ['shared_lib'],
  allowedDocumentIds: ['sales_sw_resume'],
  targetRole: '销售'
});
assert.ok(isolatedSelfIntro.items.length > 0, 'Bound resume must be recalled on self-intro');
assert.ok(isolatedSelfIntro.items.every(i => i.documentId === 'sales_sw_resume'), 'Unchecked resume in same library must have 0 leakage');
assert.equal((await crossService.retrieve({
  query: '先做个自我介绍',
  libraryIds: ['shared_lib'],
  allowedDocumentIds: []
})).items.length, 0, 'Explicit empty allowedDocumentIds must return 0 items');

// 2) Same resume ('sales_sw_resume'), different targetRole shifts top-ranked evidence chunk!
const asSales = await crossService.retrieve({
  query: '讲讲你之前做过的项目经历',
  libraryIds: ['shared_lib'],
  allowedDocumentIds: ['sales_sw_resume'],
  targetRole: '销售',
  jobDescription: '大客户开拓、报价谈判、回款转化'
});
assert.equal(asSales.items[0]?.chunkId, 'sw_sales_c1', 'Sales targetRole ranks sales/conversion chunk #1');

const asPm = await crossService.retrieve({
  query: '讲讲你之前做过的项目经历',
  libraryIds: ['shared_lib'],
  allowedDocumentIds: ['sales_sw_resume'],
  targetRole: '产品经理',
  jobDescription: '需求调研、PRD文档、功能迭代与留存率'
});
assert.equal(asPm.items[0]?.chunkId, 'sw_pm_c2', 'PM targetRole ranks PRD/iteration chunk #1 from the same resume');

const asTech = await crossService.retrieve({
  query: '讲讲你之前做过的项目经历',
  libraryIds: ['shared_lib'],
  allowedDocumentIds: ['sales_sw_resume'],
  targetRole: '后端开发',
  jobDescription: '后端接口开发、SQL优化与异步队列排障'
});
assert.equal(asTech.items[0]?.chunkId, 'sw_tech_c3', 'Backend targetRole ranks API/SQL chunk #1 from the same resume');

// 3) SQLite persistence of targetRole, jobDescription, documentIds, and document deletion sync
const tmpRoleDbDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-role-db-'));
try {
  const roleDb = new AppDatabase(path.join(tmpRoleDbDir, 'app.db'));
  roleDb.saveLibrary({id: 'l1', name: '简历库', description: '', docCount: 0, createdAt: 1, updatedAt: 1});
  roleDb.saveDocument({
    id: 'd1', fileName: '销售简历.pdf', fileType: 'pdf', fileSize: 100, fileHash: 'h1',
    pageCount: 1, status: 'ready', errorMsg: null, needsOcr: false, storagePath: '/tmp/d1',
    createdAt: 1, updatedAt: 1, libraryIds: ['l1']
  });
  roleDb.saveDocument({
    id: 'd2', fileName: '项目复盘.md', fileType: 'md', fileSize: 100, fileHash: 'h2',
    pageCount: null, status: 'ready', errorMsg: null, needsOcr: false, storagePath: '/tmp/d2',
    createdAt: 1, updatedAt: 1, libraryIds: ['l1']
  });
  roleDb.saveSession({
    id: 'sess_sales', title: '销售', targetRole: '销售', jobDescription: '负责SaaS销售',
    libraryIds: ['l1'], documentIds: ['d1', 'd2'], strategy: 'docs_and_general', promptStyle: 'standard',
    createdAt: 1, updatedAt: 1
  });
  let savedSess = roleDb.getSessions().find(s => s.id === 'sess_sales')!;
  assert.equal(savedSess.targetRole, '销售');
  assert.equal(savedSess.jobDescription, '负责SaaS销售');
  assert.deepEqual(savedSess.documentIds, ['d1', 'd2']);

  roleDb.deleteDocument('d1');
  savedSess = roleDb.getSessions().find(s => s.id === 'sess_sales')!;
  assert.deepEqual(savedSess.documentIds, ['d2'], 'Deleting a document removes it from session.documentIds');

  roleDb.saveSession({...savedSess, documentIds: undefined, updatedAt: 2});
  savedSess = roleDb.getSessions().find(s => s.id === 'sess_sales')!;
  assert.equal(savedSess.documentIds, undefined, 'Clearing documentIds back to full-library mode persists cleanly');
  roleDb.close();
} finally {
  fs.rmSync(tmpRoleDbDir, {recursive: true, force: true});
}

// 4) English question -> Chinese resume & project (.md) retrieval + completion language preservation
assert.ok(isIdentityOrResumeQuery('Can you introduce yourself?'));
assert.ok(isIdentityOrResumeQuery('Could you walk me through your resume?'));
assert.ok(isIdentityOrResumeQuery('What are your biggest strengths?'));
assert.equal(isIdentityOrResumeQuery('Let me introduce myself first, I am your interviewer today.'), false);

const enWhoAmI = await auditService.retrieve({query: 'Can you introduce yourself?', libraryIds: ['audit']}, [1, 0, 0]);
assert.ok(enWhoAmI.items.some(i => i.documentId === 'audit_resume'), 'English self-intro recalls Chinese PDF resume');

const enQuantFocus = resolveProjectFocus('What was the quantization bug in your 8295 project?', docs);
assert.deepEqual(enQuantFocus.documentIds, ['sms']);
const enQuantRetrieve = await service.retrieve({
  query: 'What was the quantization bug in your 8295 project?',
  libraryIds: ['lib'],
  documentIds: enQuantFocus.documentIds,
  topK: 2
});
assert.ok(enQuantRetrieve.items.some(i => i.text.includes('98.5%')), 'English quantization question hits Chinese 8295 .md case & outcome');

const enTcpUdp = await auditService.retrieve({query: 'What is the difference between TCP and UDP?', libraryIds: ['audit']}, [1, 0, 0]);
assert.equal(enTcpUdp.items.length, 0, 'English general tech question must not pull personal resume noise');

const preservedEnRewrite = parseCompletionResponse(
  JSON.stringify({intent: 'project_or_resume', rewrittenQuestion: '介绍一下你的RK3588项目难点', searchQuery: 'RK3588 难点 故障 优化', targetDocIds: ['vision']}),
  'Tell me about the biggest challenge in your RK3588 project.',
  new Set(['vision', 'sms'])
);
assert.equal(preservedEnRewrite.rewrittenQuestion, 'Tell me about the biggest challenge in your RK3588 project.', 'English question language is preserved even if completion model translated it');
assert.match(preservedEnRewrite.searchQuery, /RK3588 难点/);

console.log('PASS Project aliases, explicit switch, follow-up scope, ambiguity, whole-case evidence, NFKC, .md authority, library boundary and budget diagnostics');

