-- Careful: buy only the fuel the working datacenters need, and go dark when they do.
-- Demand of 8 or less means both datacenters sleep: Luddites are near, or no work pays.
function tick(io, mem)
  if io.demand <= 8 then
    io.sleep(5)
    return
  end
  if not mem.ready then
    io.set_priority({ "DA", "DB" })
    mem.ready = true
  end
  -- Cover the recent peak, so a job that starts between two ticks isn't shed;
  -- the peak decays slowly after the jobs stop. Steps of 10 keep the actions few.
  local peak = (mem.peak or 0) - 10
  if io.demand > peak then peak = io.demand end
  mem.peak = peak
  local need = (peak - io.wind + 19) // 10 * 10
  if need < 0 then need = 0 elseif need > 300 then need = 300 end
  if need ~= mem.last then
    io.set_thermal(need)
    mem.last = need
  end
end
