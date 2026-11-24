export interface ProjectFocus {documentIds:string[];name:string;reason:string;anchor:string;}
export interface ProjectDocument {id:string;fileName:string;fileType?:string;headings?:string[];}
const normal=(s:string)=>s.normalize('NFKC').toLowerCase().replace(/yolov(?=\d)/g,'yolo').replace(/[\s_\-]/g,'');
const words=new Intl.Segmenter('zh-CN',{granularity:'word'});
const generic=new Set('项目 系统 基于 平台 技术 文档 文件 介绍 说明 结果 效果 测试 压测 报告 架构 设计 实现 复盘 配置 开发 部署 实战 解析 深度 拆解 面试 指南 手册 讲稿 方案 全景 通关 宝典 底层 机理 核心 优化 实时 通信 原理 功能 案例 对应 最大 代表性 工程 完整 内容 学习 记录 模型 软件 嵌入式 如何 为什么 关键 性能 指标 背景 处理 数据 代码 硬件 结构 结构体 拷贝 定位 交互 并发 安全 计算 本地 仿真 故障 故事 真实 还原 穿帮 口语 口语化 逐字 逐字稿 背诵 必考 清单 逐一 目录 简历 履历 候选人 求职 个人 工程师 端侧 边缘 离线 智能 推理 单帧 耗时 延迟 延时 帧率 毫秒 api debug ai npu sdk md pdf txt docx'.split(' '));
const singleCharStop=new Set('的了和与及在对把被从向给用按由为是有无非多单全高低大小新旧主子总各上下中内外'.split(''));
export function isResumeDocument(doc:{fileName:string;fileType?:string}):boolean {
  return doc.fileType==='pdf'||/\.pdf$/i.test(doc.fileName)||/(?:简历|履历|个人介绍|候选人|求职|\bcv\b|\bresume\b)/i.test(doc.fileName);
}
export function isIdentityOrResumeQuery(question:string):boolean {
  const q=question.normalize('NFKC').trim();
  if(/(?:感谢|谢谢|听完).{0,12}自我介绍|我先.{0,6}自我介绍.{0,28}(?:我是|面试官)|\blet\s+me\s+introduce\s+myself\b|\bthank\s+you\s+for\s+your\s+(?:self[\s-]?)?introduction\b|\bi\s+am\s+your\s+interviewer\b/i.test(q))return false;
  return /(?:你是谁|我是谁|你叫什么|我叫什么|(?:你|我)(?:是)?(?:干啥|做什么|干什么|搞什么)的|(?:你|我)的?(?:实际)?(?:职业|工作方向|技术方向|求职方向|研究方向|主要职责|岗位|职位|个人背景|教育背景|学历|学校|专业|实习经历|工作经历)|(?:你|我)的实际工作是什么|自我介绍|个人介绍|介绍一下你自己|根据简历|(?:你|我)(?:为什么|为啥).{0,12}(?:面|投|应聘|选择?|转岗|转行|跨行|来我们)|(?:为什么|为啥)(?:想|要)?(?:转岗|转行|跨专业|跨行|应聘)|(?:你|我).{0,10}(?:应聘|胜任|适合|匹配).{0,12}(?:优势|竞争力|岗位|职位)|(?:你|我)的?(?:核心|最大|个人)(?:优势|竞争力))/.test(q) ||
    /\b(?:introduce\s+yourself|self[\s-]?introduction|tell\s+(?:me|us)\s+(?:a\s+(?:little|bit)\s+)?about\s+yourself|walk\s+(?:me|us)\s+through\s+your\s+(?:resume|cv|background|experience)|who\s+are\s+you|what\s+is\s+your\s+(?:background|major|education|current\s+role|profession|career\s+goal)|what\s+(?:is|are)\s+your\s+(?:\w+\s+)?(?:strengths?|weaknesses|advantages?)|your\s+(?:biggest|greatest|core|main|key)\s+(?:strengths?|weaknesses|advantages?)|why\s+(?:do\s+you\s+want\s+to\s+(?:join|work|apply)|should\s+we\s+hire\s+you|did\s+you\s+(?:apply|choose\s+this)|this\s+(?:role|job|position)|our\s+company))\b/i.test(q);
}
export function isExplicitResumeEntityQuery(question:string):boolean {
  const q=question.normalize('NFKC');
  return /(?:深蓝|兵装|兵器装备|心语心言|中山大学|矿业大学|矿大|研究生实验室|实验室(?:里|里头|课题)?.*做|兵工自动化|procise|knn[\s_\-]?ddpg)/i.test(q);
}
export function isClearStandaloneTechOrCodeQuestion(question:string):boolean {
  const q=question.normalize('NFKC').trim();
  if(!q||/携程|你|你们|我|我们|这(?:个|项目|块|里|套|边)|那(?:个|块|里|边|它)|刚才|当时|上一|项目|简历|实习|公司|\b(?:your|yourself|resume|project|projects|internship|company)\b/i.test(q))return false;
  return /^(?:什么是|什么叫|解释一下|请解释|讲一下|说说)[^，。！？!?]{1,22}[？?。]?$|.{1,20}(?:和|与|跟).{1,20}(?:有什么区别|的区别是什么|区别在哪)[？?。]?$|(?:死锁|虚函数|多态|智能指针|三次握手|四次挥手|进程|线程|协程|互斥锁|自旋锁|内存泄漏|栈和堆|大小端|volatile|static|const).*(?:什么|区别|原理|实现|条件|作用|写代码|写一个)/i.test(q) ||
    /^(?:what\s+is\s+(?:a|an|the)\s+[a-z0-9_+#+-]{2,25}|(?:what\s+is\s+the\s+)?difference\s+between\s+[a-z0-9_+#+\s-]{2,30}\s+and\s+[a-z0-9_+#+\s-]{2,30})\s*[?.]?$/i.test(q);
}
export function projectAliases(name:string):string[] {
  const stripped=name.replace(/\.(?:md|pdf|txt|docx)\b/gi,' ');
  const text=stripped.normalize('NFKC').toLowerCase().replace(/yolov(?=\d)/g,'yolo').replace(/(\d)(?=[a-z]{2})/g,'$1 ');
  const rawSegments=[...words.segment(text)].map(x=>x.segment.trim()).filter(Boolean);
  const tokens=rawSegments.filter(x=>x.length>=2&&!generic.has(x)&&!/^\p{P}+$/u.test(x));
  const joinedSingleCjk:string[]=[];
  let run='';
  for(const seg of rawSegments){
    if(/^[\u4e00-\u9fff]$/.test(seg)&&!singleCharStop.has(seg)){run+=seg;}
    else{if(run.length>=2&&!generic.has(run))joinedSingleCjk.push(run);run='';}
  }
  if(run.length>=2&&!generic.has(run))joinedSingleCjk.push(run);
  const technical=(text.match(/[a-z][a-z\d]+|\d{4,}/g)||[]).filter(x=>x.length>=3&&!generic.has(x));
  const prefixes=technical.filter(x=>/^[a-z]{3,}\d/.test(x)).map(x=>x.match(/^[a-z]+/)![0]);
  return [...new Set([...tokens,...joinedSingleCjk,...technical,...prefixes,...(text.match(/\d{4,}/g)||[])].map(normal))].filter(x=>!generic.has(x)&&x.length>=2);
}
export function isProjectFollowUp(q:string) {
  const trimmed=q.normalize('NFKC').trim().replace(/^(?:嗯+|呃+|啊+|哦+|噢+|好(?:的)?|行|对(?:的)?|是的|ok|okay|well|so|and|right|哎|诶|所以|还有|另外)[\s，,。！？!?、]*/gi,'');
  return /^(?:那|然后|最后|结果|效果|具体|当时|刚才|你刚才|换个|另一个|这个|该|它|这|这块|那块|这里|里面|怎么定位|怎么验证|怎么确认|怎么解决|怎么优化|怎么实现|为什么|为啥|帧率|延迟|延时|耗时|内存|带宽|功耗|体积|大小|精度|准确率|召回率|置信度|一致性|校准集|瓶颈|难点|挑战|亮点|(?:QNN|SNPE|TFLite|CMA|NPU|RGA|MPP|V4L2|ALSA|AEC|VAD|ASR|TTS|RKNN).*(?:具体|当时|你|做|用|多少|结果|瓶颈|怎么|为什么))/i.test(trimmed) ||
    /^(?:what\s+about\s+(?:the|its|your|this)|how\s+did\s+you\s+(?:fix|solve|debug|test|verify|optimize|measure|reduce|improve)|what\s+was\s+the\s+(?:final\s+)?(?:result|latency|fps|frame\s+rate|accuracy|root\s+cause|bottleneck|challenge)|why\s+did\s+you\s+(?:use|choose))\b/i.test(trimmed);
}
export function resolveProjectFocus(question:string,documents:ProjectDocument[],previous?:ProjectFocus):ProjectFocus {
  if(isIdentityOrResumeQuery(question))return {documentIds:[],name:'',reason:'个人身份与简历背景提问，优先检索简历',anchor:question};
  const q=normal(question);
  if((/^(?:什么是|什么叫|解释一下|请解释|介绍一下)(?!你|你的|项目)/.test(question.trim())||/^(?:what\s+(?:is|are)\s+(?:a|an|the)?\s*|explain\s+|difference\s+between\s+)(?!your\b|this\s+project\b)/i.test(question.trim()))&&!/\d{4,}/.test(q))return {documentIds:[],name:'',reason:'通用概念题，不继承项目范围',anchor:question};
  const projectDocs=documents.filter(doc=>!isResumeDocument(doc));
  const scored=projectDocs.map(doc=>{
    const aliases=projectAliases(doc.fileName+' '+(doc.headings||[]).join(' '));
    const hits=aliases.filter(a=>q.includes(a));
    return {doc,aliases,hits,score:hits.reduce((n,a)=>n+(/\d/.test(a)?8:3),0)};
  }).filter(x=>x.score>0).sort((a,b)=>b.score-a.score);
  if(scored.length){
    const best=scored[0].score;
    const platforms=[...new Set(q.match(/\d{4,}/g)||[])];
    const matchedPlatforms=platforms.filter(p=>scored.some(x=>x.aliases.includes(p)));
    const multiCue=/比较|对比|区别|和|与|以及|分别|各自|两个|两份|哪些项目/.test(question);
    const nonDominated=scored.filter(x=>x.score===best||(!scored.some(y=>y.score>x.score&&x.hits.every(h=>y.hits.includes(h)))&&(x.score>=6||multiCue||matchedPlatforms.length>1)));
    const winners=matchedPlatforms.length>1
      ? [...new Map([...scored.filter(x=>x.hits.some(a=>matchedPlatforms.includes(a))),...nonDominated].map(x=>[x.doc.id,x])).values()]
      : nonDominated;
    const distinctProjects=winners.length>1&&!winners.every(w=>w.hits.length===winners[0].hits.length&&w.hits.every(h=>winners[0].hits.includes(h)));
    const sharedTopic=winners[0].hits.some(a=>!/[0-9]/.test(a)&&winners.every(x=>x.aliases.includes(a)));
    // Same chip alone may refer to several projects: retain all tied sources,
    // explicitly report ambiguity and never silently pick the previous project.
    return {documentIds:winners.map(x=>x.doc.id),name:winners.map(x=>x.doc.fileName.replace(/\.[^.]+$/,'')).join(' / '),reason:winners.length===1?'本题项目标识匹配':(matchedPlatforms.length>1||distinctProjects)?'跨项目问题，分别使用各项目资料':sharedTopic?'同一项目主题匹配多份文档':'项目标识存在多个候选，需按具体事项区分',anchor:question};
  }
  const active=previous?.documentIds.filter(id=>projectDocs.some(d=>d.id===id))||[];
  if(isProjectFollowUp(question)&&active.length)return {...previous!,documentIds:active,reason:'连续追问继承上一题项目',anchor:previous!.anchor};
  return {documentIds:[],name:'',reason:'未明确限定项目',anchor:question};
}

export function caseSection(path:string):string|undefined {
  const parts=path.split(' > ');
  const i=parts.findIndex(p=>/(?:案例[一二三四五六七八九十\d]|case\s*\d+)/i.test(p));
  if(i>=0)return parts.slice(0,i+1).join(' > ');
  if(parts.length>=3&&/现象|定位|排查|根因|修复|结果|验证/.test(parts.at(-1)!))return parts.slice(0,-1).join(' > ');
}

export function answeredCase(answer:string,items:{sectionPath:string;text:string;documentId:string}[]):string|undefined {
  const groups=new Map<string,string>();
  for(const item of items){const key=caseSection(item.sectionPath);if(key)groups.set(key,(groups.get(key)||'')+' '+item.text);}
  if(groups.size===1)return [...groups.keys()][0];
  const q=normal(answer);
  const scores=[...groups].map(([section,text])=>{
    const terms=projectAliases(text);
    const unique=terms.filter(t=>q.includes(t)&&[...groups.values()].filter(s=>normal(s).includes(t)).length===1);
    return {section,score:unique.reduce((sum,t)=>sum+(/\d/.test(t)?3:1),0)};
  }).sort((a,b)=>b.score-a.score);
  return scores[0]?.score>0&&scores[0].score>(scores[1]?.score??0)?scores[0].section:undefined;
}
