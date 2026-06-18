import React, { useState, useEffect, useRef } from 'react';
import { 
  TrendingUp, 
  Settings, 
  Plus, 
  Trash2, 
  RefreshCw, 
  CheckCircle, 
  AlertCircle, 
  DollarSign, 
  Calendar, 
  PieChart, 
  Trophy, 
  Eye, 
  EyeOff, 
  Activity,
  ChevronDown,
  ChevronUp
} from 'lucide-react';
import confetti from 'canvas-confetti';
import gsap from 'gsap';
import { useGSAP } from '@gsap/react';
import ProgressionChart from './components/ProgressionChart';

// Register GSAP React plugin (optional, but good practice)
gsap.registerPlugin();

// Constants
const TARGET_IDR = 100000000; // 100 Million IDR
const TARGET_DATE = new Date('2026-09-10T00:00:00');
const START_DATE = new Date('2026-06-01T00:00:00'); // Baseline start for chart

// Reusable GSAP CountUp component for high-fidelity rolling numbers
function CountUp({ value, prefix = '', suffix = '', decimals = 0, duration = 1 }) {
  const [displayValue, setDisplayValue] = useState(0);
  const prevValRef = useRef(0);
  const valueRef = useRef(value);
  valueRef.current = value;

  useEffect(() => {
    const obj = { val: prevValRef.current };
    gsap.to(obj, {
      val: value,
      duration: duration,
      ease: 'power2.out',
      onUpdate: () => {
        setDisplayValue(obj.val);
      }
    });
    prevValRef.current = value;
  }, [value, duration]);

  const formatted = displayValue.toLocaleString('id-ID', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  });

  return <span>{prefix}{formatted}{suffix}</span>;
}

