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
 * 从 Gate.io 同步账户资金并重新初始化数据库
 */
import "dotenv/config";
import { createClient } from "@libsql/client";
import { CREATE_TABLES_SQL } from "./schema";
import { createPinoLogger } from "@voltagent/logger";
import { createGateClient } from "../services/gateClient";
import * as fs from "node:fs";
import * as path from "node:path";

const logger = createPinoLogger({
  name: "sync-from-gate",
  level: "info",
});

async function syncFromGate() {
  try {
    logger.info("🔄 从 Gate.io 同步账户信息...");
    
    // 1. 连接 Gate.io 获取当前账户余额
    const gateClient = createGateClient();
    const account = await gateClient.getFuturesAccount();
    
    const currentBalance = Number.parseFloat(account.total || "0");
    const availableBalance = Number.parseFloat(account.available || "0");
    const unrealizedPnl = Number.parseFloat(account.unrealisedPnl || "0");
    
    logger.info(`\n📊 Gate.io 当前账户状态:`);
    logger.info(`   总资产: ${currentBalance} USDT`);
    logger.info(`   可用资金: ${availableBalance} USDT`);
    logger.info(`   未实现盈亏: ${unrealizedPnl} USDT`);
    
    // 2. 获取持仓信息
    const positions = await gateClient.getPositions();
    const activePositions = positions.filter((p: any) => Number.parseInt(p.size || "0") !== 0);
    logger.info(`   当前持仓数: ${activePositions.length}`);
    
    if (activePositions.length > 0) {
      logger.info(`\n   持仓详情:`);
      for (const pos of activePositions) {
        const size = Number.parseInt(pos.size || "0");
        const symbol = pos.contract.replace("_USDT", "");
        const side = size > 0 ? "做多" : "做空";
        const pnl = Number.parseFloat(pos.unrealisedPnl || "0");
        logger.info(`     ${symbol}: ${Math.abs(size)} 张 (${side}) | 盈亏: ${pnl >= 0 ? '+' : ''}${pnl.toFixed(2)} USDT`);
      }
    }
    
    // 3. 确认是否继续
    logger.info(`\n${"=".repeat(60)}`);
    logger.info(`⚠️  将以当前账户资金 ${currentBalance} USDT 作为新的初始资金`);
    logger.info(`   这将重置所有历史数据和收益率统计！`);
    logger.info(`${"=".repeat(60)}\n`);
    
    // 等待 3 秒让用户看清信息
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // 4. 连接数据库
    const dbUrl = process.env.DATABASE_URL || "file:./.voltagent/trading.db";
    logger.info(`📦 连接数据库: ${dbUrl}`);
    
    const client = createClient({
      url: dbUrl,
    });
    
    // 5. 删除现有表
    logger.info("🗑️  删除现有表...");
    await client.executeMultiple(`
      DROP TABLE IF EXISTS trades;
      DROP TABLE IF EXISTS positions;
      DROP TABLE IF EXISTS account_history;
      DROP TABLE IF EXISTS trading_signals;
      DROP TABLE IF EXISTS agent_decisions;
    `);
    logger.info("✅ 现有表已删除");
    
    // 6. 创建新表
    logger.info("📦 创建新表...");
    await client.executeMultiple(CREATE_TABLES_SQL);
    logger.info("✅ 表创建完成");
    
    // 插入默认引擎
    logger.info("⚙️ 创建默认引擎...");
    await client.execute({
      sql: `INSERT INTO quant_engines (id, name, api_key, api_secret, status) VALUES (1, 'Default Engine', ?, ?, 'stopped')`,
      args: [process.env.GATE_API_KEY || '', process.env.GATE_API_SECRET || '']
    });

    // 7. 插入初始账户记录（使用 Gate.io 的实际资金）
    logger.info(`💰 插入初始资金记录: ${currentBalance} USDT`);
    await client.execute({
      sql: `INSERT INTO account_history 
            (engine_id, timestamp, total_value, available_cash, unrealized_pnl, realized_pnl, return_percent) 
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
      args: [
        1, // engine_id
        new Date().toISOString(),
        currentBalance,
        availableBalance,
        unrealizedPnl,
        0, // realized_pnl 从 0 开始
        0, // return_percent 从 0% 开始
      ],
    });
    
    // 8. 同步持仓到数据库
    if (activePositions.length > 0) {
      logger.info(`\n🔄 同步 ${activePositions.length} 个持仓到数据库...`);
      
      for (const pos of activePositions) {
        const size = Number.parseInt(pos.size || "0");
        if (size === 0) continue;
        
        const symbol = pos.contract.replace("_USDT", "");
        const entryPrice = Number.parseFloat(pos.entryPrice || "0");
        const currentPrice = Number.parseFloat(pos.markPrice || "0");
        const leverage = Number.parseInt(pos.leverage || "1");
        const side = size > 0 ? "long" : "short";
        const quantity = Math.abs(size);
        const pnl = Number.parseFloat(pos.unrealisedPnl || "0");
        const liqPrice = Number.parseFloat(pos.liqPrice || "0");
        
        // 生成占位符 order_id
        const entryOrderId = `synced-${symbol}-${Date.now()}`;
        
        await client.execute({
          sql: `INSERT INTO positions 
                (engine_id, symbol, quantity, entry_price, current_price, liquidation_price, unrealized_pnl, 
                 leverage, side, entry_order_id, opened_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          args: [
            1, // engine_id
            symbol,
            quantity,
            entryPrice,
            currentPrice,
            liqPrice,
            pnl,
            leverage,
            side,
            entryOrderId,
            new Date().toISOString(),
          ],
        });
        
        logger.info(`   ✅ ${symbol}: ${quantity} 张 (${side}) @ ${entryPrice}`);
      }
    }
    
    // 9. 更新 .env 文件中的 INITIAL_BALANCE
    logger.info(`\n🔧 更新 .env 文件...`);
    try {
      const envPath = path.join(process.cwd(), ".env");
      let envContent = fs.readFileSync(envPath, "utf-8");
      
      // 替换 INITIAL_BALANCE 的值
      const newBalance = currentBalance.toFixed(2);
      const balanceRegex = /^INITIAL_BALANCE=.*$/m;
      
      if (balanceRegex.test(envContent)) {
        // 如果存在，则替换
        envContent = envContent.replace(balanceRegex, `INITIAL_BALANCE=${newBalance}`);
        logger.info(`   更新 INITIAL_BALANCE: ${newBalance} USDT`);
      } else {
        // 如果不存在，则在交易配置部分添加
        const tradingConfigRegex = /(# 交易配置[\s\S]*?)(# =+)/;
        if (tradingConfigRegex.test(envContent)) {
          envContent = envContent.replace(
            tradingConfigRegex,
            `$1INITIAL_BALANCE=${newBalance}\n\n$2`
          );
          logger.info(`   添加 INITIAL_BALANCE: ${newBalance} USDT`);
        }
      }
      
      fs.writeFileSync(envPath, envContent, "utf-8");
      logger.info(`✅ .env 文件已更新`);
    } catch (error) {
      logger.warn(`⚠️  更新 .env 文件失败:`, error as any);
    }
  } catch (error) {
    logger.error("❌ 初始化失败:", error as any);
    process.exit(1);
  }
}

// 执行同步
syncFromGate();

