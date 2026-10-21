import http from 'http';
import crypto from 'crypto';

export class MockAiServer {
  private server: http.Server | null = null;
  private port: number = 52140;
  private shouldSimulate429: boolean = false;
  private shouldSimulateTimeout: boolean = false;
  private splitMultibyteUtf8: boolean = false;

  constructor(port = 52140) {
    this.port = port;
  }

  public setSimulate429(enable: boolean) {
    this.shouldSimulate429 = enable;
  }

  public setSimulateTimeout(enable: boolean) {
    this.shouldSimulateTimeout = enable;
  }

  public setSplitMultibyteUtf8(enable: boolean) {
    this.splitMultibyteUtf8 = enable;
  }

  public start(): Promise<string> {
    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => {
        // Handle CORS
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

        if (req.method === 'OPTIONS') {
          res.writeHead(200);
          res.end();
          return;
        }

        const url = req.url || '';
        const bodyChunks: Buffer[] = [];

        req.on('data', chunk => bodyChunks.push(chunk));
        req.on('end', async () => {
          const bodyStr = Buffer.concat(bodyChunks).toString('utf-8');
          let jsonBody: any = {};
          try {
            if (bodyStr) jsonBody = JSON.parse(bodyStr);
          } catch {}

          if (this.shouldSimulate429) {
            res.writeHead(429, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: { message: 'Rate limit exceeded (Mock 429)', type: 'rate_limit_error', code: 'rate_limit' } }));
            return;
          }

          if (this.shouldSimulateTimeout) {
            // Keep connection open without answering
            return;
          }

          // 1. Embeddings Endpoint: /v1/embeddings
          if (url.includes('/embeddings')) {
            const inputs = Array.isArray(jsonBody.input) ? jsonBody.input : [jsonBody.input || ''];
            const data = inputs.map((inp: string, idx: number) => {
              const vec = this.generateDeterministicVector(inp, 1536);
              return {
                object: 'embedding',
                index: idx,
                embedding: vec
              };
            });

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              object: 'list',
              data,
              model: jsonBody.model || 'text-embedding-3-small',
              usage: { prompt_tokens: 10, total_tokens: 10 }
            }));
            return;
          }

          // 2. Chat Completions Endpoint: /v1/chat/completions
          if (url.includes('/chat/completions')) {
            const messages = jsonBody.messages || [];
            const isStream = jsonBody.stream === true;
            const rawContent = messages[messages.length - 1]?.content;
            let lastMsg = '';
            let hasImageUrl = false;
            if (typeof rawContent === 'string') {
              lastMsg = rawContent;
            } else if (Array.isArray(rawContent)) {
              for (const part of rawContent) {
                if (part.type === 'text') lastMsg += part.text + ' ';
                if (part.type === 'image_url') hasImageUrl = true;
              }
            }

            // Generate structured interview response
            let replyText = '';
            if (hasImageUrl || lastMsg.includes('提取截图中') || lastMsg.includes('识别助手')) {
              replyText = '面试官提问：在分布式高并发系统中，如何设计一套保证接口幂等性与防重提交的方案？请结合实际项目说明。';
            } else if (lastMsg.includes('百分之多少') || lastMsg.includes('性能提高了')) {
              replyText = '根据提供的项目资料，文档中仅描述了接口幂等性的技术改造与分布式事务保障方案，**并未提供具体的性能提升百分比或量化吞吐量提升数字**。在仅依据资料的策略下，不可虚构业务数字。';
            } else if (lastMsg.includes('订单') || lastMsg.includes('幂等')) {
              replyText = '在分布式系统中处理订单重复提交，通常采用以下几项关键技术方案：\n\n' +
                '1. **防重 Token / 唯一业务流水号机制** [资料1]：客户端在提交前向服务端申请唯一 Token，服务端存入 Redis 并设置短暂过期时间，消费后立即原子删除。\n' +
                '2. **数据库唯一键约束与乐观锁** [资料1]：在数据库订单表将 `order_id` 或 `request_id` 设为唯一索引，并发插入时直接触发唯一键冲突异常。\n' +
                '3. **分布式锁控制**：使用 Redis Redlock 或 setnx 锁住关键用户操作，避免高并发下多实例同时执行扣减。';
            } else {
              replyText = `针对您提出的问题：“${lastMsg.slice(0, 30)}...”，根据参考资料与系统架构设计原则：\n\n` +
                '1. 核心业务采用模块化解耦架构，结合本地缓存与分布式缓存提升响应速率。\n' +
                '2. 针对高并发与故障容灾，设置明确的熔断降级与重试回退机制。\n' +
                '3. 相关实现与背景可参考 [资料1] 与工程配置说明。';
            }

            if (!isStream) {
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({
                id: `chatcmpl-${Date.now()}`,
                object: 'chat.completion',
                created: Math.floor(Date.now() / 1000),
                model: jsonBody.model || 'mock-gpt-4o',
                choices: [{
                  index: 0,
                  message: { role: 'assistant', content: replyText },
                  finish_reason: 'stop'
                }]
              }));
              return;
            }

            // Stream SSE
            res.writeHead(200, {
              'Content-Type': 'text/event-stream; charset=utf-8',
              'Cache-Control': 'no-cache',
              'Connection': 'keep-alive'
            });
            res.flushHeaders();

            // Split into small character chunks to stream
            const chars = Array.from(replyText);
            let charIndex = 0;

            const interval = setInterval(() => {
              if (res.destroyed || res.writableEnded) {
                clearInterval(interval);
                return;
              }

              if (charIndex >= chars.length) {
                res.write(`data: [DONE]\n\n`);
                res.end();
                clearInterval(interval);
                return;
              }

              // Take 3-6 chars per chunk
              const slice = chars.slice(charIndex, charIndex + 4).join('');
              charIndex += 4;

              const payload = {
                id: `chatcmpl-${Date.now()}`,
                object: 'chat.completion.chunk',
                created: Math.floor(Date.now() / 1000),
                model: jsonBody.model || 'mock-gpt-4o',
                choices: [{
                  index: 0,
                  delta: { content: slice },
                  finish_reason: null
                }]
              };

              res.write(`data: ${JSON.stringify(payload)}\n\n`);
            }, 30);

            res.on('close', () => {
              clearInterval(interval);
            });
            return;
          }

          // 3. Audio Transcriptions Endpoint: /v1/audio/transcriptions
          if (url.includes('/audio/transcriptions')) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              text: '面试官问：订单重复提交如何保证接口幂等性？请谈谈分布式事务与降级方案。'
            }));
            return;
          }

          // Default fallback
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Endpoint not found on mock server' }));
        });
      });

      this.server.listen(this.port, '127.0.0.1', () => {
        resolve(`http://127.0.0.1:${this.port}/v1`);
      });

      this.server.on('error', (err) => {
        reject(err);
      });
    });
  }

  public stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => resolve());
        this.server = null;
      } else {
        resolve();
      }
    });
  }

  /**
   * Deterministic vector generator:
   * Maps words/hash to a normalized 1536-dimensional vector.
   * Semantic keywords like "订单", "幂等" produce similar vectors.
   */
  public generateDeterministicVector(text: string, dimensions = 1536): number[] {
    const vec = new Float64Array(dimensions);
    const words = text.toLowerCase().split(/\s+|(?=[\u4e00-\u9fa5])/);

    for (const w of words) {
      if (!w) continue;
      const hash = crypto.createHash('md5').update(w).digest();
      for (let i = 0; i < 16; i++) {
        const idx = (hash[i] * 97 + i * 31) % dimensions;
        vec[idx] += (hash[i] - 128) / 128.0;
      }
    }

    // Add baseline content seed
    const fullHash = crypto.createHash('sha256').update(text).digest();
    for (let i = 0; i < dimensions; i++) {
      const byte = fullHash[i % fullHash.length];
      vec[i] += ((byte - 128) / 256.0) * 0.1;
    }

    // Normalize
    let normSq = 0;
    for (let i = 0; i < dimensions; i++) normSq += vec[i] * vec[i];
    const norm = Math.sqrt(normSq) || 1.0;
    const result: number[] = new Array(dimensions);
    for (let i = 0; i < dimensions; i++) result[i] = Number((vec[i] / norm).toFixed(6));

    return result;
  }
}
