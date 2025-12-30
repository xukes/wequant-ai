import { ApiClient, FuturesApi } from 'gate-api';
import dotenv from 'dotenv';

dotenv.config();

async function main() {
  const apiKey = process.env.GATE_API_KEY || '';
  const apiSecret = process.env.GATE_API_SECRET || '';

  if (!apiKey || !apiSecret) {
    console.error('GATE_API_KEY and GATE_API_SECRET must be set in .env');
    return;
  }

  const client = new ApiClient();
  client.setApiKeySecret(apiKey, apiSecret);
  
  const futuresApi = new FuturesApi(client);

  console.log('Testing listFuturesTickers (Old Client)...');
  try {
    const tickers = await futuresApi.listFuturesTickers('usdt');
    console.log('Tickers response status:', tickers.response.status);
  } catch (error: any) {
    console.error('Error listing tickers:', error.message);
  }

  console.log('\nTesting listPositions (Old Client)...');
  try {
    const positions = await futuresApi.listPositions('usdt');
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
