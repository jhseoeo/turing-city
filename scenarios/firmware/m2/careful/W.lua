-- Careful: people who have not eaten pay no tax, so the hungriest block is fed first, while it has less than a day's food left.
-- Food comes in from the fullest outbox before it spills (an outbox holds 80, and a harvest is 40). A truck carries 40 and pays
-- fuel for every cell it drives, so it drives only for a worthwhile load, and never to where another truck is already going.
-- With nothing to send the board sleeps: trucks on the road finish their trips.
local CAP = 40
local MIN_LOAD = 12
local HOME = "W"

function tick(io, mem)
  local idle, busy = {}, {}
  for _, t in ipairs(io.trucks) do
    if t.status == "idle" then
      idle[#idle + 1] = t.id
    elseif t.target then
      busy[t.target] = true
    end
  end
  local sent = false
  if #idle > 0 and io.stock >= MIN_LOAD then
    local home, least = nil, 1e9
    for _, h in ipairs(io.housing) do
      local per = h.food / h.residents
      if not busy[h.id] and h.food < h.residents and per < least then home, least = h, per end
    end
    if home then
      io.dispatch(table.remove(idle, 1), HOME, home.id, math.min(io.stock, CAP))
      sent = true
    end
  end
  if #idle > 0 then
    local farm, most = nil, MIN_LOAD - 1
    for _, f in ipairs(io.farms) do
      if not busy[f.id] and f.outbox > most then farm, most = f, f.outbox end
    end
    if farm then
      io.dispatch(table.remove(idle, 1), farm.id, HOME, math.min(most, CAP))
      sent = true
    end
  end
  if not sent then io.sleep(5) end
end
