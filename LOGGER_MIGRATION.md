# Logger 迁移指南

## 概述

已将项目中的 `@voltagent/logger` 迁移到统一的日志系统，支持同时输出到**控制台**和**文件**。

## 已更新的模块

- ✅ `src/index.ts`
- ✅ `src/api/routes.ts`

## 需要更新的模块清单

以下模块需要手动更新：

### 1. 核心调度器
- `src/scheduler/EngineManager.ts`
- `src/scheduler/AgentRunner.ts`

### 2. 服务层
- `src/services/gateClient.ts`
- `src/services/gateApiLocal.ts`
- `src/services/multiTimeframeAnalysis.ts`

### 3. 数据库模块
- `src/database/init.ts`
- `src/database/reset.ts`
- `src/database/sync-from-gate.ts`
- `src/database/sync-positions-only.ts`
- `src/database/close-and-reset.ts`
- `src/database/check-trades.ts`
- `src/database/add-fee-column.ts`

### 4. 交易代理
- `src/agents/tradingAgent.ts`

## 更新步骤

### 步骤 1：替换 import

将这行：
```typescript
import { createPinoLogger } from "@voltagent/logger";
```

替换为：
```typescript
import { createLogger } from "../utils/logger";
// 或者在 database/ 目录下：
import { createLogger } from "../../utils/logger";
```

### 步骤 2：替换 logger 创建

将这行：
```typescript
const logger = createPinoLogger({
  name: "xxx",
  level: "info",
});
```

替换为：
```typescript
const logger = createLogger("xxx", "info");
```

### 步骤 3：子 logger（如果存在）

如果有子 logger：
```typescript
const childLogger = logger.child({ component: "xxx" });
```

保持不变，或者使用新的工具函数：
```typescript
import { createChildLogger } from "../utils/logger";

const childLogger = createChildLogger(logger, { component: "xxx" });
```

## 示例

### 更新前 (src/scheduler/EngineManager.ts)
```typescript
import { createPinoLogger } from "@voltagent/logger";

const logger = createPinoLogger({
  name: "engine-manager",
  level: "info",
});
```

### 更新后
```typescript
import { createLogger } from "../utils/logger";

const logger = createLogger("engine-manager", "info");
```

## 日志输出位置

更新后，日志将同时输出到：

1. **控制台**（开发环境带颜色，生产环境 JSON 格式）
2. **文件**（`logs/` 目录）：
   - `logs/ai-btc-2026-01-07.log` - 主应用日志
   - `logs/api-routes-2026-01-07.log` - API 日志
   - `logs/engine-manager-2026-01-07.log` - 引擎管理器日志
   - `...`

## 注意事项

1. **日志文件按天分割**：每天一个新文件
2. **异步写入**：不影响应用性能
3. **自动创建目录**：无需手动创建 `logs/` 目录
4. **Docker 兼容**：`logs/` 已挂载到宿主机

## 测试

更新后可以测试：

```bash
# 查看日志文件
ls -lh logs/

# 实时查看日志
tail -f logs/ai-btc-*.log

# 重启应用
docker compose -f docker-compose.prod.yml restart
```
