import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function createFixtures(baseDir: string) {
  fs.mkdirSync(baseDir, { recursive: true });

  // 1. ORD-DEMO-731 (Order Idempotency)
  const ordDoc = `# 项目代号：ORD-DEMO-731 订单交易系统接口幂等性改造

## 1. 项目背景与责任范围
测试候选人在该项目中担任后端技术骨干，独立负责交易结算模块的接口幂等与防重提交改造。
本项目仅聚焦于分布式一致性与接口幂等保障，未统计业务提升百分比或交易量增长数字。

## 2. 核心架构设计与幂等实现
针对前端弱网环境下多次点击造成的订单重复提交问题，实施了多级防御机制：
1. **防重 Token 校验**：客户端在进入收银台时请求生成带有全局唯一 UUID 的业务防重 Token，服务端存入 Redis 集群并设置 5 分钟滑动过期时间。在提交时采用 Lua 脚本执行原子性 GET-AND-DELETE 操作。
2. **数据库唯一索引**：在 order_pay 表将 (tenant_id, out_trade_no) 设为唯一联合索引，作为数据库兜底防护。若并发击穿缓存，直接抛出 DuplicateKeyException 并转为友好提示。
3. **分布式锁降级**：针对库存扣减关键步骤，基于 Redisson 实现轻量级分布式重入锁，锁超时设定为 3 秒。
`;
  fs.writeFileSync(path.join(baseDir, 'ORD-DEMO-731.md'), ordDoc, 'utf-8');

  // 2. CACHE-DEMO-284 (Cache Penetration)
  const cacheDoc = `# 项目代号：CACHE-DEMO-284 高并发缓存穿透与击穿防护

## 1. 项目范围与职责
测试候选人作为架构组成员，主导商品详情页三级缓存架构改造，防范黑客恶意构造空 ID 导致的缓存穿透。

## 2. 解决方案
1. **布隆过滤器 (Bloom Filter)**：在网关接入层配置 Redis 内存布隆过滤器，对全量商品 ID 进行预哈希加载。对于过滤器判定不存在的请求直接拦截返回 404。
2. **空值缓存与短 TTL**：针对穿透至数据库的无效查询，写入具有 60 秒极短生命周期的空对象值 (NULL_OBJECT)。
`;
  fs.writeFileSync(path.join(baseDir, 'CACHE-DEMO-284.md'), cacheDoc, 'utf-8');

  // 3. redis-notes.txt
  const redisNotes = `Redis 核心技术笔记

一、Redis 基础数据结构
String、List、Hash、Set、SortedSet 以及 Stream 队列。

二、分布式锁的避坑要点
必须使用原子命令 SET key value NX PX expireMillis。
释放锁时必须比对客户端随机 value，使用 Lua 脚本原子释放，防止因 GC 暂停导致误删他人持有的锁。
`;
  fs.writeFileSync(path.join(baseDir, 'redis-notes.txt'), redisNotes, 'utf-8');

  // 4. technical-spec.md (Tables, Code blocks, Headings)
  const techSpec = `# 微服务接口规范与状态机定义

## 一、接口参数清单

| 参数字段 | 类型 | 是否必填 | 说明 |
| :--- | :--- | :--- | :--- |
| request_id | String | 是 | 全局请求链路追踪 ID |
| idempotent_token | String | 是 | 防重令牌 |
| amount | Long | 是 | 交易金额（单位：分） |

## 二、幂等拦截器代码示例

\`\`\`java
@Aspect
@Component
public class IdempotentAspect {
    @Around("@annotation(idempotent)")
    public Object handle(ProceedingJoinPoint joinPoint, Idempotent idempotent) throws Throwable {
        String token = RequestHolder.getToken();
        boolean acquired = redisService.checkAndEvict(token);
        if (!acquired) {
            throw new BizException("请勿重复提交订单");
        }
        return joinPoint.proceed();
    }
}
\`\`\`
`;
  fs.writeFileSync(path.join(baseDir, 'technical-spec.md'), techSpec, 'utf-8');

  // 5. scanned-sample.pdf (Minimal PDF without extractable text)
  const scannedPdf = Buffer.from(
    '%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n' +
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n' +
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R >>\nendobj\n' +
    '4 0 obj\n<< /Length 15 >>\nstream\nq\n1 0 0 1 0 0 cm\nQ\nendstream\nendobj\n' +
    'xref\n0 5\n0000000000 65535 f \n0000000009 00000 n \n0000000058 00000 n \n0000000115 00000 n \n0000000204 00000 n \n' +
    'trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n270\n%%EOF'
  );
  fs.writeFileSync(path.join(baseDir, 'scanned-sample.pdf'), scannedPdf);

  // 6. Duplicate file (Same content as ORD-DEMO-731 but different filename)
  fs.writeFileSync(path.join(baseDir, 'ORD-DEMO-731-duplicate.md'), ordDoc, 'utf-8');

  // 7. Version update files
  fs.writeFileSync(path.join(baseDir, 'design-v1.txt'), '订单服务早期版本采用 order_token_v1 进行单机锁排重。\n', 'utf-8');
  fs.writeFileSync(path.join(baseDir, 'design-v2.txt'), '订单服务最新版本升级为 idempotency_key_v2 与 Redis 集群锁。\n', 'utf-8');

  console.log(`Test fixtures successfully generated in ${baseDir}`);
}

if (process.argv[1] === __filename) {
  createFixtures(path.join(__dirname, '../fixtures'));
}
