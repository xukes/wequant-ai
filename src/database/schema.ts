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
 * 数据库模式定义
 */

// QuantEngine table is removed from local DB.
// export interface QuantEngine { ... }

// 注意：Trade 接口已废弃
// 交易记录现在存储在 backend-base 的 user_position_finish 表中

// 注意：Position 接口已废弃
// 持仓数据现在直接从 backend-base 获取，不再在本地定义

export interface AccountHistory {
  id: number;
  engine_id: number; // 新增
  timestamp: string;
  total_value: number;
  available_cash: number;
  unrealized_pnl: number;
  realized_pnl: number;
  return_percent: number;
  sharpe_ratio?: number;
}

export interface TradingSignal {
  id: number;
  engine_id: number; // 新增
  symbol: string;
  timestamp: string;
  price: number;
  ema_20: number;
  ema_50?: number;
  macd: number;
  rsi_7: number;
  rsi_14: number;
  volume: number;
  open_interest?: number;
  funding_rate?: number;
  atr_3?: number;
  atr_14?: number;
}

export interface AgentDecision {
  id: number;
  engine_id: number; // 新增
  timestamp: string;
  iteration: number;
  market_analysis: string;
  decision: string;
  actions_taken: string;
  account_value: number;
  positions_count: number;
}

export interface SystemConfig {
  id: number;
  key: string;
  value: string;
  updated_at: string;
}

/**
 * SQL 建表语句
 */
export const CREATE_TABLES_SQL = `

-- 账户历史记录表 (增加 engine_id)
CREATE TABLE IF NOT EXISTS account_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  engine_id INTEGER NOT NULL, -- 关联 quant_engines
  timestamp TEXT NOT NULL,
  total_value REAL NOT NULL,
  available_cash REAL NOT NULL,
  unrealized_pnl REAL NOT NULL,
  realized_pnl REAL NOT NULL,
  return_percent REAL NOT NULL,
  sharpe_ratio REAL
  -- FOREIGN KEY (engine_id) REFERENCES quant_engines(id) ON DELETE CASCADE -- Removed FK constraint as table is gone
);

-- 技术指标表
CREATE TABLE IF NOT EXISTS trading_signals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  engine_id INTEGER NOT NULL, -- 关联 quant_engines
  symbol TEXT NOT NULL,
  timestamp TEXT NOT NULL,
  price REAL NOT NULL,
  ema_20 REAL NOT NULL,
  ema_50 REAL,
  macd REAL NOT NULL,
  rsi_7 REAL NOT NULL,
  rsi_14 REAL NOT NULL,
  volume REAL NOT NULL,
  open_interest REAL,
  funding_rate REAL,
  atr_3 REAL,
  atr_14 REAL
  -- FOREIGN KEY (engine_id) REFERENCES quant_engines(id) ON DELETE CASCADE -- Removed FK constraint
);

-- Agent 决策记录表
CREATE TABLE IF NOT EXISTS agent_decisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  engine_id INTEGER NOT NULL, -- 关联 quant_engines
  timestamp TEXT NOT NULL,
  iteration INTEGER NOT NULL,
  market_analysis TEXT NOT NULL,
  decision TEXT NOT NULL,
  actions_taken TEXT NOT NULL,
  account_value REAL NOT NULL,
  positions_count INTEGER NOT NULL
  -- FOREIGN KEY (engine_id) REFERENCES quant_engines(id) ON DELETE CASCADE -- Removed FK constraint
);


-- 创建索引
CREATE INDEX IF NOT EXISTS idx_signals_timestamp ON trading_signals(timestamp);
CREATE INDEX IF NOT EXISTS idx_signals_engine ON trading_signals(engine_id);
CREATE INDEX IF NOT EXISTS idx_decisions_engine ON agent_decisions(engine_id);
`;

