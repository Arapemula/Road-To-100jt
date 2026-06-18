import React from 'react';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ReferenceLine
} from 'recharts';

const CustomTooltip = ({ active, payload, label }) => {
  if (active && payload && payload.length) {
    return (
      <div 
        style={{
          background: 'rgba(15, 17, 26, 0.95)',
          border: '1px solid rgba(255, 255, 255, 0.1)',
          padding: '0.75rem 1rem',
          borderRadius: '8px',
          boxShadow: '0 8px 32px rgba(0, 0, 0, 0.5)',
          backdropFilter: 'blur(8px)'
        }}
      >
        <p style={{ margin: 0, fontWeight: 600, fontSize: '0.85rem', color: '#94a3b8', marginBottom: '0.4rem' }}>
          {label}
        </p>
        {payload.map((p, idx) => (
          <p key={idx} style={{ margin: 0, fontSize: '0.9rem', color: p.color, fontWeight: 500 }}>
            {p.name}: Rp {p.value.toLocaleString('id-ID')}
          </p>
        ))}
      </div>
    );
  }
  return null;
};

export default function ProgressionChart({ chartData }) {
  // Format Y-axis ticks in Millions
  const formatYAxis = (value) => {
    if (value === 0) return '0';
    return `${(value / 1000000).toFixed(0)}M`;
  };

  return (
    <div className="chart-wrapper">
      <ResponsiveContainer width="99%" height={300}>
        <AreaChart
          data={chartData}
          margin={{ top: 10, right: 10, left: -15, bottom: 0 }}
        >
          <defs>
            <linearGradient id="colorTarget" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.15}/>
              <stop offset="95%" stopColor="#f59e0b" stopOpacity={0.0}/>
            </linearGradient>
            <linearGradient id="colorActual" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#10b981" stopOpacity={0.3}/>
              <stop offset="95%" stopColor="#10b981" stopOpacity={0.0}/>
            </linearGradient>
          </defs>
          
          <CartesianGrid 
            strokeDasharray="3 3" 
            stroke="rgba(255, 255, 255, 0.02)" 
            vertical={false}
          />
          
          <XAxis 
            dataKey="date" 
            stroke="#64748b" 
            fontSize={11}
            tickLine={false}
            dy={10}
          />
          
          <YAxis 
            stroke="#64748b" 
            fontSize={11}
            tickLine={false}
            tickFormatter={formatYAxis}
            dx={-5}
            domain={[0, 110000000]} // limit to 110M
          />
          
          <Tooltip content={<CustomTooltip />} />
          
          <Legend 
            verticalAlign="top" 
            height={36}
            iconType="circle"
            iconSize={8}
            wrapperStyle={{
              fontSize: '0.85rem',
              color: '#94a3b8'
            }}
          />

          {/* Target Progression Line */}
          <Area
            name="Target Slope"
            type="monotone"
            dataKey="target"
            stroke="#f59e0b"
            strokeWidth={1.5}
            strokeDasharray="3 3"
            fillOpacity={1}
            fill="url(#colorTarget)"
          />

          {/* Actual Balance Path */}
          <Area
            name="Actual Balance"
            type="monotone"
            dataKey="actual"
            stroke="#10b981"
            strokeWidth={2.5}
            fillOpacity={1}
            fill="url(#colorActual)"
            activeDot={{ r: 5, strokeWidth: 0, fill: '#10b981' }}
          />

          {/* Goal Reference Line at 100M */}
          <ReferenceLine 
            y={100000000} 
            stroke="#f43f5e" 
            strokeDasharray="3 3"
            label={{ 
              value: "100M Target", 
              position: "top", 
              fill: "#f43f5e",
              fontSize: 10,
              fontWeight: 600
            }} 
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
