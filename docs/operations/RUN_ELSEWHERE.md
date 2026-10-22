# Run this desk somewhere else

The download you want is the **main** branch. Ignore every `research/` and `feat/` branch.

Zip of that branch:

https://github.com/yougotsam/MacroMiro/archive/refs/heads/main.zip

## What is in the zip

- The code that sends: `src/lib/desk/` (`config.ts`, `gate.ts`, `risk.ts`, `oms.ts`, `evaluator.ts`, `intelligence.ts`, `intel-gate.ts`).
- The written rules: `README.md`, `docs/STRATEGY.md`, `docs/operations/ORDER_PATH.md`, `docs/operations/RISK_MANDATES.md`.
- One page per file, for reading: `artifacts/rule-pages/`.
- The desk record except one file: `data/desk/` (journal, outcomes, bars, prints, book). `data/loop/`, `data/macro-calendar.json`, `data/operating-mode.json`.

## What is not in the zip

- Keys. `.grok/secrets/` holds `kalshi_key_id`, `kalshi_private.pem`, and the three switches (`kalshi_live`, `kalshi_begin`, `desk_arm`). Those never go to GitHub. Copy them onto the new machine yourself. Without the key, the desk can boot and will not send.
- The raw scan log `data/desk/decisions.jsonl`. It is over 100MB, which GitHub refuses. A snapshot is `data/desk/decisions.jsonl.gz`. Restore it with:

```
gzip -dc data/desk/decisions.jsonl.gz > data/desk/decisions.jsonl
```

## Start

```
npm install
```

Then the two lines in `docs/operations/ORDER_PATH.md`. The arm switch is off until you turn it on.
