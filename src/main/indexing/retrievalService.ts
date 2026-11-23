import {caseSection,isIdentityOrResumeQuery,isResumeDocument} from '../services/projectFocus';
import { KeywordIndex } from './keywordIndex';
import { VectorIndex } from './vectorIndex';
import { RetrievalQuery, RetrievalResult, RetrievalResultItem, ChunkRecord, DocumentRecord } from '../types';

export interface DocLookup {
  getDocument(id: string): DocumentRecord | null;
  getNeighborChunk?(chunkId: string, offset: number): ChunkRecord | null;
}

export class RetrievalService {
  private keywordIndex: KeywordIndex;
  private vectorIndex: VectorIndex;
  private docLookup: DocLookup;

  constructor(keywordIndex: KeywordIndex, vectorIndex: VectorIndex, docLookup: DocLookup) {
    this.keywordIndex = keywordIndex;
    this.vectorIndex = vectorIndex;
    this.docLookup = docLookup;
  }

  public projects(libraryIds?:string[]) {
    const chunks=this.keywordIndex.scopedChunks(libraryIds);
    return [...new Set(chunks.map(c=>c.documentId))].map(id=>{
      const doc=this.docLookup.getDocument(id);
      const docChunks=chunks.filter(c=>c.documentId===id).sort((a,b)=>a.ordinal-b.ordinal);
      const firstRoot=docChunks[0]?.sectionPath?.split(' > ')[0]?.trim()||'';
      const isDocTitle=!!firstRoot&&!/^(?:正文|全文|目录|第\s*\d+\s*页|[一二三四五六七八九十\d]+[、.．\s]|第[一二三四五六七八九十\d]+[章节部分])/.test(firstRoot);
      return {id,fileName:doc?.fileName||id,fileType:doc?.fileType,headings:isDocTitle?[firstRoot]:[]};
    });
  }

