#include "lauxlib.h"
#include "lua.h"
#include "lualib.h"
#include <math.h>
#include <stdint.h>
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
static int walkTo(lua_State *L) {
  int id = luaL_checkinteger(L, 1);
  if (id < 0 || id >= count)
    return 0;
  Rat *r = &rats[id];
  int goal = luaL_checkinteger(L, 2);
  if (goal < 0 || goal >= CELLS)
    return 0;
  int from = cell(r->x, r->z);
  int16_t parent[CELLS], queue[CELLS];
  memset(parent, -1, sizeof(parent));
  parent[from] = from;
  queue[0] = from;
  int tail = 1;
  for (int head = 0; head < tail && parent[goal] < 0; head++) {
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
typedef struct {
  float x, y, z;
  int prey;
} Eagle;
static Eagle birds[FLOCK];
static float clockTime;

void reset(void) {
  count = 0;
  clockTime = 0;
  for (int i = 0; i < FLOCK; i++) {
    birds[i] = (Eagle){.prey = -1};
    lua_getglobal(lua, "wakeEagle");
    lua_pushinteger(lua, i);
    if (lua_pcall(lua, 1, 0, 0) != LUA_OK)
      lua_pop(lua, 1);
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

static int moveBird(Eagle *b, float x, float y, float z, float step) {
  float dx = x - b->x, dy = y - b->y, dz = z - b->z;
  float dist = sqrtf(dx * dx + dy * dy + dz * dz);
  float t = dist > 0 ? fminf(1, step / dist) : 1;
  b->x += dx * t;
  b->y += dy * t;
  b->z += dz * t;
  return t == 1;
}

static Eagle *bird(lua_State *L) {
  lua_Integer id = luaL_checkinteger(L, 1);
  luaL_argcheck(L, id >= 0 && id < FLOCK, 1, "unknown eagle");
  return &birds[id];
}

static int flyTo(lua_State *L) {
  moveBird(bird(L), luaL_checknumber(L, 2), luaL_checknumber(L, 3),
           luaL_checknumber(L, 4), luaL_checknumber(L, 5));
  return 0;
}

// Keep an existing claim, otherwise take the nearest visible, unclaimed rat.
static int claimRat(lua_State *L) {
  Eagle *b = bird(L);
  if (b->prey < 0) {
    float best = INFINITY;
    for (int i = 0; i < count; i++) {
      Rat *r = &rats[i];
      if (r->hidden > 0)
        continue;
      int taken = 0;
      for (int k = 0; k < FLOCK; k++)
        if (birds[k].prey == i)
          taken = 1;
      float d = hypotf(r->x - b->x, r->z - b->z);
      if (!taken && d < best) {
        best = d;
        b->prey = i;
      }
    }
  }
  lua_pushboolean(L, b->prey >= 0);
  return 1;
}

static int dive(lua_State *L) {
  Eagle *b = bird(L);
  if (b->prey < 0)
    return 0;
  Rat *r = &rats[b->prey];
  lua_pushboolean(L, moveBird(b, r->x, height[cell(r->x, r->z)] + 1.65f, r->z,
                              luaL_checknumber(L, 2)));
  return 1;
}

static int eatRat(lua_State *L) {
  Eagle *b = bird(L);
  burrow(b->prey, luaL_checknumber(L, 2));
  b->prey = -1;
  return 0;
}

int boot(const char *street, const char *script) {
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
  lua_register(lua, "flyTo", flyTo);
  lua_register(lua, "claimRat", claimRat);
  lua_register(lua, "dive", dive);
  lua_register(lua, "eatRat", eatRat);
  lua_register(lua, "walkTo", walkTo);
  return luaL_dostring(lua, script) == LUA_OK;
}

float *flock(float dt, int size) {
  static float out[FLOCK * 3];
  clockTime += dt;
  for (int i = 0; i < size && i < FLOCK; i++) {
    lua_getglobal(lua, "flyEagle");
    lua_pushinteger(lua, i);
    lua_pushnumber(lua, clockTime);
    lua_pushnumber(lua, dt);
    if (lua_pcall(lua, 3, 0, 0) != LUA_OK)
      lua_pop(lua, 1);
    out[i * 3] = birds[i].x;
    out[i * 3 + 1] = birds[i].y;
    out[i * 3 + 2] = birds[i].z;
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
