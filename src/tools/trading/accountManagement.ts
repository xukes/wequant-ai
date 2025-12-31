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
 * 账户管理工具
 */
import { createTool } from "@voltagent/core";
import { z } from "zod";
import { GateApiLocal } from "../../services/gateApiLocal";
import { RISK_PARAMS } from "../../config/riskParams";

/**
 * 创建账户管理工具
 * @param backendClient Backend-base API 客户端（使用 GateApiLocal）
 */
export const createGetAccountBalanceTool = (backendClient: GateApiLocal) => createTool({
  name: "getAccountBalance",
  description: "获取账户余额和资金信息",
  parameters: z.object({}),
  execute: async () => {
    try {
      // 使用 backend-base API 获取账户信息
      const result = await backendClient.futures.listFuturesAccounts('usdt');

      return {
        currency: "USDT",
        totalBalance: Number.parseFloat(result.body.total || "0"),
        availableBalance: Number.parseFloat(result.body.available || "0"),
        positionMargin: Number.parseFloat(result.body.positionMargin || "0"),
        orderMargin: Number.parseFloat(result.body.orderMargin || "0"),
        unrealisedPnl: Number.parseFloat(result.body.unrealisedPnl || "0"),
        timestamp: new Date().toISOString(),
      };
    } catch (error: any) {
      return {
        error: error.message,
        message: `获取账户余额失败: ${error.message}`,
      };
    }
  },
});

/**
 * 获取当前持仓工具
 */
export const createGetPositionsTool = (backendClient: GateApiLocal) => createTool({
  name: "getPositions",
  description: "获取当前所有持仓信息",
  parameters: z.object({}),
  execute: async () => {
    try {
      // 使用 backend-base API 获取持仓
      const result = await backendClient.futures.listPositions('usdt');
      const positions = result.body || [];

      const formattedPositions = positions
        .filter((p: any) => Number.parseInt(p.size || "0") !== 0)
        .map((p: any) => ({
          contract: p.contract,
          size: Number.parseFloat(p.size || "0"),
          leverage: Number.parseInt(p.leverage || "1"),
          entryPrice: Number.parseFloat(p.entryPrice || "0"),
          markPrice: Number.parseFloat(p.markPrice || "0"),
          liquidationPrice: Number.parseFloat(p.liqPrice || "0"),
          unrealisedPnl: Number.parseFloat(p.unrealisedPnl || "0"),
          realisedPnl: 0,
          margin: Number.parseFloat(p.margin || "0"),
          side: Number.parseFloat(p.size || "0") > 0 ? "long" : "short",
        }));

      return {
        positions: formattedPositions,
        count: formattedPositions.length,
        timestamp: new Date().toISOString(),
      };
    } catch (error: any) {
      return {
        error: error.message,
        message: `获取持仓失败: ${error.message}`,
      };
    }
  },
});

/**
 * 获取未成交订单工具
 */
