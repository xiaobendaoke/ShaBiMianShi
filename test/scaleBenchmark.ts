import os from 'os';
import { fileURLToPath } from 'url';
import { KeywordIndex } from '../src/main/indexing/keywordIndex';

const __filename = fileURLToPath(import.meta.url);
import { VectorIndex } from '../src/main/indexing/vectorIndex';
import { RetrievalService } from '../src/main/indexing/retrievalService';
import { ChunkRecord, DocumentRecord } from '../src/main/types';

export function runScaleBenchmark() {
  console.log('======================================================================');
  console.log('           500 篇文档 / 20,000 Chunks 知识库检索规模压测              ');
  console.log('======================================================================');

  const cpus = os.cpus();
  console.log(`运行环境: macOS ${os.release()} (${os.arch()})`);
  console.log(`CPU: ${cpus.length} 核心 - ${cpus[0]?.model || 'Apple Silicon'}`);
  console.log(`物理内存: ${(os.totalmem() / (1024 ** 3)).toFixed(2)} GB`);
  console.log('----------------------------------------------------------------------');

  const startMem = process.memoryUsage().heapUsed;
  const keywordIndex = new KeywordIndex();
  const vectorIndex = new VectorIndex();
  const docsMap = new Map<string, DocumentRecord>();

  const DIMENSIONS = 1536;
  vectorIndex.setProfile({
    profileId: 'scale_test',
    model: 'text-embedding-3-small',
    dimensions: DIMENSIONS,
    createdAt: Date.now()
  });

  const topics = [
    '订单交易系统幂等性设计与防重 Token 机制',
    '高并发分布式缓存穿透、雪崩与布隆过滤器实践',
    '基于 Redis Redlock 与 Lua 脚本的分布式锁实现要点',
    'MySQL 分库分表 ShardingSphere 与两阶段提交 XA 事务',
    'RocketMQ 事务消息半消息机制与最终一致性方案',
    '网关层令牌桶限流算法与熔断降级 Sentinel 集成',
    '全文检索 Elasticsearch 倒排索引原理与深度分页调优',
    '微服务链路追踪 OpenTelemetry 与日志采集排查方案',
    'Netty 高性能网络模型与零拷贝 Epoll 优化实践',
    '用户权限系统 RBAC 模型与 JWT 双 Token 无感刷新'
  ];

  console.log('正在生成 500 份合成文档及约 20,000 个 Chunks...');
  const genStart = Date.now();

  const TOTAL_DOCS = 500;
  const CHUNKS_PER_DOC = 40; // 500 * 40 = 20,000 chunks
  let totalChunksCount = 0;

  for (let d = 0; d < TOTAL_DOCS; d++) {
    const docId = `doc_scale_${d}`;
    const topic = topics[d % topics.length];
    const docRecord: DocumentRecord = {
      id: docId,
      fileName: `项目架构技术方案_${d}_${topic.slice(0, 10)}.md`,
      fileType: 'md',
      fileSize: 1024 * 40,
      fileHash: `hash_mock_${d}`,
      pageCount: null,
      status: 'ready',
      errorMsg: null,
      needsOcr: false,
      storagePath: `/mock/path/${docId}.md`,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      libraryIds: ['lib_scale_test']
    };
    docsMap.set(docId, docRecord);

    for (let c = 0; c < CHUNKS_PER_DOC; c++) {
      const chunkId = `${docId}_c${c}`;
      const chunkText = `第 ${c} 节：在${topic}中，核心解决思路是采用模块化解耦与幂等校验机制。\n` +
        `在分布式集群环境下，通过对每个业务请求分配全局唯一链路标识与防重令牌，防止网络抖动导致的重复消费。\n` +
        `当发生异常时，结合重试队列与死信队列保障系统的最终数据一致性。`;

      const chunk: ChunkRecord = {
        id: chunkId,
        documentId: docId,
        documentVersion: 1,
        libraryId: 'lib_scale_test',
        sectionPath: `${topic} > 第 ${c} 节`,
        pageStart: null,
        pageEnd: null,
        ordinal: c,
        sourceStart: c * 200,
        sourceEnd: (c + 1) * 200,
        text: chunkText,
        contentHash: `hash_chunk_${d}_${c}`,
        tokenEstimate: 280,
        createdAt: Date.now()
      };

      keywordIndex.addChunk(chunk);

      // Generate normalized mock embedding vector
      const v = new Float32Array(DIMENSIONS);
      v[d % DIMENSIONS] = 0.6;
      v[c % DIMENSIONS] += 0.4;
      v[(d + c) % DIMENSIONS] += 0.3;
      vectorIndex.addVector(chunkId, 'lib_scale_test', v);

      totalChunksCount++;
    }
  }

  const genTime = Date.now() - genStart;
  const memUsed = (process.memoryUsage().heapUsed - startMem) / (1024 * 1024);
  console.log(`生成与索引完成！总文档数: ${TOTAL_DOCS}, 总 Chunks: ${totalChunksCount}`);
  console.log(`索引构建耗时: ${genTime} ms`);
  console.log(`内存占用增量: ${memUsed.toFixed(2)} MB`);
  console.log('----------------------------------------------------------------------');

  const retrievalService = new RetrievalService(keywordIndex, vectorIndex, {
    getDocument: (id) => docsMap.get(id) || null
  });

  // Benchmark queries
  const testQueries = [
    '订单重复提交怎么解决',
    'Redis 分布式锁 Lua 脚本',
    '缓存穿透与布隆过滤器',
    '消息队列事务半消息',
    'MySQL 分库分表一致性',
    '令牌桶限流算法',
    'Elasticsearch 深度分页',
    '微服务链路追踪',
    'Netty 零拷贝',
    'JWT 双 Token 刷新'
  ];

  console.log('正在执行 100 次混合检索测试并统计延迟分布...');
  const latencies: number[] = [];
  const dummyVec = new Float32Array(DIMENSIONS);
  dummyVec[0] = 0.5;
  dummyVec[1] = 0.5;

  // JIT Warmup
  for (let w = 0; w < 5; w++) {
    keywordIndex.search(testQueries[w], ['lib_scale_test'], 10);
    vectorIndex.search(dummyVec, ['lib_scale_test'], 10);
  }

  for (let i = 0; i < 100; i++) {
    const q = testQueries[i % testQueries.length];
    const t0 = performance.now();
    const res = keywordIndex.search(q, ['lib_scale_test'], 30);
    const vecRes = vectorIndex.search(dummyVec, ['lib_scale_test'], 30);
    const t1 = performance.now();
    latencies.push(t1 - t0);
  }

  latencies.sort((a, b) => a - b);
  const p50 = latencies[Math.floor(latencies.length * 0.50)];
  const p90 = latencies[Math.floor(latencies.length * 0.90)];
  const p95 = latencies[Math.floor(latencies.length * 0.95)];
  const max = latencies[latencies.length - 1];
  const min = latencies[0];
  const avg = latencies.reduce((a, b) => a + b, 0) / latencies.length;

  console.log(`检索性能统计 (单位: 毫秒 ms):`);
  console.log(`  Min: ${min.toFixed(2)} ms`);
  console.log(`  Avg: ${avg.toFixed(2)} ms`);
  console.log(`  p50: ${p50.toFixed(2)} ms`);
  console.log(`  p90: ${p90.toFixed(2)} ms`);
  console.log(`  p95: ${p95.toFixed(2)} ms`);
  console.log(`  Max: ${max.toFixed(2)} ms`);
  console.log('----------------------------------------------------------------------');

  return {
    docs: TOTAL_DOCS,
    chunks: totalChunksCount,
    dimensions: DIMENSIONS,
    indexTimeMs: genTime,
    memoryMb: memUsed,
    p50,
    p90,
    p95,
    max,
    min,
    avg
  };
}

if (process.argv[1] === __filename) {
  runScaleBenchmark();
}
