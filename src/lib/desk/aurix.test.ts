import { describe, expect, it } from "bun:test";
import { cryptoProb, goldProb } from "./settlement";
import { nextGridBid, scoreSides } from "./gate";
import { evaluateSniper, resampleComplete, fibPocket, vwap, orderBlockCandidate, type Candle } from "./sniper";
import { scheduledVeto } from "./intelligence";
import { CALIBRATED_MODEL_APPROVED, DAILY_STOP_USD } from "./config";

const closeMs = Date.UTC(2026, 9, 9, 0, 15, 0);
const closeSec = closeMs / 1000;
const ticks = () => new Map(Array.from({ length: 60 }, (_, i) => [(closeSec - 59 + i) * 1000, 100]));

describe("AURIX-X settlement correctness", () => {
  it("excludes starting boundary and includes close tick", () => {
    const values = ticks();
    values.set((closeSec - 60) * 1000, 1);
    values.set(closeMs, 160);
    const model = cryptoProb({ closeMs, strike: 100.95, dp: 2,
      last: {t:closeMs,v:160}, windowPrints:values,sigma:0.0001 });
    expect(model.printed).toBe(60);
    expect(model.future).toBe(0);
    expect(model.mean).toBe(101);
    expect(model.p).toBe(1);
  });
  it("missing historical tick is an error, never a guessed fill", () => {
    const values = ticks();values.delete((closeSec-5)*1000);
    expect(()=>cryptoProb({closeMs,strike:99,dp:2,last:{t:closeMs,v:100},
      windowPrints:values,sigma:0.0001})).toThrow();
  });
  it("uses the authenticated official partial accumulator when local frames drop", () => {
    const values = ticks();
    values.delete((closeSec - 10) * 1000);
    const out = cryptoProb({
      closeMs, strike: 100, dp: 2, last: { t: closeMs, v: 100 },
      windowPrints: values, sigma: 0.0001,
      official: { value: 100, count: 60, t: closeMs },
    });
    expect(out.printed).toBe(60);
    expect(out.p).toBe(1);
    expect(() => cryptoProb({
      closeMs, strike: 100, dp: 2, last: { t: closeMs, v: 100 },
      windowPrints: values, sigma: 0.0001,
      official: { value: 100, count: 59, t: closeMs },
    })).toThrow();
  });
  it("rejects invalid gold sigma rather than manufacturing certainty",()=>{
    expect(()=>goldProb({closeMs,strike:100,dp:2,last:{t:closeMs-1000,v:100},sigma:0})).toThrow();
  });
});

describe("AURIX-X executable trading gate",()=>{
  it("quotes the venue legal increment rather than a universal penny tick",()=>{
    const ranges=[{start:0.001,end:0.10,step:0.001},{start:0.10,end:0.90,step:0.01},
      {start:0.90,end:0.999,step:0.001}];
    expect(nextGridBid(0.09,ranges)).toBeCloseTo(0.091);
    expect(nextGridBid(0.10,ranges)).toBeCloseTo(0.11);
    expect(nextGridBid(0.90,ranges)).toBeCloseTo(0.901);
    expect(nextGridBid(0.50,[])).toBeNull();
  });
  it("NaN probability and NaN orderbook cannot trigger a trade",()=>{
    const book={yesBid:{price:0.45,size:8},noBid:{price:0.50,size:8},ts:Date.now()};
    const fees={feeType:"quadratic",multiplier:1};
    expect(scoreSides(NaN,0.5,book,fees).best).toBeNull();
    expect(scoreSides(0.7,0.7,{...book,yesBid:{...book.yesBid,price:NaN}},fees).best).toBeNull();
  });
  it("unreviewed probability model prevents live order approval",()=>{
    expect(CALIBRATED_MODEL_APPROVED).toBe(false);
    expect(DAILY_STOP_USD).toBe(-15); // POLICY round 3
  });
});

describe("AURIX-X genuine price/flow evidence",()=>{
  it("refuses to invent 1h bars from a one-minute gap",()=>{
    const bars: Candle[]=Array.from({length:75},(_,i)=>({
      t: i * 60_000, o:100,h:101,l:99,c:100,
    })).filter((_,i)=>i!==30);
    const fifteen=resampleComplete(bars,15);
    expect(fifteen.length).toBe(4);
    const result=evaluateSniper(fifteen,[],"long",true);
    expect(result.eligible).toBe(false);
    expect(result.missing).toContain("205 complete 1h bars");
  });
  it("maps bullish 61.8 percent retracement to DISCOUNT, not premium", () => {
    expect(fibPocket(38.2,0,100,"long")?.inside).toBe(true);
    expect(fibPocket(63,0,100,"short")?.inside).toBe(true);
    expect(fibPocket(80,0,100,"long")?.premium).toBe(true);
  });
  it("will not manufacture volume-weighted VWAP from price-only data", () => {
    expect(vwap([{t:0,o:1,h:2,l:1,c:1.5}])).toBeNull();
    expect(vwap([{t:0,o:1,h:2,l:1,c:1.5,v:10}])).toBeCloseTo(1.5);
  });
  it("order block candidate requires real displacement rather than any opposite candle", () => {
    const b: Candle[] = Array.from({length:10},(_,i)=>({t:i*900000,o:100,h:101,l:99,c:i%2?99.9:100.1,v:100}));
    expect(orderBlockCandidate(b,"long",10)).toBeNull();
  });
  it("only explicit timezone ISO macro events can create a scheduled veto",()=>{
    const now=Date.parse("2026-10-09T12:25:00Z");
    expect(scheduledVeto([{name:"CPI",when:"2026-10-09T12:30:00Z"}],now).length).toBe(1);
    expect(scheduledVeto([{name:"CPI",when:"Friday at 8:30"}],now).length).toBe(0);
  });
});
