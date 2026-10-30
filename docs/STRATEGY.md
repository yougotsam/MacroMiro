# Strategy

Read `README.md`. The strategy is the pre-trade checklist in `src/lib/signal/checklist.ts`, scored by the model in `data/signal/model.json`. The current measured result is in `data/signal/report.md`; a product without a KEPT verdict does not trade.

The perpetual button stays manual: you pick the side, the clip, the stop and the target.

## Update Oct 30 2026
- Perps are tested with Sameer's rules (8% stop, half at 1R, trail, 3 losses end the day, −25% stop, real fees and funding, multi-hour holds). None of the 5 series is kept. The perps button stays manual.
- A missing or unverified release calendar blocks trading. Release block is −15/+30 minutes (measured).
- News and MiroFish count in the score: release move (measured), headline tone (measured, 0 until data), MiroFish direction (prior 0.15, never a percent, null when down).
- Gold uses OKX spot-gold bars. Owner blanks stay empty. CALIBRATED_MODEL_APPROVED stays false.
