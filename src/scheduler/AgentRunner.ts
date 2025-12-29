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

import cron from "node-cron";
import { createPinoLogger } from "@voltagent/logger";
import { createClient } from "@libsql/client";
import { GateClient } from "../services/gateClient";
import { createToolsForEngine } from "../tools/trading/factory";
import { Agent, Memory } from "@voltagent/core";
import { LibSQLMemoryAdapter } from "@voltagent/libsql";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { generateTradingPrompt, generateInstructions, TradingStrategy } from "../agents/tradingAgent";
import { RISK_PARAMS } from "../config/riskParams";
import { 
  calculateIndicators, 
  calculateIntradaySeries, 
  calculateLongerTermContext,
  ensureFinite,
  ensureRange
} from "../utils/indicators";
import { getChinaTimeISO } from "../utils/timeUtils";

const logger = createPinoLogger({
  name: "agent-runner",
  level: "info",
});

const dbClient = createClient({
  url: process.env.DATABASE_URL || "file:./.voltagent/trading.db",
});

export interface EngineConfig {
  id: number;
  name: string;
  apiKey: string;
  apiSecret: string;
  modelName: string;
  strategy: string;
  riskParams: any;
}

export class AgentRunner {
  private config: EngineConfig;
  private gateClient: GateClient;
  private agent: Agent;
  private cronTask: cron.ScheduledTask | null = null;
  private isRunning: boolean = false;
  private iterationCount: number = 0;
  private startTime: Date = new Date();
  // 支持的币种
  private readonly SYMBOLS: string[];

  constructor(config: EngineConfig) {
    this.config = config;
    this.gateClient = new GateClient(config.apiKey, config.apiSecret);

    // Initialize symbols from config or default
    if (config.riskParams && config.riskParams.symbols && Array.isArray(config.riskParams.symbols) && config.riskParams.symbols.length > 0) {
      this.SYMBOLS = config.riskParams.symbols;
    } else {
      this.SYMBOLS = [...RISK_PARAMS.TRADING_SYMBOLS];
    }
    
    // 初始化 Agent
    const openrouter = createOpenRouter({
      apiKey: process.env.OPENROUTER_API_KEY || "",
    });
    
    const model = openrouter.chat(config.modelName || "deepseek/deepseek-v3.2-exp");
    
    const memory = new Memory({
      storage: new LibSQLMemoryAdapter({
        url: process.env.DATABASE_URL || "file:./.voltagent/trading.db",
      }),
      // namespace: `engine_${config.id}`, // MemoryConfig 可能不支持 namespace，或者需要通过其他方式隔离
      // 暂时移除 namespace，LibSQLMemoryAdapter 内部可能需要支持 session_id 来区分
    });

    // 创建绑定了特定 GateClient 的工具集
    const tools = createToolsForEngine(this.gateClient, config.id);

    // 使用详细的策略指令生成 System Prompt
    // 默认执行间隔为 1 分钟 (与 cron 调度一致)
    const intervalMinutes = 1;
    const strategy = (config.strategy as TradingStrategy) || "balanced";
    const instructions = generateInstructions(strategy, intervalMinutes);

    this.agent = new Agent({
      name: `quant-engine-${config.id}`,
      model,
      memory,
      instructions,
      tools,
    });
  }

  /**
   * 启动引擎
   */
  public start() {
    if (this.isRunning) {
      logger.warn(`Engine ${this.config.id} is already running`);
      return;
    }

    this.isRunning = true;
    this.startTime = new Date();
    
    // 立即执行一次
    this.executeCycle();

    // 启动定时任务 (每5分钟)
    // TODO: 可以从 config 中读取间隔
    this.cronTask = cron.schedule("*/1 * * * *", () => {
      this.executeCycle();
    });

    logger.info(`Engine ${this.config.id} started`);
    this.updateStatus("running");
  }

  /**
   * 停止引擎
   */
  public stop() {
    if (!this.isRunning) return;

    this.isRunning = false;
    if (this.cronTask) {
      this.cronTask.stop();
      this.cronTask = null;
    }

    logger.info(`Engine ${this.config.id} stopped`);
    this.updateStatus("stopped");
  }

