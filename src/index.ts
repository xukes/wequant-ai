import "./utils/fix-console";
import "dotenv/config";
import { createPinoLogger } from "@voltagent/logger";
import { serve } from "@hono/node-server";
import { createApiRoutes } from "./api/routes";
import { startTradingLoop, initTradingSystem } from "./scheduler/tradingLoop";
import { startAccountRecorder } from "./scheduler/accountRecorder";
import { initDatabase } from "./database/init";
import { RISK_PARAMS } from "./config/riskParams";

// 设置时区为中国时间（Asia/Shanghai，UTC+8）
process.env.TZ = 'Asia/Shanghai';

// 创建日志实例（使用中国时区）
const logger = createPinoLogger({
  name: "ai-btc",
  level: "info",
  formatters: {
    timestamp: () => {
      // 使用系统时区设置，已经是 Asia/Shanghai
      const now = new Date();
      // 正确格式化：使用 toLocaleString 获取中国时间，然后转换为 ISO 格式
      const chinaOffset = 8 * 60; // 中国时区偏移（分钟）
      const utc = now.getTime() + (now.getTimezoneOffset() * 60 * 1000);
      const chinaTime = new Date(utc + (chinaOffset * 60 * 1000));
      return `, "time": "${chinaTime.toISOString().replace('Z', '+08:00')}"`;
    }
  }
});

// 全局服务器实例
let server: any = null;

/**
 * 主函数
 */
async function main() {
  logger.info("Starting AI Crypto Trading System");
  
  // 1. Initialize database
  logger.info("Initializing database...");
  await initDatabase();
  
  // 2. Initialize trading system config (read env and sync to DB)
  await initTradingSystem();
  
  // 3. Start API server
  logger.info("🌐 Starting Web Server...");
  const apiRoutes = createApiRoutes();
  
  const port = Number.parseInt(process.env.PORT || "3141");
  
  server = serve({
    fetch: apiRoutes.fetch,
    port,
  });
  
  logger.info(`Web server started: http://localhost:${port}`);
  logger.info(`Monitor dashboard: http://localhost:${port}/`);
  
  // 4. Start trading loop
  logger.info("Starting trading loop...");
  startTradingLoop();
  
  // 5. Start account recorder
  logger.info("Starting account recorder...");
  startAccountRecorder();
  
  logger.info("\n" + "=".repeat(80));
  logger.info("System started successfully!");
  logger.info("=".repeat(80));
  logger.info(`\nMonitor Dashboard: http://localhost:${port}/`);
  logger.info(`Trading Interval: ${process.env.TRADING_INTERVAL_MINUTES || 5} minutes`);
  logger.info(`Account Record Interval: ${process.env.ACCOUNT_RECORD_INTERVAL_MINUTES || 10} minutes`);
  logger.info(`Supported Symbols: ${RISK_PARAMS.TRADING_SYMBOLS.join(', ')}`);
  logger.info(`Max Leverage: ${RISK_PARAMS.MAX_LEVERAGE}x`);
  logger.info(`Max Positions: ${RISK_PARAMS.MAX_POSITIONS}`);
  logger.info(`\n🔴 Stop Loss: ${process.env.ACCOUNT_STOP_LOSS_USDT || 50} USDT (close all & exit)`);
  logger.info(`🟢 Take Profit: ${process.env.ACCOUNT_TAKE_PROFIT_USDT || 10000} USDT (close all & exit)`);
  logger.info("\nPress Ctrl+C to stop the system\n");
}

// 错误处理
process.on("uncaughtException", (error) => {
  logger.error("Uncaught Exception:", error);
  process.exit(1);
});

process.on("unhandledRejection", (reason: unknown) => {
  logger.error("Unhandled Promise Rejection:", { reason });
});

// 优雅退出处理
async function gracefulShutdown(signal: string) {
  logger.info(`\n\nReceived ${signal} signal, shutting down system...`);
  
  try {
    // Close server
    if (server) {
      logger.info("Closing Web server...");
      server.close();
      logger.info("Web server closed");
    }
    
    logger.info("System shutdown gracefully");
    process.exit(0);
  } catch (error) {
    logger.error("Error during shutdown:", error as any);
    process.exit(1);
  }
}

// 监听退出信号
process.on("SIGINT", () => gracefulShutdown("SIGINT"));
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));

// 启动应用
await main();
