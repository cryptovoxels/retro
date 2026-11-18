#include "lauxlib.h"
#include "lua.h"
#include "lualib.h"
#include <math.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

enum { WIDTH = 40, CELLS = WIDTH * WIDTH, LIMIT = 100 };
typedef struct {
  float x, z, rest, hidden;
  int home, food, carrying, target;
  uint16_t path[CELLS];
  int left;
} Rat;

static Rat rats[LIMIT];
static int8_t height[CELLS];
static int count;
static lua_State *lua;

static int cell(float x, float z) { return (int)z * WIDTH + (int)x; }

// Unit-cost neighbours. One bounded BFS per departure on this 20m street.
static void flood(int from, int goal, int16_t *parent) {
  int16_t queue[CELLS];
  memset(parent, -1, CELLS * sizeof(*parent));
  parent[from] = from;
  queue[0] = from;
  int tail = 1;
  for (int head = 0; head < tail && (goal < 0 || parent[goal] < 0); head++) {
    int p = queue[head];
    int neighbours[] = {p - WIDTH, p + WIDTH, p % WIDTH ? p - 1 : -1,
                        p % WIDTH < WIDTH - 1 ? p + 1 : -1};
    for (int i = 0; i < 4; i++) {
      int n = neighbours[i];
      if (n < 0 || n >= CELLS || parent[n] >= 0 || height[n] < 0 ||
          abs(height[n] - height[p]) > 1)
        continue;
      parent[n] = p;
      queue[tail++] = n;
    }
  }
}
static int walk_to(lua_State *L) {
  int id = luaL_checkinteger(L, 1);
  if (id < 0 || id >= count)
    return 0;
  Rat *r = &rats[id];
  // A path-filtered face carries the accessible street cell beside it.
  if (lua_istable(L, 2))
    lua_getfield(L, 2, "cell");
  int goal = lua_tointegerx(L, -1, NULL);
  if (!lua_isinteger(L, -1))
    return 0;
  if (goal < 0 || goal >= CELLS)
    return 0;
  int from = cell(r->x, r->z);
  int16_t parent[CELLS];
  flood(from, goal, parent);
  r->left = 0;
  if (parent[goal] < 0) {
    r->rest = 3;
    return 0;
  }
  for (int p = goal; p != from; p = parent[p])
    r->path[r->left++] = p;
  r->target = goal;
  return 0;
}

enum { FLOCK = 5 };
static int prey[FLOCK];
static uint64_t solids[CELLS];
static char states[FLOCK][20];

static float number(lua_State *L, int table, const char *key) {
  lua_getfield(L, table, key);
  float n = lua_tonumber(L, -1);
  lua_pop(L, 1);
  return n;
}
typedef struct {
  float x, y, z;
} Vec;
static Vec vector(lua_State *L, int i) {
  i = lua_absindex(L, i);
  return (Vec){number(L, i, "x"), number(L, i, "y"), number(L, i, "z")};
}
static void field(lua_State *L, const char *key, float n) {
  lua_pushnumber(L, n);
  lua_setfield(L, -2, key);
}
static void push_vec(lua_State *L, Vec p) {
  lua_createtable(L, 0, 3);
  field(L, "x", p.x);
  field(L, "y", p.y);
  field(L, "z", p.z);
}

static int move_to(lua_State *L) {
  lua_getfield(L, 1, "position");
  Vec p = vector(L, -1), goal = vector(L, 2);
  float dx = goal.x - p.x, dy = goal.y - p.y, dz = goal.z - p.z;
  float horizontal = hypotf(dx, dz), dist = hypotf(horizontal, dy);
  float t = dist > 0 ? fminf(1, luaL_checknumber(L, 3) / dist) : 1;
  field(L, "x", p.x + dx * t);
  field(L, "y", p.y + dy * t);
  field(L, "z", p.z + dz * t);
  lua_pop(L, 1);
  if (dist > 0) {
    if (horizontal > 0.001) {
      lua_pushnumber(L, atan2f(dx, dz));
      lua_setfield(L, 1, "yaw");
    }
    lua_pushnumber(L, -0.6f * atan2f(dy, horizontal));
    lua_setfield(L, 1, "pitch");
  }
  lua_pushboolean(L, t == 1);
  return 1;
}

