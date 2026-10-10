# Milestone 1 playtest (2026-10-10)

You play in the browser with your own Claude Code. Milestone 1 is the power plant (P) and the two datacenters (DA, DB); the game's labels are in Korean, and they are quoted below as they appear on screen.

## Getting started
1. Run `pnpm start` in a terminal and open http://127.0.0.1:7840 in a browser. The terminal prints a timestamped line each time the agent connects ("agent connected: claude-code") or disconnects ("agent disconnected").
2. Copy the connect command from the screen ("복사" copies it) and run it in an empty folder outside this repository (for example `mkdir ~/turing-city-play && cd ~/turing-city-play`), then start Claude Code in that folder. The command registers the game's MCP server for that folder, so once per folder is enough. Inside the repository Claude Code would read CLAUDE.md, the reference firmware in `scenarios/firmware/m1/`, and the sources, and "from the datasheets and logs alone" (below) would mean nothing.
   After "토큰 재발급" (the token reissue button) the old registration stops working, and `claude mcp add` refuses a name that already exists ("MCP server turing-city already exists in local config", exit code 1; checked with Claude Code 2.1.296). Run `claude mcp remove turing-city` in that folder first, then the new connect command.
3. When the screen shows "● 에이전트 연결됨", press "시즌 시작". The season starts paused, with every board empty. Each "시즌 시작" (and each "새 시즌") draws a random seed that the screen doesn't show, so two seasons are two different towns, with their own wind, job prices, and raids.
4. Ask Claude Code for the town's first firmware, for example: "Read the datasheets of the turing-city boards, then write and deploy their firmware."
5. When it's done, press Space to play. 1, 2, and 3 set the speed; H shows the EMF heatmap. A season is 30 days of 40 seconds: about 20 minutes at 1×. The game pauses by itself at a raid, a destroyed board, a fire, and a firmware error; the "자동 정지" boxes under the alert feed change that.

## What to check
- [ ] Is the loop of writing and fixing firmware fun? How does a crisis (Luddites, overheating, a blackout), then pausing, then the agent's fix, then playing on feel?
- [ ] Does a careful season score clearly better than a careless one? Play one of each and note the money ("최종 자금") at each season's end. Two seasons are two different towns, so a gap of a few hundred can be the town; the controlled comparison is `pnpm sim` with a fixed seed (`pnpm sim --firmware scenarios/firmware/m1/careless --seed 3 --rebuild`, and the same with `scenarios/firmware/m1/careful`), or a QA agent's `dev_new_season` with a seed. For reference, in those headless runs (seeds 1 to 10) the careless set falls on day 3 and scores 3,259 to 5,631; the careful set completes the season and scores 4,056 to 32,157. Compare each score with the do-nothing baseline of 4,100 as well as with the other set (see the last item): a fall keeps its money, so careless lands on both sides of 4,100.
- [ ] Does the agent understand what's happening from the datasheets and logs alone (Claude Code started in an empty folder, as above)? Where does it get lost?
- [ ] Can you read what's happening on screen: board lights (the panel names the state: "펌웨어 없음", "동작", "휴면", "정전", "에러", "파괴"), temperatures, Luddite paths, the plant's links when it's selected?
- [ ] Does the H key (the heatmap) work with the 한글 input source on? Chrome reports the key as "Process" then, and the game reads it by its position on the keyboard. Only a synthetic key event has checked this, so it's worth a real try.
- [ ] How often and how hard do Luddites raid: too often, too rarely?
- [ ] Does the game pause when the agent disconnects (the "⏸ 에이전트 연결이 끊겼어요" box), and can you play again once it reconnects? Note any such box that you didn't cause (you didn't quit Claude Code or use /mcp), with its time from the terminal's "agent disconnected" line. The game pings the agent every 5 seconds and takes two missed answers in a row for a disconnect; a headless `claude -p` run answered every ping (Claude Code 2.1.296), but interactive Claude Code has not been checked.
- [ ] Is there more to careful play than sleeping until the job price pays? A firmware that does nothing but sleep ends every season on 4,100 (the start money less upkeep, with no raids). In the headless runs (`pnpm sim --rebuild`, seeds 1 to 10) the careful firmware ended well above that on six seeds (6,473 to 32,157). On the other four (seeds 6, 7, 9, 10) the job price rarely reached its threshold and its datacenters slept through 99 to 100% of the season, so it ended between 4,056 and 4,658: below 4,100 on seeds 6 and 10 (4,056 and 4,062), slightly above it on seeds 7 and 9 (4,658 and 4,275), within 560 of sleeping all season.

## Out of scope for now
The food chain (farms, the warehouse, trucks, housing), the season wrap-up's breakdown and past seasons ("시즌 결산 화면(내역과 지난 시즌 목록)은 마일스톤 2에서 붙어요."), and sprites come in milestone 2 or later.

## Notes
(What you felt while playing, and the time of anything odd. The terminal's timestamps show when the agent connected and disconnected.)