  /**
   * Get account information
   */
  private async getAccountInfo() {
    try {
      const account = await this.gateClient.getFuturesAccount();
      
      const accountTotal = Number.parseFloat(account.total || "0");
      const availableBalance = Number.parseFloat(account.available || "0");
      const unrealisedPnl = Number.parseFloat(account.unrealisedPnl || "0");
      
      // Gate.io account.total includes unrealized PnL
      const totalBalance = accountTotal - unrealisedPnl;

      // Get initial capital from database (specific to this engine)
      const initialResult = await dbClient.execute({
        sql: "SELECT total_value FROM account_history WHERE engine_id = ? ORDER BY timestamp ASC LIMIT 1",
        args: [this.config.id]
      });
      
      const initialBalance = initialResult.rows[0]
        ? Number.parseFloat(initialResult.rows[0].total_value as string)
        : totalBalance; // Default fallback to current balance
      
      // Get peak balance
      const peakResult = await dbClient.execute({
        sql: "SELECT MAX(total_value) as peak_value FROM account_history WHERE engine_id = ?",
        args: [this.config.id]
      });
      const peakBalance = peakResult.rows[0]?.peak_value 
        ? Number.parseFloat(peakResult.rows[0].peak_value as string)
        : initialBalance;

      // Return percent based on initial balance
      const returnPercent = initialBalance > 0 
        ? ((totalBalance - initialBalance) / initialBalance) * 100
        : 0;
      
      // Calculate Sharpe Ratio (simplified for now)
      const sharpeRatio = 0; 
      
      return {
        totalBalance,
        availableBalance,
        unrealisedPnl,
        returnPercent,
        sharpeRatio,
        initialBalance,
        peakBalance
      };
    } catch (error) {
      logger.error(`[Engine ${this.config.id}] Failed to get account info:`, error as any);
      return {
        totalBalance: 0,
        availableBalance: 0,
        unrealisedPnl: 0,
        returnPercent: 0,
        sharpeRatio: 0,
        initialBalance: 0,
        peakBalance: 0
      };
    }
  }