// A candidate is the centre of an exposed voxel face. Sample without
// replacement.
static int nav_candidates(lua_State *L) {
  Vec origin = vector(L, 1);
  const char *face = luaL_checkstring(L, 2);
  float r = luaL_checknumber(L, 3);
  int path = lua_toboolean(L, 4);
  lua_newtable(L);
  if (!(r >= 0) || strlen(face) != 2 || (face[0] != '+' && face[0] != '-'))
    return 1;
  int sign = face[0] == '+' ? 1 : -1, dx = 0, dy = 0, dz = 0;
  switch (face[1]) {
  case 'x':
    dx = sign;
    break;
  case 'y':
    dy = sign;
    break;
  case 'z':
    dz = sign;
    break;
  default:
    return 1;
  }
  int16_t parent[CELLS];
  if (path) {
    int x = floorf(origin.x * 2), z = floorf(origin.z * 2);
    if (x < 0 || x >= WIDTH || z < 0 || z >= WIDTH)
      return 1;
    int start = z * WIDTH + x;
    if (height[start] < 0 ||
        fabsf(origin.y - (height[start] + 1) * 0.5f) > 0.5f)
      return 1;
    flood(start, -1, parent);
  }
  int seen = 0;
  for (int z = 0; z < WIDTH; z++)
    for (int x = 0; x < WIDTH; x++) {
      int nx = x + dx, nz = z + dz;
      if (nx < 0 || nx >= WIDTH || nz < 0 || nz >= WIDTH)
        continue;
      int at = z * WIDTH + x, next = nz * WIDTH + nx;
      uint64_t bits = solids[at], adj = dy > 0   ? bits >> 1
                                        : dy < 0 ? (bits << 1) | 1
                                                 : solids[next];
      uint64_t faces = bits & ~adj;
      while (faces) {
        int y = __builtin_ctzll(faces);
        faces &= faces - 1;
        Vec p = {(x + 0.5f + dx * 0.5f) * 0.5f, (y + 0.5f + dy * 0.5f) * 0.5f,
                 (z + 0.5f + dz * 0.5f) * 0.5f};
        float ax = p.x - origin.x, ay = p.y - origin.y, az = p.z - origin.z;
        if (ax * ax + ay * ay + az * az > r * r)
          continue;
        if (path && (parent[next] < 0 ||
                     fabsf(p.y - (height[next] + 1) * 0.5f) > 0.25f))
          continue;
        ++seen;
        int slot = seen <= 8 ? seen : 1 + rand() % seen;
        if (slot > 8)
          continue;
        push_vec(L, p);
        if (path) {
          lua_pushinteger(L, next);
          lua_setfield(L, -2, "cell");
        }
        lua_pushboolean(L, dy > 0 && (bits >> y) == 1);
        lua_setfield(L, -2, "sky");
        lua_rawseti(L, -2, slot);
      }
    }
  return 1;
}

void reset(void) {
  count = 0;
  for (int i = 0; i < FLOCK; i++) {
    prey[i] = -1;
    lua_getglobal(lua, "wake_eagle");
    lua_pushinteger(lua, i);
    if (lua_pcall(lua, 1, 0, 0) != LUA_OK) {
      fprintf(stderr, "wake_eagle: %s\n", lua_tostring(lua, -1));
      lua_pop(lua, 1);
    }
  }
}

void burrow(int i, float delay) {
  if (i < 0 || i >= count)
    return;
  Rat *r = &rats[i];
  r->hidden = delay;
  r->x = r->home % WIDTH + 0.5f;
  r->z = r->home / WIDTH + 0.5f;
  r->left = r->carrying = 0;
  r->rest = 0;
  r->target = -1;
}

static int bird_id(lua_State *L) {
  int id = number(L, 1, "id");
  luaL_argcheck(L, id >= 0 && id < FLOCK, 1, "unknown eagle");
  return id;
}
static int claim_rat(lua_State *L) {
  int id = bird_id(L), wanted = luaL_optinteger(L, 2, -1);
  if (prey[id] < 0) {
    lua_getfield(L, 1, "position");
    Vec p = vector(L, -1);
    lua_pop(L, 1);
    float best = INFINITY;
    for (int i = 0; i < count; i++) {
      Rat *r = &rats[i];
      if (r->hidden > 0 || (wanted != -1 && wanted != i))
        continue;
      int taken = 0;
      for (int k = 0; k < FLOCK; k++)
        if (prey[k] == i)
          taken = 1;
      float d = hypotf(r->x * .5f - p.x, r->z * .5f - p.z);
      if (!taken && d < best) {
        best = d;
        prey[id] = i;
      }
    }
  }
  if (prey[id] < 0)
    return 0;
  lua_pushinteger(L, prey[id]);
  return 1;
}
static int release_rat(lua_State *L) {
  prey[bird_id(L)] = -1;
  return 0;
}
static int rat_position(lua_State *L) {
  int i = luaL_checkinteger(L, 1);
  if (i < 0 || i >= count || rats[i].hidden > 0)
    return 0;
  Rat *r = &rats[i];
  push_vec(L, (Vec){r->x * .5f, (height[cell(r->x, r->z)] + 1.65f) * .5f,
                    r->z * .5f});
  return 1;
}
static int eat_rat(lua_State *L) {
  int id = bird_id(L);
  burrow(prey[id], luaL_checknumber(L, 2));
  prey[id] = -1;
  return 0;
}
int boot(const char *street, const char *script, const uint8_t *block,
         int len) {
  if (len != sizeof(solids))
    return 0;
  memcpy(solids, block, len);
  int i = 0;
  for (; *street; street++) {
    if (*street == '\n' || *street == '\r')
      continue;
    if (i >= CELLS)
      return 0;
    height[i++] =
        *street == '.' ? -1 : (int)strtol((char[]){*street, 0}, NULL, 16);
  }
  if (i != CELLS)
    return 0;
  lua = luaL_newstate();
  if (!lua)
    return 0;
  luaL_requiref(lua, LUA_MATHLIBNAME, luaopen_math, 1);
  lua_pop(lua, 1);
  // Inherit via Lua's ordinary metatables. Only expose that base-library
  // function.
  lua_pushglobaltable(lua);
  lua_newtable(lua);
  lua_rawseti(lua, LUA_REGISTRYINDEX, LUA_RIDX_GLOBALS);
  luaopen_base(lua);
  lua_getfield(lua, -1, "setmetatable");
  lua_setfield(lua, -3, "setmetatable");
  lua_pop(lua, 1);
  lua_rawseti(lua, LUA_REGISTRYINDEX, LUA_RIDX_GLOBALS);
  lua_register(lua, "nav_candidates", nav_candidates);
  lua_register(lua, "move_to", move_to);
  lua_register(lua, "claim_rat", claim_rat);
  lua_register(lua, "release_rat", release_rat);
  lua_register(lua, "rat_position", rat_position);
  lua_register(lua, "eat_rat", eat_rat);
  lua_register(lua, "walk_to", walk_to);
  return luaL_dostring(lua, script) == LUA_OK;
}

