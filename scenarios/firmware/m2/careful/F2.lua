-- Careful: harvest a ripe crop at once (a crop left ripe for 20 seconds rots), and sleep until the next one is due: a sleeping
-- board is silent and nearly free. A crop ripens in 40 seconds, and ripeness is in percent.
local RIPEN_SECONDS = 40

function tick(io, mem)
  if io.ripeness >= 100 then
    io.harvest()
    return
  end
  local left = (100 - io.ripeness) * RIPEN_SECONDS // 100
  if left > 2 then io.sleep(math.min(40, left - 1)) end
end