export const createGetOpenOrdersTool = (backendClient: GateApiLocal) => createTool({
  name: "getOpenOrders",
  description: "获取所有未成交的挂单",
  parameters: z.object({
    symbol: z.enum(RISK_PARAMS.TRADING_SYMBOLS as [string, ...string[]]).optional().describe("可选：仅获取指定币种的订单"),
  }),
  execute: async ({ symbol }) => {
    try {
      const contract = symbol ? `${symbol}_USDT` : undefined;
      const result = await backendClient.futures.listFuturesOrders('usdt', 'open', contract ? { contract } : {});
      const orders = result.body || [];

      const formattedOrders = orders.map((o: any) => ({
        orderId: o.id?.toString(),
        contract: o.contract,
        size: Number.parseInt(o.size || "0"),
        price: Number.parseFloat(o.price || "0"),
        left: Number.parseInt(o.left || "0"),
        status: o.status,
        side: Number.parseInt(o.size || "0") > 0 ? "long" : "short",
        isReduceOnly: o.isReduceOnly,
        createdAt: o.createTime,
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

/**
 * 检查订单状态工具
 */
export const createCheckOrderStatusTool = (backendClient: GateApiLocal) => createTool({
  name: "checkOrderStatus",
  description: "检查指定订单的详细状态，包括成交价格、成交数量等",
  parameters: z.object({
    orderId: z.string().describe("订单ID"),
  }),
  execute: async ({ orderId }) => {
    try {
      const result = await backendClient.futures.getFuturesOrder('usdt', orderId);
      const order = result.body;

      const totalSize = Math.abs(Number.parseInt(order.size || "0"));
      const leftSize = Math.abs(Number.parseInt(order.left || "0"));
      const filledSize = totalSize - leftSize;
      const fillPrice = Number.parseFloat(order.fillPrice || order.price || "0");

      return {
        success: true,
        orderId: order.id?.toString(),
        contract: order.contract,
        status: order.status,
        totalSize,
        filledSize,
        leftSize,
        fillPrice,
        price: Number.parseFloat(order.price || "0"),
        createdAt: order.createTime,
        finishedAt: order.finishTime,
        isFullyFilled: leftSize === 0,
        fillPercentage: totalSize > 0 ? (filledSize / totalSize * 100).toFixed(2) : "0",
        message: `订单 ${orderId} 状态: ${order.status}, 已成交 ${filledSize}/${totalSize} 张 (${totalSize > 0 ? (filledSize / totalSize * 100).toFixed(1) : '0'}%), 成交价 ${fillPrice}`,
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

/**
 * 计算风险敞口工具
 */
export const createCalculateRiskTool = (backendClient: GateApiLocal) => createTool({
  name: "calculateRisk",
  description: "计算当前账户的风险敞口和仓位情况",
  parameters: z.object({}),
  execute: async () => {
    try {
      // 使用 backend-base API 获取账户和持仓数据
      const [accountResult, positionsResult] = await Promise.all([
        backendClient.futures.listFuturesAccounts('usdt'),
        backendClient.futures.listPositions('usdt'),
      ]);

      const account = accountResult.body;
      const positions = positionsResult.body || [];

      // 从响应中解析数据
      const unrealisedPnl = Number.parseFloat(account.unrealisedPnl || "0");
      const totalBalance = Number.parseFloat(account.total || "0") - unrealisedPnl;
      const availableBalance = Number.parseFloat(account.available || "0");

      // 计算每个持仓的风险
      const activePositions = positions.filter((p: any) => Number.parseInt(p.size || "0") !== 0);

      const positionRisks = activePositions.map((p: any) => {
        const size = Math.abs(Number.parseFloat(p.size || "0"));
        const entryPrice = Number.parseFloat(p.entryPrice || "0");
        const leverage = Number.parseInt(p.leverage || "1");
        const liquidationPrice = Number.parseFloat(p.liqPrice || "0");
        const currentPrice = Number.parseFloat(p.markPrice || "0");
        const pnl = Number.parseFloat(p.unrealisedPnl || "0");

        // 使用默认合约乘数 0.01
        const quantoMultiplier = 0.01;

        // 正确计算名义价值：张数 × 入场价格 × 合约乘数
        const notionalValue = size * entryPrice * quantoMultiplier;
        const margin = Number.parseFloat(p.margin || notionalValue / leverage);

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
      });

      const totalNotional = positionRisks.reduce((sum: number, p: any) => sum + p.notionalValue, 0);
      const totalMargin = positionRisks.reduce((sum: number, p: any) => sum + p.margin, 0);
      const usedMarginPercent = totalBalance > 0 ? (totalMargin / totalBalance) * 100 : 0;

      // TODO: 从 backend-base 获取初始资金，暂时使用默认值
      const initialBalance = 10000;
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

/**
 * 同步持仓到数据库工具
 * 注意：由于现在持仓数据直接从 backend-base 获取，这个工具已废弃
 * 保留接口以兼容性，但实际不再执行同步操作
 */
export const createSyncPositionsTool = (backendClient: GateApiLocal) => createTool({
  name: "syncPositions",
  description: "同步交易所持仓数据到本地数据库（已废弃，持仓数据现在直接从 backend-base 获取）",
  parameters: z.object({}),
  execute: async () => {
    try {
      // 现在持仓数据直接从 backend-base 获取，无需同步
      // 只是为了验证连接是否正常
      await backendClient.futures.listPositions('usdt');

      return {
        success: true,
        syncedCount: 0,
        message: "持仓数据现在直接从 backend-base 获取，无需同步",
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
        message: `连接 backend-base 失败: ${error.message}`,
      };
    }
  },
});
