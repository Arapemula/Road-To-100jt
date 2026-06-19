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

// Helper to call Bybit API with User-Agent and failover domains (api.bybit.com and api.bytick.com)
async function callBybit(endpoint, headers, method = 'GET', data = null) {
  const customHeaders = {
    ...headers,
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  };

  const config = {
    method,
    headers: customHeaders,
  };
  if (data) config.data = data;

  try {
    config.url = `https://api.bybit.com${endpoint}`;
    return await axios(config);
  } catch (err) {
    // If it fails with a 403 or network issue, fallback to api.bytick.com
    const is403OrNetworkErr = !err.response || err.response.status === 403;
    if (is403OrNetworkErr) {
      console.warn(`Bybit primary domain failed (${err.message}). Retrying with api.bytick.com...`);
      try {
        config.url = `https://api.bytick.com${endpoint}`;
        return await axios(config);
      } catch (retryErr) {
        throw retryErr;
      }
    } else {
      throw err;
    }
  }
}

// Route to get USD to IDR conversion rate (Bybit P2P Rate first, with fallback)
app.get('/api/rates', async (req, res) => {
  try {
    // 1. Try to get USDT/IDR P2P price from Bybit P2P API
    try {
      const p2pResponse = await axios.post('https://api2.bybit.com/fiat/otc/item/online', {
        tokenId: 'USDT',
        currencyId: 'IDR',
        side: '1', // 1 = Buy (we want to check what price sellers are offering, which represents USDT price in IDR)
        size: '5',
        page: '1',
      }, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'application/json',
          'Content-Type': 'application/json'
        },
        timeout: 5000 // 5 seconds timeout
      });

      if (p2pResponse.data?.result?.items && p2pResponse.data.result.items.length > 0) {
        const rate = parseFloat(p2pResponse.data.result.items[0].price);
        if (rate > 10000 && rate < 25000) { // sanity check
          console.log(`Successfully fetched Bybit P2P rate: Rp ${rate}`);
          return res.json({ success: true, rate, source: 'bybit_p2p' });
        }
      }
    } catch (p2pError) {
      console.warn('Bybit P2P rate fetch failed:', p2pError.message);
    }

    // 2. Fallback to general ExchangeRate API if P2P fails
    const response = await axios.get('https://open.er-api.com/v6/latest/USD', { timeout: 5000 });
    const rate = response.data?.rates?.IDR || 16400; // fallback to 16,400 IDR/USD if missing
    res.json({ success: true, rate, source: 'er-api' });
  } catch (error) {
    console.error('Error fetching fallback exchange rates:', error.message);
    res.json({ success: false, rate: 16400, message: 'Using default fallback exchange rate', source: 'default' });
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
    let response;
    try {
      response = await axios.get('https://api.bybit.com/v5/market/tickers?category=spot', {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        }
      });
    } catch (err) {
      console.warn(`Tickers failed on api.bybit.com (${err.message}). Trying api.bytick.com...`);
      response = await axios.get('https://api.bytick.com/v5/market/tickers?category=spot', {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        }
      });
    }

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
    : ['UNIFIED', 'SPOT', 'FUND']; // default to checking Unified, Spot, and Funding to cover all modes!
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
        const response = await callBybit(`/v5/account/wallet-balance?${queryString}`, headers);
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
    if (accountTypes.includes('FUND')) {
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
        const response = await callBybit(`/v5/asset/transfer/query-account-coins-balance?${queryString}`, headers);
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

// Route to fetch Bybit active positions securely (using server-side API keys)
app.post('/api/bybit/positions', async (req, res) => {
  const apiKey = process.env.BYBIT_API_KEY;
  const apiSecret = process.env.BYBIT_API_SECRET;

  if (!apiKey || !apiSecret) {
    return res.status(400).json({
      success: false,
      error: 'Bybit API keys are missing on the server-side environment variables.'
    });
  }

  const categories = [
    { category: 'linear', settleCoin: 'USDT' },
    { category: 'inverse', settleCoin: 'BTC' }
  ];
  const positions = [];
  const recvWindow = '5000';

  try {
    for (const item of categories) {
      const timestamp = Date.now().toString();
      const queryString = item.settleCoin
        ? `category=${item.category}&settleCoin=${item.settleCoin}`
        : `category=${item.category}`;

      const signature = generateBybitSignature(apiKey, apiSecret, timestamp, recvWindow, queryString);
      const headers = {
        'X-BAPI-API-KEY': apiKey,
        'X-BAPI-TIMESTAMP': timestamp,
        'X-BAPI-RECV-WINDOW': recvWindow,
        'X-BAPI-SIGN': signature,
      };

      try {
        const response = await callBybit(`/v5/position/list?${queryString}`, headers);
        const data = response.data;
        if (data.retCode === 0 && data.result?.list) {
          // filter active positions where size > 0
          const active = data.result.list.filter(p => parseFloat(p.size || '0') > 0);
          positions.push(...active);
        }
      } catch (err) {
        console.error(`Error fetching positions for ${item.category}:`, err.message);
      }
    }

    res.json({
      success: true,
      positions
    });
  } catch (error) {
    console.error('Bybit Positions Serverless Error:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Route to fetch Bybit closed PnL (trade history) securely
app.post('/api/bybit/closed-pnl', async (req, res) => {
  const apiKey = process.env.BYBIT_API_KEY;
  const apiSecret = process.env.BYBIT_API_SECRET;

  if (!apiKey || !apiSecret) {
    return res.status(400).json({
      success: false,
      error: 'Bybit API keys are missing on the server-side environment variables.'
    });
  }

  const categories = ['linear', 'inverse'];
  const history = [];
  const recvWindow = '5000';

  try {
    for (const category of categories) {
      const timestamp = Date.now().toString();
      const queryString = `category=${category}&limit=50`;

      const signature = generateBybitSignature(apiKey, apiSecret, timestamp, recvWindow, queryString);
      const headers = {
        'X-BAPI-API-KEY': apiKey,
        'X-BAPI-TIMESTAMP': timestamp,
        'X-BAPI-RECV-WINDOW': recvWindow,
        'X-BAPI-SIGN': signature,
      };

      try {
        const response = await callBybit(`/v5/position/closed-pnl?${queryString}`, headers);
        const data = response.data;
        if (data.retCode === 0 && data.result?.list) {
          history.push(...data.result.list);
        }
      } catch (err) {
        console.error(`Error fetching closed PnL for ${category}:`, err.message);
      }
    }

    // Sort by createdTime descending (newest first)
    history.sort((a, b) => parseInt(b.createdTime || '0') - parseInt(a.createdTime || '0'));

    res.json({
      success: true,
      history
    });
  } catch (error) {
    console.error('Bybit Closed PnL Serverless Error:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

export default app;