export default function App() {
  // Mode & Load States
  const [mode, setMode] = useState(() => localStorage.getItem('app_mode') || 'demo');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState(null);
  const [successMsg, setSuccessMsg] = useState(null);
  const [exchangeRate, setExchangeRate] = useState(16400);

  // Server-Side Configuration Caching
  const [isLockedByServer, setIsLockedByServer] = useState(false);

  // Balances
  const [bybitBalanceUsd, setBybitBalanceUsd] = useState(() => {
    return parseFloat(localStorage.getItem('bybit_balance_usd') || '0');
  });
  
  // Offline Assets & History
  const [offlineAssets, setOfflineAssets] = useState(() => {
    try {
      const saved = localStorage.getItem('offline_assets');
      return saved ? JSON.parse(saved) : [
        { id: '1', label: 'Kas Bank Mandiri', amount: 20000000 },
        { id: '2', label: 'Tabungan Reksa Dana', amount: 8000000 }
      ];
    } catch {
      return [];
    }
  });

  const [liveHistory, setLiveHistory] = useState(() => {
    try {
      const saved = localStorage.getItem('balance_history');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  // Forms
  const [newAssetLabel, setNewAssetLabel] = useState('');
  const [newAssetAmount, setNewAssetAmount] = useState('');

  // Countdown timer
  const [timeLeft, setTimeLeft] = useState({ days: 0, hours: 0, minutes: 0, seconds: 0 });

  // Refs for 3D Console effect & timeouts
  const consoleRef = useRef(null);
  const successTimeoutRef = useRef(null);

  // Confetti
  const celebrate = () => {
    confetti({
      particleCount: 140,
      spread: 80,
      origin: { y: 0.6 },
      colors: ['#f59e0b', '#10b981', '#06b6d4', '#ffffff']
    });
  };

  // 1. Mouse Tracking 3D Tilt Effect disabled

  // 2. Entrance Stagger Animation (GSAP)
  useGSAP(() => {
    // Entrance animations
    gsap.from('.header-animate', {
      opacity: 0,
      y: -25,
      duration: 0.8,
      ease: 'power3.out'
    });

    gsap.from('.card-animate', {
      opacity: 0,
      y: 40,
      scale: 0.98,
      duration: 1,
      stagger: 0.12,
      ease: 'power4.out',
      delay: 0.25
    });
  }, { scope: consoleRef });

  // 3. Countdown timer effect
  useEffect(() => {
    const updateTimer = () => {
      const now = new Date();
      const difference = TARGET_DATE.getTime() - now.getTime();

      if (difference <= 0) {
        setTimeLeft({ days: 0, hours: 0, minutes: 0, seconds: 0 });
        return;
      }

      const days = Math.floor(difference / (1000 * 60 * 60 * 24));
      const hours = Math.floor((difference % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
      const minutes = Math.floor((difference % (1000 * 60 * 60)) / (1000 * 60));
      const seconds = Math.floor((difference % (1000 * 60)) / 1000);

      setTimeLeft({ days, hours, minutes, seconds });
    };

    updateTimer();
    const interval = setInterval(updateTimer, 1000);
    return () => clearInterval(interval);
  }, []);

  // 4. Initialize app config & exchange rates on mount
  useEffect(() => {
    const initApp = async () => {
      try {
        // Fetch exchange rates
        const rateRes = await fetch('/api/rates');
        const rateData = await rateRes.json();
        if (rateData.success && rateData.rate) {
          setExchangeRate(rateData.rate);
        }

        // Fetch server side configuration
        const configRes = await fetch('/api/bybit/config');
        const configData = await configRes.json();
        if (configData.success && configData.hasServerKeys) {
          setIsLockedByServer(true);
          setMode('live');
        }
      } catch (err) {
        console.error('Failed to initialize app settings:', err);
      }
    };
    initApp();
  }, []);

  // 5. Fetch live balance when server lock triggers
  useEffect(() => {
    if (isLockedByServer) {
      fetchLiveBalance();
    }
  }, [isLockedByServer]);

  // 6. Save offline assets & mode to localstorage
  useEffect(() => {
    localStorage.setItem('offline_assets', JSON.stringify(offlineAssets));
  }, [offlineAssets]);

  useEffect(() => {
    localStorage.setItem('app_mode', mode);
  }, [mode]);

  // Fetch Live Balance from proxy
  const fetchLiveBalance = async () => {
    if (!isLockedByServer && (!apiKey || !apiSecret)) {
      setErrorMsg('Masukkan API Key dan API Secret di menu integrasi.');
      setShowSettings(true);
      return;
    }

    setLoading(true);
    setErrorMsg(null);
    setSuccessMsg(null);

    try {
      const res = await fetch('/api/bybit/balance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          apiKey: isLockedByServer ? '' : apiKey, 
          apiSecret: isLockedByServer ? '' : apiSecret, 
          accountTypes, 
          isTestnet 
        })
      });

      const data = await res.json();

      if (data.success) {
        setBybitBalanceUsd(data.totalUsdValue);
        localStorage.setItem('bybit_balance_usd', data.totalUsdValue.toString());
        
        // Calculate total
        const offlineSum = offlineAssets.reduce((sum, asset) => sum + asset.amount, 0);
        const currentBybitIdr = data.totalUsdValue * exchangeRate;
        const totalIdr = currentBybitIdr + offlineSum;

        // Record balance history point
        const todayStr = new Date().toLocaleDateString('id-ID', { day: '2-digit', month: 'short' });
        const todayKey = new Date().toISOString().split('T')[0];
        
        setLiveHistory(prev => {
          const filtered = prev.filter(item => item.dateKey !== todayKey);
          const updated = [...filtered, { dateKey: todayKey, date: todayStr, amount: totalIdr }];
          updated.sort((a, b) => a.dateKey.localeCompare(b.dateKey));
          localStorage.setItem('balance_history', JSON.stringify(updated));
          return updated;
        });

        setSuccessMsg('Sinkronisasi Bybit berhasil!');
        if (successTimeoutRef.current) clearTimeout(successTimeoutRef.current);
        successTimeoutRef.current = setTimeout(() => setSuccessMsg(null), 3000);

        if (totalIdr >= TARGET_IDR) {
          celebrate();
        }
      } else {
        setErrorMsg(data.error || 'Autentikasi Bybit ditolak. Silakan cek API Key Anda.');
      }
    } catch (err) {
      setErrorMsg('Koneksi proxy gagal. Pastikan backend server anda sudah menyala.');
    } finally {
      setLoading(false);
    }
  };

  // Asset Form Management

  // Asset Form Management
  const handleAddAsset = (e) => {
    e.preventDefault();
    if (!newAssetLabel || !newAssetAmount) return;

    const amount = parseFloat(newAssetAmount);
    if (isNaN(amount) || amount <= 0) return;

    const newAsset = {
      id: Date.now().toString(),
      label: newAssetLabel,
      amount
    };

    setOfflineAssets(prev => [...prev, newAsset]);
    setNewAssetLabel('');
    setNewAssetAmount('');
    
    setSuccessMsg('Aset offline terdaftar!');
    if (successTimeoutRef.current) clearTimeout(successTimeoutRef.current);
    successTimeoutRef.current = setTimeout(() => setSuccessMsg(null), 3000);
  };

  const handleDeleteAsset = (id) => {
    setOfflineAssets(prev => prev.filter(asset => asset.id !== id));
  };



  // Financial Calculations
  const offlineSum = offlineAssets.reduce((sum, asset) => sum + asset.amount, 0);
  const currentBybitUsd = mode === 'demo' ? 2450 : bybitBalanceUsd;
  const currentBybitIdr = currentBybitUsd * exchangeRate;
  const totalActualBalance = currentBybitIdr + offlineSum;
  
  const progressPercentage = Math.min(100, (totalActualBalance / TARGET_IDR) * 100);
  const remainingNeeded = Math.max(0, TARGET_IDR - totalActualBalance);
  
  const today = new Date();
  today.setHours(0,0,0,0);
  const msDiff = TARGET_DATE.getTime() - today.getTime();
  const daysRemaining = Math.max(1, Math.ceil(msDiff / (1000 * 60 * 60 * 24)));
  const dailyTargetRequired = remainingNeeded / daysRemaining;

  // Custom circular progress arc math
  // Circle radius = 75, Circumference = 471.24
  const radius = 75;
  const strokeDasharray = 2 * Math.PI * radius; // 471.24
  const strokeDashoffset = strokeDasharray - (progressPercentage / 100) * strokeDasharray;

  // Chart Data Generator
  const getChartData = () => {
    const dataPoints = [];
    const totalDays = Math.ceil((TARGET_DATE.getTime() - START_DATE.getTime()) / (1000 * 60 * 60 * 24));
    
    const initialTargetVal = 10000000;
    const targetSlope = (TARGET_IDR - initialTargetVal) / totalDays;

    for (let dayOffset = 0; dayOffset <= totalDays; dayOffset += 4) {
      const date = new Date(START_DATE.getTime() + dayOffset * 24 * 60 * 60 * 1000);
      const dateKey = date.toISOString().split('T')[0];
      const dateStr = date.toLocaleDateString('id-ID', { day: '2-digit', month: 'short' });
      
      const targetVal = Math.round(initialTargetVal + targetSlope * dayOffset);
      let actualVal = null;

      if (mode === 'demo') {
        const daysFromStart = Math.ceil((today.getTime() - START_DATE.getTime()) / (1000 * 60 * 60 * 24));
        if (dayOffset <= daysFromStart) {
          const frac = dayOffset / daysFromStart;
          const base = 15000000 + (totalActualBalance - 15000000) * frac;
          const sineNoise = Math.sin(dayOffset * 0.45) * 1800000;
          actualVal = Math.round(base + sineNoise);
        }
      } else {
        const daysFromStart = Math.ceil((today.getTime() - START_DATE.getTime()) / (1000 * 60 * 60 * 24));
        if (dayOffset <= daysFromStart) {
          if (liveHistory.length > 0) {
            const closest = [...liveHistory]
              .reverse()
              .find(h => h.dateKey <= dateKey);
            actualVal = closest ? closest.amount : null;
          } else {
            const frac = dayOffset / daysFromStart;
            const base = 28000000 + (totalActualBalance - 28000000) * frac;
            actualVal = Math.round(base);
          }
        }
      }

      dataPoints.push({
        date: dateStr,
        dateKey,
        target: targetVal,
        actual: actualVal
      });
    }

    const finalPoint = dataPoints[dataPoints.length - 1];
    if (finalPoint) {
      finalPoint.target = TARGET_IDR;
    }

    const todayStr = today.toLocaleDateString('id-ID', { day: '2-digit', month: 'short' });
    const todayKey = today.toISOString().split('T')[0];
    const todayIndex = dataPoints.findIndex(d => d.dateKey === todayKey);
    
    if (todayIndex !== -1) {
      dataPoints[todayIndex].actual = totalActualBalance;
    } else {
      const insertIdx = dataPoints.findIndex(d => d.dateKey > todayKey);
      const targetValToday = Math.round(initialTargetVal + targetSlope * Math.ceil((today.getTime() - START_DATE.getTime()) / (1000 * 60 * 60 * 24)));
      const todayPoint = {
        date: todayStr,
        dateKey: todayKey,
        target: targetValToday,
        actual: totalActualBalance
      };
      
      if (insertIdx !== -1) {
        dataPoints.splice(insertIdx, 0, todayPoint);
      } else {
        dataPoints.push(todayPoint);
      }
    }

    return dataPoints;
  };

  const chartData = getChartData();

  return (
    <div className="deck-perspective">
      {/* Toast Alert Popups */}
      {successMsg && (
        <div style={{
          position: 'fixed', top: '24px', right: '24px', zIndex: 10000,
          background: 'rgba(16, 185, 129, 0.95)', border: '1px solid rgba(255, 255, 255, 0.1)',
          color: '#fff', padding: '0.8rem 1.4rem', borderRadius: '8px',
          boxShadow: 'var(--glow-emerald)', display: 'flex', alignItems: 'center', gap: '0.6rem',
          fontWeight: 600, animation: 'fadeIn 0.3s ease', backdropFilter: 'blur(8px)',
          fontFamily: 'var(--sans)'
        }}>
          <CheckCircle size={16} color="#10b981" style={{ fill: '#fff' }} /> {successMsg}
        </div>
      )}
      {errorMsg && (
        <div style={{
          position: 'fixed', top: '24px', right: '24px', zIndex: 10000,
          background: 'rgba(244, 63, 94, 0.95)', border: '1px solid rgba(255, 255, 255, 0.1)',
          color: '#fff', padding: '0.8rem 1.4rem', borderRadius: '8px',
          boxShadow: '0 0 25px rgba(244, 63, 94, 0.3)', display: 'flex', alignItems: 'center', gap: '0.6rem',
          fontWeight: 600, animation: 'fadeIn 0.3s ease', backdropFilter: 'blur(8px)',
          fontFamily: 'var(--sans)'
        }}>
          <AlertCircle size={16} /> {errorMsg}
        </div>
      )}

      {/* Main Asymmetric 3D Control Console */}
      <main ref={consoleRef} className="deck-console">
        
        {/* Luxury Top Mini Status Bar */}
        <section className="status-bar header-animate">
          <div className="status-indicator">
            <span className={`indicator-dot ${mode === 'demo' ? 'dot-warning' : (isLockedByServer ? 'dot-active' : 'dot-offline')}`}></span>
            <span style={{ textTransform: 'uppercase', letterSpacing: '1px', fontWeight: 600 }}>
              {mode === 'demo' ? 'Console Demo Mode' : (isLockedByServer ? 'Bybit API Linked' : 'Bybit API Configuration Missing')}
            </span>
          </div>
          <div style={{ display: 'flex', gap: '1.25rem', fontFamily: 'var(--mono)', fontWeight: 500 }}>
            <span>NODE PROXY: ACTIVE (PORT 3001)</span>
            <span>UTC: {new Date().toISOString().substring(11, 16)}</span>
          </div>
        </section>

        {/* Dashboard Title & Clock Header */}
        <header className="header-animate" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: '1rem' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
              <Activity size={18} color="var(--color-gold)" style={{ filter: 'drop-shadow(0 0 5px var(--color-gold))' }} />
              <span className="label-muted" style={{ color: 'var(--color-gold)' }}>PORTFOLIO ACCELERATOR</span>
            </div>
            <h1 style={{ marginTop: '0.2rem', fontSize: '2.25rem' }}>
              Road to 100M <span style={{ color: 'var(--text-secondary)', fontWeight: 300 }}>Console</span>
            </h1>
          </div>

          {/* Luxury Count Down Timer */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.25rem' }}>
            <span className="label-muted" style={{ fontSize: '0.65rem' }}>Time Until Sept 10 Limit</span>
            <div className="clock-deck">
              <div className="clock-slot">
                <span className="clock-val">{timeLeft.days}</span>
                <span className="clock-lbl">D</span>
              </div>
              <div className="clock-slot">
                <span className="clock-val">{timeLeft.hours.toString().padStart(2, '0')}</span>
                <span className="clock-lbl">H</span>
              </div>
              <div className="clock-slot">
                <span className="clock-val">{timeLeft.minutes.toString().padStart(2, '0')}</span>
                <span className="clock-lbl">M</span>
              </div>
              <div className="clock-slot">
                <span className="clock-val">{timeLeft.seconds.toString().padStart(2, '0')}</span>
                <span className="clock-lbl">S</span>
              </div>
            </div>
          </div>
        </header>

        {/* Dynamic Controls Bar */}
        <section className="card-animate" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
          <div className="tabs-container">
            <button 
              className={`tab-btn ${mode === 'demo' ? 'active' : ''}`}
              onClick={() => setMode('demo')}
            >
              Demo Sandbox
            </button>
            <button 
              className={`tab-btn ${mode === 'live' ? 'active' : ''}`}
              onClick={() => {
                setMode('live');
                if (apiKey && apiSecret) fetchLiveBalance();
              }}
            >
              Live Bybit Node
            </button>
          </div>

          <div style={{ display: 'flex', gap: '0.75rem' }}>
            {mode === 'live' && (
              <button 
                className="btn-titan" 
                onClick={fetchLiveBalance}
                disabled={loading}
              >
                <RefreshCw size={13} className={loading ? 'spin-anim' : ''} />
                Sync Balance
              </button>
            )}
            <button 
              className="btn-gold" 
              onClick={celebrate}
            >
              Celebrate 🎉
            </button>
          </div>
        </section>

        {/* Master Progress Ring & Goal Section */}
        <section className="obsidian-card card-animate accent-gold">
          <div className="progress-radial-wrapper">
            <div className="radial-metrics">
              <span className="label-muted">Consolidated Equity</span>
              <h2 style={{ fontSize: '2.5rem', fontWeight: 700, fontFamily: 'var(--mono)', marginTop: '-0.2rem', letterSpacing: '-1px' }}>
                Rp <CountUp value={totalActualBalance} />
              </h2>
              <div style={{ display: 'flex', gap: '1.25rem', marginTop: '0.2rem' }}>
                <div>
                  <span className="label-muted" style={{ fontSize: '0.65rem' }}>Target Limit</span>
                  <div style={{ fontFamily: 'var(--mono)', fontSize: '0.95rem', fontWeight: 600, color: 'var(--text-secondary)' }}>
                    Rp 100.000.000
                  </div>
                </div>
                <div>
                  <span className="label-muted" style={{ fontSize: '0.65rem' }}>Difference</span>
                  <div style={{ fontFamily: 'var(--mono)', fontSize: '0.95rem', fontWeight: 600, color: 'var(--color-gold)' }}>
                    Rp <CountUp value={remainingNeeded} />
                  </div>
                </div>
              </div>
            </div>

            {/* Circular Gauge Arc */}
            <div className="radial-gauge-container">
              <svg className="gauge-svg" viewBox="0 0 180 180">
                <defs>
                  <linearGradient id="goldGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stopColor="#f59e0b" />
                    <stop offset="100%" stopColor="#e11d48" />
                  </linearGradient>
                </defs>
                <circle className="gauge-bg" cx="90" cy="90" r={radius} />
                <circle 
                  className="gauge-glow" 
                  cx="90" 
                  cy="90" 
                  r={radius} 
                  strokeDasharray={strokeDasharray}
                  strokeDashoffset={strokeDashoffset}
                />
                <circle 
                  className="gauge-progress" 
                  cx="90" 
                  cy="90" 
                  r={radius} 
                  strokeDasharray={strokeDasharray}
                  strokeDashoffset={strokeDashoffset}
                />
              </svg>
              <div className="gauge-label-center">
                <span className="gauge-val-pct">
                  <CountUp value={progressPercentage} decimals={1} suffix="%" />
                </span>
                <span className="label-muted" style={{ fontSize: '0.55rem', marginTop: '0.1rem' }}>Completed</span>
              </div>
            </div>
          </div>
        </section>

        {/* Bloomberg Grid Metrics */}
        <section className="grid-4x card-animate">
          <div className="stat-box">
            <div className="stat-header">
              <span className="stat-title">Daily Profit Required</span>
              <Trophy size={14} color="var(--color-gold)" />
            </div>
            <div className="stat-value accented">
              Rp <CountUp value={dailyTargetRequired} />
            </div>
            <span className="stat-subtext">Target profit harian berdasarkan sisa hari hari ini.</span>
          </div>

          <div className="stat-box">
            <div className="stat-header">
              <span className="stat-title">Bybit Live Balance</span>
              <DollarSign size={14} color="var(--color-cyan)" />
            </div>
            <div className="stat-value">
              $<CountUp value={currentBybitUsd} decimals={2} />
            </div>
            <span className="stat-subtext">
              Equiv: Rp {(currentBybitIdr).toLocaleString('id-ID')} @ {exchangeRate}/$
            </span>
          </div>

          <div className="stat-box">
            <div className="stat-header">
              <span className="stat-title">Offline Ledger Assets</span>
              <PieChart size={14} color="var(--color-emerald)" />
            </div>
            <div className="stat-value green">
              Rp <CountUp value={offlineSum} />
            </div>
            <span className="stat-subtext">Akumulasi tabungan fisik & rekening luar.</span>
          </div>

          <div className="stat-box">
            <div className="stat-header">
              <span className="stat-title">Days Remaining</span>
              <Calendar size={14} color="var(--color-rose)" />
            </div>
            <div className="stat-value red">
              {daysRemaining} Hari
            </div>
            <span className="stat-subtext">Waktu tersisa menuju deadline 10 September.</span>
          </div>
        </section>

        {/* Asymmetric Core Section */}
        <div className="grid-asymmetric card-animate">
          
          {/* Progression Chart Panel */}
          <section className="obsidian-card" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h2 style={{ fontSize: '1rem', textTransform: 'uppercase', letterSpacing: '1px' }}>Progression Log Slope</h2>
              <span className="label-muted" style={{ fontSize: '0.65rem' }}>Interpolated Weekly Slope</span>
            </div>
            <ProgressionChart chartData={chartData} />
          </section>

          {/* Right hand Manual Ledger Assets */}
          <section className="obsidian-card" style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            <h2 style={{ fontSize: '1.1rem', textTransform: 'uppercase', letterSpacing: '1px' }}>Offline Ledger</h2>
            
            <form onSubmit={handleAddAsset} style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              <input 
                type="text"
                placeholder="Deskripsi Aset (e.g. Deposito Mandiri)"
                className="input-titan"
                value={newAssetLabel}
                onChange={e => setNewAssetLabel(e.target.value)}
                required
              />
              <input 
                type="number"
                placeholder="Nominal Rupiah"
                className="input-titan"
                value={newAssetAmount}
                onChange={e => setNewAssetAmount(e.target.value)}
                required
              />
              <button type="submit" className="btn-gold" style={{ width: '100%' }}>
                <Plus size={15} /> Add Asset Log
              </button>
            </form>

            <div style={{ flex: 1 }}>
              <span className="label-muted" style={{ fontSize: '0.65rem', display: 'block', marginBottom: '0.6rem' }}>Current Allocations</span>
              {offlineAssets.length === 0 ? (
                <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontStyle: 'italic', textAlign: 'center', margin: '1rem 0' }}>
                  No manual ledger records exist.
                </p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', maxHeight: '180px', overflowY: 'auto' }}>
                  {offlineAssets.map(asset => (
                    <div 
                      key={asset.id}
                      style={{
                        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                        background: 'rgba(255, 255, 255, 0.01)', border: '1px solid rgba(255, 255, 255, 0.02)',
                        padding: '0.5rem 0.75rem', borderRadius: '6px'
                      }}
                    >
                      <div>
                        <div style={{ fontSize: '0.85rem', fontWeight: 600 }}>{asset.label}</div>
                        <div style={{ fontSize: '0.8rem', color: 'var(--color-gold)', fontFamily: 'var(--mono)', marginTop: '0.1rem' }}>
                          Rp {asset.amount.toLocaleString('id-ID')}
                        </div>
                      </div>
                      <button 
                        onClick={() => handleDeleteAsset(asset.id)}
                        className="btn-danger-titan"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>
        </div>


        {/* Footer */}
        <footer style={{ display: 'flex', justifyContent: 'space-between', padding: '1rem 0', fontSize: '0.75rem', color: 'var(--text-muted)', borderTop: '1px solid var(--border-light)' }}>
          <span>PORTFOLIO TRACKING SYSTEM v5.0</span>
          <span>TARGET DEADLINE: 10 SEPTEMBER 2026</span>
        </footer>

      </main>
    </div>
  );
}
