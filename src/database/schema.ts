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

export interface QuantEngine {
  id: number;
  name: string;
  description?: string;
  api_key: string;
  api_secret: string;
  model_name: string;
  strategy: string;
  risk_params: string; // JSON string
  status: 'running' | 'stopped' | 'error';
  last_run_at?: string;
  created_at: string;
  updated_at: string;
}

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
 * 注意：
 * - positions 表已废弃，数据现在存储在 backend-base 的 user_position 表中
 * - trades 表已废弃，交易记录现在存储在 backend-base 的 user_position_finish 表中
 */
export const CREATE_TABLES_SQL = `
-- 量化引擎配置表 (新增)
CREATE TABLE IF NOT EXISTS quant_engines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT,
  api_key TEXT NOT NULL,
  api_secret TEXT NOT NULL,
  model_name TEXT DEFAULT 'deepseek/deepseek-v3.2-exp',
  strategy TEXT DEFAULT 'balanced',
  risk_params TEXT, -- JSON 格式存储个性化风控参数
  status TEXT DEFAULT 'stopped',
  last_run_at TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- 注意：trades 表已废弃
-- 交易记录现在存储在 backend-base 的 user_position_finish 表中

-- 注意：positions 表已废弃
-- 持仓数据现在从 backend-base 的 user_position 表获取

-- 账户历史表
CREATE TABLE IF NOT EXISTS account_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  engine_id INTEGER NOT NULL, -- 关联 quant_engines
  timestamp TEXT NOT NULL,
  total_value REAL NOT NULL,
  available_cash REAL NOT NULL,
  unrealized_pnl REAL NOT NULL,
  realized_pnl REAL NOT NULL,
  return_percent REAL NOT NULL,
  sharpe_ratio REAL,
  FOREIGN KEY (engine_id) REFERENCES quant_engines(id) ON DELETE CASCADE
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
  atr_14 REAL,
  FOREIGN KEY (engine_id) REFERENCES quant_engines(id) ON DELETE CASCADE
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
  positions_count INTEGER NOT NULL,
  FOREIGN KEY (engine_id) REFERENCES quant_engines(id) ON DELETE CASCADE
);

-- 系统配置表 (保留用于全局配置)
CREATE TABLE IF NOT EXISTS system_config (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT NOT NULL UNIQUE,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- 创建索引
CREATE INDEX IF NOT EXISTS idx_signals_timestamp ON trading_signals(timestamp);
CREATE INDEX IF NOT EXISTS idx_signals_engine ON trading_signals(engine_id);
CREATE INDEX IF NOT EXISTS idx_decisions_engine ON agent_decisions(engine_id);
`;

