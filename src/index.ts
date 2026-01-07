import "./utils/fix-console";
import "dotenv/config";
import { serve } from "@hono/node-server";
import { createApiRoutes } from "./api/routes";
import { initDatabase } from "./database/init";
import { RISK_PARAMS } from "./config/riskParams";
import { EngineManager } from "./scheduler/EngineManager"; // 引入新的管理器
import { createLogger } from "./utils/logger";

// 设置时区为中国时间（Asia/Shanghai，UTC+8）
process.env.TZ = 'Asia/Shanghai';

// 创建日志实例（输出到控制台 + 文件）
const logger = createLogger("ai-btc", "info");

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
  
  // 2. Initialize Engine Manager (Restore running engines)
  logger.info("Initializing Engine Manager...");
  await EngineManager.getInstance().init();
  
  // 3. Start API server
  logger.info("🌐 Starting Web Server...");
  const apiRoutes = createApiRoutes();
  
  const port = Number.parseInt(process.env.PORT || "3141");
  
  server = serve({
    fetch: apiRoutes.fetch,
    port,
  });
  
  logger.info(`Web server started: http://localhost:${port}`);
  
  logger.info("\n" + "=".repeat(80));
  logger.info("System started successfully!");
  logger.info("=".repeat(80));
  logger.info(`\nMonitor Dashboard: http://localhost:${port}/`);
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
