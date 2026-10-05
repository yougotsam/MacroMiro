// src/components/PerpCockpit.tsx
import React, { useState } from "react";
import { Shield, Zap, Flame, Crosshair, Award } from "lucide-react";

interface CockpitProps {
  ticker: string;
  maxLeverage: number;
  currentPrice: number;
  balanceUsd: number;
  dailyPnL: number;
  onDispatchOrder: (orderConfig: any) => void;
}

export const PerpCockpit: React.FC<CockpitProps> = ({
  ticker = "KXGOLDPERP",
  maxLeverage = 15.2,
  currentPrice = 4.1442,
  balanceUsd = 100.0,
  dailyPnL = 14.5,
  onDispatchOrder,
}) => {
  // 1. Tactical Controls State
  const [leverage, setLeverage] = useState<number>(Math.min(10, maxLeverage));
  const [clipSizeUsd, setClipSizeUsd] = useState<number>(25);
  const [tpMultiple, setTpMultiple] = useState<number>(2.5); // 2.5:1 reward-to-risk
  const [slPercent, setSlPercent] = useState<number>(8); // 8% margin risk

  // 2. Computed Financial Math
  const notionalExposure = clipSizeUsd * leverage;
  const estProfit = clipSizeUsd * (slPercent / 100) * tpMultiple;
  const estMaxLoss = clipSizeUsd * (slPercent / 100);
  const liqCushion = ((1 / leverage) * 90).toFixed(1);

  // 3. Compounding Ladder Milestones ($100 Base)
  const ladderRungs = [
    { target: 100, label: "x1 BASE", status: balanceUsd >= 100 },
    { target: 200, label: "x2 DOUBLE", status: balanceUsd >= 200 },
    { target: 400, label: "x4 VELOCITY", status: balanceUsd >= 400 },
    { target: 800, label: "x8 APEX", status: balanceUsd >= 800 },
    { target: 1600, label: "x16 TERMINAL", status: balanceUsd >= 1600 },
  ];

  return (
    <div className="bg-[#0b0e14] text-slate-100 font-mono p-5 rounded-xl border border-slate-800 shadow-2xl space-y-6">
      {/* HUD Header: Ticker, Price, and Shields */}
      <div className="flex flex-wrap items-center justify-between border-b border-slate-800 pb-4 gap-4">
        <div className="flex items-center space-x-3">
          <div className="p-2 bg-emerald-500/10 border border-emerald-500/30 rounded-lg text-emerald-400">
            <Zap className="w-5 h-5 animate-pulse" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <span className="text-lg font-bold tracking-wider">{ticker}</span>
              <span className="text-xs px-2 py-0.5 rounded bg-slate-800 text-slate-400">MAX {maxLeverage}x</span>
            </div>
            <div className="text-2xl font-black text-emerald-400">${currentPrice.toFixed(4)}</div>
          </div>
        </div>

        {/* HUD Shields / Risk Status */}
        <div className="flex items-center space-x-6 text-xs">
          <div>
            <div className="text-slate-500 flex items-center space-x-1">
              <Shield className="w-3.5 h-3.5 text-cyan-400" />
              <span>CAPITAL SHIELD</span>
            </div>
            <div className="font-bold text-sm text-slate-200">
              ${balanceUsd.toFixed(2)}
              <span className={`ml-2 text-xs ${dailyPnL >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                ({dailyPnL >= 0 ? "+" : ""}${dailyPnL.toFixed(2)})
              </span>
            </div>
          </div>

          <div>
            <div className="text-slate-500">LIQUIDATION CUSHION</div>
            <div className="font-bold text-sm text-cyan-400">±{liqCushion}%</div>
          </div>
        </div>
      </div>

      {/* The Compounding Ladder (Gamified Visual Rungs) */}
      <div className="bg-slate-900/60 p-3 rounded-lg border border-slate-800/80">
        <div className="text-xs text-slate-400 mb-2 flex items-center justify-between">
          <span className="flex items-center space-x-1.5 font-bold text-amber-400">
            <Award className="w-3.5 h-3.5" />
            <span>COMPOUNDING RUNWAY</span>
          </span>
          <span className="text-slate-500 text-[11px]">Auto-scales clip size at each tier</span>
        </div>
        <div className="grid grid-cols-5 gap-2">
          {ladderRungs.map((rung, idx) => (
            <div
              key={idx}
              className={`text-center py-2 px-1 rounded border text-xs transition-all ${
                rung.status
                  ? "bg-emerald-500/20 border-emerald-500/60 text-emerald-300 font-bold shadow-[0_0_12px_rgba(16,185,129,0.2)]"
                  : "bg-slate-950/40 border-slate-800/60 text-slate-600"
              }`}
            >
              <div className="text-[10px] tracking-tight">{rung.label}</div>
              <div className="text-xs mt-0.5">${rung.target}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Tactile Leverage Slider Control */}
      <div className="bg-slate-900/40 p-4 rounded-lg border border-slate-800 space-y-3">
        <div className="flex justify-between items-center text-xs">
          <span className="text-slate-400 flex items-center space-x-1">
            <Flame className="w-3.5 h-3.5 text-amber-500" />
            <span>DYNAMIC LEVERAGE DIAL</span>
          </span>
          <span className="text-base font-black text-amber-400 bg-amber-500/10 px-2.5 py-0.5 rounded border border-amber-500/30">
            {leverage.toFixed(1)}x
          </span>
        </div>

        <input
          type="range"
          min="1"
          max={maxLeverage}
          step="0.1"
          value={leverage}
          onChange={(e) => setLeverage(parseFloat(e.target.value))}
          className="w-full accent-amber-500 h-2 bg-slate-800 rounded-lg cursor-pointer"
        />

        <div className="grid grid-cols-3 gap-2 text-center text-xs pt-1">
          <div className="bg-slate-950 p-2 rounded border border-slate-800/60">
            <div className="text-[10px] text-slate-500">COLLATERAL CLIP</div>
            <div className="font-bold text-slate-200">${clipSizeUsd.toFixed(2)}</div>
          </div>
          <div className="bg-slate-950 p-2 rounded border border-slate-800/60">
            <div className="text-[10px] text-slate-500">NOTIONAL POSITION</div>
            <div className="font-bold text-amber-400">${notionalExposure.toFixed(2)}</div>
          </div>
          <div className="bg-slate-950 p-2 rounded border border-slate-800/60">
            <div className="text-[10px] text-slate-500">BUFFER TO LIQ</div>
            <div className="font-bold text-cyan-400">{liqCushion}%</div>
          </div>
        </div>
      </div>

      {/* Bracket Target & Risk/Reward Matrix */}
      <div className="grid grid-cols-2 gap-3 text-xs">
        <div className="bg-emerald-950/20 border border-emerald-900/40 p-3 rounded-lg">
          <div className="text-emerald-500 font-bold mb-1 flex items-center justify-between">
            <span>TAKE PROFIT ({tpMultiple}x)</span>
            <span className="text-emerald-400">+${estProfit.toFixed(2)}</span>
          </div>
          <div className="text-[11px] text-slate-400">
            Target Exit: ${(currentPrice * (1 + (slPercent * tpMultiple) / 100 / leverage)).toFixed(4)}
          </div>
        </div>

        <div className="bg-rose-950/20 border border-rose-900/40 p-3 rounded-lg">
          <div className="text-rose-500 font-bold mb-1 flex items-center justify-between">
            <span>STOP LOSS (-{slPercent}%)</span>
            <span className="text-rose-400">-${estMaxLoss.toFixed(2)}</span>
          </div>
          <div className="text-[11px] text-slate-400">Stop Exit: ${(currentPrice * (1 - slPercent / 100 / leverage)).toFixed(4)}</div>
        </div>
      </div>

      {/* Execution Triggers */}
      <div className="grid grid-cols-2 gap-3 pt-2">
        <button
          onClick={() => onDispatchOrder({ side: "bid", leverage, clipSizeUsd, tpMultiple, slPercent })}
          className="flex items-center justify-center space-x-2 py-3 bg-emerald-600 hover:bg-emerald-500 active:scale-[0.98] font-bold text-sm rounded-lg transition-all shadow-lg shadow-emerald-900/30"
        >
          <Crosshair className="w-4 h-4" />
          <span>FIRE LONG BRACKET</span>
        </button>

        <button
          onClick={() => onDispatchOrder({ side: "ask", leverage, clipSizeUsd, tpMultiple, slPercent })}
          className="flex items-center justify-center space-x-2 py-3 bg-rose-600 hover:bg-rose-500 active:scale-[0.98] font-bold text-sm rounded-lg transition-all shadow-lg shadow-rose-900/30"
        >
          <Crosshair className="w-4 h-4" />
          <span>FIRE SHORT BRACKET</span>
        </button>
      </div>
    </div>
  );
};
