-- Careless: work whenever it isn't too hot. No cooling, no price, no Luddites.
function tick(io, mem)
  if io.temp < 80 then io.process() end
end