  public async retrieve(
    req: RetrievalQuery,
    queryVector?: number[] | Float32Array
  ): Promise<RetrievalResult> {
    const startTime = Date.now();

    // If libraryIds is explicitly provided as empty array, search scope is 0 libraries
    if (req.libraryIds !== undefined && req.libraryIds.length === 0) {
      return {
        query: req.query,
        items: [],
        totalCandidates: 0,
        latencyMs: 0
      };
    }

    const topKCandidates = Math.max(30, req.topK ?? 8);
    const libraryIds = req.libraryIds;
    const identityQuery = isIdentityOrResumeQuery(req.query);
    const isGeneralConcept = req.intent === 'general_tech' || (
      !req.documentIds?.length &&
      !identityQuery &&
      !/你|你们|我|我们|简历|项目|实习|当时|刚才/.test(req.query) &&
      (/(?:什么是|什么叫|解释一下|请解释)/.test(req.query) || /(?:有什么区别|的区别是什么|和.+的区别)\s*[？?]?$/m.test(req.query.trim()))
    );
    const kwQuery = identityQuery
      ? `${req.query} 个人简历 自我介绍 候选人 工程师 技术方向 工作方向 主要职责 教育 实习`
      : req.query;

    // 1. Parallel Candidate Retrieval: Keywords + Vector
    const kwResults = this.keywordIndex.search(kwQuery, libraryIds, topKCandidates, req.documentIds);
    let vecResults: { chunkId: string; score: number }[] = [];

    if (queryVector && this.vectorIndex.size > 0) {
      try {
        const allowedChunkIds = req.documentIds?.length
          ? new Set(this.keywordIndex.scopedChunks(libraryIds).filter(c => req.documentIds!.includes(c.documentId)).map(c => c.id))
          : undefined;
        vecResults = this.vectorIndex.search(queryVector, libraryIds, topKCandidates, allowedChunkIds);
      } catch (err) {
        console.warn('Vector search warning:', err);
      }
    }

    // 2. Rank calculation
    const kwRankMap = new Map<string, number>();
    const kwScoreMap = new Map<string, number>();
    const kwMatchedMap = new Map<string, number>();
    let kwQueryTerms = 0;
    kwResults.forEach((r, idx) => {
      kwRankMap.set(r.chunkId, idx + 1);
      kwScoreMap.set(r.chunkId, r.score);
      kwMatchedMap.set(r.chunkId, r.matchedTerms ?? 1);
      if (r.queryTerms) kwQueryTerms = r.queryTerms;
    });

    const vecRankMap = new Map<string, number>();
    const vecScoreMap = new Map<string, number>();
    vecResults.forEach((r, idx) => {
      vecRankMap.set(r.chunkId, idx + 1);
      vecScoreMap.set(r.chunkId, r.score);
    });

    // 3. Reciprocal Rank Fusion (RRF) with constant k=60 + .md primary authority weighting
    const k = 60;
    const allChunkIds = new Set<string>([...kwRankMap.keys(), ...vecRankMap.keys()]);
    if (identityQuery && !req.documentIds?.length) {
      const perResumeCount = new Map<string, number>();
      const resumeChunks = this.keywordIndex.scopedChunks(libraryIds)
        .filter(c => {
          const d = this.docLookup.getDocument(c.documentId);
          return isResumeDocument({ fileName: d?.fileName || c.documentId, fileType: d?.fileType });
        })
        .sort((a, b) => a.ordinal - b.ordinal);
      for (const rc of resumeChunks) {
        const seenForDoc = perResumeCount.get(rc.documentId) || 0;
        if (seenForDoc < 3) {
          allChunkIds.add(rc.id);
          perResumeCount.set(rc.documentId, seenForDoc + 1);
        }
      }
    }

    const fusedItems: RetrievalResultItem[] = [];
    const resumeIntent = identityQuery || /自我介绍|个人介绍|教育|学校|大学|本科|硕士|学院|专业|论文|期刊|实习|兵装|深蓝|procise|bootloader|jetson|stm32|knn[\s_\-]?ddpg/i.test(req.query);
    const hasMdKeywordHit = [...kwRankMap.keys()].some(cid => {
      const ch = this.keywordIndex.getChunk(cid);
      const d = ch ? this.docLookup.getDocument(ch.documentId) : null;
      return d?.fileType === 'md' || /\.md$/i.test(d?.fileName || '');
    });

    for (const chunkId of allChunkIds) {
      const chunk = this.keywordIndex.getChunk(chunkId);
      if (!chunk || !this.keywordIndex.inScope(chunkId,libraryIds) || (req.documentIds?.length&&!req.documentIds.includes(chunk.documentId))) continue;

      const doc = this.docLookup.getDocument(chunk.documentId);
      const fileName = doc?.fileName || '未知文档';
      const isMd = doc?.fileType === 'md' || /\.md$/i.test(fileName);
      const isPdf = doc?.fileType === 'pdf' || /\.pdf$/i.test(fileName);
      const isResumeDoc = isResumeDocument({ fileName, fileType: doc?.fileType });
      const isQuestionBank = /真题|题库|考点|八股/.test(fileName);

      const kwRank = kwRankMap.get(chunkId);
      const vecRank = vecRankMap.get(chunkId);
      const vecScore = vecScoreMap.get(chunkId) || 0;

      // Open-scope vector noise guard: prevent low-similarity vector hits from injecting unrelated project chunks
      if (!req.documentIds?.length && !kwRank && !(identityQuery && isResumeDoc)) {
        const minVec = kwResults.length === 0 ? 0.46 : 0.35;
        if (vecScore < minVec) continue;
      }

      // General concept guard: prevent single incidental word overlap (e.g. "线程", "UDP") from pulling personal project docs
      if (!req.documentIds?.length && isGeneralConcept && !isQuestionBank) {
        const matchedTerms = kwMatchedMap.get(chunkId) || 0;
        const queryTerms = kwQueryTerms || 1;
        const hasVectors = !!(queryVector && this.vectorIndex.size > 0);
        if (queryTerms >= 2 && matchedTerms < 2 && (!hasVectors || vecScore < 0.44)) continue;
        if (queryTerms < 2 && ((hasVectors && vecScore < 0.44) || (!hasVectors && (kwScoreMap.get(chunkId) || 0) < 2.2))) continue;
      }

      const rrfKw = kwRank ? 1.0 / (k + kwRank) : 0;
      const rrfVec = vecRank ? 1.0 / (k + vecRank) : 0;
      const section=caseSection(chunk.sectionPath);
      const caseIntent=/坑|卡在哪|定位|排查|故障|异常|量化|校准|怎么确认|效果|结果|最后/.test(req.query);
      const authorityBoost = resumeIntent
        ? (isResumeDoc ? 0.025 + (identityQuery && chunk.ordinal <= 2 ? 0.015 : 0) : 0)
        : (isMd ? 0.006 : (isPdf && hasMdKeywordHit ? -0.003 : 0));
      const rrfScore = rrfKw + rrfVec + authorityBoost + (section&&caseIntent?0.04:0) + (req.focusSection&&section===req.focusSection?0.1:0);

      fusedItems.push({
        chunkId,
        documentId: chunk.documentId,
        fileName,
        sectionPath: chunk.sectionPath,
        pageStart: chunk.pageStart,
        pageEnd: chunk.pageEnd,
        text: chunk.text,
        keywordScore: kwScoreMap.get(chunkId) || 0,
        keywordRank: kwRank,
        vectorScore: vecScoreMap.get(chunkId) || 0,
        vectorRank: vecRank,
        rrfScore
      });
    }

    // Sort descending by RRF score
    fusedItems.sort((a, b) => b.rrfScore - a.rrfScore);

    // Build seeds: when multiple target documents are explicitly requested, ensure balanced round-robin coverage
    const targetCap = Math.max(1, req.topK ?? 8);
    let seeds: RetrievalResultItem[];
    const multiDocRequest = !!(req.documentIds && req.documentIds.length > 1);
    if (multiDocRequest) {
      const byDoc = new Map<string, RetrievalResultItem[]>();
      for (const docId of req.documentIds!) byDoc.set(docId, []);
      for (const item of fusedItems) {
        if (!byDoc.has(item.documentId)) byDoc.set(item.documentId, []);
        byDoc.get(item.documentId)!.push(item);
      }
      const interleaved: RetrievalResultItem[] = [];
      const pickedIds = new Set<string>();
      for (let round = 0; round < 2; round++) {
        for (const list of byDoc.values()) {
          if (list[round] && !pickedIds.has(list[round].chunkId)) {
            interleaved.push(list[round]);
            pickedIds.add(list[round].chunkId);
          }
        }
      }
      const cap = Math.max(targetCap, req.documentIds!.length * 2);
      for (const item of fusedItems) {
        if (interleaved.length >= cap) break;
        if (!pickedIds.has(item.chunkId)) {
          interleaved.push(item);
          pickedIds.add(item.chunkId);
        }
      }
      seeds = interleaved;
    } else {
      seeds = fusedItems.slice(0, targetCap);
    }

    // A case is an evidence unit. Keep its outcome with its diagnosis instead
    // of using document diversity to replace it with unrelated project material.
    const finalItems:RetrievalResultItem[]=[];const seen=new Set<string>();const omitted:string[]=[];const handled=new Set<string>();
    const budget=req.maxContextChars??10000;let used=0;
    const distinctSeedDocs=new Set(seeds.map(s=>s.documentId)).size;
    const neighborRadius=multiDocRequest&&distinctSeedDocs>1?4:16;
    for(const seed of seeds){
      if(seen.has(seed.chunkId))continue;
      const section=caseSection(seed.sectionPath);
      const groupId=seed.documentId+'::'+(section||seed.chunkId);if(handled.has(groupId))continue;handled.add(groupId);
      const group=[seed];
      if(section&&this.docLookup.getNeighborChunk){
        for(const direction of [-1,1])for(let n=1;n<=neighborRadius;n++){
          const chunk=this.docLookup.getNeighborChunk(seed.chunkId,n*direction);
          if(!chunk||chunk.documentId!==seed.documentId||caseSection(chunk.sectionPath)!==section)break;
          if(!this.keywordIndex.inScope(chunk.id,libraryIds))continue;
          if(n===neighborRadius){const more=this.docLookup.getNeighborChunk(seed.chunkId,(neighborRadius+1)*direction);if(more&&caseSection(more.sectionPath)===section)omitted.push(`${seed.fileName} / ${section}：案例超过邻接扩展范围，仍有片段未发送`);}
          group.push({...seed,chunkId:chunk.id,text:chunk.text,sectionPath:chunk.sectionPath,pageStart:chunk.pageStart,pageEnd:chunk.pageEnd});
        }
      }
      group.sort((a,b)=>this.keywordIndex.getChunk(a.chunkId)!.ordinal-this.keywordIndex.getChunk(b.chunkId)!.ordinal);
      const unique=group.filter(x=>!seen.has(x.chunkId));
      const size=unique.reduce((sum,x)=>sum+x.text.length,0);
      let included=unique;
      if(size>budget-used){
        const priority=(item:RetrievalResultItem)=>/结果|验证|修复/.test(item.sectionPath)?4:/根因/.test(item.sectionPath)?3:/定位|排查/.test(item.sectionPath)?2:1;
        let remaining=budget-used;included=[];
        for(const item of [...unique].sort((a,b)=>priority(b)-priority(a))){
          if(item.text.length<=remaining){included.push(item);remaining-=item.text.length;}
          else omitted.push(`${item.fileName} / ${item.sectionPath}：超过剩余预算，未发送该片段`);
        }
        included.sort((a,b)=>this.keywordIndex.getChunk(a.chunkId)!.ordinal-this.keywordIndex.getChunk(b.chunkId)!.ordinal);
      }
      for(const item of included){seen.add(item.chunkId);finalItems.push({...item,caseKey:section?seed.documentId+'::'+section:undefined});used+=item.text.length;}
    }

    return {
      query: req.query,
      items: finalItems,
      omitted,
      totalCandidates: fusedItems.length,
      latencyMs: Date.now() - startTime
    };
  }
}