const char *bird_state(int i) { return i >= 0 && i < FLOCK ? states[i] : ""; }
float *flock(float dt, int size) {
  static float out[FLOCK * 11];
  for (int i = 0; i < size && i < FLOCK; i++) {
    lua_getglobal(lua, "tick_eagle");
    lua_pushinteger(lua, i);
    lua_pushnumber(lua, dt);
    if (lua_pcall(lua, 2, 3, 0) != LUA_OK) {
      fprintf(stderr, "tick_eagle: %s\n", lua_tostring(lua, -1));
      lua_pop(lua, 1);
      return NULL;
    }
    int bird = lua_absindex(lua, -3);
    lua_getfield(lua, bird, "position");
    Vec p = vector(lua, -1);
    lua_pop(lua, 1);
    Vec offset = vector(lua, -2), rot = vector(lua, -1);
    float pose[] = {p.x,
                    p.y,
                    p.z,
                    number(lua, bird, "pitch"),
                    number(lua, bird, "yaw"),
                    offset.x,
                    offset.y,
                    offset.z,
                    rot.x,
                    rot.y,
                    rot.z};
    memcpy(out + 11 * i, pose, sizeof(pose));
    lua_getfield(lua, bird, "state");
    snprintf(states[i], sizeof(states[i]), "%s", lua_tostring(lua, -1));
    lua_pop(lua, 4);
  }
  return out;
}

int add(float x, float z, int home, int food, int carrying) {
  if (count >= LIMIT || !(x >= 0 && x < WIDTH && z >= 0 && z < WIDTH) ||
      home < 0 || home >= CELLS || food < 0 || food >= CELLS ||
      height[cell(x, z)] < 0 || height[home] < 0 || height[food] < 0)
    return -1;
  rats[count] = (Rat){.x = x,
                      .z = z,
                      .home = home,
                      .food = food,
                      .carrying = carrying,
                      .target = -1};
  return count++;
}

// Flat buffer shared with Node. Positions are half-metre cell coordinates.
static float poses[LIMIT * 4];
float *tick(float dt) {
  int searches = 4;
  for (int i = 0; i < count; i++) {
    Rat *r = &rats[i];
    if (r->hidden > 0)
      r->hidden = fmaxf(0, r->hidden - dt);
    else if (r->rest > 0)
      r->rest -= dt;
    else if (r->left) {
      int p = r->path[r->left - 1];
      float dx = p % WIDTH + 0.5f - r->x, dz = p / WIDTH + 0.5f - r->z;
      float length = sqrtf(dx * dx + dz * dz);
      float step = fminf(length, dt * (3.8f + (i % 4) * 0.4f));
      if (length > 0) {
        r->x += dx * step / length;
        r->z += dz * step / length;
      }
      if (step == length)
        r->left--;
    } else if (r->target >= 0) {
      lua_getglobal(lua, "arrived");
      lua_pushinteger(lua, i);
      lua_pushboolean(lua, r->carrying);
      if (lua_pcall(lua, 2, 2, 0) == LUA_OK) {
        r->carrying = lua_toboolean(lua, -2);
        r->rest = lua_tonumber(lua, -1);
        lua_pop(lua, 2);
      } else {
        lua_pop(lua, 1);
        r->rest = 3;
      }
      r->target = -1;
    } else if (searches > 0) {
      searches--;
      lua_getglobal(lua, "depart");
      lua_pushinteger(lua, i);
      lua_pushboolean(lua, r->carrying);
      lua_pushinteger(lua, r->home);
      lua_pushinteger(lua, r->food);
      if (lua_pcall(lua, 4, 0, 0) != LUA_OK) {
        lua_pop(lua, 1);
        r->rest = 3;
      }
    }
    poses[4 * i] = r->x;
    poses[4 * i + 1] = height[cell(r->x, r->z)];
    poses[4 * i + 2] = r->z;
    poses[4 * i + 3] = r->hidden > 0 ? -r->hidden : r->carrying;
  }
  return poses;
}
