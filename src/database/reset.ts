/**
 * open-nof1.ai - AI 加密货币自动交易系统
 * Copyright (C) 2025 195440
 * 
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 * 
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU Affero General Public License for more details.
 * 
 * You should have received a copy of the GNU Affero General Public License
 * along with this program. If not, see <https://www.gnu.org/licenses/>.
 */

import { createClient } from "@libsql/client";
import { createPinoLogger } from "@voltagent/logger";
import { CREATE_TABLES_SQL } from "./schema";
import "dotenv/config";

const logger = createPinoLogger({
  name: "db-reset",
  level: "info",
});

/**
 * 强制重新初始化数据库
 * 清空所有数据并重新创建表
 */
async function resetDatabase() {
  try {
    const dbUrl = process.env.DATABASE_URL || "file:./.voltagent/trading.db";

    logger.info("⚠️  强制重新初始化数据库");
    logger.info(`数据库路径: ${dbUrl}`);
    // logger.info(`初始资金: ${initialBalance} USDT`);

    const client = createClient({
      url: dbUrl,
    });

    // 删除所有表
    logger.info("🗑️  删除现有表...");
    await client.execute("DROP TABLE IF EXISTS trade_logs");
    await client.execute("DROP TABLE IF EXISTS agent_decisions");
    await client.execute("DROP TABLE IF EXISTS trading_signals");
    await client.execute("DROP TABLE IF EXISTS positions");
    await client.execute("DROP TABLE IF EXISTS account_history");
    await client.execute("DROP TABLE IF EXISTS quant_engines");
    logger.info("✅ 现有表已删除");

    // 重新创建表
    logger.info("📦 创建新表...");
    await client.executeMultiple(CREATE_TABLES_SQL);
    logger.info("✅ 表创建完成");

   
    logger.info("✅ 数据库重置成功！");
    // client.close();
    logger.info("\n🎉 数据库已重置为初始状态，可以开始交易了！");
    
  } catch (error) {
    logger.error("❌ 数据库重置失败:", error as any);
    process.exit(1);
  }
}

// 执行重置
resetDatabase();

