-- Careful: fuel costs fuel_price per unit per day, and a day is 40 seconds. Powering a home with fuel costs more than its people
-- pay in tax, while a datacenter job at a good price pays for its fuel. So the datacenters come first on the grid, and the plant
-- burns fuel only for the load above BASE, which is theirs: the homes and the other boards share the wind. With nothing to burn
-- for it sleeps, silent: the thermal setting and the supply order stay set while it does.
-- BASE: both homes (77 and 92 with their transmission loss) and the boards awake (about 50).
local BASE = 220

function tick(io, mem)
  if not mem.ready then
    io.set_priority({ "DA", "DB", "H1", "H2", "W", "F1", "F2", "F3" })
    mem.ready = true
  end
  local need = (io.demand - BASE + 9) // 10 * 10
  if need < 0 then need = 0 elseif need > 300 then need = 300 end
  if need ~= mem.last then
    io.set_thermal(need)
    mem.last = need
  end
  if need == 0 then io.sleep(10) end
end
