-- Careful: work only at a price that pays for the power even when all of it is fuel;
-- otherwise sleep, silent and nearly free. Hide from Luddites. Cool only when hot.
local MIN_PRICE = 50

function tick(io, mem)
  if io.luddite_dist then
    io.sleep(40) -- dark and silent until the group loses the trail
    return
  end
  if io.price < MIN_PRICE then
    io.sleep(20)
    return
  end
  if io.temp > 70 and mem.cooling ~= 1 then
    io.cool(1)
    mem.cooling = 1
  elseif io.temp < 50 and mem.cooling ~= 0 then
    io.cool(0)
    mem.cooling = 0
  end
  if io.temp < 86 then io.process() end
end
