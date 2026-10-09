/**
 * Trusted Lua that runs once per board VM, before any firmware. It keeps what it needs
 * in locals, builds the sandbox, and exposes entry points as globals that the host
 * takes into registry references and then removes.
 */
export const PRELUDE = String.raw`
local charge = __charge; __charge = nil
local load, type, error, select, tostring_raw = load, type, error, select, tostring
local setmetatable_raw, getmetatable, rawget, rawset, rawlen, rawequal = setmetatable, getmetatable, rawget, rawset, rawlen, rawequal
local pairs, ipairs, next, pcall, xpcall, assert, tonumber = pairs, ipairs, next, pcall, xpcall, assert, tonumber
local S, T, M, C = string, table, math, coroutine
local collect = collectgarbage

-- What a value looks like to firmware. A table prints through the __tostring that getmetatable shows, which is called
-- here and not through tostring_raw: getmetatable hands back a __metatable field in place of the real metatable, so
-- tostring_raw would look in a metatable that has no __tostring and print an address. A __tostring that is not a
-- function has nothing to call: the table is just "table".
local function safe_tostring(v)
  local tv = type(v)
  if tv == "table" then
    local mt = getmetatable(v)
    local f = type(mt) == "table" and rawget(mt, "__tostring")
    if type(f) ~= "function" then return "table" end
    local s = f(v)
    local ts = type(s)
    if ts == "string" then return s end
    if ts == "number" then return tostring_raw(s) end
    error("'__tostring' must return a string", 0)
  elseif tv == "function" or tv == "thread" or tv == "userdata" then
    return tv
  end
  return tostring_raw(v)
end

local function safe_setmetatable(t, mt)
  if type(mt) == "table" and (rawget(mt, "__gc") ~= nil or rawget(mt, "__mode") ~= nil) then
    error("__gc and __mode are not allowed", 2)
  end
  return setmetatable_raw(t, mt)
end

-- Builtins whose work grows with their input are charged as instructions, one per 16 bytes
-- or per element. Sizes come only from real strings and integers, and costs are computed in
-- floating point, so no argument (a __len metamethod, a negative range, NaN, an overflowing
-- count) can produce a negative charge; the host also ignores anything that isn't positive.
local function len(v) return type(v) == "string" and #v or 32 end
local function int(v, i, name)
  return M.tointeger(v) or error("bad argument #" .. i .. " to '" .. name .. "' (number has no integer representation)", 3)
end
-- How many values string.byte returns, by Lua's rules for negative and out-of-range positions.
local function span(l, i, j)
  if i < 0 then i = i < -l and 1 or l + i + 1 elseif i == 0 then i = 1 end
  if j > l then j = l elseif j < 0 then j = j < -l and 0 or l + j + 1 end
  return j - i + 1
end

local safe_string = {
  len = S.len,
  sub = S.sub,
  upper = function(s) charge(len(s) / 16); return S.upper(s) end,
  lower = function(s) charge(len(s) / 16); return S.lower(s) end,
  reverse = function(s) charge(len(s) / 16); return S.reverse(s) end,
  rep = function(s, n, sep)
    n = int(n, 2, "rep")
    -- The C loop runs n times even when the strings are empty.
    if n > 0 then charge(M.max(len(s) + (sep == nil and 0 or len(sep)), 1) / 16 * n) end
    return S.rep(s, n, sep)
  end,
  -- Without j, string.byte returns one value at most; with it, every value counts.
  byte = function(s, i, j)
    if j ~= nil and type(s) == "string" then charge(span(#s, int(i == nil and 1 or i, 2, "byte"), int(j, 3, "byte"))) end
    return S.byte(s, i, j)
  end,
  char = function(...) charge(select("#", ...)); return S.char(...) end,
  -- A table, function, thread, or userdata goes through safe_tostring first, so %s prints what tostring does and
  -- never an address. %p prints the address of any value, so it is refused. "%%" is a percent sign, not a conversion:
  -- once those pairs are gone, a % followed by flags, digits, or a dot and a p is a %p. The pattern is one class
  -- and a star, so it stays linear however the format string is built. The charge counts the converted arguments.
  format = function(fmt, ...)
    local args = T.pack(...)
    local n = len(fmt)
    for k = 1, args.n do
      local a = args[k]
      local ta = type(a)
      if ta == "table" or ta == "function" or ta == "thread" or ta == "userdata" then
        a = safe_tostring(a)
        args[k] = a
      end
      if type(a) == "string" then n = n + #a end
    end
    charge(n / 16)
    if type(fmt) == "string" and S.find(S.gsub(fmt, "%%%%", ""), "%%[-+ #0-9.]*p") then
      error("bad argument #1 to 'format' (the %p conversion prints an address and is not available)", 2)
    end
    return S.format(fmt, T.unpack(args, 1, args.n))
  end,
  -- Plain substring search only: Lua patterns can backtrack for seconds inside one instruction.
  -- Even a plain search can compare the needle at every position, so both lengths count.
  find = function(s, sub, init) charge(len(s) * len(sub) / 16); return S.find(s, sub, init, true) end,
}
local strmeta = getmetatable("")
strmeta.__index = safe_string
strmeta.__metatable = false

local function copy(t) local r = {}; for k, v in pairs(t) do r[k] = v end; return r end

local safe_table = {
  pack = T.pack,
  -- insert, remove, and move shift elements one at a time. They're written in Lua so every
  -- shift counts, whatever a __len metamethod says the length is.
  insert = function(t, ...)
    local nargs, e = select("#", ...), #t + 1
    if nargs == 1 then
      t[e] = ...
      return
    end
    if nargs ~= 2 then error("wrong number of arguments to 'insert'", 2) end
    local pos, v = ...
    pos = int(pos, 2, "insert")
    if pos < 1 or pos > e then error("bad argument #2 to 'insert' (position out of bounds)", 2) end
    for k = e, pos + 1, -1 do t[k] = t[k - 1] end
    t[pos] = v
  end,
  remove = function(t, pos)
    local size = #t
    pos = pos == nil and size or int(pos, 2, "remove")
    if pos ~= size and (pos < 1 or pos > size + 1) then error("bad argument #2 to 'remove' (position out of bounds)", 2) end
    local v = t[pos]
    for k = pos, size - 1 do t[k] = t[k + 1] end
    t[pos < size and size or pos] = nil
    return v
  end,
  move = function(a1, f, e, t, a2)
    f, e, t = int(f, 2, "move"), int(e, 3, "move"), int(t, 4, "move")
    if a2 == nil then a2 = a1 end
    if e >= f then
      if t > e or t <= f or a2 ~= a1 then
        for k = 0, e - f do a2[t + k] = a1[f + k] end
      else
        for k = e - f, 0, -1 do a2[t + k] = a1[f + k] end
      end
    end
    return a2
  end,
  concat = function(t, sep, i, j)
    i = i == nil and 1 or int(i, 3, "concat")
    j = int(j == nil and #t or j, 4, "concat")
    local lsep, n = sep == nil and 0 or len(sep), 0.0
    for k = i, j do
      local v = t[k]
      n = n + lsep + (type(v) == "string" and #v or 32)
    end
    charge(n / 16)
    return T.concat(t, sep, i, j)
  end,
  -- C sorts a table in place only when it has no metatable, so no __len can change the length
  -- it was charged for; any other table is sorted through a plain copy.
  sort = function(t, f)
    local n = #t
    if n > 1 then charge(n * M.log(n, 2)) end
    if getmetatable(t) == nil then return T.sort(t, f) end
    local c = {}
    for k = 1, n do c[k] = t[k] end
    T.sort(c, f)
    for k = 1, n do t[k] = c[k] end
  end,
  unpack = function(t, i, j)
    i = i == nil and 1 or int(i, 2, "unpack")
    j = int(j == nil and #t or j, 3, "unpack")
    charge(j + 0.0 - i + 1)
    return T.unpack(t, i, j)
  end,
}
local safe_math = copy(M); safe_math.randomseed = nil
local safe_coroutine = copy(C)

local mem, q, logs = {}, {}, {}
-- actions holds the io actions of the board's kind; io_t is the io table of the firmware that runs.
local io_t, actions = nil, {}
-- pending is a compiled firmware waiting for the next step; installed is the record of the one that runs (its main
-- closure, its environment, and the copies of the libraries in it), kept whole so that nothing compiling added
-- can be freed by the firmware and then spent as data.
local env, pending, installed = nil, nil, nil

local function log(...)
  local parts = {}
  for k = 1, select("#", ...) do parts[k] = safe_tostring((select(k, ...))) end
  if #logs < 20 then logs[#logs + 1] = S.sub(T.concat(parts, "\t"), 1, 200) end
end

local function push(...)
  local n = select("#", ...)
  if #q + n <= 64 then
    for k = 1, n do q[#q + 1] = (select(k, ...)) end
  end
end

local function make_env()
  local libs = { copy(safe_string), copy(safe_table), copy(safe_math), copy(safe_coroutine) }
  local e = {
    assert = assert, error = error, ipairs = ipairs, next = next, pairs = pairs, pcall = pcall, xpcall = xpcall,
    select = select, tonumber = tonumber, tostring = safe_tostring, type = type, rawequal = rawequal,
    rawget = rawget, rawset = rawset, rawlen = rawlen, setmetatable = safe_setmetatable, getmetatable = getmetatable,
    print = log, string = libs[1], table = libs[2], math = libs[3],
    coroutine = libs[4], _VERSION = _VERSION,
  }
  e._G = e
  return e, libs
end

-- Every install gets a brand-new io: whatever the old firmware did to the table (a field changed or removed, a
-- metatable, a protected one too) is left behind with it, and only mem carries over. The host writes the sensors in.
local function fresh_io()
  local t = {}
  for k, v in next, actions do t[k] = v end
  io_t = t
  return t
end

function __boot(kind, fids, seed)
  M.randomseed(seed)
  -- The queue and the log keep the arrays they grow to, and an array never shrinks. They start at their limits (64
  -- numbers, 20 lines of an array of 32) so that the baseline holds them and no tick can leave them to the firmware.
  for k = 1, 64 do q[k] = 0 end
  for k = 1, 64 do q[k] = nil end
  for k = 1, 20 do logs[k] = "" end
  for k = 1, 20 do logs[k] = nil end
  local fidx = {}
  for k = 1, #fids do fidx[fids[k]] = k end
  actions.log = log
  actions.sleep = function(seconds) push(5, tonumber(seconds) or 0) end
  if kind == "datacenter" then
    actions.process = function() push(1) end
    actions.cool = function(level) push(2, tonumber(level) or 0) end
  elseif kind == "power" then
    actions.set_thermal = function(output) push(3, tonumber(output) or 0) end
    actions.set_priority = function(list)
      if type(list) ~= "table" then error("set_priority expects a list of facility ids", 2) end
      local idx = {}
      for k = 1, #list do
        local i = fidx[list[k]]
        if not i then error("unknown facility: " .. safe_tostring(list[k]), 2) end
        idx[k] = i
      end
      push(4, #idx, T.unpack(idx))
    end
  end
  return fresh_io()
end

function __compile(src)
  local e, libs = make_env()
  local f, err = load(src, "=firmware", "t", e)
  if not f then error("syntax error: " .. err, 0) end
  pending = { f = f, env = e, libs = libs }
end

-- Drops the installed firmware and its globals, and returns the fresh io table that the next one starts with. The
-- host calls it once a deploy has compiled and been measured, so that the chunk waiting in pending is the only
-- firmware alive when the RAM cap is set.
function __release()
  env, installed = nil, nil
  return fresh_io()
end

function __collect() collect("collect") end

function __step()
  if pending then
    local p = pending
    pending = nil
    installed, env = p, p.env
    p.f()
  end
  if env == nil then error("__NOTICK__ no firmware installed", 0) end
  local tick = rawget(env, "tick")
  if type(tick) ~= "function" then error("__NOTICK__ firmware defines no tick(io, mem) function", 0) end
  tick(io_t, mem)
end

__q, __logs = q, logs
`;
