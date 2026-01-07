/**
 * 统一日志配置工具
 * 支持：控制台输出 + 文件输出
 */

import pino from "pino";
import { mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";

/**
 * 创建日志目录（如果不存在）
 */
function ensureLogDir() {
  const logDir = join(process.cwd(), "logs");
  if (!existsSync(logDir)) {
    mkdirSync(logDir, { recursive: true });
  }
  return logDir;
}

/**
 * 获取当前日期字符串，用于日志文件名
 */
function getDateString(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * 创建带文件输出的 Pino Logger
 *
 * @param name - 日志名称（模块名）
 * @param level - 日志级别（默认: info）
 * @returns pino.Logger 实例
 */
export function createLogger(
  name: string,
  level: string = "info"
): pino.Logger {
  const logDir = ensureLogDir();
  const dateStr = getDateString();
  const logFilePath = join(logDir, `${name}-${dateStr}.log`);

  // 创建多流输出：控制台 + 文件
  const streams: pino.StreamEntry[] = [
    // 1. 控制台输出（带颜色）
    {
      level,
      stream: pino.multistream([
        {
          level,
          stream: process.stdout,
        },
      ]),
    },
    // 2. 文件输出（JSON 格式）
    {
      level,
      stream: pino.destination({
        dest: logFilePath,
        sync: false, // 异步写入，性能更好
        mkdir: true, // 自动创建目录
      }),
    },
  ];

  const logger = pino(
    {
      name,
      level,
      // 自定义时间格式
      timestamp: pino.stdTimeFunctions.isoTime,
      // 开发环境使用美化输出
      transport:
        process.env.NODE_ENV !== "production"
          ? {
              target: "pino-pretty",
              options: {
                colorize: true,
                translateTime: "SYS:standard",
                ignore: "pid,hostname",
              },
            }
          : undefined,
    },
    pino.multistream(streams)
  );

  return logger;
}

/**
 * 为子模块创建子 logger
 *
 * @param parentLogger - 父 logger
 * @param bindings - 子模块的绑定属性
 * @returns 子 logger
 */
export function createChildLogger(
  parentLogger: pino.Logger,
  bindings: Record<string, any>
): pino.Logger {
  return parentLogger.child(bindings);
}
