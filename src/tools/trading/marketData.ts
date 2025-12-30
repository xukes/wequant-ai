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
 * 市场数据工具
 */
import { createTool } from "@voltagent/core";
import { z } from "zod";
import { GateClient } from "../../services/gateClient";
import { RISK_PARAMS } from "../../config/riskParams";
import { calculateIndicators, ensureFinite } from "../../utils/indicators";

/**
 * 获取市场价格工具
 */
export const createGetMarketPriceTool = (gateClient: GateClient) => createTool({
  name: "getMarketPrice",
  description: "获取指定加密货币的当前市场价格",
  parameters: z.object({
    symbol: z.enum(RISK_PARAMS.TRADING_SYMBOLS as [string, ...string[]]).describe("币种代码，例如 BTC, ETH"),
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

/**
 * 获取技术指标工具
 */
export const createGetTechnicalIndicatorsTool = (gateClient: GateClient) => createTool({
  name: "getTechnicalIndicators",
  description: "获取指定币种的技术指标 (RSI, MACD, Bollinger Bands, MA)",
  parameters: z.object({
    symbol: z.enum(RISK_PARAMS.TRADING_SYMBOLS as [string, ...string[]]).describe("币种代码"),
    interval: z.enum(["1m", "5m", "15m", "1h", "4h"]).default("5m").describe("K线周期"),
    limit: z.number().default(100).describe("K线数量"),
  }),
  execute: async ({ symbol, interval, limit }) => {
    try {
      const contract = `${symbol}_USDT`;
      const candles = await gateClient.getFuturesCandles(contract, interval, limit);
      
      // Gate.io returns: [t, v, c, h, l, o] (time, volume, close, high, low, open)
      // We need to sort by time ascending for calculation
      const sortedCandles = candles.sort((a: any, b: any) => a.t - b.t);
      
      const indicators = calculateIndicators(sortedCandles);
      
      return {
        symbol,
        interval,
        currentPrice: indicators.currentPrice,
        indicators: {
          rsi: ensureFinite(indicators.rsi14),
          macd: {
            value: ensureFinite(indicators.macd),
            signal: 0, // Not available
            histogram: 0, // Not available
          },
          bollinger: {
            upper: 0, // Not available
            middle: 0, // Not available
            lower: 0, // Not available
          },
          ma7: 0, // Not available
          ma25: ensureFinite(indicators.ema20),
          ma99: ensureFinite(indicators.ema50),
          atr: 0, // Not available
        },
        timestamp: new Date().toISOString(),
      };
    } catch (error: any) {
      return { error: `获取指标失败: ${error.message}` };
    }
  },
});

/**
 * 获取资金费率工具
 */
export const createGetFundingRateTool = (gateClient: GateClient) => createTool({
  name: "getFundingRate",
  description: "获取指定币种的资金费率",
  parameters: z.object({
    symbol: z.enum(RISK_PARAMS.TRADING_SYMBOLS as [string, ...string[]]).describe("币种代码"),
  }),
  execute: async ({ symbol }) => {
    try {
      const rate = await gateClient.getFundingRate(`${symbol}_USDT`);
      return {
        symbol,
        rate: Number.parseFloat(rate.r || "0"),
        predictedRate: Number.parseFloat(rate.r_indicative || "0"),
        nextFundingTime: new Date((rate.t || 0) * 1000).toISOString(),
      };
    } catch (error: any) {
      return { error: `获取资金费率失败: ${error.message}` };
    }
  },
});

/**
 * 获取订单簿工具
 */
export const createGetOrderBookTool = (gateClient: GateClient) => createTool({
  name: "getOrderBook",
  description: "获取指定币种的订单簿深度",
  parameters: z.object({
    symbol: z.enum(RISK_PARAMS.TRADING_SYMBOLS as [string, ...string[]]).describe("币种代码"),
    limit: z.number().min(1).max(50).default(10).describe("深度数量"),
  }),
  execute: async ({ symbol, limit }) => {
    try {
      const book = await gateClient.getOrderBook(`${symbol}_USDT`, limit);
      return {
        symbol,
        asks: book.asks.map((a: any) => ({ price: Number.parseFloat(a.p), size: Number.parseFloat(a.s) })),
        bids: book.bids.map((b: any) => ({ price: Number.parseFloat(b.p), size: Number.parseFloat(b.s) })),
        timestamp: new Date(book.t || Date.now()).toISOString(),
      };
    } catch (error: any) {
      return { error: `获取订单簿失败: ${error.message}` };
    }
  },
});

/**
 * 获取持仓量工具
 */
export const createGetOpenInterestTool = (gateClient: GateClient) => createTool({
  name: "getOpenInterest",
  description: "获取指定币种的未平仓合约数量 (Open Interest)",
  parameters: z.object({
    symbol: z.enum(RISK_PARAMS.TRADING_SYMBOLS as [string, ...string[]]).describe("币种代码"),
  }),
  execute: async ({ symbol }) => {
    try {
      const contractInfo = await gateClient.getContractInfo(`${symbol}_USDT`);
      return {
        symbol,
        openInterest: contractInfo.open_interest || "unknown",
        volume24h: contractInfo.volume_24h || "unknown",
        turnover24h: contractInfo.turnover_24h || "unknown",
      };
    } catch (error: any) {
      return { error: `获取持仓量失败: ${error.message}` };
    }
  },
});

