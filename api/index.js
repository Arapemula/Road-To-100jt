import express from 'express';
import cors from 'cors';
import axios from 'axios';
import crypto from 'crypto';
import dotenv from 'dotenv';

dotenv.config();

const app = express();

app.use(cors());
app.use(express.json());

// Helper to generate Bybit API v5 HMAC Signature
function generateBybitSignature(apiKey, apiSecret, timestamp, recvWindow, queryString) {
  const message = timestamp + apiKey + recvWindow + queryString;
  return crypto.createHmac('sha256', apiSecret).update(message).digest('hex');
}

// Route to get USD to IDR conversion rate
app.get('/api/rates', async (req, res) => {
  try {
    const response = await axios.get('https://open.er-api.com/v6/latest/USD');
    const rate = response.data?.rates?.IDR || 16400; // fallback to 16,400 IDR/USD if missing
    res.json({ success: true, rate });
  } catch (error) {
    console.error('Error fetching exchange rates:', error.message);
    res.json({ success: false, rate: 16400, message: 'Using fallback exchange rate' });
  }
});

// Route to check if Bybit API keys are configured on the server side (.env or Vercel env)
app.get('/api/bybit/config', (req, res) => {
  const hasServerKeys = !!(process.env.BYBIT_API_KEY && process.env.BYBIT_API_SECRET);
  res.json({
    success: true,
    hasServerKeys,
    accountTypes: process.env.BYBIT_ACCOUNT_TYPES ? process.env.BYBIT_ACCOUNT_TYPES.split(',') : ['UNIFIED']
  });
});

// Route to fetch Bybit balance securely on the server-side (using Vercel Env)
app.post('/api/bybit/balance', async (req, res) => {
  const apiKey = process.env.BYBIT_API_KEY;
  const apiSecret = process.env.BYBIT_API_SECRET;
  
  if (!apiKey || !apiSecret) {
    return res.status(400).json({ 
      success: false, 
      error: 'Bybit API keys are missing on the server-side environment variables.' 
    });
  }

  // accountTypes defaults to UNIFIED, but can be configured via env
  const accountTypes = process.env.BYBIT_ACCOUNT_TYPES 
    ? process.env.BYBIT_ACCOUNT_TYPES.split(',') 
    : ['UNIFIED'];

  const baseUrl = 'https://api.bybit.com'; // Always Mainnet for Vercel deployment
  const recvWindow = '5000';
  const results = [];
  let totalUsdValue = 0;

  try {
    for (const accountType of accountTypes) {
      const timestamp = Date.now().toString();
      const queryString = `accountType=${accountType}`;
      const signature = generateBybitSignature(apiKey, apiSecret, timestamp, recvWindow, queryString);

      const headers = {
        'X-BAPI-API-KEY': apiKey,
        'X-BAPI-TIMESTAMP': timestamp,
        'X-BAPI-RECV-WINDOW': recvWindow,
        'X-BAPI-SIGN': signature,
      };

      try {
        const response = await axios.get(`${baseUrl}/v5/account/wallet-balance?${queryString}`, { headers });
        const data = response.data;

        if (data.retCode === 0 && data.result?.list) {
          const accountData = data.result.list[0];
          let equity = parseFloat(accountData.totalEquity || accountData.totalWalletBalance || '0');
          
          const coins = (accountData.coin || []).map(c => ({
            coin: c.coin,
            equity: parseFloat(c.equity || '0'),
            usdValue: parseFloat(c.usdValue || '0'),
            walletBalance: parseFloat(c.walletBalance || '0')
          }));

          // If totalEquity is 0 but we have coins, let's sum their usdValue
          if (equity === 0 && coins.length > 0) {
            equity = coins.reduce((sum, c) => sum + c.usdValue, 0);
          }

          totalUsdValue += equity;

          results.push({
            accountType,
            equity,
            coins,
            success: true
          });
        } else {
          results.push({
            accountType,
            success: false,
            error: data.retMsg || `Error code ${data.retCode}`
          });
        }
      } catch (err) {
        console.error(`Error fetching ${accountType} balance:`, err.message);
        results.push({
          accountType,
          success: false,
          error: err.response?.data?.retMsg || err.message
        });
      }
    }

    res.json({
      success: true,
      totalUsdValue,
      accounts: results
    });

  } catch (error) {
    console.error('Bybit Balance Serverless Error:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

export default app;