  /**
   * Sync positions from Gate.io to database
   */
  private async syncPositionsFromGate(cachedPositions?: any[]) {
    try {
      const gatePositions = cachedPositions || await this.gateClient.getPositions();
      
      // Get existing positions from DB for this engine
      const dbResult = await dbClient.execute({
        sql: "SELECT symbol, sl_order_id, tp_order_id, stop_loss, profit_target, entry_order_id, opened_at, peak_pnl_percent FROM positions WHERE engine_id = ?",
        args: [this.config.id]
      });
      const dbPositionsMap = new Map(
        dbResult.rows.map((row: any) => [row.symbol, row])
      );
      
      // Check if Gate.io has positions
      const activeGatePositions = gatePositions.filter((p: any) => Number.parseInt(p.size || "0") !== 0);
      
      // Safety check: if API returns 0 but DB has many, might be API error
      if (activeGatePositions.length === 0 && dbResult.rows.length > 0) {
        logger.warn(`[Engine ${this.config.id}] Gate.io returned 0 positions, but DB has ${dbResult.rows.length}. Skipping sync.`);
        return;
      }
      
      // Delete existing positions for this engine
      await dbClient.execute({
        sql: "DELETE FROM positions WHERE engine_id = ?",
        args: [this.config.id]
      });
      
      for (const pos of gatePositions) {
        const size = Number.parseInt(pos.size || "0");
        if (size === 0) continue;
        
        const symbol = pos.contract.replace("_USDT", "");
        let entryPrice = Number.parseFloat(pos.entryPrice || "0");
        let currentPrice = Number.parseFloat(pos.markPrice || "0");
        const leverage = Number.parseInt(pos.leverage || "1");
        const side = size > 0 ? "long" : "short";
        const quantity = Math.abs(size);
        const unrealizedPnl = Number.parseFloat(pos.unrealisedPnl || "0");
        let liquidationPrice = Number.parseFloat(pos.liqPrice || "0");
        
        // Fallback for prices
        if (entryPrice === 0 || currentPrice === 0) {
          try {
            const ticker = await this.gateClient.getFuturesTicker(pos.contract);
            if (currentPrice === 0) currentPrice = Number.parseFloat(ticker.markPrice || ticker.last || "0");
            if (entryPrice === 0) entryPrice = currentPrice;
          } catch (e) {}
        }
        
        if (liquidationPrice === 0 && entryPrice > 0) {
          liquidationPrice = side === "long" 
            ? entryPrice * (1 - 0.9 / leverage)
            : entryPrice * (1 + 0.9 / leverage);
        }
        
        const dbPos = dbPositionsMap.get(symbol);
        const entryOrderId = dbPos?.entry_order_id || `synced-${symbol}-${Date.now()}`;
        
        await dbClient.execute({
          sql: `INSERT INTO positions 
                (engine_id, symbol, quantity, entry_price, current_price, liquidation_price, unrealized_pnl, 
                 leverage, side, stop_loss, profit_target, sl_order_id, tp_order_id, entry_order_id, opened_at, peak_pnl_percent)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          args: [
            this.config.id,
            symbol,
            quantity,
            entryPrice,
            currentPrice,
            liquidationPrice,
            unrealizedPnl,
            leverage,
            side,
            dbPos?.stop_loss || null,
            dbPos?.profit_target || null,
            dbPos?.sl_order_id || null,
            dbPos?.tp_order_id || null,
            entryOrderId,
            dbPos?.opened_at || new Date().toISOString(),
            dbPos?.peak_pnl_percent || 0
          ],
        });
      }
    } catch (error) {
      logger.error(`[Engine ${this.config.id}] Failed to sync positions:`, error as any);
    }
  }

  /**
   * Get formatted positions
   */
  private async getPositions(cachedGatePositions?: any[]) {
    try {
      const gatePositions = cachedGatePositions || await this.gateClient.getPositions();
      
      return gatePositions
        .filter((p: any) => Number.parseInt(p.size || "0") !== 0)
        .map((p: any) => {
          const size = Number.parseInt(p.size || "0");
          return {
            symbol: p.contract.replace("_USDT", ""),
            contract: p.contract,
            quantity: Math.abs(size),
            side: size > 0 ? "long" : "short",
            entry_price: Number.parseFloat(p.entryPrice || "0"),
            current_price: Number.parseFloat(p.markPrice || "0"),
            liquidation_price: Number.parseFloat(p.liqPrice || "0"),
            unrealized_pnl: Number.parseFloat(p.unrealisedPnl || "0"),
            leverage: Number.parseInt(p.leverage || "1"),
            margin: Number.parseFloat(p.margin || "0"),
            opened_at: p.create_time || getChinaTimeISO(),
          };
        });
    } catch (error) {
      logger.error(`[Engine ${this.config.id}] Failed to get positions:`, error as any);
      return [];
    }
  }

  /**
   * Get trade history
   */
  private async getTradeHistory(limit: number = 10) {
    try {
      const result = await dbClient.execute({
        sql: `SELECT * FROM trades WHERE engine_id = ? ORDER BY timestamp DESC LIMIT ?`,
        args: [this.config.id, limit],
      });
      
      if (!result.rows || result.rows.length === 0) return [];
      
      const trades = result.rows.map((row: any) => ({
        symbol: row.symbol,
        side: row.side,
        type: row.type,
        price: Number.parseFloat(row.price || "0"),
        quantity: Number.parseFloat(row.quantity || "0"),
        leverage: Number.parseInt(row.leverage || "1"),
        pnl: row.pnl ? Number.parseFloat(row.pnl) : null,
        fee: Number.parseFloat(row.fee || "0"),
        timestamp: row.timestamp,
        status: row.status,
      }));
      
      // Sort oldest to newest
      trades.sort((a: any, b: any) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
      return trades;
    } catch (error) {
      logger.error(`[Engine ${this.config.id}] Failed to get trade history:`, error as any);
      return [];
    }
  }

  /**
   * Get recent decisions
   */
  private async getRecentDecisions(limit: number = 3) {
    try {
      const result = await dbClient.execute({
        sql: `SELECT timestamp, iteration, decision, account_value, positions_count 
              FROM agent_decisions 
              WHERE engine_id = ?
              ORDER BY timestamp DESC 
              LIMIT ?`,
        args: [this.config.id, limit],
      });
      
      if (!result.rows || result.rows.length === 0) return [];
      
      return result.rows.reverse().map((row: any) => ({
        timestamp: row.timestamp,
        iteration: row.iteration,
        decision: row.decision,
        account_value: Number.parseFloat(row.account_value || "0"),
        positions_count: Number.parseInt(row.positions_count || "0"),
      }));
    } catch (error) {
      logger.error(`[Engine ${this.config.id}] Failed to get recent decisions:`, error as any);
      return [];
    }
  }

  /**
   * Check account thresholds (Stop Loss / Take Profit)
   */
  private async checkAccountThresholds(accountInfo: any): Promise<boolean> {
    const totalBalance = accountInfo.totalBalance;
    const initialBalance = accountInfo.initialBalance;
    const riskParams = this.config.riskParams || {};
    const stopLossUsdt = riskParams.stopLossUsdt || 50;
    const takeProfitUsdt = riskParams.takeProfitUsdt || 20000;
    
    const pnl = totalBalance - initialBalance;
    
    if (pnl <= -stopLossUsdt) {
      logger.error(`[Engine ${this.config.id}] Stop loss triggered! PnL: ${pnl.toFixed(2)} <= -${stopLossUsdt}`);
      await this.closeAllPositions(`Stop loss triggered (PnL ${pnl.toFixed(2)} USDT)`);
      return true;
    }
    
    if (pnl >= takeProfitUsdt) {
      logger.warn(`[Engine ${this.config.id}] Take profit triggered! PnL: ${pnl.toFixed(2)} >= ${takeProfitUsdt}`);
      await this.closeAllPositions(`Take profit triggered (PnL ${pnl.toFixed(2)} USDT)`);
      return true;
    }
    
    return false;
  }

  /**
   * Mandatory Risk Check & Position Management
   * Includes: 36h forced close, dynamic stop loss, trailing stop profit, peak drawdown protection
   */
  private async checkRiskAndManagePositions(positions: any[]): Promise<boolean> {
    let positionsChanged = false;

    for (const pos of positions) {
      const symbol = pos.symbol;
      const side = pos.side;
      const leverage = pos.leverage;
      const entryPrice = pos.entry_price;
      const currentPrice = pos.current_price;
      
      // Calculate PnL percent (considering leverage)
      const priceChangePercent = entryPrice > 0 
        ? ((currentPrice - entryPrice) / entryPrice * 100 * (side === 'long' ? 1 : -1))
        : 0;
      const pnlPercent = priceChangePercent * leverage;
      
      // Get and update peak profit
      let peakPnlPercent = 0;
      try {
        const dbPosResult = await dbClient.execute({
          sql: "SELECT peak_pnl_percent FROM positions WHERE symbol = ? AND engine_id = ?",
          args: [symbol, this.config.id],
        });
        
        if (dbPosResult.rows.length > 0) {
          peakPnlPercent = Number.parseFloat(dbPosResult.rows[0].peak_pnl_percent as string || "0");
          
          // If current PnL exceeds historical peak, update it
          if (pnlPercent > peakPnlPercent) {
            peakPnlPercent = pnlPercent;
            await dbClient.execute({
              sql: "UPDATE positions SET peak_pnl_percent = ? WHERE symbol = ? AND engine_id = ?",
              args: [peakPnlPercent, symbol, this.config.id],
            });
            logger.info(`[Engine ${this.config.id}] ${symbol} Peak profit updated: ${peakPnlPercent.toFixed(2)}%`);
          }
        }
      } catch (error: any) {
        logger.warn(`[Engine ${this.config.id}] Failed to get peak profit for ${symbol}: ${error.message}`);
      }
      
      let shouldClose = false;
      let closeReason = "";
      
      // a) 36-hour forced close check
      const openedTime = new Date(pos.opened_at);
      const now = new Date();
      const holdingHours = (now.getTime() - openedTime.getTime()) / (1000 * 60 * 60);
      
      if (holdingHours >= 36) {
        shouldClose = true;
        closeReason = `Holding time reached ${holdingHours.toFixed(1)} hours, exceeding 36-hour limit`;
      }
      
      // b) Dynamic stop loss check (based on leverage)
      let stopLossPercent = -5; // Default
      if (leverage >= 12) {
        stopLossPercent = -3;
      } else if (leverage >= 8) {
        stopLossPercent = -4;
      } else {
        stopLossPercent = -5;
      }
      
      if (pnlPercent <= stopLossPercent) {
        shouldClose = true;
        closeReason = `Dynamic stop loss triggered (${pnlPercent.toFixed(2)}% ≤ ${stopLossPercent}%)`;
      }
      
      // c) Trailing stop profit check
      if (!shouldClose) {
        let trailingStopPercent = stopLossPercent; // Default use initial stop loss
        
        if (pnlPercent >= 25) {
          trailingStopPercent = 15;
        } else if (pnlPercent >= 15) {
          trailingStopPercent = 8;
        } else if (pnlPercent >= 8) {
          trailingStopPercent = 3;
        }
        
        // If current PnL is below trailing stop line
        if (pnlPercent < trailingStopPercent && trailingStopPercent > stopLossPercent) {
          shouldClose = true;
          closeReason = `Trailing stop profit triggered (Current ${pnlPercent.toFixed(2)}% < Trailing Stop Line ${trailingStopPercent}%)`;
        }
      }
      
      // d) Peak drawdown protection (if position was profitable)
      if (!shouldClose && peakPnlPercent > 5) {
        // Only enable peak drawdown protection for positions that were profitable by more than 5%
        const drawdownFromPeak = peakPnlPercent > 0 
          ? ((peakPnlPercent - pnlPercent) / peakPnlPercent) * 100 
          : 0;
        
        if (drawdownFromPeak >= 30) {
          shouldClose = true;
          closeReason = `Peak drawdown protection triggered (Peak ${peakPnlPercent.toFixed(2)}% → Current ${pnlPercent.toFixed(2)}%, Drawdown ${drawdownFromPeak.toFixed(1)}% >= 30%)`;
        }
      }
      
      // Execute forced close
      if (shouldClose) {
        logger.warn(`[Engine ${this.config.id}] [Forced Close] ${symbol} ${side} - ${closeReason}`);
        try {
          const contract = `${symbol}_USDT`;
          const size = side === 'long' ? -pos.quantity : pos.quantity;
          
          // 1. Place close order
          const order = await this.gateClient.placeOrder({
            contract,
            size,
            price: 0,
            reduceOnly: true,
          });
          
          logger.info(`[Engine ${this.config.id}] ✅ Forced close order placed for ${symbol}, Order ID: ${order.id}`);
          
          // 2. Wait for order completion and get fill info (max 5 retries)
          let actualExitPrice = 0;
          let actualQuantity = Math.abs(pos.quantity);
          let pnl = 0;
          let totalFee = 0;
          let orderFilled = false;
          
          for (let retry = 0; retry < 5; retry++) {
            await new Promise(resolve => setTimeout(resolve, 500));
            
            try {
              const orderStatus = await this.gateClient.getOrder(order.id?.toString() || "");
              
              if (orderStatus.status === 'finished') {
                actualExitPrice = Number.parseFloat(orderStatus.fillPrice ||  orderStatus.fill_price || orderStatus.price || "0");
                actualQuantity = Math.abs(Number.parseFloat(orderStatus.size || "0"));
                orderFilled = true;
                
                // Get contract multiplier
                let quantoMultiplier = 0.01;
                try {
                  const contractInfo = await this.gateClient.getContractInfo(contract);
                  quantoMultiplier = Number.parseFloat(contractInfo.quantoMultiplier || "0.01");
                } catch (err) {
                  logger.warn(`[Engine ${this.config.id}] Failed to get contract info, using default multiplier 0.01`);
                }
                
                // Calculate PnL
                const entryPrice = pos.entry_price;
                const priceChange = side === "long" 
                  ? (actualExitPrice - entryPrice) 
                  : (entryPrice - actualExitPrice);
                
                const grossPnl = priceChange * actualQuantity * quantoMultiplier;
                
                // Calculate fees (open + close)
                const openFee = entryPrice * actualQuantity * quantoMultiplier * 0.0005;
                const closeFee = actualExitPrice * actualQuantity * quantoMultiplier * 0.0005;
                totalFee = openFee + closeFee;
                
                // Net PnL
                pnl = grossPnl - totalFee;
                
                logger.info(`[Engine ${this.config.id}] Close filled: Price=${actualExitPrice}, Qty=${actualQuantity}, PnL=${pnl.toFixed(2)} USDT`);
                break;
              }
            } catch (statusError: any) {
              logger.warn(`[Engine ${this.config.id}] Failed to query order status (Retry ${retry + 1}/5): ${statusError.message}`);
            }
          }
          
          // 3. Record to trades table
          try {
            await dbClient.execute({
              sql: `INSERT INTO trades (engine_id, order_id, symbol, side, type, price, quantity, leverage, pnl, fee, timestamp, status)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              args: [
                this.config.id,
                order.id?.toString() || "",
                symbol,
                side,
                "close",
                actualExitPrice || pos.current_price,
                actualQuantity,
                pos.leverage || 1,
                pnl,
                totalFee,
                getChinaTimeISO(),
                orderFilled ? "filled" : "pending",
              ],
            });
            logger.info(`[Engine ${this.config.id}] ✅ Forced close trade recorded: ${symbol}, PnL=${pnl.toFixed(2)} USDT, Reason=${closeReason}`);
          } catch (dbError: any) {
            logger.error(`[Engine ${this.config.id}] ❌ Failed to record forced close trade: ${dbError.message}`);
          }
          
          // 4. Delete position from DB
          await dbClient.execute({
            sql: "DELETE FROM positions WHERE symbol = ? AND engine_id = ?",
            args: [symbol, this.config.id],
          });
          
          logger.info(`[Engine ${this.config.id}] ✅ Forced close completed ${symbol}, Reason: ${closeReason}`);
          positionsChanged = true;
          
        } catch (closeError: any) {
          logger.error(`[Engine ${this.config.id}] Forced close failed ${symbol}: ${closeError.message}`);
        }
      }
    }

    return positionsChanged;
  }

  /**
   * Close all positions
   */
  private async closeAllPositions(reason: string) {
    try {
      const positions = await this.gateClient.getPositions();
      const activePositions = positions.filter((p: any) => Number.parseInt(p.size || "0") !== 0);
      
      for (const pos of activePositions) {
        const size = Number.parseInt(pos.size || "0");
        const contract = pos.contract;
        await this.gateClient.placeOrder({
          contract,
          size: -size,
          price: 0,
        });
        logger.info(`[Engine ${this.config.id}] Closed position ${contract} due to: ${reason}`);
      }
    } catch (error) {
      logger.error(`[Engine ${this.config.id}] Failed to close all positions:`, error as any);
    }
  }

  /**
   * 执行一个交易周期
   */
  private async executeCycle() {
    if (!this.isRunning) return;

    this.iterationCount++;
    const engineId = this.config.id;
    const minutesElapsed = Math.floor((Date.now() - this.startTime.getTime()) / 60000);
    const intervalMinutes = 1; // Default or from config

    logger.info(`Engine ${engineId} cycle #${this.iterationCount} started`);

    try {
      // 1. Collect Market Data
      const marketData = await this.collectMarketData();
      if (Object.keys(marketData).length === 0) {
        logger.warn(`[Engine ${engineId}] No market data collected, skipping cycle`);
        return;
      }

      // 2. Get Account Info
      const accountInfo = await this.getAccountInfo();
      if (accountInfo.totalBalance === 0) {
        logger.warn(`[Engine ${engineId}] Account balance 0 or error, skipping cycle`);
        return;
      }

      // 3. Check Thresholds
      if (await this.checkAccountThresholds(accountInfo)) {
        this.stop();
        return;
      }

      // 4. Sync & Get Positions
      const rawGatePositions = await this.gateClient.getPositions();
      await this.syncPositionsFromGate(rawGatePositions);
      let positions = await this.getPositions(rawGatePositions);

      // 5. Risk Management & Position Control
      const positionsChanged = await this.checkRiskAndManagePositions(positions);
      
      if (positionsChanged) {
        // Refresh positions if any were closed
        const updatedRawPositions = await this.gateClient.getPositions();
        await this.syncPositionsFromGate(updatedRawPositions);
        positions = await this.getPositions(updatedRawPositions);
      }

      // 6. Record Account Snapshot
      await this.recordAccountSnapshot(accountInfo);

      // 7. Get History & Decisions
      const tradeHistory = await this.getTradeHistory();
      const recentDecisions = await this.getRecentDecisions();

      // 8. Generate Prompt
      const prompt = generateTradingPrompt({
        minutesElapsed,
        iteration: this.iterationCount,
        intervalMinutes,
        marketData,
        accountInfo,
        positions,
        tradeHistory,
        recentDecisions
      });

      logger.info(`[Engine ${engineId}] Generating decision...`);
      
      // 9. Call Agent
      const response = await this.agent.generateText(prompt);
      
      // Extract decision text
      let decisionText = "";
      if (typeof response === 'string') {
        decisionText = response;
      } else if (response && typeof response === 'object') {
        const steps = (response as any).steps || [];
        
        // Find the last text response from AI
        for (let i = steps.length - 1; i >= 0; i--) {
          const step = steps[i];
          if (step.content) {
            for (let j = step.content.length - 1; j >= 0; j--) {
              const item = step.content[j];
              if (item.type === 'text' && item.text) {
                decisionText = item.text;
                break;
              }
            }
          }
          if (decisionText) break;
        }
        
        if (!decisionText) {
          decisionText = (response as any).text || (response as any).message || "";
        }
        
        if (!decisionText && steps.length > 0) {
          decisionText = "AI called tools but did not produce a decision result";
        }
      }

      logger.info(`[Engine ${engineId}] Decision: ${decisionText.substring(0, 100)}...`);

      // 10. Record Decision
      await this.recordDecision(decisionText, marketData, accountInfo.totalBalance, positions.length);

      // 11. Update Last Run
      await dbClient.execute({
        sql: "UPDATE quant_engines SET last_run_at = ? WHERE id = ?",
        args: [new Date().toISOString(), engineId],
      });

    } catch (error: any) {
      logger.error(`Engine ${engineId} cycle failed:`, error);
    }
  }

  private async updateStatus(status: string) {
    try {
      await dbClient.execute({
        sql: "UPDATE quant_engines SET status = ? WHERE id = ?",
        args: [status, this.config.id],
      });
    } catch (error: any) {
      logger.error(`Failed to update status for engine ${this.config.id}`, error);
    }
  }

  private async recordDecision(decisionText: string, marketData: any, accountValue: number, positionsCount: number) {
    try {
      await dbClient.execute({
        sql: `INSERT INTO agent_decisions 
              (engine_id, timestamp, iteration, market_analysis, decision, actions_taken, account_value, positions_count)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          this.config.id,
          new Date().toISOString(),
          this.iterationCount,
          JSON.stringify(marketData), // Store market data summary
          decisionText,
          "[]", 
          accountValue,
          positionsCount,
        ],
      });
    } catch (error: any) {
      logger.error(`Failed to record decision for engine ${this.config.id}`, error);
    }
  }

  private async recordAccountSnapshot(accountInfo?: any) {
    try {
      const info = accountInfo || await this.getAccountInfo();
      
      await dbClient.execute({
        sql: `INSERT INTO account_history 
              (engine_id, timestamp, total_value, available_cash, unrealized_pnl, realized_pnl, return_percent)
              VALUES (?, ?, ?, ?, ?, ?, ?)`,
        args: [
          this.config.id,
          new Date().toISOString(),
          info.totalBalance,
          info.availableBalance,
          info.unrealisedPnl,
          0, // Realized PnL calculation requires more logic
          info.returnPercent,
        ],
      });
    } catch (error: any) {
      logger.error(`Failed to record account snapshot for engine ${this.config.id}`, error);
    }
  }

  /**
   * Collect all market data (including multi-timeframe analysis and time series data)
   */
  private async collectMarketData() {
    const marketData: Record<string, any> = {};

    for (const symbol of this.SYMBOLS) {
      try {
        const contract = `${symbol}_USDT`;
        
        // Get price (with retry)
        let ticker: any = null;
        let retryCount = 0;
        const maxRetries = 2;
        
        while (retryCount <= maxRetries) {
          try {
            ticker = await this.gateClient.getFuturesTicker(contract);
            
            // Validate price data validity
            const price = Number.parseFloat(ticker.last || "0");
            if (price === 0 || !Number.isFinite(price)) {
              throw new Error(`Invalid price: ${ticker.last}`);
            }
            
            break; // Success, break retry loop
          } catch (error) {
            retryCount++;
            if (retryCount > maxRetries) {
              logger.error(`[Engine ${this.config.id}] ${symbol} Failed to get price (${maxRetries} retries):`, error as any);
              throw error;
            }
            await new Promise(resolve => setTimeout(resolve, 200));
          }
        }
        
        // Get candlestick data for all timeframes
        const candles1m = await this.gateClient.getFuturesCandles(contract, "1m", 60);
        const candles3m = await this.gateClient.getFuturesCandles(contract, "3m", 60);
        const candles5m = await this.gateClient.getFuturesCandles(contract, "5m", 100);
        const candles15m = await this.gateClient.getFuturesCandles(contract, "15m", 96);
        const candles30m = await this.gateClient.getFuturesCandles(contract, "30m", 90);
        const candles1h = await this.gateClient.getFuturesCandles(contract, "1h", 120);
        
        // 计算每个时间框架的指标
        const indicators1m = calculateIndicators(candles1m);
        const indicators3m = calculateIndicators(candles3m);
        const indicators5m = calculateIndicators(candles5m);
        const indicators15m = calculateIndicators(candles15m);
        const indicators30m = calculateIndicators(candles30m);
        const indicators1h = calculateIndicators(candles1h);
        
        // 计算3分钟时序指标
        const intradaySeries = calculateIntradaySeries(candles3m);
        
        // 计算1小时指标作为更长期上下文
        const longerTermContext = calculateLongerTermContext(candles1h);
        
        // 使用5分钟K线数据作为主要指标
        const indicators = indicators5m;
        
        // Get funding rate
        let fundingRate = 0;
        try {
          const fr = await this.gateClient.getFundingRate(contract);
          fundingRate = Number.parseFloat(fr.r || "0");
          if (!Number.isFinite(fundingRate)) {
            fundingRate = 0;
          }
        } catch (error) {
          logger.warn(`[Engine ${this.config.id}] Failed to get funding rate for ${symbol}:`, error as any);
        }
        
        // 将各时间框架指标添加到市场数据
        marketData[symbol] = {
          price: Number.parseFloat(ticker.last || "0"),
          change24h: Number.parseFloat(ticker.change_percentage || "0"),
          volume24h: Number.parseFloat(ticker.volume_24h || "0"),
          fundingRate,
          openInterest: { latest: 0, average: 0 },
          ...indicators,
          intradaySeries,
          longerTermContext,
          timeframes: {
            "1m": indicators1m,
            "3m": indicators3m,
            "5m": indicators5m,
            "15m": indicators15m,
            "30m": indicators30m,
            "1h": indicators1h,
          },
        };
        
        // 保存技术指标到数据库
        await dbClient.execute({
          sql: `INSERT INTO trading_signals 
                (engine_id, symbol, timestamp, price, ema_20, ema_50, macd, rsi_7, rsi_14, volume, funding_rate)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          args: [
            this.config.id,
            symbol,
            getChinaTimeISO(),
            ensureFinite(marketData[symbol].price),
            ensureFinite(indicators.ema20),
            ensureFinite(indicators.ema50),
            ensureFinite(indicators.macd),
            ensureFinite(indicators.rsi7, 50),
            ensureFinite(indicators.rsi14, 50),
            ensureFinite(indicators.volume),
            ensureFinite(fundingRate),
          ],
        });
      } catch (error) {
        logger.error(`[Engine ${this.config.id}] Failed to collect market data for ${symbol}:`, error as any);
      }
    }

    return marketData;
  }
}
