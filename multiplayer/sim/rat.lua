function depart(rat, carrying, burrow, food)
  walkTo(rat, carrying and burrow or food)
end

function arrived(rat, carrying)
  -- Pause to pick up the chip, or take a longer break after delivering it.
  return not carrying, carrying and 2 + rat % 3 or 0.6
end
