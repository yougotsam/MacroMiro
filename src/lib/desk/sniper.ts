/**
 * AURIX-X independent evidence engine (price/volume technical research).
 * Pure functions; consume REAL instrument OHLCV and trade signed flow, never
 * settlement-index-only prints masquerading as traded volume.
 * This is a candidate ranker, NOT a calibrated settlement probability.
 */
export type Candle = {
  t: number; o: number; h: number; l: number; c: number;
  /** Exchange-traded base volume for the underlying instrument, not index ticks. */
  v?: number;
  /** Genuine aggressive buy minus sell volume from signed venue trades. */
  delta?: number;
};
export type Direction = "long" | "short";
export type Evidence = {
  direction: Direction; setup: string; score: number; families: number;
  points: { structure: number; liquidity: number; flow: number; momentum: number;
    regime: number; macro: number; trigger: number };
  tags: string[]; missing: string[]; eligible: boolean;
};
const avg = (x: number[]) => x.reduce((a,b)=>a+b,0)/x.length;
function finite(x: number): boolean { return Number.isFinite(x); }
function closes(b: Candle[]) { return b.map(x=>x.c); }
export function emaSeries(x: number[], n: number): number[] {
  if (x.length < n) return [];
  let e=avg(x.slice(0,n)); const result=[e];
  for(let i=n;i<x.length;i++){ e=(2*x[i]+(n-1)*e)/(n+1); result.push(e); }
  return result;
}
export function rsiSeries(x:number[], n=14):number[] {
  if(x.length<n+1)return [];
  let g=0,l=0;
  for(let i=1;i<=n;i++){const d=x[i]-x[i-1];g+=Math.max(0,d);l+=Math.max(0,-d);}
  g/=n;l/=n;
  const rs=(a:number,b:number)=>b===0?(a===0?50:100):100-100/(1+a/b);
  const out=[rs(g,l)];
  for(let i=n+1;i<x.length;i++){ const d=x[i]-x[i-1];
    g=(g*(n-1)+Math.max(0,d))/n; l=(l*(n-1)+Math.max(0,-d))/n;out.push(rs(g,l));}
  return out;
}
export function stochRsi(x:number[],period=14,smoothK=3,smoothD=3) {
  const rs=rsiSeries(x,period);
  if(rs.length<period+smoothK+smoothD-2)return null;
  const raw:number[]=[];
  for(let i=period-1;i<rs.length;i++){
    const window=rs.slice(i-period+1,i+1), hi=Math.max(...window),lo=Math.min(...window);
    raw.push(hi===lo?50:100*(rs[i]-lo)/(hi-lo));
  }
  const sm=(v:number[],n:number)=>v.slice(n-1).map((_,i)=>avg(v.slice(i,i+n)));
  const k=sm(raw,smoothK),d=sm(k,smoothD);
  return {k:k.at(-1)!,d:d.at(-1)!};
}
export function macd(x:number[],fast=12,slow=26,signal=9) {
  if(x.length<slow+signal-1)return null;
  const f=emaSeries(x,fast),s=emaSeries(x,slow);
  const diff=s.map((v,i)=>f[i+slow-fast]-v);
  const sig=emaSeries(diff,signal);
  return {line:diff.at(-1)!,signal:sig.at(-1)!,hist:diff.at(-1)!-sig.at(-1)!};
}
export function atr(b:Candle[],period=14):number|null {
  if(b.length<period+1)return null;
  const tr=b.slice(1).map((x,i)=>Math.max(x.h-x.l,Math.abs(x.h-b[i].c),Math.abs(x.l-b[i].c)));
  let v=avg(tr.slice(0,period));
  for(const x of tr.slice(period))v=(v*(period-1)+x)/period;
  return v;
}
export function bollinger(x:number[],period=20,mult=2) {
  if(x.length<period)return null;
  const w=x.slice(-period),mean=avg(w),variance=avg(w.map(v=>(v-mean)**2)),sd=Math.sqrt(variance);
  return {lower:mean-mult*sd,mid:mean,upper:mean+mult*sd,width:mean>0?2*mult*sd/mean:0};
}
export function vwap(b:Candle[]):number|null {
  if(!b.length||b.some(x=>x.v==null||!finite(x.v)||x.v<0))return null;
  const total=b.reduce((s,x)=>s+(x.v||0),0);
  return total>0?b.reduce((s,x)=>s+(x.h+x.l+x.c)/3*(x.v||0),0)/total:null;
}
export function rvol(b:Candle[],n=20):number|null {
  if(b.length<n+1||b.some(x=>x.v==null||!finite(x.v)))return null;
  const base=avg(b.slice(-n-1,-1).map(x=>x.v!));
  return base>0?b.at(-1)!.v!/base:null;
}
export function cvd(b:Candle[]):number|null {
  if(!b.length||b.some(x=>x.delta==null||!finite(x.delta)))return null;
  return b.reduce((s,x)=>s+x.delta!,0);
}
export function adx(b:Candle[],period=14):number|null {
  if(b.length<period*2+1)return null;
  const trueRange:number[]=[],pd:number[]=[],md:number[]=[];
  for(let i=1;i<b.length;i++){
    const a=b[i],p=b[i-1],up=a.h-p.h,dn=p.l-a.l;
    pd.push(up>dn&&up>0?up:0);md.push(dn>up&&dn>0?dn:0);
    trueRange.push(Math.max(a.h-a.l,Math.abs(a.h-p.c),Math.abs(a.l-p.c)));
  }
  const sm=(v:number[])=>{
    const out=[v.slice(0,period).reduce((a,b)=>a+b,0)];
    for(let i=period;i<v.length;i++)out.push(out.at(-1)!-out.at(-1)!/period+v[i]);
    return out;
  };
  const ts=sm(trueRange),ps=sm(pd),ms=sm(md);
  const dx=ts.map((tr,i)=>{const plus=100*ps[i]/(tr||1),minus=100*ms[i]/(tr||1);
    return 100*Math.abs(plus-minus)/(plus+minus||1);});
  if(dx.length<period)return null;
  let a=avg(dx.slice(0,period));
  for(const v of dx.slice(period))a=(a*(period-1)+v)/period;
  return a;
}
/** Confirmed three-left/three-right pivots, never available until right bars close. */
export function confirmedSwings(b:Candle[],wing=3) {
  const highs:{i:number;price:number}[]=[], lows:{i:number;price:number}[]=[];
  for(let i=wing;i<b.length-wing;i++){
    const left=b.slice(i-wing,i),right=b.slice(i+1,i+wing+1);
    if([...left,...right].every(x=>b[i].h>x.h))highs.push({i,price:b[i].h});
    if([...left,...right].every(x=>b[i].l<x.l))lows.push({i,price:b[i].l});
  }
  return {highs,lows};
}
export function fvg(b:Candle[],a:number) {
  if(b.length<3)return null;
  const x=b[b.length-3],z=b[b.length-1];
  if(z.l>x.h && z.l-x.h>=.12*a)return {direction:"long" as const,low:x.h,high:z.l};
  if(z.h<x.l && x.l-z.h>=.12*a)return {direction:"short" as const,low:z.h,high:x.l};
  return null;
}


