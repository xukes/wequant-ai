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
 * API Client Wrapper
 */
// @ts-ignore - gate-api type definitions might be incomplete
// import * as GateApi from "gate-api";
import { GateApiLocal } from "./gateApiLocal";
import { createLogger } from "../utils/logger";
import { RISK_PARAMS } from "../config/riskParams";

const logger = createLogger("gate-client", "info");

export class GateClient {
  public readonly client: GateApiLocal;
  private readonly futuresApi: any;

  // private readonly spotApi: any;
  private readonly settle = "usdt"; // Use USDT settlement

  constructor(apiKey: string, apiSecret: string, baseUrl: string) {
    // @ts-ignore
    this.client = new GateApiLocal(apiKey, apiSecret, baseUrl);
    // @ts-ignore
    this.futuresApi = this.client.futures;
  }

  /**
   * Get futures ticker price (with retry mechanism)
   */
  async getFuturesTicker(contract: string, retries: number = 2) {
    let lastError: any;
    
    for (let i = 0; i <= retries; i++) {
      try {
        const result = await this.futuresApi.listFuturesTickers(this.settle, {
          contract,
        });
            
        return result.body[0];
      } catch (error) {
        lastError = error;
        if (i < retries) {
          logger.warn(`Failed to get ${contract} price, retry ${i + 1}/${retries}...`);
          await new Promise(resolve => setTimeout(resolve, 300 * (i + 1))); // Incremental delay
        }
      }
    }
    
    logger.error(`Failed to get ${contract} price after ${retries} retries:`, lastError);
    throw lastError;
  }

  /**
   * Get futures candlestick data (with retry mechanism)
   */
  async getFuturesCandles(
    contract: string,
    interval: string = "5m",
    limit: number = 100,
    retries: number = 2
  ) {
    let lastError: any;
    
    for (let i = 0; i <= retries; i++) {
      try {
        const result = await this.futuresApi.listFuturesCandlesticks(
          this.settle,
          contract,
          {
            interval: interval as any,
            limit,
          }
        );
        return result.body;
      } catch (error) {
        lastError = error;
        if (i < retries) {
          logger.warn(`Failed to get ${contract} candlestick data, retry ${i + 1}/${retries}...`);
          await new Promise(resolve => setTimeout(resolve, 300 * (i + 1))); // Incremental delay
        }
      }
    }
    
    logger.error(`Failed to get ${contract} candlestick data after ${retries} retries:`, lastError);
    throw lastError;
  }

  /**
   * Get account balance (with retry mechanism)
   */
  async getFuturesAccount(retries: number = 2) {
    let lastError: any;
    
    for (let i = 0; i <= retries; i++) {
      try {
        const result = await this.futuresApi.listFuturesAccounts(this.settle);
        return result.body;
      } catch (error) {
        lastError = error;
        if (i < retries) {
          logger.warn(`Failed to get account balance, retry ${i + 1}/${retries}...`);
          await new Promise(resolve => setTimeout(resolve, 300 * (i + 1))); // Incremental delay
        }
      }
    }
    
    logger.error(`Failed to get account balance after ${retries} retries:`, lastError);
    throw lastError;
  }

  /**
   * Get current positions (with retry mechanism, only returns allowed symbols)
   * Note: position mode parameter needs to be specified
   */
  async getPositions(retries: number = 2) {
    let lastError: any;
    
    for (let i = 0; i <= retries; i++) {
      try {
        // API call listPositions
        // Note: Not passing the second parameter means querying positions in all modes
        const result = await this.futuresApi.listPositions(this.settle);
        const allPositions = result.body;
        
        // Filter: Only keep allowed symbols
        const allowedSymbols = RISK_PARAMS.TRADING_SYMBOLS;
        const filteredPositions = allPositions?.filter((p: any) => {
          // Extract symbol name (e.g., "BTC") from contract (e.g., "BTC_USDT")
          const symbol = p.contract?.split('_')[0];
          return symbol && allowedSymbols.includes(symbol);
        }) || [];
        
        // Optimize logs: Only record key information
        logger.info(`Positions fetched (API returned ${allPositions?.length || 0}, filtered ${filteredPositions.length})`);
        
        // Only record detailed information for active positions (size != 0)
        const activePositions = filteredPositions.filter((p: any) => p.size && p.size !== 0);
        if (activePositions.length > 0) {
          logger.info(`Active positions: ${activePositions.map((p: any) => 
            `${p.contract}(${p.size > 0 ? 'Long' : 'Short'} ${Math.abs(p.size)} @${p.entryPrice})`
          ).join(', ')}`);
        }
        
        return filteredPositions;
      } catch (error) {
        lastError = error;
        if (i < retries) {
          logger.warn(`Failed to get positions, retry ${i + 1}/${retries}...`);
          await new Promise(resolve => setTimeout(resolve, 300 * (i + 1))); // Incremental delay
        }
      }
    }
    
    logger.error(`Failed to get positions after ${retries} retries:`, lastError);
    throw lastError;
  }

