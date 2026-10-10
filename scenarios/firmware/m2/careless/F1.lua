-- Careless: harvest whenever the crop is ripe, awake all the time.
function tick(io, mem)
  if io.ripeness >= 100 then io.harvest() end
end
