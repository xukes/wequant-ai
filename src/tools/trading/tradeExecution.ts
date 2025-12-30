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
 * 交易执行工具
 */
import { createTool } from "@voltagent/core";
import { z } from "zod";
import { GateClient } from "../../services/gateClient";
import { RISK_PARAMS } from "../../config/riskParams";

/**
 * 开仓工具
 */
export const createOpenPositionTool = (gateClient: GateClient) => createTool({
  name: "openPosition",
  description: "开立新的合约仓位 (做多或做空)",
  parameters: z.object({
    symbol: z.enum(RISK_PARAMS.TRADING_SYMBOLS as [string, ...string[]]).describe("币种代码"),
    side: z.enum(["long", "short"]).describe("方向: long(做多) 或 short(做空)"),
    amount: z.number().positive().describe("交易数量 (USDT金额)"),
    leverage: z.number().min(1).max(RISK_PARAMS.MAX_LEVERAGE).default(1).describe("杠杆倍数"),
  }),
  execute: async ({ symbol, side, amount, leverage }) => {
    try {
      // 1. 检查风险控制
      if (leverage > RISK_PARAMS.MAX_LEVERAGE) {
        return { error: `杠杆倍数超过最大限制: ${RISK_PARAMS.MAX_LEVERAGE}` };
      }

      const contract = `${symbol}_USDT`;
      
      // 2. 设置杠杆
      await gateClient.setLeverage(contract, leverage);
      
      // 3. 获取当前价格计算数量
      const ticker = await gateClient.getFuturesTicker(contract);
      const price = Number.parseFloat(ticker.last || "0");
      if (price <= 0) return { error: "无法获取有效市场价格" };
      
      // 计算合约数量 (Gate.io合约通常以币为单位或张数为单位，这里简化假设为币的数量)
      // 注意：实际生产环境需要根据合约面值精确计算
      // 假设 amount 是 USDT 金额，size = (amount * leverage) / price
      // 且需要取整到合约最小单位
      let size = Math.floor(((amount * leverage) / price) * 100) / 100; // 保留2位小数
      
      // 转换方向: long -> size > 0, short -> size < 0
      const sizeToSend = side === "long" ? size : -size;
      
      // 4. 下单
      const order = await gateClient.placeFuturesOrder(
        contract,
        sizeToSend,
        0, // 0 表示市价单
        { tif: "ioc" } // 市价单通常配合 IOC
      );
      
      return {
        success: true,
        orderId: order.id,
        symbol,
        side,
        size: sizeToSend,
        price: order.fill_price || price, // 如果是市价单，可能还没有成交价
        status: order.status,
        timestamp: new Date().toISOString()
      };
    } catch (error: any) {
      return { error: `开仓失败: ${error.message}` };
    }
  },
});

/**
 * 平仓工具
 */
export const createClosePositionTool = (gateClient: GateClient) => createTool({
  name: "closePosition",
  description: "平掉指定币种的当前仓位",
  parameters: z.object({
    symbol: z.enum(RISK_PARAMS.TRADING_SYMBOLS as [string, ...string[]]).describe("币种代码"),
  }),
  execute: async ({ symbol }) => {
    try {
      const contract = `${symbol}_USDT`;
      
      // 1. 获取当前持仓
      const positions = await gateClient.getPositions();
      const position = positions.find((p: any) => p.contract === contract) || {};
      const size = Number.parseFloat(position.size || "0");
      
      if (size === 0) {
        return { message: "当前无持仓，无需平仓" };
      }
      
      // 2. 下反向单平仓
      // 平仓数量为持仓数量的相反数
      const closeSize = -size;
      
      const order = await gateClient.placeFuturesOrder(
        contract,
        closeSize,
        0, // 市价
        { tif: "ioc", reduce_only: true } // 只减仓
      );
      
      return {
        success: true,
        orderId: order.id,
        symbol,
        action: "close",
        closedSize: Math.abs(size),
        pnl: position.realised_pnl || "unknown",
        timestamp: new Date().toISOString()
      };
    } catch (error: any) {
      return { error: `平仓失败: ${error.message}` };
    }
  },
});

/**
 * 设置止损止盈工具
 */
export const createSetStopLossTakeProfitTool = (gateClient: GateClient) => createTool({
  name: "setStopLossTakeProfit",
  description: "为当前仓位设置止损和止盈价格",
  parameters: z.object({
    symbol: z.enum(RISK_PARAMS.TRADING_SYMBOLS as [string, ...string[]]).describe("币种代码"),
    stopLossPrice: z.number().positive().optional().describe("止损触发价格"),
    takeProfitPrice: z.number().positive().optional().describe("止盈触发价格"),
  }),
  execute: async ({ symbol, stopLossPrice, takeProfitPrice }) => {
    try {
      const contract = `${symbol}_USDT`;
      
      // 1. 获取当前持仓以确定方向
      const positions = await gateClient.getPositions();
      const position = positions.find((p: any) => p.contract === contract) || {};
      const size = Number.parseFloat(position.size || "0");
      
      if (size === 0) {
        return { error: "当前无持仓，无法设置止损止盈" };
      }
      
      const isLong = size > 0;
      const results = [];
      
      // 2. 设置止损单 (触发后市价平仓)
      if (stopLossPrice) {
        // 验证止损价格合理性
        // 多单止损价应低于当前价，空单止损价应高于当前价 (这里简化，仅提交订单)
        const slOrder = await gateClient.placePriceTriggerOrder(
          contract,
          stopLossPrice,
          isLong ? "down" : "up", // 触发规则: 多单价格下跌触发，空单价格上涨触发
          0, // 市价
          0, // 数量0代表平掉所有仓位(close_long/close_short)
          { close_position: true }
        );
        results.push({ type: "stop_loss", id: slOrder.id, price: stopLossPrice });
      }
      
      // 3. 设置止盈单
      if (takeProfitPrice) {
        const tpOrder = await gateClient.placePriceTriggerOrder(
          contract,
          takeProfitPrice,
          isLong ? "up" : "down", // 触发规则: 多单价格上涨触发，空单价格下跌触发
          0, // 市价
          0, // 数量0代表平掉所有仓位
          { close_position: true }
        );
        results.push({ type: "take_profit", id: tpOrder.id, price: takeProfitPrice });
      }
      
      return {
        success: true,
        symbol,
        orders: results
      };
    } catch (error: any) {
      return { error: `设置止损止盈失败: ${error.message}` };
    }
  },
});

/**
 * 取消所有订单工具
 */
export const createCancelAllOrdersTool = (gateClient: GateClient) => createTool({
  name: "cancelAllOrders",
  description: "取消指定币种的所有挂单",
  parameters: z.object({
    symbol: z.enum(RISK_PARAMS.TRADING_SYMBOLS as [string, ...string[]]).describe("币种代码"),
  }),
  execute: async ({ symbol }) => {
    try {
      const contract = `${symbol}_USDT`;
      const result = await gateClient.cancelAllFuturesOrders(contract);
      return {
        success: true,
        symbol,
        result
      };
    } catch (error: any) {
      return { error: `取消订单失败: ${error.message}` };
    }
  },
});