  /**
   * Place Order - Open or Close Position
   */
  async placeOrder(params: {
    contract: string;
    size: number;
    price?: number;
    tif?: string;
    reduceOnly?: boolean;
    autoSize?: string;
    stopLoss?: number;
    takeProfit?: number;
  }) {
    // Validate and adjust size (defined outside try to be used in catch)
    let adjustedSize = params.size;
    
    try {
      // Get contract info to validate size
      const contractInfo = await this.getContractInfo(params.contract);
      
      const absSize = Math.abs(params.size);
      
      // API single order size limit (based on error message)
      const API_MAX_SIZE = 10000000;
      
      // Check minimum size limit (using camelCase)
      if (contractInfo.orderSizeMin && absSize < contractInfo.orderSizeMin) {
        logger.warn(`Order size ${absSize} below minimum ${contractInfo.orderSizeMin}, adjusted to minimum`);
        adjustedSize = params.size > 0 ? contractInfo.orderSizeMin : -contractInfo.orderSizeMin;
      }
      
      // Check maximum size limit (use smaller of contract limit and API limit)
      const maxSize = contractInfo.orderSizeMax 
        ? Math.min(contractInfo.orderSizeMax, API_MAX_SIZE)
        : API_MAX_SIZE;
        
      if (absSize > maxSize) {
        logger.warn(`Order size ${absSize} exceeds maximum ${maxSize}, adjusted to maximum`);
        adjustedSize = params.size > 0 ? maxSize : -maxSize;
      }

      // Validate price deviation (for limit orders)
      let adjustedPrice = params.price;
      if (params.price && params.price > 0) {
        // Get current mark price
        const ticker = await this.getFuturesTicker(params.contract);
        const markPrice = Number.parseFloat(ticker.markPrice || ticker.last || "0");
        
        if (markPrice > 0) {
          const priceDeviation = Math.abs(params.price - markPrice) / markPrice;
          const maxDeviation = 0.015; // 1.5% limit, leave some buffer (API limit is 2%)
          
          if (priceDeviation > maxDeviation) {
            // Adjust price to allowed range (leave 0.5% buffer)
            if (params.size > 0) {
              // Buy order: price cannot be too high
              adjustedPrice = markPrice * (1 + maxDeviation);
            } else {
              // Sell order: price cannot be too low
              adjustedPrice = markPrice * (1 - maxDeviation);
            }
            logger.warn(
              `Order price ${params.price.toFixed(6)} deviates from mark price ${markPrice} by more than ${maxDeviation * 100}%, adjusted to ${adjustedPrice.toFixed(6)}`
            );
          }
        }
      }

      // Format price, ensure precision limit is not exceeded
      // API requires price precision not to exceed 12 decimal places
      // Note: price: "0" means market order
      const formatPrice = (price: number | undefined): string => {
        if (!price || price === 0) return "0";  // Market order
        
        // Round to 8 decimal places first to avoid floating point precision issues
        const roundedPrice = Math.round(price * 100000000) / 100000000;
        
        // Convert to string
        let priceStr = roundedPrice.toString();
        
        // If contains decimal point, remove trailing zeros
        if (priceStr.includes('.')) {
          priceStr = priceStr.replace(/\.?0+$/, "");
        }
        
        return priceStr;
      };

      // Use FuturesOrder type structure
      // Note: gate-api SDK uses camelCase, automatically converts to snake_case
      const order: any = {
        contract: params.contract,
        size: adjustedSize,
        price: formatPrice(adjustedPrice), // Market order pass "0"
      };
      
      // Set tif based on order type
      const formattedPrice = formatPrice(adjustedPrice);
      if (formattedPrice !== "0") {
        // Limit order: set tif to GTC (Good Till Cancel)
        order.tif = params.tif || "gtc";
      } else {
        // Market order: must set IOC (Immediate or Cancel) or FOK (Fill or Kill)
        // API requires market orders to specify IOC or FOK
        order.tif = "ioc"; // Immediate or Cancel
      }

      // SDK uses camelCase: isReduceOnly -> is_reduce_only, isClose -> is_close
      if (params.reduceOnly === true) {
        order.isReduceOnly = true;
        order.isClose = true;
      }

      // camelCase: autoSize -> auto_size
      if (params.autoSize !== undefined) {
        order.autoSize = params.autoSize;
      }

      // Stop loss and take profit parameters (if provided)
      if (params.stopLoss !== undefined && params.stopLoss > 0) {
        order.stopLoss = params.stopLoss.toString();
        logger.info(`Stop loss set: ${params.stopLoss}`);
      }
      
      if (params.takeProfit !== undefined && params.takeProfit > 0) {
        order.takeProfit = params.takeProfit.toString();
        logger.info(`Take profit set: ${params.takeProfit}`);
      }

      logger.info(`Placing order: ${JSON.stringify(order)}`);
      const result = await this.futuresApi.createFuturesOrder(
        this.settle,
        order
      );
      return result.body;
    } catch (error: any) {
      // Get detailed API error information
      const errorDetails = {
        message: error.message,
        status: error.response?.status,
        statusText: error.response?.statusText,
        apiError: error.response?.body || error.response?.data,
      };
      logger.error(errorDetails, "Order failed:");
      
      // Special handling for insufficient funds
      if (errorDetails.apiError?.label === "INSUFFICIENT_AVAILABLE") {
        const msg = errorDetails.apiError.message || "Insufficient available margin";
        throw new Error(`Insufficient funds to open position ${params.contract}: ${msg}`);
      }
      
      // Throw more detailed error message
      const detailedMessage = errorDetails.apiError?.message || errorDetails.apiError?.label || error.message;
      throw new Error(`Order failed: ${detailedMessage} (${params.contract}, size: ${adjustedSize})`);
    }
  }