/** A directional retracement must agree with the correct high/low coordinates. */
export function fibPocket(lastPrice:number, swingLow:number, swingHigh:number, dir:Direction) {
  if (![lastPrice,swingLow,swingHigh].every(Number.isFinite) || swingHigh<=swingLow) return null;
  const position=(lastPrice-swingLow)/(swingHigh-swingLow);
  // 61.8–65% retraced FROM the swing high => position .350–.382 for longs.
  // 61.8–65% retraced FROM the swing low => position .618–.650 for shorts.
  const inside=dir==="long"
    ? position>=0.350&&position<=0.382
    : position>=0.618&&position<=0.650;
  return { position, inside, premium:position>=.618, discount:position<=.382 };
}

/**
 * OB candidate only: the last opposite-direction candle before genuine
 * displacement. No assertion that institutional limit orders live there.
 * Require subsequent two-candle movement of >=1.2 ATR and a close beyond
 * that candle's entire range.
 */
export function orderBlockCandidate(b:Candle[], dir:Direction, atrValue:number) {
  if(b.length<4 || !(atrValue>0))return null;
  for(let i=b.length-4;i>=Math.max(0,b.length-24);i--){
    const x=b[i],next=b.slice(i+1,i+3);
    const opposite=dir==="long"?x.c<x.o:x.c>x.o;
    const change=next.at(-1)!.c-x.c;
    const move=dir==="long"?change:-change;
    if(opposite&&move>=1.2*atrValue&&
      (dir==="long"?next.at(-1)!.c>x.h:next.at(-1)!.c<x.l)){
      // Only accept blocks that have not been structurally invalidated later.
      const later=b.slice(i+3);
      const invalid=later.some(c=>dir==="long"?c.c<x.l:c.c>x.h);
      if(!invalid)return {low:x.l,high:x.h,index:i};
    }
  }
  return null;
}

