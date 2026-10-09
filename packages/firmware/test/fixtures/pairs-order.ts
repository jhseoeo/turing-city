import { LuaEngine, LuaLibraries } from 'wasmoon';
import { createLuaRuntime } from '../../src/runtime.ts';

const lua = await createLuaRuntime();
const engine = new LuaEngine(lua, { openStandardLibs: false, injectObjects: false, enableProxy: false });
for (const lib of [LuaLibraries.Base, LuaLibraries.Table, LuaLibraries.String, LuaLibraries.Math]) engine.global.loadLibrary(lib);
const out: unknown = engine.doStringSync(`
  local t = {}
  for i = 1, 50 do t["key_" .. i] = i end
  local order = {}
  for k in pairs(t) do order[#order + 1] = k end
  return table.concat(order, ",") .. "|" .. math.random(1, 1000000)
`);
process.stdout.write(String(out));
engine.global.close();