  /**
   * Get order details
   */
  async getOrder(orderId: string) {
    try {
      const result = await this.futuresApi.getFuturesOrder(this.settle, orderId);
      return result.body;
    } catch (error) {
      logger.error(`Failed to get order ${orderId} details:`, error as any);
      throw error;
    }
  }

  /**
   * Cancel order
   */
  async cancelOrder(orderId: string) {
    try {
      const result = await this.futuresApi.cancelFuturesOrder(
        this.settle,
        orderId
      );
      return result.body;
    } catch (error) {
      logger.error(`Failed to cancel order ${orderId}:`, error as any);
      throw error;
    }
  }

  /**
   * Get open orders
   */
  async getOpenOrders(contract?: string) {
    try {
      const result = await this.futuresApi.listFuturesOrders(this.settle, "open", {
        contract,
      });
      return result.body;
    } catch (error) {
      logger.error("Failed to get open orders:", error as any);
      throw error;
    }
  }

  /**
   * Set position leverage
   */
  async setLeverage(contract: string, leverage: number) {
    try {
      logger.info(`Setting ${contract} leverage to ${leverage}x`);
      const result = await this.futuresApi.updatePositionLeverage(
        this.settle,
        contract,
        leverage.toString()
      );
      return result.body;
    } catch (error: any) {
      // If there are existing positions, some exchanges do not allow leverage modification, this is normal
      // Log warning but do not throw error, allow trading to continue
      logger.warn(`Failed to set ${contract} leverage (might have existing positions):`, error.message);
      return null;
    }
  }

  /**
   * Get funding rate
   */
  async getFundingRate(contract: string) {
    try {
      const result = await this.futuresApi.listFuturesFundingRateHistory(
        this.settle,
        contract,
        { limit: 1 }
      );
      return result.body[0];
    } catch (error) {
      logger.error(`Failed to get ${contract} funding rate:`, error as any);
      throw error;
    }
  }

  /**
   * Get contract info (including open interest, etc.)
   */
  async getContractInfo(contract: string) {
    try {
      const result = await this.futuresApi.getFuturesContract(
        this.settle,
        contract
      );
      return result.body;
    } catch (error) {
      logger.error(`Failed to get ${contract} contract info:`, error as any);
      throw error;
    }
  }

  /**
   * Get order book
   */
  async getOrderBook(contract: string, limit: number = 10) {
    try {
      const result = await this.futuresApi.listFuturesOrderBook(
        this.settle,
        contract,
        { limit }
      );
      return result.body;
    } catch (error) {
      logger.error(`Failed to get ${contract} order book:`, error as any);
      throw error;
    }
  }

  /**
   * Get historical trade records (my trades)
   * For analyzing recent trading history and profit and loss
   * @param contract Contract name (optional, leave blank to get all contracts)
   * @param limit Number of records to return, default 10
   */
  async getMyTrades(contract?: string, limit: number = 10) {
    try {
      const options: any = { limit };
      if (contract) {
        options.contract = contract;
      }
      
      // API: use getMyFuturesTrades method
      // Note: SDK method name might be getMyFuturesTrades instead of listMyTrades
      const result = await this.futuresApi.getMyFuturesTrades(
        this.settle,
        options
      );
      return result.body;
    } catch (error) {
      logger.error(`Failed to get my trade history:`, error as any);
      throw error;
    }
  }