/** Confirmed RSI divergence on two separately confirmed price pivots. */
export function rsiDivergence(b:Candle[],dir:Direction, period=14):boolean {
  if(b.length<period+12)return false;
  const rs=rsiSeries(closes(b),period), pivots=confirmedSwings(b);
  const refs=dir==="long"?pivots.lows:pivots.highs;
  if(refs.length<2)return false;
  const first=refs.at(-2)!,second=refs.at(-1)!;
  const a=rs[first.i-period],z=rs[second.i-period];
  if(a==null||z==null)return false;
  return dir==="long"
    ? second.price<first.price&&z>a
    : second.price>first.price&&z<a;
}

/** Real OHLCV day-anchored VWAP; do not use index price bars as volume. */
export function dailyAnchoredVwap(b:Candle[],asOf:number):number|null {
  const start=Math.floor(asOf/86_400_000)*86_400_000;
  return vwap(b.filter(c=>c.t>=start&&c.t<=asOf));
}

export function resampleComplete(b:Candle[],minutes:15|60):Candle[] {
  const map=new Map<number,Candle[]>();
  for(const x of b){
    const bucket=Math.floor(x.t/(minutes*60_000));
    if(!map.has(bucket))map.set(bucket,[]);
    map.get(bucket)!.push(x);
  }
  const out:Candle[]=[];
  for(const [bucket,rows]of [...map].sort((a,z)=>a[0]-z[0])){
    rows.sort((a,z)=>a.t-z.t);
    if(rows.length!==minutes || rows.some((x,i)=>x.t!==(bucket*minutes+i)*60_000))continue;
    const volume=rows.every(x=>x.v!=null)?rows.reduce((a,x)=>a+x.v!,0):undefined;
    const delta=rows.every(x=>x.delta!=null)?rows.reduce((a,x)=>a+x.delta!,0):undefined;
    out.push({t:bucket*minutes*60_000,o:rows[0].o,h:Math.max(...rows.map(x=>x.h)),
      l:Math.min(...rows.map(x=>x.l)),c:rows.at(-1)!.c,v:volume,delta});
  }
  return out;
}
export function evaluateSniper(b15:Candle[],b1h:Candle[],dir:Direction,macroClear:boolean):Evidence {
  const isLong=dir==="long",side=isLong?1:-1, tags:string[]=[],missing:string[]=[];
  const pts={structure:0,liquidity:0,flow:0,momentum:0,regime:0,macro:0,trigger:0};
  const last=b15.at(-1),prev=b15.at(-2), a=atr(b15), h=closes(b1h),c=closes(b15);
  if(b15.length<60||b1h.length<205||!last||!prev||a==null||a<=0) {
    return {direction:dir,setup:"NONE",score:0,families:0,points:pts,tags,missing:["60 complete 15m bars","205 complete 1h bars"],eligible:false};
  }
  const swings=confirmedSwings(b15),hi=swings.highs.at(-1),lo=swings.lows.at(-1);
  const emaH=emaSeries(h,200).at(-1)!,ema7=emaSeries(c,7).at(-1)!,
    ema14=emaSeries(c,14).at(-1)!,ema50=emaSeries(c,50).at(-1)!;
  if((isLong&&last.c>emaH)||(!isLong&&last.c<emaH)){pts.structure++;tags.push("1h_EMA200");}
  if(isLong&&hi&&last.c>hi.price+.15*a||!isLong&&lo&&last.c<lo.price-.15*a){
    pts.structure++;tags.push("confirmed_BOS");}
  const swept=isLong&&lo&&last.l<lo.price-.1*a&&last.c>lo.price||
    !isLong&&hi&&last.h>hi.price+.1*a&&last.c<hi.price;
  if(swept){pts.liquidity+=2;tags.push("liquidity_sweep_reclaim");}
  const recentGap=fvg(b15,a);
  const loAnchor=swings.lows.at(-1)?.price,hiAnchor=swings.highs.at(-1)?.price;
  const fib=loAnchor!=null&&hiAnchor!=null?fibPocket(last.c,loAnchor,hiAnchor,dir):null;
  const block=orderBlockCandidate(b15,dir,a);
  if(recentGap?.direction===dir){pts.liquidity++;tags.push("new_FVG");}
  if(fib?.inside){pts.liquidity=Math.min(3,pts.liquidity+1);tags.push("fib_61.8_65");}
  if(block&&last.c>=block.low&&last.c<=block.high){
    pts.liquidity=Math.min(3,pts.liquidity+1);tags.push("candidate_order_block");
  }
  // Avoid entries in the wrong half unless a confirmed sweep supplies an override.
  if(fib&&!swept&&((isLong&&fib.premium)||(!isLong&&fib.discount)))
    missing.push("wrong premium/discount location");
  const isTrend=(isLong&&ema7>ema14&&ema14>ema50)||(!isLong&&ema7<ema14&&ema14<ema50);
  if(isTrend){pts.momentum++;tags.push("EMA_7_14_50");}
  const rs=rsiSeries(c).at(-1),m=macd(c),stoch=stochRsi(c);
  if(rsiDivergence(b15,dir)){pts.momentum++;tags.push("confirmed_RSI_divergence");}
  if(rs!=null&&m&&stoch&&Math.sign(rs-50)===side&&Math.sign(m.hist)===side &&
     Math.sign(stoch.k-stoch.d)===side){pts.momentum=Math.min(2,pts.momentum+1);tags.push("RSI_MACD_Stoch_confluence");}
  const vol=rvol(b15),delta=cvd(b15.slice(-8));
  if(vol!=null&&vol>=1.5){pts.flow++;tags.push("RVOL");} else if(vol==null)missing.push("real exchange volume");
  if(delta!=null&&Math.sign(delta)===side){pts.flow++;tags.push("CVD");}else if(delta==null)missing.push("signed trade flow");
  const strength=adx(b15),bb=bollinger(c),v=dailyAnchoredVwap(b15,last.t);
  if(strength!=null&&strength>=25){pts.regime++;tags.push("ADX_trend");}
  if(bb&&v!=null&&((isLong&&last.c>v&&last.c>bb.mid)||(!isLong&&last.c<v&&last.c<bb.mid))){
    pts.regime++;tags.push("VWAP_BB_location");}else if(v==null)missing.push("session traded-volume VWAP");
  if(macroClear){pts.macro=1;tags.push("no_verified_macro_veto");}
  const range=last.h-last.l,wick=isLong?Math.min(last.o,last.c)-last.l:last.h-Math.max(last.o,last.c);
  if(range>0&&wick>2*Math.abs(last.c-last.o)&&wick>.3*range){pts.trigger=1;tags.push("rejection_candle");}
  const score=Object.values(pts).reduce((a,b)=>a+b,0);
  const families=Object.values(pts).filter(x=>x>0).length;
  const setup=swept?"SWEEP_REVERSAL":isTrend?"TREND_PULLBACK":"NONE";
  return {direction:dir,setup,score,families,points:pts,tags,missing,
    eligible:setup!=="NONE"&&score>=9&&families>=4&&pts.liquidity>0 &&
      !missing.includes("wrong premium/discount location") &&
      !missing.includes("real exchange volume") && !missing.includes("signed trade flow")};
}
