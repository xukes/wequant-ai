import { GateApiLocal } from '../src/services/gateApiLocal';
import dotenv from 'dotenv';

dotenv.config();

async function main() {
  const apiKey = process.env.GATE_API_KEY || '';
  const apiSecret = process.env.GATE_API_SECRET || '';

  console.log('API Key loaded:', apiKey ? `${apiKey.substring(0, 4)}...` : 'No');
  console.log('API Secret loaded:', apiSecret ? 'Yes' : 'No');

  if (!apiKey || !apiSecret) {
    console.error('GATE_API_KEY and GATE_API_SECRET must be set in .env');
    return;
  }

  const client = new GateApiLocal(apiKey, apiSecret);

  console.log('Testing listFuturesTickers...');
  try {
    const tickers = await client.futures.listFuturesTickers('usdt');
    console.log('Tickers response status:', tickers.response.status);
    console.log('First ticker:', tickers.body[0]);
  } catch (error: any) {
    console.error('Error listing tickers:', error.message);
    if (error.response) {
      console.error('Response data:', error.response.data);
    }
  }

  console.log('\nTesting listPositions...');
  try {
    const positions = await client.futures.listPositions('usdt');
    console.log('Positions response status:', positions.response.status);
    console.log('Positions:', positions.body);
  } catch (error: any) {
    console.error('Error listing positions:', error.message);
    if (error.response) {
      console.error('Response data:', error.response.data);
    }
  }
}

main();
