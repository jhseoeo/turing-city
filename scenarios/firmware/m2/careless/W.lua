-- Careless: truck 1 always fetches 40 from F1, and truck 2 always takes 40 to H1, whatever there is.
function tick(io, mem)
  for _, t in ipairs(io.trucks) do
    if t.status == "idle" then
      if t.id == 1 then
        io.dispatch(1, "F1", "W", 40)
      else
        io.dispatch(2, "W", "H1", 40)
      end
    end
  end
end
