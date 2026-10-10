-- Careful: work only at a price that pays for the power even when all of it is fuel;
-- otherwise sleep, silent and nearly free. Hide from Luddites. Never cool: a cooling
-- cycle burns more power than the work it makes room for, so rest below 75 °C instead.
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
  if io.temp < 75 then io.process() end
end
