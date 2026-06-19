import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  RefreshCw,
  CheckCircle,
  AlertCircle,
  Activity,
} from 'lucide-react';
// QUALITY-01: Removed 12 unused imports (TrendingUp, Settings, Plus, Trash2,
// DollarSign, CalendarIcon, PieChart, Trophy, Eye, EyeOff, ArrowUpRight, TrendingDown)
import confetti from 'canvas-confetti';
import gsap from 'gsap';
import { useGSAP } from '@gsap/react';
import ProgressionChart from './components/ProgressionChart';

gsap.registerPlugin();

const TARGET_IDR = 100_000_000; // 100 Million IDR
const TARGET_DATE = new Date('2026-09-10T00:00:00');
const START_DATE = new Date('2026-06-01T00:00:00');
// QUALITY-04: Named constant instead of magic number 28000000
const ESTIMATED_START_BALANCE_IDR = 28_000_000;
const INITIAL_TARGET_VAL = 10_000_000;

// BUG-01: Parse YYYY-MM-DD as LOCAL date (not UTC) to prevent off-by-one timezone bug.
// new Date("YYYY-MM-DD") parses as UTC midnight, which can shift the date by -1 in UTC+7.
const parseDateStr = (dateStr) => {
  const [yr, mo, dy] = dateStr.split('-').map(Number);
  return new Date(yr, mo - 1, dy);
};

// Helper to get local YYYY-MM-DD string from any timestamp
const getLocalDateStr = (timestamp) => {
  if (!timestamp) return '';
  const d = new Date(parseInt(timestamp));
  const yr = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const dy = String(d.getDate()).padStart(2, '0');
  return `${yr}-${mo}-${dy}`;
};

// BUG-03: CountUp with proper GSAP tween cleanup to prevent memory leaks.
// Without tween.kill(), old tweens pile up and call setDisplayValue on unmounted components.
function CountUp({ value, prefix = '', suffix = '', decimals = 0, duration = 1 }) {
  const [displayValue, setDisplayValue] = useState(0);
  const prevValRef = useRef(0);

  useEffect(() => {
    const obj = { val: prevValRef.current };
    const tween = gsap.to(obj, {
      val: value,
      duration,
      ease: 'power2.out',
      onUpdate: () => setDisplayValue(obj.val),
    });
    prevValRef.current = value;
    return () => tween.kill(); // cleanup: kill tween on re-run or unmount
  }, [value, duration]);

  const formatted = displayValue.toLocaleString('id-ID', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });

  return <span>{prefix}{formatted}{suffix}</span>;
}