  /**
   * Get historical position records (settlement records of closed positions)
   * @param contract Contract name (optional, leave blank to get all contracts)
   * @param limit Number of records to return, default 100
   * @param offset Offset, default 0, for pagination
   */
  async getPositionHistory(contract?: string, limit: number = 100, offset: number = 0) {
    try {
      const options: any = { limit, offset };
      if (contract) {
        options.contract = contract;
      }
      
      // API: use listFuturesLiquidatedOrders method to get liquidated positions
      // Note: this method returns the history of liquidated (closed) positions
      const result = await this.futuresApi.listFuturesLiquidatedOrders(
        this.settle,
        options
      );
      return result.body;
    } catch (error) {
      logger.error(`Failed to get position history:`, error as any);
      throw error;
    }
  }

  /**
   * Get historical settlement records (more detailed historical position information)
   * @param contract Contract name (optional, leave blank to get all contracts)
   * @param limit Number of records to return, default 100
   * @param offset Offset, default 0, for pagination
   */
  async getSettlementHistory(contract?: string, limit: number = 100, offset: number = 0) {
    try {
      const options: any = { limit, offset };
      if (contract) {
        options.contract = contract;
      }
      
      // API: use listFuturesSettlementHistory method to get settlement history
      const result = await this.futuresApi.listFuturesSettlementHistory(
        this.settle,
        options
      );
      return result.body;
    } catch (error) {
      logger.error(`Failed to get settlement history:`, error as any);
      throw error;
    }
  }

  /**
   * Get completed order history
   * @param contract Contract name (optional)
   * @param limit Number of records to return, default 10
   */
  async getOrderHistory(contract?: string, limit: number = 10) {
    try {
      const options: any = { limit };
      if (contract) {
        options.contract = contract;
      }
      
      const result = await this.futuresApi.listFuturesOrders(
        this.settle,
        "finished",
        options
      );
      return result.body;
    } catch (error) {
      logger.error(`Failed to get order history:`, error as any);
      throw error;
    }
  }

  /**
   * Place futures order (wrapper for placeOrder to match tool expectations)
   */
  async placeFuturesOrder(
    contract: string,
    size: number,
    price: number = 0,
    options: { tif?: string; reduce_only?: boolean; auto_size?: string } = {}
  ) {
    return this.placeOrder({
      contract,
      size,
      price,
      tif: options.tif,
      reduceOnly: options.reduce_only,
      autoSize: options.auto_size,
    });
  }

  /**
   * Place price triggered order (Stop Loss / Take Profit)
   */
  async placePriceTriggerOrder(
    contract: string,
    triggerPrice: number,
    rule: "up" | "down",
    orderPrice: number = 0,
    orderSize: number = 0,
    options: { close_position?: boolean } = {}
  ) {
    try {
      // Gate API rule: 1 for >= (up), 2 for <= (down)
      const ruleId = rule === "up" ? 1 : 2;
      
      const triggerOrder = {
        initial: {
          contract,
          size: 0, 
          price: "0",
        },
        trigger: {
          strategy_type: 0, // 0: price trigger
          price_type: 0, // 0: last price, 1: mark price, 2: index price
          price: triggerPrice.toString(),
          rule: ruleId,
          expiration: 86400 * 30, // 30 days
        },
        order: {
          contract,
          size: orderSize, 
          price: orderPrice === 0 ? "0" : orderPrice.toString(),
          tif: "ioc", 
          is_close: options.close_position,
        }
      };

      const result = await this.futuresApi.createFuturesPriceTriggeredOrder(
        this.settle,
        triggerOrder
      );
      return { id: result.body.id }; 
    } catch (error: any) {
       logger.error(`Failed to place trigger order:`, error);
       throw error;
    }
  }

  /**
   * Cancel all futures orders for a contract
   */
  async cancelAllFuturesOrders(contract: string) {
    try {
      const result = await this.futuresApi.cancelFuturesOrders(
        this.settle,
        contract,
        {}
      );
      return result.body;
    } catch (error: any) {
      logger.error(`Failed to cancel all orders for ${contract}:`, error);
      throw error;
    }
  }
}

/**
 * Global GATE client instance (Singleton pattern)
 */
let gateClientInstance: GateClient | null = null;

/**
 * Create global GATE client instance (Singleton pattern)
 */
export function createGateClient(apiKey: string, apiSecret: string) {
  if (!apiKey || !apiSecret) {
    throw new Error("Gate API Key/Secret is required");
  }
  
  return new GateClient(apiKey, apiSecret, process.env.BACKEND_API_URL || "");
}
