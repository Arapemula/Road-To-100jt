import express from 'express';
import cors from 'cors';
import axios from 'axios';
import crypto from 'crypto';
import dotenv from 'dotenv';

dotenv.config();

const app = express();

// SEC-01: Restrict CORS to allowed origin(s).
// On Vercel, frontend and API share the same domain (same-origin), so CORS
// headers are not needed for production requests — the browser won't send an
// Origin header for same-origin requests.
//
// FRONTEND_URL supports comma-separated values:
//   FRONTEND_URL=https://my-app.vercel.app,https://my-custom-domain.com
//
// All *.vercel.app origins are automatically allowed to handle preview URLs.

const rawFrontendUrl = process.env.FRONTEND_URL || '';
const explicitOrigins = rawFrontendUrl
  ? rawFrontendUrl.split(',').map(u => u.trim()).filter(Boolean)
  : [];

// Always include localhost for local dev
const localOrigins = ['http://localhost:5173', 'http://localhost:4173', 'http://localhost:3000'];
const allowedOrigins = [...explicitOrigins, ...localOrigins];

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no Origin header:
    //   - same-origin browser requests (Vercel co-hosted frontend)
    //   - server-to-server / curl calls
    if (!origin) return callback(null, true);

    // Allow any *.vercel.app origin (covers preview & production deployments)
    if (origin.endsWith('.vercel.app')) return callback(null, true);

    // Allow explicitly listed origins
    if (allowedOrigins.includes(origin)) return callback(null, true);

    // Block everything else
    callback(new Error('Origin not allowed by CORS policy.'));
  },
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type'],
}));

app.use(express.json({ limit: '10kb' })); // SEC-03: limit request body size

// SEC-02: Simple in-memory rate limiter (no external dependency needed).
// Limits each IP to maxRequests per windowMs on protected routes.
const rateLimitStore = new Map();

function createRateLimiter(maxRequests = 15, windowMs = 60000) {
  return (req, res, next) => {
    const ip = req.ip || req.socket?.remoteAddress || 'unknown';
    const now = Date.now();
    const windowStart = now - windowMs;

    const timestamps = (rateLimitStore.get(ip) || []).filter(t => t > windowStart);

    if (timestamps.length >= maxRequests) {
      return res.status(429).json({
        success: false,
        error: 'Terlalu banyak permintaan. Coba lagi dalam semenit.'
      });
    }

    timestamps.push(now);
    rateLimitStore.set(ip, timestamps);

    // Cleanup store periodically to prevent unbounded memory growth
    if (Math.random() < 0.01) {
      for (const [key, times] of rateLimitStore.entries()) {
        if (times.every(t => t <= windowStart)) rateLimitStore.delete(key);
      }
    }

    next();
  };
}

// Apply rate limiter to all /api/bybit/* routes (sensitive, hits external API)
const bybitLimiter = createRateLimiter(15, 60000); // 15 req/min per IP

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

  const config = { method, headers: customHeaders };
  if (data) config.data = data;

  try {
    config.url = `https://api.bybit.com${endpoint}`;
    return await axios(config);
  } catch (err) {
    // If it fails with a 403 or network issue, fallback to api.bytick.com
    const is403OrNetworkErr = !err.response || err.response.status === 403;
    if (is403OrNetworkErr) {
      console.warn(`Bybit primary domain failed (${err.message}). Retrying with api.bytick.com...`);
      config.url = `https://api.bytick.com${endpoint}`;
      return await axios(config);
    }
    throw err;
  }
}

// SEC-04: Sanitize error messages before sending to client.
// Never expose raw Bybit internal error codes or server-side details directly.
function sanitizeError(err) {
  if (!err) return 'Terjadi kesalahan yang tidak diketahui.';
  const msg = String(err);
  // Pass through known safe user-facing messages; hide the rest
  if (msg.includes('API key') || msg.includes('signature') || msg.includes('timestamp')) {
    return 'Autentikasi Bybit gagal. Periksa API key dan secret Anda.';
  }
  if (msg.includes('network') || msg.includes('ECONNREFUSED') || msg.includes('timeout')) {
    return 'Gagal terhubung ke Bybit. Periksa koneksi internet Anda.';
  }
  if (msg.includes('10001') || msg.includes('10003') || msg.includes('10004')) {
    return 'Autentikasi Bybit gagal. API key mungkin tidak valid atau tidak memiliki izin.';
  }
  // For unknown errors, return a generic message instead of the raw error
  return 'Bybit API mengembalikan error. Coba lagi nanti.';
}

