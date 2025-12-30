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
 * API 路由
 */
import { Hono } from "hono";
import { serveStatic } from "@hono/node-server/serve-static";
import { createClient } from "@libsql/client";
import { createPinoLogger } from "@voltagent/logger";
import { EngineManager } from "../scheduler/EngineManager";

const logger = createPinoLogger({
  name: "api-routes",
  level: "info",
});

const dbClient = createClient({
  url: process.env.DATABASE_URL || "file:./.voltagent/trading.db",
});

export function createApiRoutes() {
  const app = new Hono();
  
  // CORS Middleware
  app.use('*', async (c, next) => {
    c.res.headers.set('Access-Control-Allow-Origin', '*');
    c.res.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    c.res.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (c.req.method === 'OPTIONS') {
      return c.text('', 204);
    }
    await next();
  });

  // Health check endpoint
  app.get("/api/health", (c) => {
    return c.json({ status: "ok" }, 200);
  });

  // ====== Engine Management APIs ======

  // 1. Create a new Quant Engine
  app.post("/api/engines", async (c) => {
    try {
      const body = await c.req.json();
      const { name, apiKey, apiSecret, modelName, strategy, riskParams } = body;

      if (!name || !apiKey || !apiSecret) {
        return c.json({ error: "Missing required fields" }, 400);
      }

      const result = await dbClient.execute({
        sql: `INSERT INTO quant_engines (name, api_key, api_secret, model_name, strategy, risk_params, status)
              VALUES (?, ?, ?, ?, ?, ?, 'stopped') RETURNING id`,
        args: [
          name,
          apiKey,
          apiSecret,
          modelName || "deepseek/deepseek-v3.2-exp",
          strategy || "balanced",
          JSON.stringify(riskParams || {}),
        ],
      });

      const newId = result.rows[0].id;
      return c.json({ success: true, id: newId, message: "Engine created" });
    } catch (error: any) {
      logger.error("Create engine failed:", error);
      return c.json({ error: error.message }, 500);
    }
  });

  // 2. Start an Engine
  app.post("/api/engines/:id/start", async (c) => {
    const id = Number.parseInt(c.req.param("id"));
    try {
      await EngineManager.getInstance().startEngine(id);
      return c.json({ success: true, message: `Engine ${id} started` });
    } catch (error: any) {
      return c.json({ error: error.message }, 500);
    }
  });

  // 3. Stop an Engine
  app.post("/api/engines/:id/stop", async (c) => {
    const id = Number.parseInt(c.req.param("id"));
    try {
      await EngineManager.getInstance().stopEngine(id);
      return c.json({ success: true, message: `Engine ${id} stopped` });
    } catch (error: any) {
      return c.json({ error: error.message }, 500);
    }
  });

  // 3.5 Delete an Engine
  app.delete("/api/engines/:id", async (c) => {
    const id = Number.parseInt(c.req.param("id"));
    try {
      // Ensure stopped
      try {
        await EngineManager.getInstance().stopEngine(id);
      } catch (e) {
        // Ignore error if engine is not running or not found in manager
      }
      
      // Delete related data first (Manual Cascade Delete)
      const tables = ['trades', 'positions', 'account_history', 'trading_signals', 'agent_decisions'];
      for (const table of tables) {
        await dbClient.execute({
          sql: `DELETE FROM ${table} WHERE engine_id = ?`,
          args: [id]
        });
      }

      // Delete from DB
      await dbClient.execute({
        sql: "DELETE FROM quant_engines WHERE id = ?",
        args: [id]
      });
      
      return c.json({ success: true, message: `Engine ${id} deleted` });
    } catch (error: any) {
      return c.json({ error: error.message }, 500);
    }
  });

  // 4. List all Engines
  app.get("/api/engines", async (c) => {
    try {
      const result = await dbClient.execute("SELECT * FROM quant_engines ORDER BY created_at DESC");
      return c.json({ engines: result.rows });
    } catch (error: any) {
      return c.json({ error: error.message }, 500);
    }
  });

  // 5. Get Engine Details (Stats)
  app.get("/api/engines/:id/stats", async (c) => {
    const id = Number.parseInt(c.req.param("id"));
    try {
      // Get latest account history
      const historyResult = await dbClient.execute({
        sql: "SELECT * FROM account_history WHERE engine_id = ? ORDER BY timestamp DESC LIMIT 1",
        args: [id]
      });
      
      // Get positions count and sum unrealized pnl
      const positionsResult = await dbClient.execute({
        sql: "SELECT COUNT(*) as count, SUM(unrealized_pnl) as total_pnl FROM positions WHERE engine_id = ?",
        args: [id]
      });

      return c.json({
        latestHistory: historyResult.rows[0] || null,
        positionsSummary: positionsResult.rows[0] || { count: 0, total_pnl: 0 }
      });
    } catch (error: any) {
      return c.json({ error: error.message }, 500);
    }
  });

  // 6. Get Engine Chart Data (Account History)
  app.get("/api/engines/:id/chart", async (c) => {
    const id = Number.parseInt(c.req.param("id"));
    try {
      const result = await dbClient.execute({
        sql: "SELECT timestamp, total_value, unrealized_pnl FROM account_history WHERE engine_id = ? ORDER BY timestamp ASC",
        args: [id]
      });
      return c.json({ data: result.rows });
    } catch (error: any) {
      return c.json({ error: error.message }, 500);
    }
  });

  // 7. Get Engine Positions
  app.get("/api/engines/:id/positions", async (c) => {
    const id = Number.parseInt(c.req.param("id"));
    try {
      const result = await dbClient.execute({
        sql: "SELECT * FROM positions WHERE engine_id = ? ORDER BY opened_at DESC",
        args: [id]
      });
      return c.json({ data: result.rows });
    } catch (error: any) {
      return c.json({ error: error.message }, 500);
    }
  });

  // 8. Get Engine Trades
  app.get("/api/engines/:id/trades", async (c) => {
    const id = Number.parseInt(c.req.param("id"));
    try {
      const result = await dbClient.execute({
        sql: "SELECT * FROM trades WHERE engine_id = ? ORDER BY timestamp DESC LIMIT 100",
        args: [id]
      });
      return c.json({ data: result.rows });
    } catch (error: any) {
      return c.json({ error: error.message }, 500);
    }
  });

  // 9. Get Engine Decisions (Logs)
  app.get("/api/engines/:id/decisions", async (c) => {
    const id = Number.parseInt(c.req.param("id"));
    try {
      const result = await dbClient.execute({
        sql: "SELECT * FROM agent_decisions WHERE engine_id = ? ORDER BY timestamp DESC LIMIT 50",
        args: [id]
      });
      return c.json({ data: result.rows });
    } catch (error: any) {
      return c.json({ error: error.message }, 500);
    }
  });

  // 静态文件服务已移动到路由末尾，防止拦截 API 请求
  // 静态文件服务 - 需要使用绝对路径 (放在最后)
  app.use("/*", serveStatic({ root: "./public" }));

  return app;
}


function parseActionFromText(text: string) {
  // Simple logic to extract structured command from AI text
  if (text.includes("ACTION: BUY")) return "BUY";
  if (text.includes("ACTION: SELL")) return "SELL";
  return "HOLD";
}
