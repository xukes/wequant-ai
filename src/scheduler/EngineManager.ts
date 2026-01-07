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
import { createLogger } from "../utils/logger";
import { GateApiLocal } from "../services/gateApiLocal";

const logger = createLogger("engine-manager", "info");

// Use a default GateApiLocal instance for fetching engine configs.
// The keys here are placeholders as we only need to access the public/internal backend APIs initially.
// Ideally, the backend API for engine management shouldn't require Gate API keys, or we should use a system key.
// For now, we assume the backend API is accessible.
const backendApi = new GateApiLocal("system", "system", process.env.BACKEND_API_URL || "http://localhost:8998/api/v4");

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
   * 初始化：从后端 API 加载所有状态为 running 的引擎并启动
   */
  public async init() {
    logger.info("Initializing Engine Manager...");
    try {
      const { body } = await backendApi.futures.getQuantRunningEngines();
      const runningEngines = body.data || [];
      
      for (const engine of runningEngines) {
        await this.startEngine(engine.id);
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
      const { body } = await backendApi.futures.getQuantEngineConfig(engineId);
      const engineData = body.data;

      if (!engineData) {
        throw new Error(`Engine ${engineId} not found`);
      }
      logger.info(`Starting engine ${engineId} with config:`, engineData);
      const config: EngineConfig = {
        id: engineData.id,
        name: engineData.name,
        apiKey: engineData.apiKey,
        apiSecret: engineData.apiSecret,
        modelName: engineData.modelName,
        strategy: engineData.strategy,
        riskParams: engineData.riskParams || {},
      };

      // 2. 创建并启动 Runner
      const runner = new AgentRunner(config);
      runner.start();
      
      this.runners.set(engineId, runner);
      logger.info(`Engine ${engineId} started successfully.`);

    } catch (error: any) {
      logger.error(error, `Failed to start engine ${engineId}:`);
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
