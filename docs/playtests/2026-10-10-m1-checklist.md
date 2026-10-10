# Milestone 1 playtest (2026-10-10)

You play in the browser with your own Claude Code. Milestone 1 is the power plant (P) and the two datacenters (DA, DB); the game's labels are in Korean, and they are quoted below as they appear on screen.

## Getting started
1. Run `pnpm start` in a terminal and open http://127.0.0.1:7840 in a browser. The terminal prints a timestamped line each time the agent connects ("agent connected: claude-code") or disconnects ("agent disconnected").
2. Copy the connect command from the screen ("복사" copies it) and run it in the folder where you'll start Claude Code: it registers the game's MCP server for that folder, so once per folder is enough (after "토큰 재발급", the token reissue button, run the new command again). Then start Claude Code there.
3. When the screen shows "● 에이전트 연결됨", press "시즌 시작". The season starts paused, with every board empty.
4. Ask Claude Code for the town's first firmware, for example: "Read the datasheets of the turing-city boards, then write and deploy their firmware."
5. When it's done, press Space to play. 1, 2, and 3 set the speed; H shows the EMF heatmap. A season is 30 days of 40 seconds: about 20 minutes at 1×. The game pauses by itself at a raid, a destroyed board, a fire, and a firmware error; the "자동 정지" boxes under the alert feed change that.

## What to check
- [ ] Is the loop of writing and fixing firmware fun? How does a crisis (Luddites, overheating, a blackout), then pausing, then the agent's fix, then playing on feel?
- [ ] Does a careful season score clearly better than a careless one? Play one of each and note the money ("최종 자금") at each season's end.
- [ ] Does the agent understand what's happening from the datasheets and logs alone? Where does it get lost?
- [ ] Can you read what's happening on screen: board lights (the panel names the state: "펌웨어 없음", "동작", "휴면", "정전", "에러", "파괴"), temperatures, Luddite paths, the plant's links when it's selected?
- [ ] How often and how hard do Luddites raid: too often, too rarely?
- [ ] Does the game pause when the agent disconnects (the "⏸ 에이전트 연결이 끊겼어요" box), and can you play again once it reconnects?
- [ ] Is there more to careful play than sleeping until the job price pays? In the headless runs (`pnpm sim --rebuild`, seeds 1 to 10) the careful firmware beat the careless one by more than 1,000 on six seeds; on the other four the job price rarely reached its threshold, so its datacenters slept through 99 to 100% of the season, and it ended within 650 of the careless set.

## Out of scope for now
The food chain (farms, the warehouse, trucks, housing), the season wrap-up's breakdown and past seasons ("시즌 결산 화면(내역과 지난 시즌 목록)은 마일스톤 2에서 붙어요."), and sprites come in milestone 2 or later.

## Notes
(What you felt while playing, and the time of anything odd. The terminal's timestamps show when the agent connected and disconnected.)
