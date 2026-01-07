#!/bin/bash

# 批量更新 logger import 脚本

files=(
  "src/scheduler/EngineManager.ts"
  "src/scheduler/AgentRunner.ts"
  "src/services/gateClient.ts"
  "src/services/gateApiLocal.ts"
  "src/services/multiTimeframeAnalysis.ts"
  "src/database/init.ts"
  "src/database/reset.ts"
  "src/database/sync-from-gate.ts"
  "src/database/sync-positions-only.ts"
  "src/database/close-and-reset.ts"
  "src/database/check-trades.ts"
  "src/database/add-fee-column.ts"
  "src/agents/tradingAgent.ts"
)

echo "🔄 开始更新 logger 配置..."

for file in "${files[@]}"; do
  if [ -f "$file" ]; then
    echo "处理: $file"

    # 替换 import
    if grep -q "createPinoLogger.*@voltagent/logger" "$file"; then
      # 根据文件所在目录确定相对路径
      if [[ $file == src/database/* ]]; then
        sed -i 's/import { createPinoLogger } from "@voltagent\/logger";/import { createLogger } from "..\/..\/utils\/logger";/g' "$file"
      elif [[ $file == src/scheduler/* ]]; then
        sed -i 's/import { createPinoLogger } from "@voltagent\/logger";/import { createLogger } from "..\/utils\/logger";/g' "$file"
      elif [[ $file == src/services/* ]]; then
        sed -i 's/import { createPinoLogger } from "@voltagent\/logger";/import { createLogger } from "..\/utils\/logger";/g' "$file"
      elif [[ $file == src/agents/* ]]; then
        sed -i 's/import { createPinoLogger } from "@voltagent\/logger";/import { createLogger } from "..\/utils\/logger";/g' "$file"
      fi
      echo "  ✅ 已更新 import"
    fi

    # 替换 logger 创建
    if grep -q "createPinoLogger" "$file"; then
      sed -i 's/const logger = createPinoLogger({/const logger = createLogger(/g' "$file"
      sed -i '/const logger = createLogger(/,/})/s/  name: "/"/g' "$file"
      sed -i '/const logger = createLogger(/,/})/s/",//g' "$file"
      sed -i '/const logger = createLogger(/,/})/s/  level: "/", "/g' "$file"
      echo "  ✅ 已更新 logger 创建"
    fi
  else
    echo "❌ 文件不存在: $file"
  fi
done

echo ""
echo "✅ 更新完成！"
echo ""
echo "请检查更新后的文件，然后运行："
echo "  npm run build"
echo "  docker compose -f docker-compose.prod.yml build"
