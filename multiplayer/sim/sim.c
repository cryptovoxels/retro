#include "lauxlib.h"
#include "lualib.h"
#include <math.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>

// A VM owns one 32m region. Y spans the parcel bounds loaded at wake.
enum { WIDTH = 64 };
static int ox, oy, oz, layers;
static uint8_t *solid;
static lua_State *vm;
static float pose[7];

int region(int x, int y, int z, int height) {
  if (height < 1 || height > 4096) return 0;
  free(solid);
  solid = calloc((size_t)WIDTH * WIDTH, height);
  ox = x; oy = y; oz = z; layers = height;
  return solid != NULL;
}

// Coordinates are half-metre cells. Ground is YZX bytes (255 = air),
// parcels are X Y Z little-endian uint16 (0 = air).
void stamp(const uint8_t *bytes, int x, int y, int z, int w, int h, int d,
           int ground, int scale) {
  for (int iz = fmax(0, oz - z); iz < fmin(d * scale, oz + WIDTH - z); iz++)
    for (int ix = fmax(0, ox - x); ix < fmin(w * scale, ox + WIDTH - x); ix++) {
      int col = ((z + iz - oz) * WIDTH + x + ix - ox) * layers;
      for (int iy = fmax(0, oy - y); iy < fmin(h * scale, oy + layers - y); iy++) {
        int a = ix / scale, b = iy / scale, c = iz / scale;
        if (ground ? bytes[(b * d + c) * w + a] != 255
                   : ((const uint16_t *)bytes)[(a * h + b) * d + c] != 0)
          solid[col + y + iy - oy] = 1;
      }
    }
}

// Polygon-only islands have a flat surface at 0.74m. Scan-convert each ring
// at the same half-metre resolution as voxel ground, including lake holes.
void shoreline(const float *ring, int count, int land) {
  if (count < 3) return;
  for (int z = 0; z < WIDTH; z++) {
    double wz = (oz + z + .5) * .5;
    uint8_t toggle[WIDTH + 1] = {0};
    for (int a = 0, b = count - 1; a < count; b = a++) {
      double ax = ring[2*a], az = ring[2*a+1];
      double bx = ring[2*b], bz = ring[2*b+1];
      if ((az > wz) == (bz > wz)) continue;
      double edge = ax + (wz-az) * (bx-ax) / (bz-az);
      int x = fmax(0, fmin(WIDTH, ceil(edge*2 - ox - .5)));
      toggle[x] ^= 1;
    }
    int inside = 0;
    for (int x = 0; x < WIDTH; x++) {
      inside ^= toggle[x];
      if (inside) solid[(z*WIDTH+x)*layers+1-oy] = land;
    }
  }
}

void surfaces(void) {
  for (int col = 0; col < WIDTH*WIDTH; col++) {
    uint8_t *p = solid + col*layers;
    for (int y = 0; y < layers-1; y++) p[y] = p[y] && !p[y+1];
  }
}

// Nearest exposed floor within reach, including floors underneath bridges.
static int floor_at(lua_State *L) {
  int x = floor(luaL_checknumber(L, 1) * 2) - ox;
  double y = luaL_checknumber(L, 2);
  int z = floor(luaL_checknumber(L, 3) * 2) - oz;
  double reach = luaL_checknumber(L, 4);
  if (!solid || x < 0 || x >= WIDTH || z < 0 || z >= WIDTH || reach < 0) return 0;
  uint8_t *col = solid + (z * WIDTH + x) * layers;
  // Cell centres straddle integer metres. Mesh top is 0.26m below the cell boundary.
  int lo = fmax(0, ceil((y - reach + .26) * 2 - oy - 1 - .00001));
  int hi = fmin(layers - 1, floor((y + reach + .26) * 2 - oy - 1 + .00001));
  int best = -1;
  double distance = INFINITY;
  for (int i = lo; i <= hi; i++) {
    double dy = fabs((oy + i + 1) * .5 - .26 - y);
    if (col[i] && dy < distance) {
      best = i; distance = dy;
    }
  }
  if (best < 0) return 0;
  lua_pushnumber(L, (oy + best + 1) * .5 - .26);
  return 1;
}

int boot(const char *source) {
  if (vm) lua_close(vm);
  vm = luaL_newstate();
  if (!vm) return 0;
  luaL_requiref(vm, "_G", luaopen_base, 1);
  lua_pop(vm, 1);
  const char *blocked[] = {"load", "loadfile", "dofile", "collectgarbage", NULL};
  for (int i = 0; blocked[i]; i++) { lua_pushnil(vm); lua_setglobal(vm, blocked[i]); }
  luaL_requiref(vm, "math", luaopen_math, 1);
  lua_pop(vm, 1);
  lua_register(vm, "floor_at", floor_at);
  if (luaL_dostring(vm, source) == LUA_OK) return 1;
  fprintf(stderr, "critter script: %s\n", lua_tostring(vm, -1));
  lua_pop(vm, 1);
  return 0;
}

static int call(int args, int results) {
  if (lua_pcall(vm, args, results, 0) == LUA_OK) return 1;
  fprintf(stderr, "critter: %s\n", lua_tostring(vm, -1));
  lua_pop(vm, 1);
  return 0;
}

int spawn(const char *kind, int id, float x, float y, float z) {
  lua_getglobal(vm, "spawn");
  lua_pushstring(vm, kind); lua_pushinteger(vm, id);
  lua_pushnumber(vm, x); lua_pushnumber(vm, y); lua_pushnumber(vm, z);
  if (!call(5, 1)) return 0;
  int ok = lua_toboolean(vm, -1);
  lua_pop(vm, 1);
  return ok;
}

float *tick(int id, float dt) {
  lua_getglobal(vm, "tick");
  lua_pushinteger(vm, id); lua_pushnumber(vm, dt);
  if (!call(2, 7)) return NULL;
  for (int i = 0; i < 7; i++) pose[i] = lua_tonumber(vm, i - 7);
  lua_pop(vm, 7);
  return pose;
}
