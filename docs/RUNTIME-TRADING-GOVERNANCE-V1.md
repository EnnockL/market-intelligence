# Runtime Trading Governance v1

Historiskt validerad edge betyder inte att en strategi ska handlas nu. Runtime-lagret har därför `NO_TRADE` som standard.

En setup får endast gå vidare när strategin är validerad, rätt regim är aktiv, kritisk data är komplett, tesen inte är invaliderad, portföljkorrelationen är känd och acceptabel, edge-decay inte är observerad och inga kritiska driftfel finns.

Livscykeln innehåller explicit `REVALIDATION_REQUIRED`, `PAUSED` och `RETIRED`. En pausad eller nedgraderad strategi återaktiveras aldrig automatiskt.

Risk-of-ruin och fractional Kelly är diagnostik. De får inte själva höja position size. Kapitalökning kräver en separat immutable grind, manuell sign-off och högst ett versionsstyrt steg. Execution safety, kill switch, spot-only och förbud mot withdrawal-behörighet fortsätter gälla oberoende av strategins status.