// Route to get USD to IDR conversion rate (Bybit P2P Rate first, with fallback)
app.get('/api/rates', async (req, res) => {
  try {
    // 1. Try to get USDT/IDR P2P price from Bybit P2P API
    try {
      const p2pResponse = await axios.post('https://api2.bybit.com/fiat/otc/item/online', {
        tokenId: 'USDT',
        currencyId: 'IDR',
        side: '1', // 1 = Buy side (seller's asking price = USDT price in IDR)
        size: '5',
        page: '1',
      }, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'application/json',
          'Content-Type': 'application/json'
        },
        timeout: 5000
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

    // 2. Fallback to ExchangeRate API
    const response = await axios.get('https://open.er-api.com/v6/latest/USD', { timeout: 5000 });
    const rate = response.data?.rates?.IDR || 16400;
    res.json({ success: true, rate, source: 'er-api' });
  } catch (error) {
    console.error('Error fetching fallback exchange rates:', error.message);
    res.json({ success: false, rate: 16400, message: 'Using default fallback exchange rate', source: 'default' });
  }
});

// Route to check if Bybit API keys are configured on the server side
app.get('/api/bybit/config', (req, res) => {
  const hasServerKeys = !!(process.env.BYBIT_API_KEY && process.env.BYBIT_API_SECRET);
  res.json({
    success: true,
    hasServerKeys,
    accountTypes: process.env.BYBIT_ACCOUNT_TYPES ? process.env.BYBIT_ACCOUNT_TYPES.split(',') : ['UNIFIED']
    // NOTE: BYBIT_IS_TESTNET env var is defined in .env.example but not yet implemented.
    // All requests always go to the production Bybit API endpoints.
  });
});

// Helper to fetch current spot prices for coin-to-USD conversion
async function getSpotPrices() {
  const priceMap = {};
  // Stablecoins are always 1 USD
  ['USDT', 'USDC', 'BUSD', 'DAI', 'USD', 'USDE'].forEach(s => { priceMap[s] = 1.0; });

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

// Route to fetch Bybit balance securely on the server-side
app.post('/api/bybit/balance', bybitLimiter, async (req, res) => {
  const apiKey = process.env.BYBIT_API_KEY;
  const apiSecret = process.env.BYBIT_API_SECRET;

  if (!apiKey || !apiSecret) {
    return res.status(400).json({
      success: false,
      error: 'Konfigurasi API Bybit tidak ditemukan di server.'
    });
  }

  const accountTypes = process.env.BYBIT_ACCOUNT_TYPES
    ? process.env.BYBIT_ACCOUNT_TYPES.split(',')
    : ['UNIFIED', 'SPOT', 'FUND'];
  const recvWindow = '5000';
  const results = [];
  let totalUsdValue = 0;

  try {
    const spotPrices = await getSpotPrices();

    // Fetch balances for Trading Accounts (UNIFIED, SPOT, etc.)
    for (const accountType of accountTypes) {
      if (accountType === 'FUND') continue;

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

          if (equity === 0 && coins.length > 0) {
            equity = coins.reduce((sum, c) => sum + c.usdValue, 0);
          }

          totalUsdValue += equity;
          results.push({ accountType, equity, coins, success: true });
        } else {
          results.push({
            accountType,
            success: false,
            // SEC-04: Use sanitized error
            error: sanitizeError(data.retMsg || `Error code ${data.retCode}`)
          });
        }
      } catch (err) {
        console.error(`Error fetching ${accountType} balance:`, err.message);
        results.push({
          accountType,
          success: false,
          error: sanitizeError(err.response?.data?.retMsg || err.message)
        });
      }
    }

    // Fetch Funding Wallet Balance (FUND)
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

            const price = spotPrices[coinName] || 0;
            const usdVal = amount * price;
            fundEquity += usdVal;
            coins.push({ coin: coinName, walletBalance: amount, usdValue: usdVal });
          }

          totalUsdValue += fundEquity;
          results.push({ accountType: 'FUND', equity: fundEquity, coins, success: true });
        } else {
          results.push({
            accountType: 'FUND',
            success: false,
            error: sanitizeError(data.retMsg || `Error code ${data.retCode}`)
          });
        }
      } catch (err) {
        console.error(`Error fetching Funding balance:`, err.message);
        results.push({
          accountType: 'FUND',
          success: false,
          error: sanitizeError(err.response?.data?.retMsg || err.message)
        });
      }
    }

    const succeeded = results.some(r => r.success);
    if (!succeeded && results.length > 0) {
      return res.status(400).json({
        success: false,
        error: results.find(r => r.error)?.error || 'Gagal terhubung ke Bybit API.'
      });
    }

    res.json({ success: true, totalUsdValue, accounts: results });

  } catch (error) {
    console.error('Bybit Balance Serverless Error:', error.message);
    res.status(500).json({ success: false, error: sanitizeError(error.message) });
  }
});

// Route to fetch Bybit active positions securely
app.post('/api/bybit/positions', bybitLimiter, async (req, res) => {
  const apiKey = process.env.BYBIT_API_KEY;
  const apiSecret = process.env.BYBIT_API_SECRET;

  if (!apiKey || !apiSecret) {
    return res.status(400).json({
      success: false,
      error: 'Konfigurasi API Bybit tidak ditemukan di server.'
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
          const active = data.result.list.filter(p => parseFloat(p.size || '0') > 0);
          positions.push(...active);
        }
      } catch (err) {
        console.error(`Error fetching positions for ${item.category}:`, err.message);
      }
    }

    res.json({ success: true, positions });
  } catch (error) {
    console.error('Bybit Positions Serverless Error:', error.message);
    res.status(500).json({ success: false, error: sanitizeError(error.message) });
  }
});

// Route to fetch Bybit closed PnL (trade history) securely
app.post('/api/bybit/closed-pnl', bybitLimiter, async (req, res) => {
  const apiKey = process.env.BYBIT_API_KEY;
  const apiSecret = process.env.BYBIT_API_SECRET;

  if (!apiKey || !apiSecret) {
    return res.status(400).json({
      success: false,
      error: 'Konfigurasi API Bybit tidak ditemukan di server.'
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

    res.json({ success: true, history });
  } catch (error) {
    console.error('Bybit Closed PnL Serverless Error:', error.message);
    res.status(500).json({ success: false, error: sanitizeError(error.message) });
  }
});

export default app;
