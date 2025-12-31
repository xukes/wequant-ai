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
import { GateApiLocal } from "../../services/gateApiLocal";
import {
  createGetAccountBalanceTool,
  createGetPositionsTool
} from "./accountManagement";
import {
  createGetMarketPriceTool,
  createGetTechnicalIndicatorsTool,
  createGetFundingRateTool,
  createGetOrderBookTool,
  createGetOpenInterestTool
} from "./marketData";
import {
  createOpenPositionTool,
  createClosePositionTool,
  createSetStopLossTakeProfitTool,
  createCancelAllOrdersTool
} from "./tradeExecution";

/**
 * 创建所有交易工具实例
 * @param gateClient GateClient 实例（用于 Gate.io 交易）
 * @param backendClient Backend-base API 客户端（用于账户和持仓查询）
 * @returns 工具列表
 */
export function createTradingTools(gateClient: GateClient, backendClient: GateApiLocal) {
  return [
    // 账户管理（使用 backendClient）
    createGetAccountBalanceTool(backendClient),
    createGetPositionsTool(backendClient),

    // 市场数据（使用 gateClient）
    createGetMarketPriceTool(gateClient),
    createGetTechnicalIndicatorsTool(gateClient),
    createGetFundingRateTool(gateClient),
    createGetOrderBookTool(gateClient),
    createGetOpenInterestTool(gateClient),

    // 交易执行（使用 gateClient）
    createOpenPositionTool(gateClient),
    createClosePositionTool(gateClient),
    createSetStopLossTakeProfitTool(gateClient),
    createCancelAllOrdersTool(gateClient),
  ];
}
