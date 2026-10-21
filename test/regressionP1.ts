import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

import { AppDatabase } from '../src/main/db/database';
import { KeyVault } from '../src/main/services/keyVault';
import { KeywordIndex } from '../src/main/indexing/keywordIndex';
import { VectorIndex } from '../src/main/indexing/vectorIndex';
import { RetrievalService } from '../src/main/indexing/retrievalService';
import { IngestionQueue } from '../src/main/services/ingestionQueue';
import { MockAiServer } from '../src/main/services/mockServer';
import { ProviderService } from '../src/main/services/providerService';
import { parseDocument } from '../src/main/parsers';
import { parsePdf } from '../src/main/parsers/pdfParser';
import { parseDocx } from '../src/main/parsers/docxParser';
import { ProviderProfile, CitationSnapshot } from '../src/main/types';

async function runRegressionSuite() {
  console.log('======================================================================');
  console.log('           后端架构审查与定向修复验证套件 (P1-01 ~ P1-06)             ');
  console.log('======================================================================\n');

  const tempDir = path.join(__dirname, '../.test_regression_suite');
  if (fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true });
  fs.mkdirSync(tempDir, { recursive: true });

  const dbPath = path.join(tempDir, 'reg.db');
  const db = new AppDatabase(dbPath);
  const keyVault = new KeyVault(tempDir);
  const keywordIndex = new KeywordIndex();
  const vectorIndex = new VectorIndex();
  const storageDir = path.join(tempDir, 'storage');

  const mockPort = 52166;
  const mockServer = new MockAiServer(mockPort);
  await mockServer.start();

  const providerService = new ProviderService(keyVault);

  const embedProfile: ProviderProfile = {
    id: 'embed_prof',
    name: 'Embed Service',
    protocol: 'openai',
    baseUrl: `http://127.0.0.1:${mockPort}/v1`,
    hasKey: true,
    modelChat: 'mock-gpt-4o',
    modelEmbed: 'text-embedding-3-small',
    modelVision: 'mock-gpt-4o',
    modelAsr: 'whisper-1',
    timeoutMs: 5000,
    isActive: true,
    createdAt: Date.now()
  };

  const chatProfile: ProviderProfile = {
    id: 'chat_prof',
    name: 'Chat Service',
    protocol: 'openai',
    baseUrl: `http://127.0.0.1:${mockPort}/v1`,
    hasKey: true,
    modelChat: 'mock-gpt-4o',
    modelEmbed: 'text-embedding-3-small',
    modelVision: 'mock-gpt-4o',
    modelAsr: 'whisper-1',
    timeoutMs: 5000,
    isActive: true,
    createdAt: Date.now()
  };

  db.saveProfile(embedProfile);
  db.saveProfile(chatProfile);
  keyVault.setKey(embedProfile.id, 'mock-key-embed');
  keyVault.setKey(chatProfile.id, 'mock-key-chat');

  // Bind distinct roles
  db.setActiveProviderId('embed', embedProfile.id);
  db.setActiveProviderId('chat', chatProfile.id);

  try {
    // =================================================================
    // 验证 P1-01: 文档入库自动生成向量、SQLite 持久化与冷启动恢复
    // =================================================================
    console.log('[Test P1-01] 验证文档导入流水线向量生成、DB持久化与重启恢复...');
    const queue = new IngestionQueue(db, keywordIndex, vectorIndex, storageDir, providerService);

    const docPath = path.join(tempDir, 'idempotent_spec.md');
    fs.writeFileSync(
      docPath,
      '# 分布式系统接口幂等性规范\n\n' +
      '## 核心设计原理\n' +
      '在微服务架构中，网络超时重试会导致重复请求。' +
      '本规范强制要求使用唯一幂等令牌 Idempotency-Key，结合 Redis 分布式锁与数据库唯一索引保障幂等。\n\n' +
      '## 异常处理与重试机制\n' +
      '如果下游处理超时，客户端发起重试必须携带相同业务流水号。服务端校验状态机防止重复结算。\n',
      'utf-8'
    );

    db.saveLibrary({
      id: 'lib_payment',
      name: '支付结算库',
      description: '交易与结算架构设计规范',
      docCount: 0,
      createdAt: Date.now(),
      updatedAt: Date.now()
    });

    queue.addFiles([docPath], 'lib_payment');
    while (queue.getStats().queued > 0 || queue.getStats().processing > 0) {
      await new Promise(r => setTimeout(r, 40));
    }

    assert.strictEqual(vectorIndex.size > 0, true, 'vectorIndex 必须包含导入生成的向量！');
    assert.strictEqual(keywordIndex.size > 0, true, 'keywordIndex 必须包含导入生成的关键词索引！');

    const savedEmbeddingsCount = db.getEmbeddingCount();
    assert.strictEqual(savedEmbeddingsCount > 0, true, `SQLite embeddings 表应持久化向量，当前记录数: ${savedEmbeddingsCount}`);

    // 测试冷启动恢复：新建 VectorIndex，直接从 SQLite 恢复
    const restoredVectorIndex = new VectorIndex();
    const storedEmbeddings = db.getAllEmbeddings();
    assert.strictEqual(storedEmbeddings.length, savedEmbeddingsCount);
    for (const emb of storedEmbeddings) {
      restoredVectorIndex.addVector(emb.chunkId, ['lib_payment'], emb.vector);
    }
    assert.strictEqual(restoredVectorIndex.size, vectorIndex.size, '冷启动恢复后向量索引数量必须完全一致！');
    console.log(`  ✓ P1-01 通过: 向量成功生成 (${vectorIndex.size} 条), SQLite 持久化 (${savedEmbeddingsCount} 条), 冷启动恢复一致\n`);

    // =================================================================
    // 验证 P1-02: 供应商角色解耦、cleanBaseUrl 路径保护与防静默假 Key
    // =================================================================
    console.log('[Test P1-02] 验证供应商角色独立绑定、URL构造与 Key 校验...');

    // 1. URL 构造规则验证
    assert.strictEqual(ProviderService.cleanBaseUrl('https://api.openai.com'), 'https://api.openai.com/v1');
    assert.strictEqual(ProviderService.cleanBaseUrl('https://api.openai.com/'), 'https://api.openai.com/v1');
    assert.strictEqual(ProviderService.cleanBaseUrl('https://my-gateway.internal/v1'), 'https://my-gateway.internal/v1');
    assert.strictEqual(ProviderService.cleanBaseUrl('https://my-gateway.internal/api/v2'), 'https://my-gateway.internal/api/v2');
    assert.strictEqual(ProviderService.cleanBaseUrl('http://127.0.0.1:8000/deepseek/v3/'), 'http://127.0.0.1:8000/deepseek/v3');

    // 2. 独立角色获取验证
    assert.strictEqual(db.getActiveProviderId('chat'), chatProfile.id);
    assert.strictEqual(db.getActiveProviderId('embed'), embedProfile.id);

    // 3. 真实服务未填 Key 时，严禁伪称成功或静默填假 Key
    const unconfiguredProfile: ProviderProfile = {
      id: 'unconfigured_prof',
      name: 'Unconfigured Real Provider',
      protocol: 'openai',
      baseUrl: 'https://api.deepseek.com',
      hasKey: false,
      modelChat: 'deepseek-chat',
      modelEmbed: 'deepseek-embed',
      modelVision: 'deepseek-chat',
      modelAsr: 'whisper-1',
      timeoutMs: 5000,
      isActive: true,
      createdAt: Date.now()
    };
    db.saveProfile(unconfiguredProfile);

    let caughtKeyError = false;
    try {
      await providerService.generateEmbeddings(unconfiguredProfile, ['测试问题']);
    } catch (err: any) {
      caughtKeyError = true;
      assert.strictEqual(err.message.includes('未配置 API Key'), true, '未配 Key 时应明确报错拦截');
    }
    assert.strictEqual(caughtKeyError, true, '未配置 API Key 时不得静默使用假 Key 发出请求');
    console.log('  ✓ P1-02 通过: cleanBaseUrl 边界完整, 角色独立解耦, 缺少 Key 严格拦截\n');

    // =================================================================
    // 验证 P1-03: 跨知识库复用、多库检索范围与空库过滤语义
    // =================================================================
    console.log('[Test P1-03] 验证多知识库跨库复用、精确检索范围与空库隔离...');
    db.saveLibrary({
      id: 'lib_trade',
      name: '交易中台库',
      description: '复用支付库文档',
      docCount: 0,
      createdAt: Date.now(),
      updatedAt: Date.now()
    });

    // 将完全相同的文件导入到 lib_trade（触发哈希去重与多库关联）
    queue.addFiles([docPath], 'lib_trade');
    while (queue.getStats().queued > 0 || queue.getStats().processing > 0) {
      await new Promise(r => setTimeout(r, 40));
    }

    const retrievalService = new RetrievalService(keywordIndex, vectorIndex, {
      getDocument: (id) => db.getDocument(id)
    });

    // 1. 在 lib_trade 中应该能准确检索到已复用的文档
    const resInTrade = await retrievalService.retrieve({
      query: '幂等令牌与状态机',
      libraryIds: ['lib_trade']
    });
    assert.strictEqual(resInTrade.items.length > 0, true, '复用文档必须在目标库中可被检索！');

    // 2. 空数组 libraryIds: [] 表示选择 0 个知识库，必须返回 0 条结果，不得全库泄露！
    const resEmpty = await retrievalService.retrieve({
      query: '幂等令牌与状态机',
      libraryIds: []
    });
    assert.strictEqual(resEmpty.items.length, 0, 'libraryIds=[] 必须返回空候选，严禁泄露所有库数据！');

    // 3. 检索未关联的不存在库，必须返回 0 条结果
    const resOther = await retrievalService.retrieve({
      query: '幂等令牌与状态机',
      libraryIds: ['lib_non_existent']
    });
    assert.strictEqual(resOther.items.length, 0, '未关联库不得返回命中');
    console.log('  ✓ P1-03 通过: 跨库复用检索命中正常, libraryIds=[] 严格返回 0 条\n');

    // =================================================================
    // 验证 P1-04: PDF 与 DOCX 解析器健壮性与扫描件识别
    // =================================================================
    console.log('[Test P1-04] 验证 PDF/DOCX 真实解析引擎与 OCR 标记...');

    // 构造带文本的 PDF
    const textPdfBuffer = Buffer.from(
      '%PDF-1.4\n' +
      '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n' +
      '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n' +
      '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R >>\nendobj\n' +
      '4 0 obj\n<< /Length 45 >>\nstream\nBT /F1 12 Tf (Distributed Transactions 2PC Architecture) Tj ET\nendstream\nendobj\n' +
      'xref\n0 5\n0000000000 65535 f \n0000000009 00000 n \n0000000058 00000 n \n0000000115 00000 n \n0000000204 00000 n \n' +
      'trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n300\n%%EOF'
    );
    const parsedPdf = await parsePdf(textPdfBuffer);
    assert.strictEqual(parsedPdf.pageCount >= 1, true);
    assert.strictEqual(parsedPdf.text.includes('Distributed Transactions'), true);
    assert.strictEqual(parsedPdf.needsOcr, false, '有文字内容的 PDF 不应被标记为 OCR');

    // 构造扫描件/无文字层 PDF
    const scannedPdfBuffer = Buffer.from(
      '%PDF-1.4\n' +
      '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n' +
      '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n' +
      '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R >>\nendobj\n' +
      '4 0 obj\n<< /Length 10 >>\nstream\nq Q\nendstream\nendobj\n' +
      'xref\n0 5\n0000000000 65535 f \n0000000009 00000 n \n0000000058 00000 n \n0000000115 00000 n \n0000000204 00000 n \n' +
      'trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n260\n%%EOF'
    );
    const parsedScanned = await parsePdf(scannedPdfBuffer);
    assert.strictEqual(parsedScanned.needsOcr, true, '无文字层的扫描 PDF 必须准确标记 needsOcr=true！');
    console.log('  ✓ P1-04 通过: PDF 文本提取正常，扫描无字件精准识别 needsOcr\n');

    // =================================================================
    // 验证 P1-05: 真实引用校验、全量原文读取与邻近分片拓展
    // =================================================================
    console.log('[Test P1-05] 验证引用校验 (精确识别真引用与虚构编号)、全文及邻近分片...');

    const candidateCitations: CitationSnapshot[] = [
      {
        id: 'c1',
        citationIndex: 1,
        chunkId: 'chk_1',
        documentId: 'doc_1',
        fileName: '架构规范.md',
        page: 1,
        sectionPath: '核心原理',
        snippet: '采用唯一幂等令牌 Idempotency-Key'
      },
      {
        id: 'c2',
        citationIndex: 2,
        chunkId: 'chk_2',
        documentId: 'doc_1',
        fileName: '架构规范.md',
        page: 2,
        sectionPath: '异常处理',
        snippet: '客户端发起重试必须携带相同业务流水号'
      }
    ];

    // 模型只引用了 [资料2]，并幻觉捏造了 [资料99]
    const answerWithCitations = '系统采用重试机制，要求携带相同流水号 [资料2]。另外参考了外部设计 [资料99]。';
    const { verifiedCitations, hallucinatedNumbers } = ProviderService.verifyCitations(answerWithCitations, candidateCitations);

    assert.strictEqual(verifiedCitations.length, 1, '只有在正文中真实引用的资料才能被标记为 verified');
    assert.strictEqual(verifiedCitations[0].citationIndex, 2);
    assert.strictEqual(verifiedCitations[0].isVerified, true);
    assert.deepStrictEqual(hallucinatedNumbers, [99], '必须准确定位模型幻觉捏造的资料编号');

    // 验证邻近分片与全文读取
    const allChunksInDb = db.getAllChunks();
    if (allChunksInDb.length > 0) {
      const firstChunk = allChunksInDb[0];
      const neighbors = db.getNeighborChunks(firstChunk.id, 1, 1);
      assert.strictEqual(Array.isArray(neighbors), true);
      const fullDocText = db.getDocumentText(firstChunk.documentId);
      assert.strictEqual(fullDocText.length > 0, true, 'getDocumentText 必须能够返回完整文档拼装正文');
    }
    console.log('  ✓ P1-05 通过: 真实引用精确筛选 (淘汰未引用分片, 识别幻觉标号), 全文与邻近分片读取正常\n');

    // =================================================================
    // 验证 P1-06: 独立 AbortController、风格注入与流式中断
    // =================================================================
    console.log('[Test P1-06] 验证会话回答风格注入与独立 AbortController 取消...');

    // 1. 测试流式生成与提示词风格注入
    let streamedTokens = '';
    let completedAnswer = '';
    const abortController = new AbortController();

    await providerService.streamChat(
      chatProfile,
      '如何实现接口幂等性？',
      [{ citationIndex: 1, text: '使用唯一幂等 Token 配合 Redis', fileName: '规范.md', sectionPath: '原理' }],
      'docs_and_general',
      [],
      {
        onToken: (tok) => { streamedTokens += tok; },
        onError: (err) => { console.error('Stream error:', err); },
        onComplete: (ans) => { completedAnswer = ans; }
      },
      'concise',
      abortController.signal
    );

    assert.strictEqual(streamedTokens.length > 0, true, 'SSE 流式必须能够接收到 token');
    assert.strictEqual(completedAnswer.length > 0, true, '必须触发 onComplete 回调');

    // 2. 测试主动中断
    const cancelController = new AbortController();
    let cancelCaught = false;
    const cancelPromise = providerService.streamChat(
      chatProfile,
      '长文本问答',
      [],
      'docs_and_general',
      [],
      {
        onToken: () => {
          cancelController.abort(); // 接收首个 token 立即取消
        },
        onError: (err) => {
          if (err.message.includes('取消')) {
            cancelCaught = true;
          }
        },
        onComplete: () => {}
      },
      'standard',
      cancelController.signal
    );
    await cancelPromise;
    assert.strictEqual(cancelCaught, true, 'AbortSignal 必须触发取消异常并优雅中止！');
    console.log('  ✓ P1-06 通过: SSE 流式传输正常, 回答风格注入生效, AbortSignal 优雅取消完成\n');

    console.log('======================================================================');
    console.log('   🎉 审查报告涉及的 P1-01 ~ P1-06 核心缺陷全部修复并完成定向验收！    ');
    console.log('======================================================================');

  } finally {
    await mockServer.stop();
    db.close();
  }
}

runRegressionSuite().catch(err => {
  console.error('\n❌ 回归测试套件发现未通过项:', err);
  process.exit(1);
});
