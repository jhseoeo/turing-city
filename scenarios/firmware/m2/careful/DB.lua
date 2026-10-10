-- Careful: as DA, but DB is 16 cells from the plant: it draws 198 units with its transmission loss, about 35 a second in fuel,
-- so it works only at a higher price.
local MIN_PRICE = 42
local SAFE = 75
local DANGER = 86

function tick(io, mem)
  if io.luddite_dist then
    io.sleep(40)
  elseif io.temp >= DANGER then
    io.cool()
  elseif io.temp >= SAFE then
    io.sleep(8)
  elseif io.price >= MIN_PRICE then
    io.process()
  else
    io.sleep(10)
  end
end
