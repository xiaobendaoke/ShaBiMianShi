import {caseSection} from '../services/projectFocus';
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
    return [...new Set(chunks.map(c=>c.documentId))].map(id=>({id,fileName:this.docLookup.getDocument(id)?.fileName||id,
      headings:[...new Set(chunks.filter(c=>c.documentId===id).map(c=>c.sectionPath.split(' > ')[0]))].slice(0,6)}));
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

    // 1. Parallel Candidate Retrieval: Keywords + Vector
    const kwResults = this.keywordIndex.search(req.query, libraryIds, topKCandidates, req.documentIds);
    let vecResults: { chunkId: string; score: number }[] = [];

    if (queryVector && this.vectorIndex.size > 0) {
      try {
        vecResults = this.vectorIndex.search(queryVector, libraryIds, topKCandidates);
      } catch (err) {
        console.warn('Vector search warning:', err);
      }
    }

    // 2. Rank calculation
    const kwRankMap = new Map<string, number>();
    const kwScoreMap = new Map<string, number>();
    kwResults.forEach((r, idx) => {
      kwRankMap.set(r.chunkId, idx + 1);
      kwScoreMap.set(r.chunkId, r.score);
    });

    const vecRankMap = new Map<string, number>();
    const vecScoreMap = new Map<string, number>();
    vecResults.forEach((r, idx) => {
      vecRankMap.set(r.chunkId, idx + 1);
      vecScoreMap.set(r.chunkId, r.score);
    });

    // 3. Reciprocal Rank Fusion (RRF) with constant k=60
    const k = 60;
    const allChunkIds = new Set<string>([...kwRankMap.keys(), ...vecRankMap.keys()]);
    const fusedItems: RetrievalResultItem[] = [];

    for (const chunkId of allChunkIds) {
      const chunk = this.keywordIndex.getChunk(chunkId);
      if (!chunk || !this.keywordIndex.inScope(chunkId,libraryIds) || (req.documentIds?.length&&!req.documentIds.includes(chunk.documentId))) continue;

      const doc = this.docLookup.getDocument(chunk.documentId);
      const fileName = doc?.fileName || '未知文档';

      const kwRank = kwRankMap.get(chunkId);
      const vecRank = vecRankMap.get(chunkId);

      const rrfKw = kwRank ? 1.0 / (k + kwRank) : 0;
      const rrfVec = vecRank ? 1.0 / (k + vecRank) : 0;
      const section=caseSection(chunk.sectionPath);
      const caseIntent=/坑|卡在哪|定位|排查|故障|异常|量化|校准|怎么确认|效果|结果|最后/.test(req.query);
      const rrfScore = rrfKw + rrfVec + (section&&caseIntent?0.04:0) + (req.focusSection&&section===req.focusSection?0.1:0);

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

    // A case is an evidence unit. Keep its outcome with its diagnosis instead
    // of using document diversity to replace it with unrelated project material.
    const finalItems:RetrievalResultItem[]=[];const seen=new Set<string>();const omitted:string[]=[];const handled=new Set<string>();
    const budget=req.maxContextChars??10000;let used=0;
    const seeds=fusedItems.slice(0,Math.max(1,req.topK??8));
    for(const seed of seeds){
      if(seen.has(seed.chunkId))continue;
      const section=caseSection(seed.sectionPath);
      const groupId=seed.documentId+'::'+(section||seed.chunkId);if(handled.has(groupId))continue;handled.add(groupId);
      const group=[seed];
      if(section&&this.docLookup.getNeighborChunk){
        for(const direction of [-1,1])for(let n=1;n<=16;n++){
          const chunk=this.docLookup.getNeighborChunk(seed.chunkId,n*direction);
          if(!chunk||chunk.documentId!==seed.documentId||caseSection(chunk.sectionPath)!==section)break;
          if(!this.keywordIndex.inScope(chunk.id,libraryIds))continue;
          if(n===16){const more=this.docLookup.getNeighborChunk(seed.chunkId,17*direction);if(more&&caseSection(more.sectionPath)===section)omitted.push(`${seed.fileName} / ${section}：案例超过邻接扩展范围，仍有片段未发送`);}
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
