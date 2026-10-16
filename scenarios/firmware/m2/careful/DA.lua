-- Careful: a job pays price per second, and its power costs fuel: DA draws 163 units with its transmission loss, about 29 a second
-- at the usual fuel price, so work only at a price above that. A second of work heats the datacenter 2 °C and it cools very slowly
-- by itself, so work in short spells below SAFE and sleep in between: a sleeping board is silent, and a busy datacenter is the
-- loudest thing in town. A cooling cycle burns 250 units of power for a few seconds: only past DANGER (fire starts above 90 °C).
-- Hide from Luddites.
local MIN_PRICE = 32
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
