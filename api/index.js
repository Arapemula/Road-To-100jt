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

// Helper to fetch current spot prices for coin-to-USD conversion
async function getSpotPrices() {
  const priceMap = {};
  // Stablecoins are always 1 USD
  priceMap['USDT'] = 1.0;
  priceMap['USDC'] = 1.0;
  priceMap['BUSD'] = 1.0;
  priceMap['DAI'] = 1.0;
  priceMap['USD'] = 1.0;
  priceMap['USDE'] = 1.0;

  try {
    const response = await axios.get('https://api.bybit.com/v5/market/tickers?category=spot');
    if (response.data && response.data.retCode === 0 && response.data.result?.list) {
      for (const item of response.data.result.list) {
        if (item.symbol.endsWith('USDT')) {
          const coin = item.symbol.replace('USDT', '');
          priceMap[coin] = parseFloat(item.lastPrice);
        }
      }
    }
  } catch (error) {
    console.error('Error fetching spot prices:', error.message);
  }
  return priceMap;
}

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

  // We will query both Trading Account(s) (UNIFIED, SPOT, etc.) AND the Funding Account (FUND)
  const accountTypes = process.env.BYBIT_ACCOUNT_TYPES 
    ? process.env.BYBIT_ACCOUNT_TYPES.split(',') 
    : ['UNIFIED', 'SPOT']; // default to checking both Unified and Spot to cover all account modes!

  const shouldQueryFund = !accountTypes.includes('FUND');
  const baseUrl = 'https://api.bybit.com'; // Always Mainnet for Vercel deployment
  const recvWindow = '5000';
  const results = [];
  let totalUsdValue = 0;

  try {
    // 1. Fetch spot prices for coin-to-USD conversion of Funding assets
    const spotPrices = await getSpotPrices();

    // 2. Fetch balances for Trading Accounts (UNIFIED, SPOT, etc.)
    for (const accountType of accountTypes) {
      if (accountType === 'FUND') continue; // We will handle FUND separately below
      
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
          // Keep failure info but do not block other accounts
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

    // 3. Fetch Funding Wallet Balance (FUND)
    if (shouldQueryFund || accountTypes.includes('FUND')) {
      const timestamp = Date.now().toString();
      const queryString = `accountType=FUND`;
      const signature = generateBybitSignature(apiKey, apiSecret, timestamp, recvWindow, queryString);

      const headers = {
        'X-BAPI-API-KEY': apiKey,
        'X-BAPI-TIMESTAMP': timestamp,
        'X-BAPI-RECV-WINDOW': recvWindow,
        'X-BAPI-SIGN': signature,
      };

      try {
        const response = await axios.get(`${baseUrl}/v5/asset/transfer/query-account-coins-balance?${queryString}`, { headers });
        const data = response.data;

        if (data.retCode === 0 && data.result?.balance) {
          let fundEquity = 0;
          const coins = [];

          for (const item of data.result.balance) {
            const coinName = item.coin;
            const amount = parseFloat(item.walletBalance || '0');
            if (amount <= 0) continue;

            // Get USD price of this coin
            const price = spotPrices[coinName] || 0;
            const usdVal = amount * price;

            fundEquity += usdVal;
            coins.push({
              coin: coinName,
              walletBalance: amount,
              usdValue: usdVal
            });
          }

          totalUsdValue += fundEquity;
          results.push({
            accountType: 'FUND',
            equity: fundEquity,
            coins,
            success: true
          });
        } else {
          results.push({
            accountType: 'FUND',
            success: false,
            error: data.retMsg || `Error code ${data.retCode}`
          });
        }
      } catch (err) {
        console.error(`Error fetching Funding balance:`, err.message);
        results.push({
          accountType: 'FUND',
          success: false,
          error: err.response?.data?.retMsg || err.message
        });
      }
    }

    // If all queried accounts returned errors (failed to authenticate or connect), return success: false
    const succeeded = results.some(r => r.success);
    if (!succeeded && results.length > 0) {
      return res.status(400).json({
        success: false,
        error: results.find(r => r.error)?.error || 'Gagal terhubung ke Bybit API.'
      });
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
