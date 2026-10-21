export interface ProjectFocus {documentIds:string[];name:string;reason:string;anchor:string;}
export interface ProjectDocument {id:string;fileName:string;headings?:string[];}
const normal=(s:string)=>s.normalize('NFKC').toLowerCase().replace(/yolov(?=\d)/g,'yolo').replace(/[\s_\-]/g,'');
const words=new Intl.Segmenter('zh-CN',{granularity:'word'});
const generic=new Set('项目 系统 基于 平台 技术 文档 文件 介绍 说明 结果 效果 测试 压测 报告 架构 设计 实现 复盘 配置 开发 部署 实战 解析 深度 拆解 面试 指南 手册 讲稿 方案 全景 通关 宝典 底层 机理 核心 优化 实时 通信 原理 功能 案例 对应 最大 代表性 工程 完整 内容 学习 记录 模型 软件 嵌入式 如何 为什么 md pdf txt docx'.split(' '));
export function projectAliases(name:string):string[] {
  const text=name.normalize('NFKC').toLowerCase().replace(/yolov(?=\d)/g,'yolo').replace(/(\d)(?=[a-z]{2})/g,'$1 ');
  const tokens=[...words.segment(text)].map(x=>x.segment.trim()).filter(x=>x.length>=2&&!generic.has(x)&&!/^\p{P}+$/u.test(x));
  const technical=(text.match(/[a-z][a-z\d]+|\d{4,}/g)||[]).filter(x=>x.length>=3&&!generic.has(x));
  const prefixes=technical.filter(x=>/^[a-z]{3,}\d/.test(x)).map(x=>x.match(/^[a-z]+/)![0]);
  return [...new Set([...tokens,...technical,...prefixes,...(text.match(/\d{4,}/g)||[])].map(normal))].filter(x=>!generic.has(x)&&x.length>=2);
}
export function isProjectFollowUp(q:string) {
  return /^(?:那|然后|最后|结果|效果|具体|当时|刚才|你刚才|换个|另一个|这个|该|它|怎么定位|怎么验证|怎么确认|为什么这么|为什么这样|校准集|召回率|置信度|一致性|(?:QNN|SNPE|TFLite|CMA|NPU).*(?:具体|当时|你|做|用|多少|结果))/.test(q.trim());
}
export function resolveProjectFocus(question:string,documents:ProjectDocument[],previous?:ProjectFocus):ProjectFocus {
  const q=normal(question);
  if(/^(?:什么是|解释一下|介绍一下)(?!你|你的|项目)/.test(question.trim())&&!/\d{4,}/.test(q))return {documentIds:[],name:'',reason:'通用概念题，不继承项目范围',anchor:question};
  const scored=documents.map(doc=>{
    const aliases=projectAliases(doc.fileName+' '+(doc.headings||[]).join(' '));
    const hits=aliases.filter(a=>q.includes(a));
    return {doc,aliases,hits,score:hits.reduce((n,a)=>n+(/\d/.test(a)?8:3),0)};
  }).filter(x=>x.score>0).sort((a,b)=>b.score-a.score);
  if(scored.length){
    const best=scored[0].score;
    const platforms=[...new Set(q.match(/\d{4,}/g)||[])];
    const matchedPlatforms=platforms.filter(p=>scored.some(x=>x.aliases.includes(p)));
    const winners=matchedPlatforms.length>1?scored.filter(x=>x.hits.some(a=>matchedPlatforms.includes(a))):scored.filter(x=>x.score===best);
    const sharedTopic=winners[0].hits.some(a=>!/[0-9]/.test(a)&&winners.every(x=>x.aliases.includes(a)));
    // Same chip alone may refer to several projects: retain all tied sources,
    // explicitly report ambiguity and never silently pick the previous project.
    return {documentIds:winners.map(x=>x.doc.id),name:winners.map(x=>x.doc.fileName.replace(/\.[^.]+$/,'')).join(' / '),reason:winners.length===1?'本题项目标识匹配':matchedPlatforms.length>1?'跨项目问题，分别使用各项目资料':sharedTopic?'同一项目主题匹配多份文档':'项目标识存在多个候选，需按具体事项区分',anchor:question};
  }
  const active=previous?.documentIds.filter(id=>documents.some(d=>d.id===id))||[];
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
