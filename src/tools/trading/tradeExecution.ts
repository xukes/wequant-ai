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
import { createGateClient } from "../../services/gateClient";
import { RISK_PARAMS } from "../../config/riskParams";
import { createClient } from "@libsql/client";

const dbClient = createClient({
  url: process.env.DATABASE_URL || "file:./.voltagent/trading.db",
});

/**
 * 开仓工具
 */
export const openPositionTool = createTool({
  name: "openPosition",
  description: "开仓 - 做多或做空指定币种（使用市价单）。IMPORTANT: 开仓前必须先查询可用资金。",
  parameters: z.object({
    symbol: z.enum(RISK_PARAMS.TRADING_SYMBOLS as [string, ...string[]]).describe("币种代码"),
    side: z.enum(["long", "short"]).describe("方向：long=做多，short=做空"),
    leverage: z.number().min(1).max(RISK_PARAMS.MAX_LEVERAGE).describe("杠杆倍数"),
    amountUsdt: z.number().describe("开仓金额（USDT）"),
  }),
  execute: async ({ symbol, side, leverage, amountUsdt }) => {
    const client = createGateClient();
    try {
      // 简单的参数检查
      if (amountUsdt <= 0) return { success: false, message: "金额必须大于0" };
      
      // 实际下单逻辑
      const contract = `${symbol}_USDT`;
      const priceData = await client.getFuturesTicker(contract);
      const currentPrice = Number.parseFloat(priceData.last || "0");
      
      if (currentPrice <= 0) return { success: false, message: "获取价格失败" };
      
      // 计算数量 (简化版，实际应考虑合约乘数)
      const quantity = Math.floor((amountUsdt * leverage) / currentPrice);
      if (quantity <= 0) return { success: false, message: "计算出的下单数量为0" };
      
      const size = side === "long" ? quantity : -quantity;
      
      // 设置杠杆
      try {
        await client.setLeverage(contract, leverage);
      } catch (e) {
        // 忽略杠杆设置错误，可能已经设置过了
      }

      const order = await client.placeOrder({
        contract,
        size,
        price: 0, // 市价单
      });
      
      // 记录到数据库 (使用默认 engine_id 0 或其他标识)
      // 注意：这里是旧的工具实现，可能不包含 engine_id 上下文
      // 如果需要兼容新架构，建议使用 factory.ts 中的 createToolsForEngine
      
      return {
        success: true,
        message: `下单成功: ${side} ${symbol}, 数量 ${quantity}, 订单ID ${order.id}`,
        orderId: String(order.id),
        price: currentPrice
      };
    } catch (error: any) {
      return { success: false, message: `下单失败: ${error.message}` };
    }
  },
});

/**
 * 平仓工具
 */
export const closePositionTool = createTool({
  name: "closePosition",
  description: "平仓 - 平掉指定币种的持仓",
  parameters: z.object({
    symbol: z.enum(RISK_PARAMS.TRADING_SYMBOLS as [string, ...string[]]).describe("币种代码"),
  }),
  execute: async ({ symbol }) => {
    const client = createGateClient();
    try {
      const positions = await client.getPositions();
      const targetPos = positions.find((p: any) => p.contract === `${symbol}_USDT`);
      
      if (!targetPos || Number.parseInt(targetPos.size || "0") === 0) {
        return { success: false, message: "当前无持仓" };
      }
      
      const size = -Number.parseInt(targetPos.size);
      
      const order = await client.placeOrder({
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

/**
 * 取消订单工具
 */
export const cancelOrderTool = createTool({
  name: "cancelOrder",
  description: "取消指定订单",
  parameters: z.object({
    orderId: z.string().describe("订单ID"),
    symbol: z.enum(RISK_PARAMS.TRADING_SYMBOLS as [string, ...string[]]).describe("币种代码"),
  }),
  execute: async ({ orderId, symbol }) => {
    const client = createGateClient();
    try {
      const result = await client.cancelOrder(orderId);
      const safeResult = JSON.parse(JSON.stringify(result, (_, v) => typeof v === 'bigint' ? v.toString() : v));
      return {
        success: true,
        message: `订单已取消: ${orderId}`,
        result: safeResult
      };
    } catch (error: any) {
      return { success: false, message: `取消订单失败: ${error.message}` };
    }
  },
});
