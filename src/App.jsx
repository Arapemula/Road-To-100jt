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
  Calendar as CalendarIcon, 
  PieChart, 
  Trophy, 
  Eye, 
  EyeOff, 
  Activity,
  ArrowUpRight,
  TrendingDown
} from 'lucide-react';
import confetti from 'canvas-confetti';
import gsap from 'gsap';
import { useGSAP } from '@gsap/react';
import ProgressionChart from './components/ProgressionChart';

// Register GSAP
gsap.registerPlugin();

const TARGET_IDR = 100000000; // 100 Million IDR
const TARGET_DATE = new Date('2026-09-10T00:00:00');
const START_DATE = new Date('2026-06-01T00:00:00');

function CountUp({ value, prefix = '', suffix = '', decimals = 0, duration = 1 }) {
  const [displayValue, setDisplayValue] = useState(0);
  const prevValRef = useRef(0);

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
  // Navigation tab matching the reference top-nav
  const [activeTab, setActiveTab] = useState('overview');

  // Mode & Load States
  const [mode, setMode] = useState('live');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState(null);
  const [successMsg, setSuccessMsg] = useState(null);
  const [exchangeRate, setExchangeRate] = useState(16400);

  // Server-Side Config
  const [isLockedByServer, setIsLockedByServer] = useState(false);

  // Bybit Balances
  const [bybitBalanceUsd, setBybitBalanceUsd] = useState(() => {
    return parseFloat(localStorage.getItem('bybit_balance_usd') || '0');
  });

  // Bybit Asset Allocation State
  const [bybitCoins, setBybitCoins] = useState(() => {
    try {
      const saved = localStorage.getItem('bybit_coins');
      return saved ? JSON.parse(saved) : [];
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

  // Form states for selected calendar date
  const [selectedDate, setSelectedDate] = useState(() => {
    const todayStr = new Date().toISOString().split('T')[0];
    return todayStr;
  });

  // Right-hand Panel switcher tab ("assets" vs "journal")
  const [rightPanelTab, setRightPanelTab] = useState('assets');

  // Bybit Real-Time Positions and Trade History
  const [activePositions, setActivePositions] = useState([]);
  const [bybitHistory, setBybitHistory] = useState([]);
  const [positionsLoading, setPositionsLoading] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);

  // Countdown timer
  const [timeLeft, setTimeLeft] = useState({ days: 0, hours: 0, minutes: 0, seconds: 0 });

  // Refs & timeouts
  const consoleRef = useRef(null);
  const successTimeoutRef = useRef(null);

  // Confetti
  const celebrate = () => {
    confetti({
      particleCount: 140,
      spread: 80,
      origin: { y: 0.6 },
      colors: ['#d4ff3a', '#b89bfb', '#30d158', '#ffffff']
    });
  };



  // Entrance Stagger Animation
  useGSAP(() => {
    gsap.from('.header-animate', {
      opacity: 0,
      y: -20,
      duration: 0.7,
      ease: 'power2.out'
    });

    gsap.from('.card-animate', {
      opacity: 0,
      y: 30,
      duration: 0.8,
      stagger: 0.1,
      ease: 'power3.out',
      delay: 0.15
    });
  }, { scope: consoleRef });

  // Countdown timer effect
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

  // Initialize rates & config
  useEffect(() => {
    const initApp = async () => {
      try {
        const rateRes = await fetch('/api/rates');
        const rateData = await rateRes.json();
        if (rateData.success && rateData.rate) {
          setExchangeRate(rateData.rate);
        }

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

  // Fetch live balance on lock
  useEffect(() => {
    if (isLockedByServer) {
      fetchLiveBalance();
    }
  }, [isLockedByServer]);


  useEffect(() => {
    localStorage.setItem('app_mode', mode);
  }, [mode]);

  useEffect(() => {
    localStorage.setItem('bybit_coins', JSON.stringify(bybitCoins));
  }, [bybitCoins]);

  // Fetch Bybit active positions
  const fetchActivePositions = async (silent = false) => {
    if (!silent) setPositionsLoading(true);
    try {
      const res = await fetch('/api/bybit/positions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });
      const data = await res.json();
      if (data.success) {
        setActivePositions(data.positions || []);
      }
    } catch (err) {
      console.error('Failed to fetch active positions:', err);
    } finally {
      if (!silent) setPositionsLoading(false);
    }
  };

  // Fetch Bybit closed PnL history
  const fetchClosedPnl = async () => {
    setHistoryLoading(true);
    try {
      const res = await fetch('/api/bybit/closed-pnl', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });
      const data = await res.json();
      if (data.success) {
        setBybitHistory(data.history || []);
      }
    } catch (err) {
      console.error('Failed to fetch closed PnL history:', err);
    } finally {
      setHistoryLoading(false);
    }
  };

  // Polling active positions every 10 seconds if "positions" tab is active
  useEffect(() => {
    let interval;
    if (rightPanelTab === 'positions') {
      fetchActivePositions(); // initial fetch with loading state
      interval = setInterval(() => {
        fetchActivePositions(true); // silent fetch in background
      }, 10000);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [rightPanelTab]);

  // Fetch closed PnL once when the "history" tab is active
  useEffect(() => {
    if (rightPanelTab === 'history') {
      fetchClosedPnl();
    }
  }, [rightPanelTab]);

  // Fetch Live Balance from proxy
  const fetchLiveBalance = async () => {
    setLoading(true);
    setErrorMsg(null);
    setSuccessMsg(null);

    try {
      const res = await fetch('/api/bybit/balance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });

      const data = await res.json();

      if (data.success) {
        setBybitBalanceUsd(data.totalUsdValue);
        localStorage.setItem('bybit_balance_usd', data.totalUsdValue.toString());
        
        // Parse coin list
        const allCoins = [];
        if (data.accounts) {
          data.accounts.forEach(acc => {
            if (acc.coins) {
              acc.coins.forEach(c => {
                const existing = allCoins.find(item => item.coin === c.coin);
                if (existing) {
                  existing.walletBalance += parseFloat(c.walletBalance || '0');
                  existing.usdValue += parseFloat(c.usdValue || '0');
                } else {
                  allCoins.push({
                    coin: c.coin,
                    walletBalance: parseFloat(c.walletBalance || '0'),
                    usdValue: parseFloat(c.usdValue || '0')
                  });
                }
              });
            }
          });
        }
        const filteredCoins = allCoins.filter(c => c.usdValue > 0.01);
        setBybitCoins(filteredCoins);

        // Record balance history point
        const currentBybitIdr = data.totalUsdValue * exchangeRate;
        const todayStr = new Date().toLocaleDateString('id-ID', { day: '2-digit', month: 'short' });
        const todayKey = new Date().toISOString().split('T')[0];
        
        setLiveHistory(prev => {
          const filtered = prev.filter(item => item.dateKey !== todayKey);
          const updated = [...filtered, { dateKey: todayKey, date: todayStr, amount: currentBybitIdr }];
          updated.sort((a, b) => a.dateKey.localeCompare(b.dateKey));
          localStorage.setItem('balance_history', JSON.stringify(updated));
          return updated;
        });

        setSuccessMsg('Sinkronisasi Bybit berhasil!');
        if (successTimeoutRef.current) clearTimeout(successTimeoutRef.current);
        successTimeoutRef.current = setTimeout(() => setSuccessMsg(null), 3000);

        if (currentBybitIdr >= TARGET_IDR) {
          celebrate();
        }

        // Trigger positions & history updates silently in background on sync
        fetchActivePositions(true);
        fetchClosedPnl();
      } else {
        setErrorMsg(data.error || 'Autentikasi Bybit ditolak.');
      }
    } catch (err) {
      setErrorMsg('Koneksi proxy gagal. Pastikan backend server anda sudah menyala.');
    } finally {
      setLoading(false);
    }
  };

  // Financial calculations
  const currentBybitUsd = bybitBalanceUsd;
  
  // Consolidated balance (Bybit balance)
  const totalActualBalanceUsd = currentBybitUsd;
  const totalActualBalance = totalActualBalanceUsd * exchangeRate;
  
  const progressPercentage = Math.min(100, (totalActualBalance / TARGET_IDR) * 100);
  const remainingNeeded = Math.max(0, TARGET_IDR - totalActualBalance);
  
  const today = new Date();
  today.setHours(0,0,0,0);
  const msDiff = TARGET_DATE.getTime() - today.getTime();
  const daysRemaining = Math.max(1, Math.ceil(msDiff / (1000 * 60 * 60 * 24)));
  const dailyTargetRequired = remainingNeeded / daysRemaining;

  // Win Rate (WR) calculations from Bybit History
  const totalTrades = bybitHistory.length;
  const wins = bybitHistory.filter(log => parseFloat(log.closedPnl || '0') > 0).length;
  const losses = bybitHistory.filter(log => parseFloat(log.closedPnl || '0') < 0).length;
  const winRate = totalTrades > 0 ? (wins / totalTrades) * 100 : 0;

  // Get win streak helper from Bybit History
  const getWinStreak = () => {
    let streak = 0;
    for (const log of bybitHistory) {
      const pnl = parseFloat(log.closedPnl || '0');
      if (pnl > 0) streak++;
      else if (pnl < 0) break;
    }
    return streak;
  };
  const winStreak = getWinStreak();

  // Acceleration Insight calculations
  const totalDays = Math.ceil((TARGET_DATE.getTime() - START_DATE.getTime()) / (1000 * 60 * 60 * 24));
  const daysFromStart = Math.max(0, Math.ceil((today.getTime() - START_DATE.getTime()) / (1000 * 60 * 60 * 24)));
  const initialTargetVal = 10000000;
  const targetSlope = (TARGET_IDR - initialTargetVal) / totalDays;
  const targetValToday = Math.round(initialTargetVal + targetSlope * daysFromStart);
  
  const idealDiff = totalActualBalance - targetValToday;
  const idealDiffPct = targetValToday > 0 ? (idealDiff / targetValToday) * 100 : 0;

  const activeCoins = bybitCoins;

  // Trading Calendar grid math
  const getDaysInMonth = () => {
    const date = new Date();
    const year = date.getFullYear();
    const month = date.getMonth(); // June (5) or dynamic
    const firstDayIndex = new Date(year, month, 1).getDay(); // Day of week (0-6)
    const totalDays = new Date(year, month + 1, 0).getDate();
    return { year, month, firstDayIndex, totalDays };
  };

  const { year, month, firstDayIndex, totalDays: daysInMonth } = getDaysInMonth();
  const monthName = new Date(year, month).toLocaleString('id-ID', { month: 'long', year: 'numeric' });

  // Generate calendar days array
  const calendarDays = [];
  for (let i = 0; i < firstDayIndex; i++) {
    calendarDays.push({ isEmpty: true });
  }
  for (let day = 1; day <= daysInMonth; day++) {
    const dateStr = `${year}-${(month + 1).toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`;
    calendarDays.push({ isEmpty: false, day, dateStr });
  }

  // Helper to get local date string YYYY-MM-DD from timestamp
  const getLocalDateStr = (timestamp) => {
    if (!timestamp) return '';
    const d = new Date(parseInt(timestamp));
    const yr = d.getFullYear();
    const mo = String(d.getMonth() + 1).padStart(2, '0');
    const dy = String(d.getDate()).padStart(2, '0');
    return `${yr}-${mo}-${dy}`;
  };

  // Group profits by local date string from Bybit History
  const calendarProfits = bybitHistory.reduce((acc, log) => {
    const dateStr = getLocalDateStr(log.createdTime);
    if (dateStr) {
      acc[dateStr] = (acc[dateStr] || 0) + parseFloat(log.closedPnl || '0');
    }
    return acc;
  }, {});

  // Get selected day profit logs from Bybit History
  const selectedDayTotal = bybitHistory
    .filter(log => getLocalDateStr(log.createdTime) === selectedDate)
    .reduce((sum, log) => sum + parseFloat(log.closedPnl || '0'), 0);

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

      const daysFromStart = Math.ceil((today.getTime() - START_DATE.getTime()) / (1000 * 60 * 60 * 24));
      if (dayOffset <= daysFromStart) {
        if (liveHistory.length > 0) {
          const closest = [...liveHistory]
            .reverse()
            .find(h => h.dateKey <= dateKey);
          
          if (closest) {
            actualVal = closest.amount;
          } else {
            const oldestPoint = liveHistory[0];
            const oldestDate = new Date(oldestPoint.dateKey);
            const totalDaysToOldest = Math.max(1, Math.ceil((oldestDate.getTime() - START_DATE.getTime()) / (1000 * 60 * 60 * 24)));
            const currentDate = new Date(dateKey);
            const daysFromStartPoint = Math.ceil((currentDate.getTime() - START_DATE.getTime()) / (1000 * 60 * 60 * 24));
            const frac = Math.max(0, Math.min(1, daysFromStartPoint / totalDaysToOldest));
            const startVal = 28000000;
            actualVal = Math.round(startVal + (oldestPoint.amount - startVal) * frac);
          }
        } else {
          const frac = dayOffset / daysFromStart;
          const base = 28000000 + (totalActualBalance - 28000000) * frac;
          actualVal = Math.round(base);
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
    <div className="deck-perspective" style={{ animation: 'fadeIn 0.5s ease' }}>
      {/* Toast Alert Popups */}
      {successMsg && (
        <div style={{
          position: 'fixed', top: '24px', right: '24px', zIndex: 10000,
          background: 'var(--bg-card)', border: '1px solid var(--color-lime)',
          color: '#fff', padding: '0.8rem 1.4rem', borderRadius: '30px',
          boxShadow: '0 4px 20px rgba(212, 255, 58, 0.15)', display: 'flex', alignItems: 'center', gap: '0.6rem',
          fontWeight: 600, animation: 'fadeIn 0.3s ease', backdropFilter: 'blur(8px)',
          fontFamily: 'var(--sans)'
        }}>
          <CheckCircle size={16} color="var(--color-lime)" /> {successMsg}
        </div>
      )}
      {errorMsg && (
        <div style={{
          position: 'fixed', top: '24px', right: '24px', zIndex: 10000,
          background: 'var(--bg-card)', border: '1px solid var(--color-crimson)',
          color: '#fff', padding: '0.8rem 1.4rem', borderRadius: '30px',
          boxShadow: '0 4px 20px rgba(255, 59, 48, 0.15)', display: 'flex', alignItems: 'center', gap: '0.6rem',
          fontWeight: 600, animation: 'fadeIn 0.3s ease', backdropFilter: 'blur(8px)',
          fontFamily: 'var(--sans)'
        }}>
          <AlertCircle size={16} color="var(--color-crimson)" /> {errorMsg}
        </div>
      )}

      {/* Main Console */}
      <main ref={consoleRef} className="deck-console">
        
        {/* Top Navigation Bar matching reference image */}
        <nav className="top-nav header-animate">
          <div className="nav-links" style={{ alignItems: 'center' }}>
            <button 
              className={`nav-link ${activeTab === 'overview' ? 'active' : ''}`}
              onClick={() => setActiveTab('overview')}
            >
              <Activity size={13} />
              Overview
            </button>
            <button 
              className={`nav-link ${activeTab === 'analytics' ? 'active' : ''}`}
              onClick={() => setActiveTab('analytics')}
            >
              Insights
            </button>


            {/* Daily Profit Target Badge */}
            <div className="badge-pill" style={{ background: 'rgba(255, 59, 48, 0.1)', color: 'var(--color-crimson)', padding: '0.4rem 0.8rem', borderRadius: '30px', fontSize: '0.75rem', fontWeight: 700, fontFamily: 'var(--mono)', border: '1px solid rgba(255, 59, 48, 0.2)' }}>
              🎯 Target: Rp {Math.round(dailyTargetRequired).toLocaleString('id-ID')}/Hari
            </div>
          </div>
          
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <span style={{ fontFamily: 'var(--mono)', fontSize: '0.7rem', color: 'var(--text-secondary)' }}>
              UTC: {new Date().toISOString().substring(11, 16)}
            </span>
            <div className="profile-circle">
              CX
            </div>
          </div>
        </nav>

        {/* Dashboard Title Header */}
        <header className="header-animate" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: '1rem', marginTop: '0.5rem' }}>
          <div>
            <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Welcome back,</span>
            <h1 style={{ marginTop: '0.2rem', fontSize: '2.5rem', fontWeight: '800' }}>
              Road To 100JT <span style={{ color: 'var(--color-lavender)', fontWeight: '300' }}>Terminal</span>
            </h1>
          </div>

          {/* Countdown Clock */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.3rem' }}>
            <span className="label-muted">Sept 10 Goal Countdown</span>
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

        {/* Grid 3x Cards Layout (Matching reference card blocks) */}
        <section className="grid-3x card-animate">
          {/* Card 1: Consolidated Equity */}
          <div className="reference-card">
            <div className="card-top">
              <span className="card-title">Consolidated Equity</span>
              <button className="arrow-btn" onClick={() => mode === 'live' && fetchLiveBalance()}>
                <RefreshCw size={13} className={loading ? 'spin-anim' : ''} />
              </button>
            </div>
            <div>
              <div className="card-value">
                $<CountUp value={totalActualBalanceUsd} decimals={2} />
              </div>
              <span className="card-subtext">
                Equiv: Rp <CountUp value={totalActualBalance} /> @ {exchangeRate}/$
              </span>
            </div>
          </div>

          {/* Card 2: Win Rate & Streak */}
          <div className="reference-card">
            <div className="card-top">
              <span className="card-title">Win Rate Telemetry</span>
              <div className="arrow-btn">
                <ArrowUpRight size={14} />
              </div>
            </div>
            <div>
              <div className="card-value">
                <CountUp value={winRate} decimals={1} />%
              </div>
              <span className="card-subtext">
                Streak: {winStreak} wins | W: {wins} / L: {losses}
              </span>
            </div>
          </div>

          {/* Card 3: Highlighted Lime Green Card for Milestone Completed */}
          <div className="reference-card lime-accent">
            <div className="card-top">
              <span className="card-title">Milestone Progress</span>
              <button className="arrow-btn" onClick={celebrate}>
                🎉
              </button>
            </div>
            <div>
              <div className="card-value">
                <CountUp value={progressPercentage} decimals={1} />%
              </div>
              <span className="card-subtext">
                Target: Rp 100M | Gap: Rp <CountUp value={remainingNeeded} /> | Butuh: Rp <CountUp value={dailyTargetRequired} />/hari
              </span>
            </div>
          </div>
        </section>

        {/* Asymmetric Core grid */}
        <div className="grid-asymmetric card-animate">
          
          {/* Left Column: Recharts Area Chart & Trading Calendar */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
            
            {/* Progression Chart */}
            <section className="obsidian-card" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h2 style={{ fontSize: '0.8rem' }}>Trajectory Log Slope</h2>
                <span className="label-muted">Target Slope vs Bybit Balance</span>
              </div>
              <ProgressionChart chartData={chartData} />
            </section>

            {/* Trading Calendar Card */}
            <section className="obsidian-card" style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              <div className="calendar-header">
                <div>
                  <h2 style={{ fontSize: '0.85rem' }}>Trading Calendar</h2>
                  <span className="label-muted" style={{ display: 'block', marginTop: '0.15rem' }}>Pilih tanggal untuk log profit</span>
                </div>
                <span className="badge-pill" style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--color-lime)', fontFamily: 'var(--mono)' }}>
                  {monthName.toUpperCase()}
                </span>
              </div>

              <div className="calendar-grid">
                {/* Day Labels */}
                <div className="calendar-day-label">Su</div>
                <div className="calendar-day-label">Mo</div>
                <div className="calendar-day-label">Tu</div>
                <div className="calendar-day-label">We</div>
                <div className="calendar-day-label">Th</div>
                <div className="calendar-day-label">Fr</div>
                <div className="calendar-day-label">Sa</div>

                {/* Calendar Days */}
                {calendarDays.map((cDay, idx) => {
                  if (cDay.isEmpty) {
                    return <div key={`empty-${idx}`} className="calendar-day empty" />;
                  }

                  const dateProfit = calendarProfits[cDay.dateStr] || 0;
                  const isSelected = selectedDate === cDay.dateStr;

                  return (
                    <div 
                      key={`day-${cDay.day}`} 
                      className={`calendar-day ${isSelected ? 'selected' : ''}`}
                      onClick={() => setSelectedDate(cDay.dateStr)}
                    >
                      {cDay.day}
                      {dateProfit !== 0 && (
                        <span className={`calendar-dot ${dateProfit > 0 ? 'profit' : 'loss'}`} />
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          </div>

          {/* Right Column: Switcher panel (Assets vs Journal) */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
            
            {/* Selected Date telemetry details */}
            <section className="obsidian-card" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <span className="label-muted">SELECTED TARGET DATE</span>
                  <div style={{ fontSize: '0.95rem', fontWeight: 700, fontFamily: 'var(--mono)', marginTop: '0.15rem' }}>
                    {new Date(selectedDate).toLocaleDateString('id-ID', { day: '2-digit', month: 'long', year: 'numeric' })}
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <span className="label-muted">PROFIT/LOSS DELTA</span>
                  <div className={`text-number`} style={{ fontSize: '1rem', fontWeight: 700, color: selectedDayTotal > 0 ? 'var(--color-green-profit)' : (selectedDayTotal < 0 ? 'var(--color-crimson)' : 'var(--text-secondary)') }}>
                    {selectedDayTotal > 0 ? '+' : ''}${selectedDayTotal.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                  </div>
                </div>
              </div>
            </section>

            {/* Asset Distribution & Trade Journal switcher */}
            <section className="obsidian-card" style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', flex: 1 }}>
              <div className="tabs-container" style={{ borderRadius: '30px', display: 'flex', flexWrap: 'wrap', gap: '2px' }}>
                <button 
                  className={`tab-btn ${rightPanelTab === 'assets' ? 'active' : ''}`}
                  onClick={() => setRightPanelTab('assets')}
                  style={{ flex: '1 1 auto', justifyContent: 'center', borderRadius: '30px' }}
                >
                  Assets
                </button>
                <button 
                  className={`tab-btn ${rightPanelTab === 'positions' ? 'active' : ''}`}
                  onClick={() => setRightPanelTab('positions')}
                  style={{ flex: '1 1 auto', justifyContent: 'center', borderRadius: '30px', gap: '0.3rem' }}
                >
                  Positions {activePositions.length > 0 && <span className="position-count-badge">{activePositions.length}</span>}
                </button>
                <button 
                  className={`tab-btn ${rightPanelTab === 'history' ? 'active' : ''}`}
                  onClick={() => setRightPanelTab('history')}
                  style={{ flex: '1 1 auto', justifyContent: 'center', borderRadius: '30px' }}
                >
                  Bybit History
                </button>
              </div>

              {/* Tab Content: Bybit Assets */}
              {rightPanelTab === 'assets' && (
                <div className="crypto-list" style={{ maxHeight: '380px', overflowY: 'auto' }}>
                  {activeCoins.map(c => {
                    const allocationPct = currentBybitUsd > 0 ? (c.usdValue / currentBybitUsd) * 100 : 0;
                    return (
                      <div key={c.coin} className="crypto-row">
                        <div className="crypto-left">
                          <div className="coin-icon-circle lime-text">
                            {c.coin.substring(0, 3)}
                          </div>
                          <div className="crypto-details">
                            <span className="crypto-name">{c.coin}</span>
                            <span className="crypto-sub">
                              {c.walletBalance.toLocaleString('id-ID', { maximumFractionDigits: 4 })} coins
                            </span>
                          </div>
                        </div>
                        <div className="crypto-right">
                          <span className="crypto-val">${c.usdValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                          <span className="crypto-sub">{allocationPct.toFixed(1)}% share</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Tab Content: Active Positions */}
              {rightPanelTab === 'positions' && (
                <div className="crypto-list" style={{ maxHeight: '380px', overflowY: 'auto' }}>
                  {positionsLoading ? (
                    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', margin: '2rem 0' }}>
                      <RefreshCw size={20} className="spin-anim" />
                    </div>
                  ) : activePositions.length === 0 ? (
                    <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontStyle: 'italic', textAlign: 'center', margin: '2rem 0' }}>
                      Tidak ada posisi aktif saat ini.
                    </p>
                  ) : (
                    activePositions.map((pos, index) => {
                      const uPnl = parseFloat(pos.unrealisedPnl || '0');
                      const leverage = parseFloat(pos.leverage || '1');
                      const posValue = parseFloat(pos.positionValue || '0');
                      const posIM = parseFloat(pos.positionIM || '0');
                      
                      let roi = 0;
                      if (posIM > 0) {
                        roi = (uPnl / posIM) * 100;
                      } else if (posValue > 0 && leverage > 0) {
                        roi = (uPnl / (posValue / leverage)) * 100;
                      }

                      const isLong = pos.side === 'Buy';
                      const pnlIdr = uPnl * exchangeRate;

                      return (
                        <div key={`${pos.symbol}-${index}`} className="crypto-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: '0.5rem', padding: '1rem' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                              <span className="crypto-name" style={{ fontSize: '0.9rem' }}>{pos.symbol}</span>
                              <span className={`direction-badge ${isLong ? 'long' : 'short'}`}>
                                {isLong ? 'LONG' : 'SHORT'} {leverage}x
                              </span>
                            </div>
                            <span className={`roi-badge ${uPnl >= 0 ? 'profit' : 'loss'}`}>
                              {uPnl >= 0 ? '+' : ''}{roi.toFixed(2)}%
                            </span>
                          </div>

                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.4rem', fontSize: '0.75rem', color: 'var(--text-secondary)', fontFamily: 'var(--mono)', borderTop: '1px solid rgba(255,255,255,0.02)', paddingTop: '0.4rem' }}>
                            <div>Size: <span style={{ color: '#fff' }}>{parseFloat(pos.size).toLocaleString('en-US', { maximumFractionDigits: 6 })}</span></div>
                            <div style={{ textAlign: 'right' }}>Liq. Price: <span style={{ color: 'var(--color-crimson)' }}>{parseFloat(pos.liqPrice || '0').toLocaleString('en-US', { maximumFractionDigits: 4 })}</span></div>
                            <div>Entry: <span style={{ color: '#fff' }}>{parseFloat(pos.entryPrice || '0').toLocaleString('en-US', { maximumFractionDigits: 4 })}</span></div>
                            <div style={{ textAlign: 'right' }}>Mark: <span style={{ color: '#fff' }}>{parseFloat(pos.markPrice || '0').toLocaleString('en-US', { maximumFractionDigits: 4 })}</span></div>
                          </div>

                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid rgba(255,255,255,0.02)', paddingTop: '0.4rem', marginTop: '0.2rem' }}>
                            <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>UNREALIZED PNL</span>
                            <div style={{ textAlign: 'right', fontFamily: 'var(--mono)' }}>
                              <div className={`crypto-val ${uPnl >= 0 ? 'profit' : 'loss'}`} style={{ fontSize: '0.85rem' }}>
                                {uPnl >= 0 ? '+' : ''}${uPnl.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                              </div>
                              <div style={{ fontSize: '0.7rem', color: uPnl >= 0 ? 'var(--color-green-profit)' : 'var(--color-crimson)', opacity: 0.8 }}>
                                {uPnl >= 0 ? '+' : ''}Rp {Math.round(pnlIdr).toLocaleString('id-ID')}
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              )}

              {/* Tab Content: Bybit Closed PnL History */}
              {rightPanelTab === 'history' && (
                <div className="crypto-list" style={{ maxHeight: '380px', overflowY: 'auto' }}>
                  {historyLoading ? (
                    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', margin: '2rem 0' }}>
                      <RefreshCw size={20} className="spin-anim" />
                    </div>
                  ) : bybitHistory.length === 0 ? (
                    <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontStyle: 'italic', textAlign: 'center', margin: '2rem 0' }}>
                      Tidak ada riwayat perdagangan di Bybit.
                    </p>
                  ) : (
                    bybitHistory.map((log, index) => {
                      const pnl = parseFloat(log.closedPnl || '0');
                      const pnlIdr = pnl * exchangeRate;
                      const date = new Date(parseInt(log.createdTime));
                      const dateStr = date.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });

                      return (
                        <div key={`${log.symbol}-${index}`} className="crypto-row" style={{ padding: '0.8rem 1rem' }}>
                          <div className="crypto-left">
                            <div className={`coin-icon-circle ${pnl >= 0 ? 'lime-text' : 'lavender-text'}`}>
                              {log.symbol.substring(0, 3)}
                            </div>
                            <div className="crypto-details">
                              <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                                <span className="crypto-name" style={{ fontSize: '0.8rem' }}>{log.symbol}</span>
                                <span className={`direction-badge ${log.side === 'Buy' ? 'long' : 'short'}`} style={{ fontSize: '0.55rem', padding: '0.1rem 0.3rem' }}>
                                  {log.side === 'Buy' ? 'CLOSE SHORT' : 'CLOSE LONG'}
                                </span>
                              </div>
                              <span className="crypto-sub" style={{ fontSize: '0.65rem', marginTop: '0.1rem' }}>
                                {dateStr} | Exit: {parseFloat(log.exitPrice || '0').toLocaleString('en-US', { maximumFractionDigits: 4 })}
                              </span>
                            </div>
                          </div>
                          <div className="crypto-right">
                            <span className={`crypto-val ${pnl >= 0 ? 'profit' : 'loss'}`} style={{ fontSize: '0.8rem' }}>
                              {pnl >= 0 ? '+' : ''}${pnl.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </span>
                            <span className="crypto-sub" style={{ fontSize: '0.65rem', color: pnl >= 0 ? 'var(--color-green-profit)' : 'var(--color-crimson)', opacity: 0.8 }}>
                              {pnl >= 0 ? '+' : ''}Rp {Math.round(pnlIdr).toLocaleString('id-ID')}
                            </span>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              )}


            </section>
          </div>
        </div>

        {/* Footer */}
        <footer style={{ display: 'flex', justifyContent: 'space-between', padding: '1rem 0', fontSize: '0.7rem', color: 'var(--text-muted)', borderTop: '1px solid var(--border-light)', fontFamily: 'var(--mono)', marginTop: '1rem' }}>
          <span>PORTFOLIO CORE TELEMETRY v7.0</span>
          <span>ACCELERATOR LIMIT: 10 SEPTEMBER 2026</span>
        </footer>

      </main>
    </div>
  );
}