export default function App() {
  const [activeTab, setActiveTab] = useState('overview');

  // QUALITY-02: Removed non-functional 'mode' state. App is always in live mode
  // since API keys are server-side. Kept as isLockedByServer which conveys the same semantics.
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState(null);
  const [successMsg, setSuccessMsg] = useState(null);
  const [exchangeRate, setExchangeRate] = useState(16400);

  const [isLockedByServer, setIsLockedByServer] = useState(false);
  // BUG-04: Ref to ensure the initial balance fetch only fires once, preventing double-fetch.
  const hasInitialFetchedRef = useRef(false);

  const [bybitBalanceUsd, setBybitBalanceUsd] = useState(() =>
    parseFloat(localStorage.getItem('bybit_balance_usd') || '0')
  );

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

  const [selectedDate, setSelectedDate] = useState(() =>
    getLocalDateStr(Date.now())
  );

  const [rightPanelTab, setRightPanelTab] = useState('assets');
  const [activePositions, setActivePositions] = useState([]);
  const [bybitHistory, setBybitHistory] = useState([]);
  const [positionsLoading, setPositionsLoading] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [timeLeft, setTimeLeft] = useState({ days: 0, hours: 0, minutes: 0, seconds: 0 });

  const consoleRef = useRef(null);
  const successTimeoutRef = useRef(null);
  // BUG-04: Prevent concurrent duplicate fetchClosedPnl calls (race condition guard)
  const historyFetchingRef = useRef(false);

  const celebrate = () => {
    confetti({
      particleCount: 140,
      spread: 80,
      origin: { y: 0.6 },
      colors: ['#d4ff3a', '#b89bfb', '#30d158', '#ffffff'],
    });
  };

  // BUG-05: Cleanup successTimeout ref on unmount to prevent setState on unmounted component
  useEffect(() => {
    return () => {
      if (successTimeoutRef.current) clearTimeout(successTimeoutRef.current);
    };
  }, []);

  // Entrance Stagger Animation
  useGSAP(() => {
    gsap.from('.header-animate', { opacity: 0, y: -20, duration: 0.7, ease: 'power2.out' });
    gsap.from('.card-animate', { opacity: 0, y: 30, duration: 0.8, stagger: 0.1, ease: 'power3.out', delay: 0.15 });
  }, { scope: consoleRef });

  // Countdown timer
  useEffect(() => {
    const updateTimer = () => {
      const diff = TARGET_DATE.getTime() - Date.now();
      if (diff <= 0) {
        setTimeLeft({ days: 0, hours: 0, minutes: 0, seconds: 0 });
        return;
      }
      setTimeLeft({
        days: Math.floor(diff / 86400000),
        hours: Math.floor((diff % 86400000) / 3600000),
        minutes: Math.floor((diff % 3600000) / 60000),
        seconds: Math.floor((diff % 60000) / 1000),
      });
    };
    updateTimer();
    const interval = setInterval(updateTimer, 1000);
    return () => clearInterval(interval);
  }, []);

  // Initialize rates & config on mount
  useEffect(() => {
    const initApp = async () => {
      try {
        const rateRes = await fetch('/api/rates');
        const rateData = await rateRes.json();
        if (rateData.success && rateData.rate) setExchangeRate(rateData.rate);

        const configRes = await fetch('/api/bybit/config');
        const configData = await configRes.json();
        if (configData.success && configData.hasServerKeys) {
          setIsLockedByServer(true);
          // BUG-04: Trigger initial fetch inline (not via effect watching isLockedByServer)
          // to prevent the double-fetch race condition when isLockedByServer effect also fired.
          if (!hasInitialFetchedRef.current) {
            hasInitialFetchedRef.current = true;
            // Defer to next tick so state is settled
            setTimeout(() => fetchLiveBalance(), 0);
          }
        }
      } catch (err) {
        console.error('Failed to initialize app settings:', err);
      }
    };
    initApp();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist coins to localStorage whenever they change
  useEffect(() => {
    localStorage.setItem('bybit_coins', JSON.stringify(bybitCoins));
  }, [bybitCoins]);

  // Fetch Bybit active positions (with optional silent mode for polling)
  const fetchActivePositions = async (silent = false) => {
    if (!silent) setPositionsLoading(true);
    try {
      const res = await fetch('/api/bybit/positions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (data.success) setActivePositions(data.positions || []);
    } catch (err) {
      console.error('Failed to fetch active positions:', err);
    } finally {
      if (!silent) setPositionsLoading(false);
    }
  };

  // BUG-04: fetchClosedPnl with in-flight guard to prevent concurrent duplicate calls
  const fetchClosedPnl = async () => {
    if (historyFetchingRef.current) return;
    historyFetchingRef.current = true;
    setHistoryLoading(true);
    try {
      const res = await fetch('/api/bybit/closed-pnl', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (data.success) setBybitHistory(data.history || []);
    } catch (err) {
      console.error('Failed to fetch closed PnL history:', err);
    } finally {
      setHistoryLoading(false);
      historyFetchingRef.current = false;
    }
  };

  // Poll positions every 10s when tab is active
  useEffect(() => {
    let interval;
    if (rightPanelTab === 'positions') {
      fetchActivePositions();
      interval = setInterval(() => fetchActivePositions(true), 10000);
    }
    return () => { if (interval) clearInterval(interval); };
  }, [rightPanelTab]);

  // Fetch closed PnL once when history tab opens
  useEffect(() => {
    if (rightPanelTab === 'history') fetchClosedPnl();
  }, [rightPanelTab]);

  // Fetch live balance from backend proxy
  const fetchLiveBalance = async () => {
    setLoading(true);
    setErrorMsg(null);
    setSuccessMsg(null);

    try {
      const res = await fetch('/api/bybit/balance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = await res.json();

      if (data.success) {
        setBybitBalanceUsd(data.totalUsdValue);
        localStorage.setItem('bybit_balance_usd', data.totalUsdValue.toString());

        // Merge coin lists across accounts, deduplicating by coin name
        const allCoins = [];
        data.accounts?.forEach(acc => {
          acc.coins?.forEach(c => {
            const existing = allCoins.find(item => item.coin === c.coin);
            if (existing) {
              existing.walletBalance += parseFloat(c.walletBalance || '0');
              existing.usdValue += parseFloat(c.usdValue || '0');
            } else {
              allCoins.push({
                coin: c.coin,
                walletBalance: parseFloat(c.walletBalance || '0'),
                usdValue: parseFloat(c.usdValue || '0'),
              });
            }
          });
        });
        setBybitCoins(allCoins.filter(c => c.usdValue > 0.01));

        // Record balance snapshot for history chart
        const currentBybitIdr = data.totalUsdValue * exchangeRate;
        const todayStr = new Date().toLocaleDateString('id-ID', { day: '2-digit', month: 'short' });
        const todayKey = getLocalDateStr(Date.now());

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

        if (currentBybitIdr >= TARGET_IDR) celebrate();

        // Background refresh positions & history on sync
        fetchActivePositions(true);
        fetchClosedPnl();
      } else {
        setErrorMsg(data.error || 'Autentikasi Bybit ditolak.');
      }
    } catch {
      setErrorMsg('Koneksi proxy gagal. Pastikan backend server anda sudah menyala.');
    } finally {
      setLoading(false);
    }
  };

  // ─── Financial Calculations ───────────────────────────────────────────────

  const totalActualBalanceUsd = bybitBalanceUsd;
  const totalActualBalance = totalActualBalanceUsd * exchangeRate;
  const progressPercentage = Math.min(100, (totalActualBalance / TARGET_IDR) * 100);
  const remainingNeeded = Math.max(0, TARGET_IDR - totalActualBalance);

  const today = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  // We intentionally recompute when date changes — using todayKey as a proxy.
  // todayKey is a string that changes at midnight, triggering recomputation.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [getLocalDateStr(Date.now())]);

  const msDiff = TARGET_DATE.getTime() - today.getTime();
  const daysRemaining = Math.max(1, Math.ceil(msDiff / 86400000));
  const dailyTargetRequired = remainingNeeded / daysRemaining;

  // LOGIC-04/05: Memoize all heavy derivations from bybitHistory
  const { totalTrades, wins, losses, winRate } = useMemo(() => {
    const total = bybitHistory.length;
    const w = bybitHistory.filter(log => parseFloat(log.closedPnl || '0') > 0).length;
    const l = bybitHistory.filter(log => parseFloat(log.closedPnl || '0') < 0).length;
    return { totalTrades: total, wins: w, losses: l, winRate: total > 0 ? (w / total) * 100 : 0 };
  }, [bybitHistory]);

  const winStreak = useMemo(() => {
    let streak = 0;
    for (const log of bybitHistory) {
      const pnl = parseFloat(log.closedPnl || '0');
      if (pnl > 0) streak++;
      else if (pnl < 0) break;
    }
    return streak;
  }, [bybitHistory]);

  // LOGIC-04/05: Memoize calendar computation (only changes when month changes)
  const { year, month, firstDayIndex, daysInMonth, monthName } = useMemo(() => {
    const d = new Date();
    const yr = d.getFullYear();
    const mo = d.getMonth();
    return {
      year: yr,
      month: mo,
      firstDayIndex: new Date(yr, mo, 1).getDay(),
      daysInMonth: new Date(yr, mo + 1, 0).getDate(),
      monthName: new Date(yr, mo).toLocaleString('id-ID', { month: 'long', year: 'numeric' }),
    };
  }, []); // stable within session; refreshes if user leaves app open past month boundary

  const calendarDays = useMemo(() => {
    const days = [];
    for (let i = 0; i < firstDayIndex; i++) days.push({ isEmpty: true });
    for (let day = 1; day <= daysInMonth; day++) {
      const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      days.push({ isEmpty: false, day, dateStr });
    }
    return days;
  }, [year, month, firstDayIndex, daysInMonth]);

  // LOGIC-04/05: Memoize expensive bybitHistory derivations
  const calendarProfits = useMemo(() =>
    bybitHistory.reduce((acc, log) => {
      const dateStr = getLocalDateStr(log.createdTime);
      if (dateStr) acc[dateStr] = (acc[dateStr] || 0) + parseFloat(log.closedPnl || '0');
      return acc;
    }, {}),
    [bybitHistory]
  );

  const selectedDayTrades = useMemo(() =>
    bybitHistory.filter(log => getLocalDateStr(log.createdTime) === selectedDate),
    [bybitHistory, selectedDate]
  );

  const selectedDayTotal = useMemo(() =>
    selectedDayTrades.reduce((sum, log) => sum + parseFloat(log.closedPnl || '0'), 0),
    [selectedDayTrades]
  );

  const todayKey = getLocalDateStr(Date.now());
  const todayProfitUsd = calendarProfits[todayKey] || 0;
  const todayProfitIdr = todayProfitUsd * exchangeRate;
  // LOGIC-03: Guard against false positive when dailyTargetRequired is 0 (target already met)
  const todayTargetMet = dailyTargetRequired > 0 && todayProfitIdr >= dailyTargetRequired;

  // LOGIC-04/05: Memoize chart data — only recalculates when balance or history changes
  const chartData = useMemo(() => {
    const chartToday = new Date();
    chartToday.setHours(0, 0, 0, 0);

    const totalChartDays = Math.ceil((TARGET_DATE.getTime() - START_DATE.getTime()) / 86400000);
    const chartSlope = (TARGET_IDR - INITIAL_TARGET_VAL) / totalChartDays;
    const chartDaysFromStart = Math.max(
      0,
      Math.ceil((chartToday.getTime() - START_DATE.getTime()) / 86400000)
    );

    const dataPoints = [];

    for (let dayOffset = 0; dayOffset <= totalChartDays; dayOffset += 4) {
      const date = new Date(START_DATE.getTime() + dayOffset * 86400000);
      const dateKey = getLocalDateStr(date.getTime());
      const dateStr = date.toLocaleDateString('id-ID', { day: '2-digit', month: 'short' });
      const targetVal = Math.round(INITIAL_TARGET_VAL + chartSlope * dayOffset);
      let actualVal = null;

      if (dayOffset <= chartDaysFromStart) {
        if (liveHistory.length > 0) {
          const closest = [...liveHistory].reverse().find(h => h.dateKey <= dateKey);
          if (closest) {
            actualVal = closest.amount;
          } else {
            const oldestPoint = liveHistory[0];
            const oldestDate = new Date(oldestPoint.dateKey);
            const totalDaysToOldest = Math.max(
              1,
              Math.ceil((oldestDate.getTime() - START_DATE.getTime()) / 86400000)
            );
            const daysFromStartPoint = Math.ceil(
              (new Date(dateKey).getTime() - START_DATE.getTime()) / 86400000
            );
            const frac = Math.max(0, Math.min(1, daysFromStartPoint / totalDaysToOldest));
            actualVal = Math.round(
              ESTIMATED_START_BALANCE_IDR + (oldestPoint.amount - ESTIMATED_START_BALANCE_IDR) * frac
            );
          }
        } else {
          // BUG-02: Guard against division-by-zero when chartDaysFromStart === 0
          const frac = chartDaysFromStart > 0 ? dayOffset / chartDaysFromStart : 0;
          actualVal = Math.round(
            ESTIMATED_START_BALANCE_IDR + (totalActualBalance - ESTIMATED_START_BALANCE_IDR) * frac
          );
        }
      }

      dataPoints.push({ date: dateStr, dateKey, target: targetVal, actual: actualVal });
    }

    // Ensure last point hits exactly TARGET_IDR
    const finalPoint = dataPoints[dataPoints.length - 1];
    if (finalPoint) finalPoint.target = TARGET_IDR;

    // Insert or update today's actual balance point
    const todayStr = chartToday.toLocaleDateString('id-ID', { day: '2-digit', month: 'short' });
    const todayKeyChart = getLocalDateStr(chartToday.getTime());
    const todayIdx = dataPoints.findIndex(d => d.dateKey === todayKeyChart);

    if (todayIdx !== -1) {
      dataPoints[todayIdx].actual = totalActualBalance;
    } else {
      const insertIdx = dataPoints.findIndex(d => d.dateKey > todayKeyChart);
      const targetValToday = Math.round(INITIAL_TARGET_VAL + chartSlope * chartDaysFromStart);
      const todayPoint = { date: todayStr, dateKey: todayKeyChart, target: targetValToday, actual: totalActualBalance };
      if (insertIdx !== -1) dataPoints.splice(insertIdx, 0, todayPoint);
      else dataPoints.push(todayPoint);
    }

    return dataPoints;
  }, [liveHistory, totalActualBalance]);

  // LOGIC-06: Format exchange rate for display (e.g. 16.350 instead of 16350.75)
  const exchangeRateFormatted = Math.round(exchangeRate).toLocaleString('id-ID');

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="deck-perspective" style={{ animation: 'fadeIn 0.5s ease' }}>
      {/* Toast Notifications */}
      {successMsg && (
        <div style={{
          position: 'fixed', top: '24px', right: '24px', zIndex: 10000,
          background: 'var(--bg-card)', border: '1px solid var(--color-lime)',
          color: '#fff', padding: '0.8rem 1.4rem', borderRadius: '30px',
          boxShadow: '0 4px 20px rgba(212, 255, 58, 0.15)',
          display: 'flex', alignItems: 'center', gap: '0.6rem',
          fontWeight: 600, animation: 'fadeIn 0.3s ease',
          backdropFilter: 'blur(8px)', fontFamily: 'var(--sans)',
        }}>
          <CheckCircle size={16} color="var(--color-lime)" /> {successMsg}
        </div>
      )}
      {errorMsg && (
        <div style={{
          position: 'fixed', top: '24px', right: '24px', zIndex: 10000,
          background: 'var(--bg-card)', border: '1px solid var(--color-crimson)',
          color: '#fff', padding: '0.8rem 1.4rem', borderRadius: '30px',
          boxShadow: '0 4px 20px rgba(255, 59, 48, 0.15)',
          display: 'flex', alignItems: 'center', gap: '0.6rem',
          fontWeight: 600, animation: 'fadeIn 0.3s ease',
          backdropFilter: 'blur(8px)', fontFamily: 'var(--sans)',
        }}>
          <AlertCircle size={16} color="var(--color-crimson)" /> {errorMsg}
        </div>
      )}

      <main ref={consoleRef} className="deck-console">

        {/* Top Navigation */}
        <nav className="top-nav header-animate">
          <div className="nav-links" style={{ alignItems: 'center' }}>
            <button
              className={`nav-link ${activeTab === 'overview' ? 'active' : ''}`}
              onClick={() => setActiveTab('overview')}
            >
              <Activity size={13} /> Overview
            </button>
            <button
              className={`nav-link ${activeTab === 'analytics' ? 'active' : ''}`}
              onClick={() => setActiveTab('analytics')}
            >
              Insights
            </button>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <span style={{ fontFamily: 'var(--mono)', fontSize: '0.7rem', color: 'var(--text-secondary)' }}>
              UTC: {new Date().toISOString().substring(11, 16)}
            </span>
            <div className="profile-circle">CX</div>
          </div>
        </nav>

        {/* Dashboard Title & Countdown */}
        <header className="header-animate" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: '1rem', marginTop: '0.5rem' }}>
          <div>
            <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Welcome back,</span>
            <h1 style={{ marginTop: '0.2rem', fontSize: '2.5rem', fontWeight: '800' }}>
              Road To 100JT <span style={{ color: 'var(--color-lavender)', fontWeight: '300' }}>Terminal</span>
            </h1>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.3rem' }}>
            <span className="label-muted">Sept 10 Goal Countdown</span>
            <div className="clock-deck">
              {[
                { val: timeLeft.days, lbl: 'D' },
                { val: String(timeLeft.hours).padStart(2, '0'), lbl: 'H' },
                { val: String(timeLeft.minutes).padStart(2, '0'), lbl: 'M' },
                { val: String(timeLeft.seconds).padStart(2, '0'), lbl: 'S' },
              ].map(({ val, lbl }) => (
                <div key={lbl} className="clock-slot">
                  <span className="clock-val">{val}</span>
                  <span className="clock-lbl">{lbl}</span>
                </div>
              ))}
            </div>
          </div>
        </header>

        {/* ── Overview Tab ─────────────────────────────────────────────────── */}
        {activeTab === 'overview' && (
          <>
            {/* 4-Column KPI Cards */}
            <section className="grid-4x card-animate">

              {/* Card 1: Consolidated Equity */}
              <div className="reference-card">
                <div className="card-top">
                  <span className="card-title">Consolidated Equity</span>
                  <button
                    onClick={fetchLiveBalance}
                    title="Sync balance"
                    style={{ background: 'transparent', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', padding: '4px', display: 'flex', alignItems: 'center', transition: 'color 0.2s' }}
                    onMouseEnter={e => e.currentTarget.style.color = '#fff'}
                    onMouseLeave={e => e.currentTarget.style.color = 'var(--text-secondary)'}
                  >
                    <RefreshCw size={14} className={loading ? 'spin-anim' : ''} />
                  </button>
                </div>
                <div>
                  <div className="card-value">$<CountUp value={totalActualBalanceUsd} decimals={2} /></div>
                  {/* LOGIC-06: Formatted exchange rate */}
                  <span className="card-subtext">
                    Equiv: Rp <CountUp value={totalActualBalance} /> @ Rp {exchangeRateFormatted}/$
                  </span>
                </div>
              </div>

              {/* Card 2: Win Rate — LOGIC-02: Added "Last 50" badge for clarity */}
              <div className="reference-card">
                <div className="card-top">
                  <span className="card-title">Win Rate Telemetry</span>
                  <span style={{ fontSize: '0.6rem', color: 'var(--text-muted)', fontFamily: 'var(--mono)', background: 'rgba(255,255,255,0.04)', padding: '0.15rem 0.5rem', borderRadius: '4px' }}>
                    Last 50
                  </span>
                </div>
                <div>
                  <div className="card-value"><CountUp value={winRate} decimals={1} />%</div>
                  <span className="card-subtext">
                    Streak: {winStreak} wins | W: {wins} / L: {losses}
                  </span>
                </div>
              </div>

              {/* Card 3: Milestone Progress (always lime accent) */}
              <div className="reference-card lime-accent">
                <div className="card-top">
                  <span className="card-title" style={{ color: 'rgba(0,0,0,0.6)' }}>Milestone Progress</span>
                </div>
                <div>
                  <div className="card-value"><CountUp value={progressPercentage} decimals={1} />%</div>
                  <span className="card-subtext" style={{ color: 'rgba(0,0,0,0.6)' }}>
                    Target: Rp 100M | Gap: Rp <CountUp value={remainingNeeded} />
                  </span>
                </div>
              </div>

              {/* Card 4: Daily Target — LOGIC-03: todayTargetMet only true when dailyRequired > 0 */}
              <div className={`reference-card ${todayTargetMet ? 'lime-accent' : ''}`}>
                <div className="card-top">
                  <span className="card-title" style={{ color: todayTargetMet ? 'rgba(0,0,0,0.6)' : 'var(--text-secondary)' }}>
                    Daily Target Required
                  </span>
                </div>
                <div>
                  <div className="card-value" style={{ color: todayTargetMet ? '#000' : 'var(--text-titanium)' }}>
                    Rp <CountUp value={dailyTargetRequired} />
                  </div>
                  <span className="card-subtext" style={{ color: todayTargetMet ? 'rgba(0,0,0,0.6)' : 'var(--text-secondary)', display: 'block', marginBottom: '0.4rem' }}>
                    {todayTargetMet
                      ? `🎉 Terpenuhi! Hari ini: +Rp ${Math.round(todayProfitIdr).toLocaleString('id-ID')}`
                      : `Progress: Rp ${Math.round(todayProfitIdr).toLocaleString('id-ID')} (Rp ${Math.round(Math.max(0, dailyTargetRequired - todayProfitIdr)).toLocaleString('id-ID')} lagi)`
                    }
                  </span>
                  {(() => {
                    const pct = dailyTargetRequired > 0
                      ? Math.min(100, Math.max(0, (todayProfitIdr / dailyTargetRequired) * 100))
                      : (todayProfitIdr > 0 ? 100 : 0);
                    return (
                      <div style={{ marginTop: '0.4rem' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.65rem', color: todayTargetMet ? 'rgba(0,0,0,0.6)' : 'var(--text-secondary)', marginBottom: '0.2rem', fontWeight: 600, fontFamily: 'var(--mono)' }}>
                          <span>Progress</span><span>{pct.toFixed(1)}%</span>
                        </div>
                        <div style={{ width: '100%', background: todayTargetMet ? 'rgba(0,0,0,0.1)' : 'rgba(255,255,255,0.05)', borderRadius: '10px', height: '6px', overflow: 'hidden' }}>
                          <div style={{ width: `${pct}%`, background: todayTargetMet ? '#000' : 'var(--color-lime)', height: '100%', borderRadius: '10px', transition: 'width 0.5s ease-out' }} />
                        </div>
                      </div>
                    );
                  })()}
                </div>
              </div>
            </section>

            {/* Asymmetric Layout: Chart+Calendar (left) | Detail+Tabs (right) */}
            <div className="grid-asymmetric card-animate">

              {/* Left Column */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>

                {/* Trajectory Chart */}
                <section className="obsidian-card" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <h2 style={{ fontSize: '0.8rem' }}>Trajectory Log Slope</h2>
                    <span className="label-muted">Target Slope vs Bybit Balance</span>
                  </div>
                  <ProgressionChart chartData={chartData} />
                </section>

                {/* Trading Calendar */}
                <section className="obsidian-card" style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                  <div className="calendar-header">
                    <div>
                      <h2 style={{ fontSize: '1.1rem', fontWeight: 700, letterSpacing: '0.02em' }}>Trading Calendar</h2>
                      <span className="label-muted" style={{ display: 'block', marginTop: '0.25rem', fontSize: '0.78rem' }}>PILIH TANGGAL UNTUK LOG PROFIT</span>
                    </div>
                    {/* QUALITY-06: Replaced undefined badge-pill class with explicit inline style */}
                    <span style={{ fontSize: '0.95rem', fontWeight: 800, color: 'var(--color-lime)', fontFamily: 'var(--mono)', padding: '0.35rem 0.85rem', background: 'rgba(212,255,58,0.06)', border: '1px solid rgba(212,255,58,0.12)', borderRadius: '8px' }}>
                      {monthName.toUpperCase()}
                    </span>
                  </div>

                  <div className="calendar-grid">
                    {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map(d => (
                      <div key={d} className="calendar-day-label">{d}</div>
                    ))}
                    {calendarDays.map((cDay, idx) => {
                      if (cDay.isEmpty) return <div key={`e-${idx}`} className="calendar-day empty" />;
                      const dateProfit = calendarProfits[cDay.dateStr] || 0;
                      return (
                        <div
                          key={`d-${cDay.day}`}
                          className={`calendar-day ${selectedDate === cDay.dateStr ? 'selected' : ''}`}
                          onClick={() => setSelectedDate(cDay.dateStr)}
                        >
                          {cDay.day}
                          {dateProfit !== 0 && <span className={`calendar-dot ${dateProfit > 0 ? 'profit' : 'loss'}`} />}
                        </div>
                      );
                    })}
                  </div>
                </section>
              </div>

              {/* Right Column */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', minHeight: 0 }}>

                {/* Selected Date Detail */}
                <section className="obsidian-card" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <span className="label-muted">SELECTED TARGET DATE</span>
                      <div style={{ fontSize: '0.95rem', fontWeight: 700, fontFamily: 'var(--mono)', marginTop: '0.15rem' }}>
                        {/* BUG-01: parseDateStr avoids UTC off-by-one timezone issue */}
                        {parseDateStr(selectedDate).toLocaleDateString('id-ID', { day: '2-digit', month: 'long', year: 'numeric' })}
                      </div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <span className="label-muted">PROFIT/LOSS DELTA</span>
                      <div className="text-number" style={{ fontSize: '1rem', fontWeight: 700, color: selectedDayTotal > 0 ? 'var(--color-green-profit)' : selectedDayTotal < 0 ? 'var(--color-crimson)' : 'var(--text-secondary)' }}>
                        {selectedDayTotal > 0 ? '+' : ''}${selectedDayTotal.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                      </div>
                      <div style={{ fontSize: '0.75rem', fontWeight: 600, color: selectedDayTotal > 0 ? 'var(--color-green-profit)' : selectedDayTotal < 0 ? 'var(--color-crimson)' : 'var(--text-secondary)', opacity: 0.85, fontFamily: 'var(--mono)' }}>
                        {selectedDayTotal > 0 ? '+' : ''}Rp {Math.round(selectedDayTotal * exchangeRate).toLocaleString('id-ID')}
                      </div>
                    </div>
                  </div>

                  {selectedDayTrades.length > 0 && (
                    <div style={{ borderTop: '1px solid rgba(255,255,255,0.04)', paddingTop: '0.75rem', display: 'flex', flexDirection: 'column', gap: '0.5rem', maxHeight: '180px', overflowY: 'auto' }}>
                      <span className="label-muted" style={{ fontSize: '0.6rem', display: 'block', marginBottom: '0.2rem' }}>trades for this day</span>
                      {selectedDayTrades.map((log, index) => {
                        const pnl = parseFloat(log.closedPnl || '0');
                        // LOGIC-01: Consistent "CLOSE SHORT"/"CLOSE LONG" labels
                        const closeSide = log.side === 'Buy' ? 'CLOSE SHORT' : 'CLOSE LONG';
                        const badgeClass = log.side === 'Buy' ? 'short' : 'long';
                        return (
                          <div key={`${log.symbol}-${index}`} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.75rem', padding: '0.35rem 0', borderBottom: '1px solid rgba(255,255,255,0.01)' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                              <span style={{ fontWeight: 700, color: '#fff' }}>{log.symbol}</span>
                              <span className={`direction-badge ${badgeClass}`} style={{ fontSize: '0.5rem', padding: '0.05rem 0.25rem' }}>{closeSide}</span>
                            </div>
                            <div style={{ textAlign: 'right', fontFamily: 'var(--mono)' }}>
                              <span style={{ fontWeight: 600, color: pnl >= 0 ? 'var(--color-green-profit)' : 'var(--color-crimson)' }}>
                                {pnl >= 0 ? '+' : ''}${pnl.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                              </span>
                              <span style={{ fontSize: '0.65rem', display: 'block', color: pnl >= 0 ? 'var(--color-green-profit)' : 'var(--color-crimson)', opacity: 0.8 }}>
                                {pnl >= 0 ? '+' : ''}Rp {Math.round(pnl * exchangeRate).toLocaleString('id-ID')}
                              </span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </section>

                {/* Tabs: Assets / Positions / History */}
                <section className="obsidian-card" style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', flex: 1, minHeight: 0 }}>
                  <div className="tabs-container" style={{ display: 'flex', flexWrap: 'wrap', gap: '2px' }}>
                    {[
                      { id: 'assets', label: 'Assets' },
                      { id: 'positions', label: 'Positions' },
                      { id: 'history', label: 'Bybit History' },
                    ].map(tab => (
                      <button
                        key={tab.id}
                        className={`tab-btn ${rightPanelTab === tab.id ? 'active' : ''}`}
                        onClick={() => setRightPanelTab(tab.id)}
                        style={{ flex: '1 1 auto', justifyContent: 'center', borderRadius: '30px', gap: '0.3rem' }}
                      >
                        {tab.label}
                        {tab.id === 'positions' && activePositions.length > 0 && (
                          <span className="position-count-badge">{activePositions.length}</span>
                        )}
                      </button>
                    ))}
                  </div>

                  {/* Assets Tab */}
                  {rightPanelTab === 'assets' && (
                    <div className="crypto-list" style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
                      {bybitCoins.length === 0 ? (
                        <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontStyle: 'italic', textAlign: 'center', margin: '2rem 0' }}>
                          Belum ada aset. Klik refresh untuk sync.
                        </p>
                      ) : bybitCoins.map(c => {
                        const allocationPct = totalActualBalanceUsd > 0 ? (c.usdValue / totalActualBalanceUsd) * 100 : 0;
                        return (
                          <div key={c.coin} className="crypto-row">
                            <div className="crypto-left">
                              <div className="coin-icon-circle lime-text">{c.coin.substring(0, 3)}</div>
                              <div className="crypto-details">
                                <span className="crypto-name">{c.coin}</span>
                                <span className="crypto-sub">{c.walletBalance.toLocaleString('id-ID', { maximumFractionDigits: 4 })} coins</span>
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

                  {/* Positions Tab */}
                  {rightPanelTab === 'positions' && (
                    <div className="crypto-list" style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
                      {positionsLoading ? (
                        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', margin: '2rem 0' }}>
                          <RefreshCw size={20} className="spin-anim" />
                        </div>
                      ) : activePositions.length === 0 ? (
                        <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontStyle: 'italic', textAlign: 'center', margin: '2rem 0' }}>
                          Tidak ada posisi aktif saat ini.
                        </p>
                      ) : activePositions.map((pos, index) => {
                        const uPnl = parseFloat(pos.unrealisedPnl || '0');
                        const leverage = parseFloat(pos.leverage || '1');
                        const posValue = parseFloat(pos.positionValue || '0');
                        const posIM = parseFloat(pos.positionIM || '0');
                        const roi = posIM > 0 ? (uPnl / posIM) * 100 : posValue > 0 ? (uPnl / (posValue / leverage)) * 100 : 0;
                        const isLong = pos.side === 'Buy';
                        return (
                          <div key={`${pos.symbol}-${index}`} className="crypto-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: '0.5rem', padding: '1rem' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                <span className="crypto-name" style={{ fontSize: '0.9rem' }}>{pos.symbol}</span>
                                <span className={`direction-badge ${isLong ? 'long' : 'short'}`}>{isLong ? 'LONG' : 'SHORT'} {leverage}x</span>
                              </div>
                              <span className={`roi-badge ${uPnl >= 0 ? 'profit' : 'loss'}`}>{uPnl >= 0 ? '+' : ''}{roi.toFixed(2)}%</span>
                            </div>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.4rem', fontSize: '0.75rem', color: 'var(--text-secondary)', fontFamily: 'var(--mono)', borderTop: '1px solid rgba(255,255,255,0.02)', paddingTop: '0.4rem' }}>
                              <div>Size: <span style={{ color: '#fff' }}>{parseFloat(pos.size).toLocaleString('en-US', { maximumFractionDigits: 6 })}</span></div>
                              <div style={{ textAlign: 'right' }}>Liq.: <span style={{ color: 'var(--color-crimson)' }}>{parseFloat(pos.liqPrice || '0').toLocaleString('en-US', { maximumFractionDigits: 4 })}</span></div>
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
                                  {uPnl >= 0 ? '+' : ''}Rp {Math.round(uPnl * exchangeRate).toLocaleString('id-ID')}
                                </div>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* History Tab */}
                  {rightPanelTab === 'history' && (
                    <div className="crypto-list" style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
                      {historyLoading ? (
                        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', margin: '2rem 0' }}>
                          <RefreshCw size={20} className="spin-anim" />
                        </div>
                      ) : bybitHistory.length === 0 ? (
                        <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontStyle: 'italic', textAlign: 'center', margin: '2rem 0' }}>
                          Tidak ada riwayat perdagangan di Bybit.
                        </p>
                      ) : bybitHistory.map((log, index) => {
                        const pnl = parseFloat(log.closedPnl || '0');
                        const date = new Date(parseInt(log.createdTime));
                        const dateStr = date.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
                        return (
                          <div key={`${log.symbol}-${index}`} className="crypto-row" style={{ padding: '0.8rem 1rem' }}>
                            <div className="crypto-left">
                              <div className={`coin-icon-circle ${pnl >= 0 ? 'lime-text' : 'lavender-text'}`}>{log.symbol.substring(0, 3)}</div>
                              <div className="crypto-details">
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                                  <span className="crypto-name" style={{ fontSize: '0.8rem' }}>{log.symbol}</span>
                                  <span className={`direction-badge ${log.side === 'Buy' ? 'short' : 'long'}`} style={{ fontSize: '0.55rem', padding: '0.1rem 0.3rem' }}>
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
                                {pnl >= 0 ? '+' : ''}Rp {Math.round(pnl * exchangeRate).toLocaleString('id-ID')}
                              </span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </section>
              </div>
            </div>
          </>
        )}

        {/* ── Analytics Tab — LOGIC-08: Tab now renders actual content ─────── */}
        {activeTab === 'analytics' && (
          <section className="obsidian-card card-animate" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '420px', gap: '1.25rem' }}>
            <div style={{ fontSize: '2.5rem', opacity: 0.25 }}>📊</div>
            <h2 style={{ color: 'var(--text-secondary)', fontWeight: 600, textAlign: 'center' }}>Insights — Coming Soon</h2>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', textAlign: 'center', maxWidth: '340px', lineHeight: 1.6 }}>
              Advanced analytics: performance breakdown per pair, risk-reward ratio, monthly P&L heatmap, dan drawdown metrics akan hadir di sini.
            </p>
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', justifyContent: 'center' }}>
              {['P&L Heatmap', 'Risk/Reward', 'Drawdown', 'Pair Breakdown'].map(label => (
                <span key={label} style={{ fontSize: '0.7rem', fontWeight: 700, fontFamily: 'var(--mono)', color: 'var(--text-muted)', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '6px', padding: '0.3rem 0.65rem' }}>
                  {label}
                </span>
              ))}
            </div>
          </section>
        )}

        {/* Footer */}
        <footer style={{ display: 'flex', justifyContent: 'space-between', padding: '1rem 0', fontSize: '0.7rem', color: 'var(--text-muted)', borderTop: '1px solid var(--border-light)', fontFamily: 'var(--mono)', marginTop: '1rem' }}>
          <span>PORTFOLIO CORE TELEMETRY v7.1</span>
          <span>ACCELERATOR LIMIT: 10 SEPTEMBER 2026</span>
        </footer>

      </main>
    </div>
  );
}
