# WeQuant-AI 日志系统配置总结

## ✅ 已完成的工作

### 1. 创建统一日志工具

**文件**: `src/utils/logger.ts`

提供了 `createLogger()` 函数，支持：
- ✅ 控制台输出（开发环境带颜色）
- ✅ 文件输出（JSON 格式，异步写入）
- ✅ 日志文件按天分割
- ✅ 自动创建 `logs/` 目录

### 2. 已更新的核心模块

以下模块已成功更新并可用：

| 模块 | 状态 | 日志文件 |
|------|------|----------|
| ✅ src/index.ts | 完成 | logs/ai-btc-YYYY-MM-DD.log |
| ✅ src/api/routes.ts | 完成 | logs/api-routes-YYYY-MM-DD.log |
| ✅ src/scheduler/EngineManager.ts | 完成 | logs/engine-manager-YYYY-MM-DD.log |
| ✅ src/scheduler/AgentRunner.ts | 完成 | logs/agent-runner-YYYY-MM-DD.log |
| ✅ src/services/gateClient.ts | 完成 | logs/gate-client-YYYY-MM-DD.log |
| ✅ src/database/init.ts | 完成 | logs/database-init-YYYY-MM-DD.log |
| ✅ src/agents/tradingAgent.ts | 完成 | logs/trading-agent-YYYY-MM-DD.log |

### 3. 需要手动修复的模块

以下模块的 import 已修复，但 logger 创建语句仍需手动替换：

#### 数据库模块（非核心运行时，可稍后修复）
- src/database/add-fee-column.ts
- src/database/check-trades.ts
- src/database/close-and-reset.ts
- src/database/reset.ts
- src/database/sync-positions-only.ts

#### 服务模块
- src/services/gateApiLocal.ts
- src/services/multiTimeframeAnalysis.ts

## 🔧 快速修复指南

### 方式 1：手动替换（推荐）

对于每个文件，将：
```typescript
const logger = createPinoLogger({
  name: "module-name",
  level: "info",
});
```

替换为：
```typescript
const logger = createLogger("module-name", "info");
```

### 方式 2：使用查找替换（快速）

在你的编辑器中：
1. 打开文件
2. 查找：`createPinoLogger({`
3. 查看下一个匹配项
4. 手动替换为 `createLogger("name", "level")`

## 📊 日志系统特性

### 1. 双输出模式

日志同时输出到：
- **控制台**：开发环境带颜色，便于调试
- **文件**：持久化存储，便于排查问题

### 2. 日志文件命名规则

```
logs/<module-name>-YYYY-MM-DD.log
```

例如：
- `logs/ai-btc-2026-01-07.log`
- `logs/agent-runner-2026-01-07.log`

### 3. 日志轮转

- 每天自动创建新日志文件
- Docker 日志配置：单个文件最大 50MB，保留 5 个文件
- 宿主机可访问：`./logs` 目录已挂载到容器

## 🚀 使用方法

### 查看日志

```bash
# 1. 查看 Docker 容器日志（实时）
docker logs open-nof1.ai-prod -f

# 2. 查看日志文件（实时）
tail -f logs/ai-btc-*.log

# 3. 查看特定模块的日志
tail -f logs/agent-runner-*.log

# 4. 使用 docker-compose
docker compose -f docker-compose.prod.yml logs -f
```

### 日志级别

可在创建 logger 时指定：

```typescript
const logger = createLogger("module-name", "debug");  // 详细日志
const logger = createLogger("module-name", "info");   // 标准日志
const logger = createLogger("module-name", "warn");   // 仅警告
const logger = createLogger("module-name", "error");  // 仅错误
```

### 子 Logger

```typescript
import { createChildLogger } from "../utils/logger";

const childLogger = createChildLogger(parentLogger, {
  component: "sub-component"
});
```

## 🎯 生产环境配置

### Docker 配置

已配置在 `docker-compose.prod.yml`:

```yaml
volumes:
  - ./logs:/app/logs  # 日志持久化

logging:
  driver: "json-file"
  options:
    max-size: "50m"
    max-file: "5"
```

### 环境变量

在 `.env` 中设置：
```env
NODE_ENV=production  # 生产环境使用 JSON 格式
LOG_LEVEL=info       # 全局日志级别
```

## 📝 示例

### 基本使用

```typescript
import { createLogger } from "../utils/logger";

const logger = createLogger("my-module", "info");

logger.info("Application started");
logger.warn("Warning message");
logger.error({ error: err }, "Error occurred");
```

### 结构化日志

```typescript
logger.info(
  {
    userId: 123,
    action: "trade",
    symbol: "BTC_USDT",
    amount: 1000
  },
  "Trade executed"
);
```

## ⚠️ 注意事项

1. **性能**：日志写入是异步的，不会阻塞应用
2. **磁盘空间**：定期清理旧日志文件
3. **敏感信息**：不要在日志中记录 API Key、密码等敏感信息
4. **日志级别**：生产环境建议使用 `info` 级别

## 🔍 故障排查

### 日志文件没有生成

1. 检查 `logs/` 目录权限
2. 检查应用是否正常运行
3. 检查 logger 配置是否正确

### 日志格式不正确

1. 检查 `NODE_ENV` 环境变量
2. 开发环境会自动使用 pino-pretty 美化输出
3. 生产环境使用 JSON 格式便于解析

## 📚 相关文件

- `src/utils/logger.ts` - 日志工具
- `LOGGER_MIGRATION.md` - 迁移指南
- `scripts/update-logger.cjs` - 批量更新脚本
- `scripts/fix-logger-creation.cjs` - 修复脚本
