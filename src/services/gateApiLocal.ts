import crypto from 'node:crypto';
import querystring from 'node:querystring';
import { createLogger } from "../utils/logger";

const logger = createLogger("xxx", "info");

export class GateApiLocal {
  private basePath: string;
  private apiKey: string;
  private apiSecret: string;
  private defaultHeaders: any = {};

  constructor(apiKey: string, apiSecret: string, basePath: string) {
    this.apiKey = apiKey.trim();
    this.apiSecret = apiSecret.trim();
    this.basePath = basePath;
    this.defaultHeaders['X-Gate-Size-Decimal'] = '1';
  }

  private toCamelCase(obj: any): any {
    if (Array.isArray(obj)) {
      return obj.map(v => this.toCamelCase(v));
    } else if (obj !== null && typeof obj === 'object') {
      return Object.keys(obj).reduce((result, key) => {
        const camelKey = key.replace(/_([a-z])/g, (g) => g[1].toUpperCase());
        result[camelKey] = this.toCamelCase(obj[key]);
        return result;
      }, {} as any);
    }
    return obj;
  }

  private toSnakeCase(obj: any): any {
    if (Array.isArray(obj)) {
      return obj.map(v => this.toSnakeCase(v));
    } else if (obj !== null && typeof obj === 'object') {
      return Object.keys(obj).reduce((result, key) => {
        const snakeKey = key.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
        result[snakeKey] = this.toSnakeCase(obj[key]);
        return result;
      }, {} as any);
    }
    return obj;
  }

  public setBasePath(path: string) {
    this.basePath = path;
  }

  public setApiKeySecret(key: string, secret: string) {
    this.apiKey = key;
    this.apiSecret = secret;
  }

  private async request(method: string, path: string, query: any = {}, body: any = null): Promise<{ response: any; body: any }> {
    const url = new URL(this.basePath + path);
    
    // Filter undefined query params
    const filteredQuery: any = {};
    for (const key in query) {
      if (query[key] !== undefined && query[key] !== null) {
        filteredQuery[key] = query[key];
      }
    }
    
    // Append query to URL
    Object.keys(filteredQuery).forEach(key => url.searchParams.append(key, filteredQuery[key]));

    const timestamp = (Date.now() / 1000).toString();
    const resourcePath = '/api/v4' + path; // Assuming basePath ends with /api/v4, but we need the path relative to domain?
    // Wait, basePath is "https://api.gateio.ws/api/v4".
    // The signature requires the path part.
    // If basePath includes /api/v4, then path passed to this method (e.g. /futures/usdt/tickers) makes the full path /api/v4/futures/usdt/tickers.
    // Let's verify how GateApiV4Auth does it.
    // const resourcePath: string = new URL(config.url as string).pathname;
    // So it takes the pathname from the full URL.
    
    const fullUrl = url.toString();
    const parsedUrl = new URL(fullUrl);
    const signatureResourcePath = parsedUrl.pathname; // This should be /api/v4/futures/...

    const queryString = unescape(querystring.stringify(filteredQuery));
    
    let bodyParam = '';
    if (body) {
      const snakeBody = this.toSnakeCase(body);
      if (typeof snakeBody === 'string') {
        bodyParam = snakeBody;
      } else {
        bodyParam = JSON.stringify(snakeBody);
      }
    }

    const hashedPayload = crypto.createHash('sha512').update(bodyParam).digest('hex');
    const signatureString = [method, signatureResourcePath, queryString, hashedPayload, timestamp].join('\n');
    // console.log('Signature String:', JSON.stringify(signatureString));
    const signature = crypto.createHmac('sha512', this.apiSecret).update(signatureString).digest('hex');

    const headers: any = {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      'KEY': this.apiKey,
      'Timestamp': timestamp,
      'SIGN': signature,
      ...this.defaultHeaders
    };
    // console.log('Headers:', JSON.stringify(headers));

    const options: RequestInit = {
      method: method,
      headers: headers,
      body: body ? bodyParam : undefined
    };

    try {
      const response = await fetch(fullUrl, options);
      const responseBody = await response.text();
      
      let parsedBody;
      try {
        parsedBody = JSON.parse(responseBody);
      } catch (e) {
        parsedBody = responseBody;
      }

      if (!response.ok) {
        // Mimic Axios error structure for compatibility
        const error: any = new Error(`Request failed with status ${response.status}`);
        error.response = {
          status: response.status,
          statusText: response.statusText,
          data: parsedBody,
          body: parsedBody // GateClient checks body or data
        };
        throw error;
      }

      return {
        response: {
          status: response.status,
          statusText: response.statusText,
          data: parsedBody
        },
        body: this.toCamelCase(parsedBody)
      };
    } catch (error: any) {
      if (error.response) {
        throw error;
      }
      // Network error or other
      const wrappedError: any = new Error(error.message);
      wrappedError.response = {
        status: 0,
        statusText: "Network Error",
        data: null
      };
      throw wrappedError;
    }
  }

  // Futures API methods
  public futures = {
    listFuturesTickers: (settle: string, opts: { contract?: string } = {}) => 
      this.request('GET', `/futures/${settle}/tickers`, opts),

    listFuturesCandlesticks: (settle: string, contract: string, opts: any = {}) => 
      this.request('GET', `/futures/${settle}/candlesticks`, { contract, ...opts }),

    listFuturesAccounts: (settle: string) => 
      this.request('GET', `/futures/${settle}/accounts`),

    listPositions: (settle: string, opts: any = {}) => 
      this.request('GET', `/futures/${settle}/positions`, opts),

    createFuturesOrder: (settle: string, order: any) => 
      this.request('POST', `/futures/${settle}/orders`, {}, order),

    getFuturesOrder: (settle: string, orderId: string) => 
      this.request('GET', `/futures/${settle}/orders/${orderId}`),

    cancelFuturesOrder: (settle: string, orderId: string) => 
      this.request('DELETE', `/futures/${settle}/orders/${orderId}`),

    listFuturesOrders: (settle: string, status: string, opts: any = {}) => 
      this.request('GET', `/futures/${settle}/orders`, { status, ...opts }),

    updatePositionLeverage: (settle: string, contract: string, leverage: string) => 
      this.request('POST', `/futures/${settle}/positions/${contract}/leverage`, { leverage }),

    listFuturesFundingRateHistory: (settle: string, contract: string, opts: any = {}) => 
      this.request('GET', `/futures/${settle}/funding_rate`, { contract, ...opts }),

    getFuturesContract: (settle: string, contract: string) => 
      this.request('GET', `/futures/${settle}/contracts/${contract}`),

    listFuturesOrderBook: (settle: string, contract: string, opts: any = {}) => 
      this.request('GET', `/futures/${settle}/order_book`, { contract, ...opts }),

    getMyFuturesTrades: (settle: string, opts: any = {}) => 
      this.request('GET', `/futures/${settle}/my_trades`, opts),

    listFuturesLiquidatedOrders: (settle: string, opts: any = {}) => 
      this.request('GET', `/futures/${settle}/liq_orders`, opts),

    listFuturesSettlementHistory: (settle: string, opts: any = {}) => 
      this.request('GET', `/futures/${settle}/settlements`, opts), // Assuming this endpoint

    // Backend API methods for Engine Management
    getQuantRunningEngines: () => 
      this.request('GET', `/quant/engines/running`),

    getQuantEngineConfig: (id: number) => 
      this.request('GET', `/quant/engines/${id}`),
  };
}
