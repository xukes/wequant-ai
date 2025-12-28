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

/**
 * 数据库初始化脚本
 */
import "dotenv/config";
import { createClient } from "@libsql/client";
import { CREATE_TABLES_SQL } from "./schema";
import { createPinoLogger } from "@voltagent/logger";

const logger = createPinoLogger({
  name: "database-init",
  level: "info",
});

async function initDatabase() {
  try {
    const dbUrl = process.env.DATABASE_URL || "file:./.voltagent/trading.db";
    
    logger.info(`Initializing database: ${dbUrl}`);

    const client = createClient({
      url: dbUrl,
    });

    // 执行建表语句
    logger.info("Creating database tables...");
    await client.executeMultiple(CREATE_TABLES_SQL);

    // 简单的迁移逻辑：尝试为旧表添加 engine_id 字段
    // 如果是全新安装，CREATE_TABLES_SQL 已经创建了带 engine_id 的表
    // 如果是旧数据库，CREATE_TABLES_SQL 会跳过已存在的表，这里补上字段
    const tablesToMigrate = ['trades', 'positions', 'account_history', 'trading_signals', 'agent_decisions'];
    
    for (const table of tablesToMigrate) {
      try {
        // 检查表是否存在
        const tableExists = await client.execute(`SELECT name FROM sqlite_master WHERE type='table' AND name='${table}'`);
        if (tableExists.rows.length > 0) {
          // 尝试添加 engine_id 列
          await client.execute(`ALTER TABLE ${table} ADD COLUMN engine_id INTEGER DEFAULT 0`);
          logger.info(`✅ Migrated table ${table}: added engine_id column`);
        }
      } catch (e: any) {
        // 如果错误包含 "duplicate column name"，说明列已存在，忽略
        if (e.message && !e.message.includes("duplicate column name")) {
           logger.warn(`⚠️  Migration check for ${table}: ${e.message}`);
        }
      }
    }

    // 检查并创建默认引擎
    try {
      const enginesResult = await client.execute("SELECT COUNT(*) as count FROM quant_engines");
      const engineCount = (enginesResult.rows[0] as any).count;
      
      if (engineCount === 0) {
          logger.info("⚙️ No engines found. Creating default engine (ID: 1)...");
          await client.execute({
              sql: `INSERT INTO quant_engines (id, name, api_key, api_secret, status) VALUES (1, 'Default Engine', ?, ?, 'stopped')`,
              args: [process.env.GATE_API_KEY || '', process.env.GATE_API_SECRET || '']
          });
      }
      
      // 迁移历史数据：将 engine_id=0 或 NULL 的记录更新为 1 (默认引擎)
      for (const table of tablesToMigrate) {
          try {
             // 检查是否有需要更新的记录
             const checkResult = await client.execute(`SELECT COUNT(*) as count FROM ${table} WHERE engine_id = 0 OR engine_id IS NULL`);
             const count = (checkResult.rows[0] as any).count;
             
             if (count > 0) {
                 await client.execute(`UPDATE ${table} SET engine_id = 1 WHERE engine_id = 0 OR engine_id IS NULL`);
                 logger.info(`✅ Updated ${table}: set default engine_id = 1 for ${count} legacy records`);
             }
          } catch (e: any) {
              // 忽略错误
          }
      }

      logger.info(`✅ Database initialized. Found ${engineCount > 0 ? engineCount : 1} quant engines.`);
    } catch (e) {
      logger.info("✅ Database initialized.");
    }

    client.close();
  } catch (error) {
    logger.error("❌ Database initialization failed:", error as any);
    process.exit(1);
  }
}

export { initDatabase };

