# MacroMiro

Kalshi perpetuals. One pile, $100 to $200. This is not a promise of profit.

## How a trade works

You press long or short. That press is the side. The markets are Bitcoin, Ether, Solana, XRP, gold, silver, and the S&P. The stop can lose 8% of the pile. Three full stops are 24%. The account stops at 25%.

Half comes off one risk-unit from the entry. That used to be the midpoint of the target, which paid you less than one times the risk. The rest comes off at the target on the slider. It starts at 2.5. After the half, the stop moves to the entry and then trails.

One loss does nothing. Two do nothing. The third ends the day. Do not raise the clip after a win.

## Why 8%, not 15%

A 15% stop makes the third loss impossible. Two stops are already 30%, past the 25% account stop. The three-loss rule only means something if each stop fits under that hole.

## Not this

Fifteen-minute contracts stay paper. Meme coins stay out. News does not pick the side. The three desk switches still have to be on before a press reaches Kalshi.

The code is `src/lib/perps/flip-plan.ts`, `src/lib/perps/manage.ts`, and `src/lib/desk/guard.ts`. None of it has a measured win rate on this account.
