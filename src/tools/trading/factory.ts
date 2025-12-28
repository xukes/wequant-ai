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

import { GateClient } from "../../services/gateClient";
import { createTool } from "@voltagent/core";
import { z } from "zod";
import { RISK_PARAMS } from "../../config/riskParams";
import { createPinoLogger } from "@voltagent/logger";
import { createClient } from "@libsql/client";
import { calculateIndicators } from "../../utils/indicators";

const logger = createPinoLogger({
  name: "tool-factory",
  level: "info",
});

const dbClient = createClient({
  url: process.env.DATABASE_URL || "file:./.voltagent/trading.db",
});

/**
 * 为特定量化引擎创建绑定的交易工具集
 * @param gateClient 已初始化的 GateClient 实例
 * @param engineId 量化引擎 ID
 */
export function createToolsForEngine(gateClient: GateClient, engineId: number) {
  
  // 1. 市场数据工具 (Market Data Tools)
  // 这些工具主要依赖 GateClient 获取数据，不涉及数据库写操作，或者只写公共数据
  
  const getMarketPriceTool = createTool({
    name: "getMarketPrice",
    description: "获取指定加密货币的当前市场价格",
    parameters: z.object({
      symbol: z.enum(RISK_PARAMS.TRADING_SYMBOLS).describe("币种代码，例如 BTC, ETH"),
    }),
    execute: async ({ symbol }) => {
      try {
        const ticker = await gateClient.getFuturesTicker(`${symbol}_USDT`);
        return {
          symbol,
          price: Number.parseFloat(ticker.last || "0"),
          change24h: Number.parseFloat(ticker.change_percentage || "0"),
          high24h: Number.parseFloat(ticker.high_24h || "0"),
          low24h: Number.parseFloat(ticker.low_24h || "0"),
          volume24h: Number.parseFloat(ticker.volume_24h || "0"),
        };
      } catch (error: any) {
        return { error: `获取价格失败: ${error.message}` };
      }
    },
  });

  // 2. 交易执行工具 (Trade Execution Tools)
  // 这些工具需要使用特定的 gateClient 进行下单，并且可能需要记录到数据库（带 engineId）
  
  const openPositionTool = createTool({
    name: "openPosition",
    description: "开仓 - 做多或做空指定币种（使用市价单）。IMPORTANT: 开仓前必须先查询可用资金。",
    parameters: z.object({
      symbol: z.enum(RISK_PARAMS.TRADING_SYMBOLS).describe("币种代码"),
      side: z.enum(["long", "short"]).describe("方向：long=做多，short=做空"),
      leverage: z.number().min(1).max(20).describe("杠杆倍数"),
      amountUsdt: z.number().describe("开仓金额（USDT）"),
    }),
    execute: async ({ symbol, side, leverage, amountUsdt }) => {
      try {
        // 简单的参数检查
        if (amountUsdt <= 0) return { success: false, message: "金额必须大于0" };
        
        // 实际下单逻辑
        const contract = `${symbol}_USDT`;
        const price = await gateClient.getFuturesTicker(contract);
        const currentPrice = Number.parseFloat(price.last || "0");
        
        if (currentPrice <= 0) return { success: false, message: "获取价格失败" };
        
        // 计算数量 (简化版，实际应考虑合约乘数)
        const quantity = Math.floor((amountUsdt * leverage) / currentPrice);
        if (quantity <= 0) return { success: false, message: "计算出的下单数量为0" };
        
        const size = side === "long" ? quantity : -quantity;
        
        const order = await gateClient.placeOrder({
          contract,
          size,
          price: 0, // 市价单
          // leverage: leverage.toString(), // placeOrder 接口可能不支持直接传 leverage，通常需要先 setLeverage
        });
        
        // 如果需要设置杠杆，应该在下单前调用 setLeverage
        // await gateClient.setLeverage(contract, leverage);
        
        return {
          success: true,
          message: `下单成功: ${side} ${symbol}, 数量 ${quantity}, 订单ID ${order.id}`,
          orderId: String(order.id)
        };
      } catch (error: any) {
        return { success: false, message: `下单失败: ${error.message}` };
      }
    },
  });

  const closePositionTool = createTool({
    name: "closePosition",
    description: "平仓 - 平掉指定币种的持仓",
    parameters: z.object({
      symbol: z.enum(RISK_PARAMS.TRADING_SYMBOLS).describe("币种代码"),
    }),
    execute: async ({ symbol }) => {
      try {
        const positions = await gateClient.getPositions();
        const targetPos = positions.find((p: any) => p.contract === `${symbol}_USDT`);
        
        if (!targetPos || Number.parseInt(targetPos.size || "0") === 0) {
          return { success: false, message: "当前无持仓" };
        }
        
        const size = -Number.parseInt(targetPos.size);
        
        const order = await gateClient.placeOrder({
          contract: targetPos.contract,
          size,
          price: 0,
          reduceOnly: true,
        });
        
        return {
          success: true,
          message: `平仓指令已发送: ${symbol}, 订单ID ${order.id}`,
          orderId: String(order.id)
        };
      } catch (error: any) {
        return { success: false, message: `平仓失败: ${error.message}` };
      }
    },
  });

  // 3. 账户查询工具 (Account Tools)
  
  const getAccountBalanceTool = createTool({
    name: "getAccountBalance",
    description: "获取账户余额和资金情况",
    parameters: z.object({}),
    execute: async () => {
      try {
        const account = await gateClient.getFuturesAccount();
        return {
          total: Number.parseFloat(account.total || "0"),
          available: Number.parseFloat(account.available || "0"),
          unrealisedPnl: Number.parseFloat(account.unrealisedPnl || "0"),
        };
      } catch (error: any) {
        return { error: `获取账户信息失败: ${error.message}` };
      }
    },
  });

  const getPositionsTool = createTool({
    name: "getPositions",
    description: "获取当前所有持仓信息",
    parameters: z.object({}),
    execute: async () => {
      try {
        const positions = await gateClient.getPositions();
        return positions
          .filter((p: any) => Number.parseInt(p.size || "0") !== 0)
          .map((p: any) => ({
            symbol: p.contract.replace("_USDT", ""),
            size: Number.parseInt(p.size),
            entryPrice: Number.parseFloat(p.entryPrice),
            markPrice: Number.parseFloat(p.markPrice),
            unrealisedPnl: Number.parseFloat(p.unrealisedPnl),
            leverage: Number.parseInt(p.leverage),
          }));
      } catch (error: any) {
        return { error: `获取持仓失败: ${error.message}` };
      }
    },
  });

  const cancelOrderTool = createTool({
    name: "cancelOrder",
    description: "取消指定订单",
    parameters: z.object({
      orderId: z.string().describe("订单ID"),
      symbol: z.enum(RISK_PARAMS.TRADING_SYMBOLS).describe("币种代码"),
    }),
    execute: async ({ orderId, symbol }) => {
      try {
        const result = await gateClient.cancelOrder(orderId);
        return {
          success: true,
          message: `订单已取消: ${orderId}`,
          result
        };
      } catch (error: any) {
        return { success: false, message: `取消订单失败: ${error.message}` };
      }
    },
  });

  const getTechnicalIndicatorsTool = createTool({
    name: "getTechnicalIndicators",
    description: "获取指定币种的技术指标（EMA、MACD、RSI等）",
    parameters: z.object({
      symbol: z.enum(RISK_PARAMS.TRADING_SYMBOLS).describe("币种代码"),
      interval: z.enum(["1m", "5m", "15m", "1h", "4h"]).default("5m").describe("K线周期"),
      limit: z.number().default(100).describe("K线数量"),
    }),
    execute: async ({ symbol, interval, limit }) => {
      try {
        const contract = `${symbol}_USDT`;
        const candles = await gateClient.getFuturesCandles(contract, interval, limit);
        const indicators = calculateIndicators(candles);
        
        return {
          symbol,
          interval,
          ...indicators,
          timestamp: new Date().toISOString(),
        };
      } catch (error: any) {
        return { error: `获取技术指标失败: ${error.message}` };
      }
    },
  });

  const getFundingRateTool = createTool({
    name: "getFundingRate",
    description: "获取指定币种的资金费率",
    parameters: z.object({
      symbol: z.enum(RISK_PARAMS.TRADING_SYMBOLS).describe("币种代码"),
    }),
    execute: async ({ symbol }) => {
      try {
        const contract = `${symbol}_USDT`;
        const fundingRate = await gateClient.getFundingRate(contract);
        
        return {
          symbol,
          fundingRate: Number.parseFloat(fundingRate.r || "0"),
          fundingTime: fundingRate.t,
          timestamp: new Date().toISOString(),
        };
      } catch (error: any) {
        return { error: `获取资金费率失败: ${error.message}` };
      }
    },
  });

  const getOrderBookTool = createTool({
    name: "getOrderBook",
    description: "获取指定币种的订单簿深度数据",
    parameters: z.object({
      symbol: z.enum(RISK_PARAMS.TRADING_SYMBOLS).describe("币种代码"),
      limit: z.number().default(10).describe("深度档位数量"),
    }),
    execute: async ({ symbol, limit }) => {
      try {
        const contract = `${symbol}_USDT`;
        const orderBook = await gateClient.getOrderBook(contract, limit);
        
        const bids = orderBook.bids?.slice(0, limit).map((b: any) => ({
          price: Number.parseFloat(b.p),
          size: Number.parseFloat(b.s),
        })) || [];
        
        const asks = orderBook.asks?.slice(0, limit).map((a: any) => ({
          price: Number.parseFloat(a.p),
          size: Number.parseFloat(a.s),
        })) || [];
        
        return {
          symbol,
          bids,
          asks,
          spread: asks[0]?.price - bids[0]?.price || 0,
          timestamp: new Date().toISOString(),
        };
      } catch (error: any) {
        return { error: `获取订单簿失败: ${error.message}` };
      }
    },
  });

  const getOpenOrdersTool = createTool({
    name: "getOpenOrders",
    description: "获取所有未成交的挂单",
    parameters: z.object({
      symbol: z.enum(RISK_PARAMS.TRADING_SYMBOLS).optional().describe("可选：仅获取指定币种的订单"),
    }),
    execute: async ({ symbol }) => {
      try {
        const contract = symbol ? `${symbol}_USDT` : undefined;
        const orders = await gateClient.getOpenOrders(contract);
        
        const formattedOrders = orders.map((o: any) => ({
          orderId: o.id?.toString(),
          contract: o.contract,
          size: Number.parseInt(o.size || "0"),
          price: Number.parseFloat(o.price || "0"),
          left: Number.parseInt(o.left || "0"),
          status: o.status,
          side: Number.parseInt(o.size || "0") > 0 ? "long" : "short",
          isReduceOnly: o.is_reduce_only,
          createdAt: o.create_time,
        }));
        
        return {
          orders: formattedOrders,
          count: formattedOrders.length,
          timestamp: new Date().toISOString(),
        };
      } catch (error: any) {
        return {
          error: error.message,
          message: `获取未成交订单失败: ${error.message}`,
        };
      }
    },
  });

  const checkOrderStatusTool = createTool({
    name: "checkOrderStatus",
    description: "检查指定订单的详细状态，包括成交价格、成交数量等",
    parameters: z.object({
      orderId: z.string().describe("订单ID"),
    }),
    execute: async ({ orderId }) => {
      try {
        const orderDetail = await gateClient.getOrder(orderId);
        
        const totalSize = Math.abs(Number.parseInt(orderDetail.size || "0"));
        const leftSize = Math.abs(Number.parseInt(orderDetail.left || "0"));
        const filledSize = totalSize - leftSize;
        const fillPrice = Number.parseFloat(orderDetail.fill_price || orderDetail.price || "0");
        
        return {
          success: true,
          orderId: orderDetail.id?.toString(),
          contract: orderDetail.contract,
          status: orderDetail.status,
          totalSize,
          filledSize,
          leftSize,
          fillPrice,
          price: Number.parseFloat(orderDetail.price || "0"),
          createdAt: orderDetail.create_time,
          finishedAt: orderDetail.finish_time,
          isFullyFilled: leftSize === 0,
          fillPercentage: totalSize > 0 ? (filledSize / totalSize * 100).toFixed(2) : "0",
          message: `订单 ${orderId} 状态: ${orderDetail.status}, 已成交 ${filledSize}/${totalSize} 张 (${totalSize > 0 ? (filledSize / totalSize * 100).toFixed(1) : '0'}%), 成交价 ${fillPrice}`,
        };
      } catch (error: any) {
        return {
          success: false,
          error: error.message,
          message: `获取订单状态失败: ${error.message}`,
        };
      }
    },
  });

  const calculateRiskTool = createTool({
    name: "calculateRisk",
    description: "计算当前账户的风险敞口和仓位情况",
    parameters: z.object({}),
    execute: async () => {
      try {
        const [account, positions] = await Promise.all([
          gateClient.getFuturesAccount(),
          gateClient.getPositions(),
        ]);
        
        // account.total 包含了未实现盈亏，需要减去以得到实际总资产
        const unrealisedPnl = Number.parseFloat(account.unrealisedPnl || "0");
        const totalBalance = Number.parseFloat(account.total || "0") - unrealisedPnl;
        const availableBalance = Number.parseFloat(account.available || "0");
        
        // 计算每个持仓的风险（需要异步获取合约乘数）
        const activePositions = positions.filter((p: any) => Number.parseFloat(p.size || "0") !== 0);
        
        const positionRisks = await Promise.all(
          activePositions.map(async (p: any) => {
            const size = Math.abs(Number.parseFloat(p.size || "0"));
            const entryPrice = Number.parseFloat(p.entryPrice || "0");
            const leverage = Number.parseInt(p.leverage || "1");
            const liquidationPrice = Number.parseFloat(p.liqPrice || "0");
            const currentPrice = Number.parseFloat(p.markPrice || "0");
            const pnl = Number.parseFloat(p.unrealisedPnl || "0");
            
            // 获取合约乘数（修复：正确计算名义价值）
            let quantoMultiplier = 0.01; // 默认值
            try {
              const contractInfo = await gateClient.getContractInfo(p.contract);
              quantoMultiplier = Number.parseFloat(contractInfo.quantoMultiplier || "0.01");
            } catch (error: any) {
              // 使用默认值
            }
            
            // 正确计算名义价值：张数 × 入场价格 × 合约乘数
            const notionalValue = size * entryPrice * quantoMultiplier;
            const margin = notionalValue / leverage;
            
            // 计算风险百分比（到强平的距离）
            const riskPercent = currentPrice > 0 
              ? Math.abs((currentPrice - liquidationPrice) / currentPrice) * 100 
              : 0;
            
            return {
              contract: p.contract,
              notionalValue,
              margin,
              leverage,
              pnl,
              riskPercent,
              side: Number.parseFloat(p.size || "0") > 0 ? "long" : "short",
            };
          })
        );
        
        const totalNotional = positionRisks.reduce((sum: number, p: any) => sum + p.notionalValue, 0);
        const totalMargin = positionRisks.reduce((sum: number, p: any) => sum + p.margin, 0);
        const usedMarginPercent = totalBalance > 0 ? (totalMargin / totalBalance) * 100 : 0;
        
        // 从数据库获取初始资金 (带 engine_id)
        const initialBalanceResult = await dbClient.execute({
          sql: "SELECT total_value FROM account_history WHERE engine_id = ? ORDER BY timestamp ASC LIMIT 1",
          args: [engineId]
        });
        const initialBalance = initialBalanceResult.rows[0]
          ? Number.parseFloat(initialBalanceResult.rows[0].total_value as string)
          : 100;
        
        const returnPercent = initialBalance > 0 
          ? ((totalBalance - initialBalance) / initialBalance) * 100 
          : 0;
        
        let riskLevel = "low";
        if (usedMarginPercent > 80) {
          riskLevel = "high";
        } else if (usedMarginPercent > 50) {
          riskLevel = "medium";
        }

        return {
          totalBalance,
          availableBalance,
          unrealisedPnl,
          totalNotional,
          totalMargin,
          usedMarginPercent,
          returnPercent,
          positionCount: positionRisks.length,
          positions: positionRisks,
          riskLevel,
          timestamp: new Date().toISOString(),
        };
      } catch (error: any) {
        return {
          error: error.message,
          message: `计算风险失败: ${error.message}`,
        };
      }
    },
  });

  const syncPositionsTool = createTool({
    name: "syncPositions",
    description: "同步交易所持仓数据到本地数据库",
    parameters: z.object({}),
    execute: async () => {
      try {
        const positions = await gateClient.getPositions();
        
        // 清空本地持仓表 (仅当前 engine_id)
        await dbClient.execute({
          sql: "DELETE FROM positions WHERE engine_id = ?",
          args: [engineId]
        });
        
        // 插入当前持仓
        for (const p of positions) {
          const pos = p as any;
          const size = Number.parseFloat(pos.size || "0");
          if (size === 0) continue;
          
          const symbol = pos.contract?.replace("_USDT", "") || "";
          const side = size > 0 ? "long" : "short";
          
          await dbClient.execute({
            sql: `INSERT INTO positions 
                  (engine_id, symbol, quantity, entry_price, current_price, liquidation_price, unrealized_pnl, 
                   leverage, side, entry_order_id, opened_at)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            args: [
              engineId,
              symbol,
              Math.abs(size),
              Number.parseFloat(pos.entryPrice || "0"),
              Number.parseFloat(pos.markPrice || "0"),
              Number.parseFloat(pos.liqPrice || "0"),
              Number.parseFloat(pos.unrealisedPnl || "0"),
              Number.parseInt(pos.leverage || "1"),
              side,
              "synced",
              new Date().toISOString(),
            ],
          });
        }
        
        return {
          success: true,
          syncedCount: positions.filter((p: any) => Number.parseFloat(p.size || "0") !== 0).length,
          message: "持仓同步完成",
        };
      } catch (error: any) {
        return {
          success: false,
          error: error.message,
          message: `同步持仓失败: ${error.message}`,
        };
      }
    },
  });

  const getOpenInterestTool = createTool({
    name: "getOpenInterest",
    description: "获取指定币种的合约持仓量",
    parameters: z.object({
      symbol: z.enum(RISK_PARAMS.TRADING_SYMBOLS).describe("币种代码"),
    }),
    execute: async ({ symbol }) => {
      // Gate API 需要通过其他方式获取持仓量数据
      // 暂时返回 0，后续可以通过其他端点获取
      return {
        symbol,
        openInterest: 0,
        timestamp: new Date().toISOString(),
      };
    },
  });

  return [
    getMarketPriceTool,
    openPositionTool,
    closePositionTool,
    getAccountBalanceTool,
    getPositionsTool,
    cancelOrderTool,
    getTechnicalIndicatorsTool,
    getFundingRateTool,
    getOrderBookTool,
    getOpenInterestTool,
    getOpenOrdersTool,
    checkOrderStatusTool,
    calculateRiskTool,
    syncPositionsTool,
  ];
}
