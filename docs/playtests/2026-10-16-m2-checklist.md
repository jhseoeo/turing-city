# Milestone 2 playtest (2026-10-16)

You play the early stage in the browser. The whole small town is there:
- three farms (F1 to F3);
- the warehouse (W) with two trucks;
- two housing blocks (H1, H2);
- the power plant (P);
- two datacenters (DA, DB).

Every facility starts without a board, and you work it by hand. A board takes a facility's chore over with firmware you write in the game's editor, most likely by handing the board's manual to an AI chat. A comm module on a board lets your own Claude Code take that board over by MCP. The game's labels are in Korean, quoted below as they appear on screen.

## Getting started
1. Run `pnpm start` in a terminal and open http://127.0.0.1:7840 in a browser.
2. Press "시즌 시작". No agent is needed.
   - The season stands still under the guide card ("이렇게 해요") and starts running when you close it. "다시 보지 않기" keeps it away, and the top bar's [도움말] brings it back.
   - Each "시즌 시작" and "새 시즌" draws a random seed that the screen doesn't show, so two seasons are two different towns.
3. The keys:
   - Space plays and pauses; 1, 2, and 3 set the speed; H shows the EMF heatmap.
   - Escape closes the open window, nearest first (the editor, then the manual, then the guide card), and then clears the selection. In the editor, Escape closes the editor and keeps your text. The other keys type into the code there.

   A season is 30 days of 40 seconds: about 20 minutes at 1×. The game pauses by itself at a raid, a wreck, a fire, a firmware error, and a lost agent. The "자동 정지" boxes under the alert feed change that.
4. Click a facility to open its panel. From the top, a panel has:
   - its state and tier;
   - its hand controls ("손으로"), right under the title, so the button you keep pressing stays under the pointer;
   - its readings ("현재");
   - its parts ("부품": a board, then a comm module, each with its price);
   - [매뉴얼], its board's manual, which you can read before you buy the board (housing takes none).
5. For T2 only, connect Claude Code as in milestone 1:
   - Copy the connect command from the start screen ("복사").
   - Run it in an empty folder outside this repository, and start Claude Code there. Inside the repository Claude Code would read CLAUDE.md, the reference firmware in `scenarios/firmware/m2/`, and the sources, and the manual would no longer be what it works from.
   - After "토큰 재발급" (token reissue), run `claude mcp remove turing-city` in that folder before you run the new command.

## What to try
**T0, by hand:**
- **A farm:** [수확] when the crop is ripe (the bar along the bottom of its cell turns green). A ripe crop left alone rots.
- **The warehouse:** under "트럭 보내기", pick a truck, a trip, and an amount, then [보내기]. A trip collects a farm's outbox ("F1에서 회수") or delivers to a housing block ("H1에 전달"). With the warehouse selected, the map shows its trucks' routes.
- **The power plant:**
  - the thermal slider ("화력"), whose fuel costs money;
  - the supply order (↑ and ↓), where the bottom of the list loses power first when the plant falls short.
- **A datacenter:**
  - [처리] runs it for one second and earns money while it runs. The button waits as "처리 중…" until the gauge fills; press it again then to keep it running.
  - It heats up. [냉각] runs a cooling cycle of a few seconds that draws a lot of power. Above 90 °C it can catch fire.
- **Housing** eats food, and pays tax while fed and powered. The top bar shows 식량 (food) and 인구 (people: fed, hungry, without power).

**T1, a board and the editor:**
- **The board.** [보드 설치 (price)] in a facility's panel. A new board is empty: the facility goes on by hand until you deploy.
- **The manual.** [매뉴얼] opens the board's manual beside the map. Read it, or [마크다운 복사] (copy) or [.md 다운로드] (download) it, and give it to an AI chat with what you want the board to do.
- **The editor.** [편집] opens the editor beside the manual. Paste the code and press [배포].
  - A syntax error shows its line under the editor ("N번째 줄: …").
  - An accepted deploy says when it installs.
  - Close the editor and open it again: what you typed and did not deploy is still there.
- **The log.** The panel shows the board's log. [로그 복사] copies it, for the AI when the board misbehaves.

**T2, a comm module and your agent:**
- [통신 모듈 (price)] on a board. Then ask your Claude Code to take it over, for example: "Read the manual of turing-city's DA board, then write and deploy its firmware."
- The agent's board tools reach only boards with a comm module, and say so for the others.

**The threat:**
- Running boards, and a datacenter at work, leak EMF; H shows it. A datacenter with no board leaks only while it processes.
- Luddites follow it, but only to a machine: a facility whose board runs or sleeps, or a datacenter at work. They wreck the facility they reach, board and all. A wrecked facility stops, by hand too.
- Getting it back takes [시설 복구] (repair the facility), then [보드 재건] (rebuild its board), each paid for on its own.

## What to check
- [ ] Could you tell what to do from the guide card and the panels alone?
- [ ] Is T0 tedious enough that a board is a relief, and short enough not to bore? Which chore did you want off your hands first?
- [ ] Did the manual make you hand it to an AI? Did the AI's firmware work the first time? What did you fix, and were the log and the errors enough to find it?
- [ ] Which facility did you automate first, and why? Was it a real choice?
- [ ] How was handing a board to your agent, compared with pasting from a chat? Did the agent manage from the manual and the logs alone?
- [ ] Did you feel the trade-off: each board takes a chore away and adds EMF? How often and how hard did the Luddites come?
- [ ] Did a board pay for itself within the season? Note each season's ending ("시즌 완주" or "파산") and its final money ("최종 자금"). This is a tuning question: the prices and the upkeep are placeholders. For comparison, in headless runs on seeds 1 to 3 a town with no boards ended on 5,585, 5,965, and 5,600, and a careful set of firmware on all seven boards bought at the start ended on 1,904, 7,571, and 4,138. Which boards paid, and which only cost?
- [ ] Was the food chain (the farms, the warehouse and its trucks, the housing) worth running, or did you let it go? Did the homes eat and pay tax, and what did you give up to keep them fed? Another tuning question, and the one the 10-10 spec (§15) leaves open.
- [ ] Can you read the town on screen:
  - lights only on facilities with a board, and the tier marks;
  - the trucks and their routes;
  - the captions under the cells: temperature, ripeness and outbox, stock, food.
- [ ] With an agent connected: does the game pause when it drops ("에이전트 연결이 끊겼어요" in the feed), and only when you caused it (quitting Claude Code, or /mcp)? Note any drop you didn't cause, with the time of the terminal's "agent disconnected" line. Whether interactive Claude Code answers the game's pings is still unchecked.
- [ ] Does the H key work with the 한글 input source on? Only a synthetic key event has checked this.

## Out of scope for now
- the season wrap-up's breakdown and past seasons (the end overlay says "시즌 결산 화면(내역과 지난 시즌 목록)은 이번 플레이테스트 뒤에 붙어요.");
- firmware at T0, and `io.notify`;
- tiers past T2 (the wireless module, the control center);
- fuel as a stock;
- sprites.

## Notes
(What you felt while playing, and the time of anything odd. The terminal's timestamps show when an agent connected and disconnected.)
