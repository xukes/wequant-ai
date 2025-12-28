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

import { AgentRunner, EngineConfig } from "./AgentRunner";
import { createClient } from "@libsql/client";
import { createPinoLogger } from "@voltagent/logger";

const logger = createPinoLogger({
  name: "engine-manager",
  level: "info",
});

const dbClient = createClient({
  url: process.env.DATABASE_URL || "file:./.voltagent/trading.db",
});

export class EngineManager {
  private static instance: EngineManager;
  private runners: Map<number, AgentRunner> = new Map();

  private constructor() {}

  public static getInstance(): EngineManager {
    if (!EngineManager.instance) {
      EngineManager.instance = new EngineManager();
    }
    return EngineManager.instance;
  }

  /**
   * 初始化：从数据库加载所有状态为 running 的引擎并启动
   */
  public async init() {
    logger.info("Initializing Engine Manager...");
    try {
      const result = await dbClient.execute("SELECT * FROM quant_engines WHERE status = 'running'");
      
      for (const row of result.rows) {
        await this.startEngine(row.id as number);
      }
      
      logger.info(`Restored ${this.runners.size} running engines.`);
    } catch (error: any) {
      logger.error("Failed to initialize Engine Manager:", error);
    }
  }

  /**
   * 启动指定 ID 的引擎
   */
  public async startEngine(engineId: number) {
    if (this.runners.has(engineId)) {
      logger.warn(`Engine ${engineId} is already running.`);
      return;
    }

    try {
      // 1. 获取配置
      const result = await dbClient.execute({
        sql: "SELECT * FROM quant_engines WHERE id = ?",
        args: [engineId],
      });

      if (result.rows.length === 0) {
        throw new Error(`Engine ${engineId} not found`);
      }

      const row = result.rows[0];
      const config: EngineConfig = {
        id: row.id as number,
        name: row.name as string,
        apiKey: row.api_key as string,
        apiSecret: row.api_secret as string,
        modelName: row.model_name as string,
        strategy: row.strategy as string,
        riskParams: JSON.parse((row.risk_params as string) || "{}"),
      };

      // 2. 创建并启动 Runner
      const runner = new AgentRunner(config);
      runner.start();
      
      this.runners.set(engineId, runner);
      logger.info(`Engine ${engineId} started successfully.`);

    } catch (error: any) {
      logger.error(`Failed to start engine ${engineId}:`, error);
      throw error;
    }
  }

  /**
   * 停止指定 ID 的引擎
   */
  public async stopEngine(engineId: number) {
    const runner = this.runners.get(engineId);
    if (!runner) {
      logger.warn(`Engine ${engineId} is not running.`);
      return;
    }

    runner.stop();
    this.runners.delete(engineId);
    logger.info(`Engine ${engineId} stopped.`);
  }

  /**
   * 获取引擎状态
   */
  public getEngineStatus(engineId: number) {
    return this.runners.has(engineId) ? "running" : "stopped";
  }
}
