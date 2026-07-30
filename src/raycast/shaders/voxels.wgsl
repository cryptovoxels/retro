struct MacroCell {
    chunk_indices: array<u32, 16>,
};

struct ArtInstance {
    world_from_local: mat4x4<f32>,
    local_from_world: mat4x4<f32>,
    dims: vec3<u32>,
    word_base: u32,
    tex_layer: u32,
    flags: u32,
    tex_uv_scale: vec2<f32>,
    fidelity: f32,
    _pad2: f32,
    tex_dims: vec2<f32>,
    art_id: u32,
    _pad_art: vec3<u32>,
};

struct MicroHit {
    color: vec3<f32>,
    t_world: f32,
    normal: vec3<f32>,
    ok: u32,
    lum: f32,
};

struct Uniforms {
    viewInv: mat4x4<f32>,
    resolution: vec2<f32>,
    time: f32,
    _pad0: f32,
    grid_anchor: vec4<i32>,
    terrain_params: vec4<u32>,
};

struct GpuLine {
    a: vec2<f32>,
    b: vec2<f32>,
    color: vec4<f32>,
    thickness: f32,
    _pad_line: f32,
    _pad_line2: vec2<f32>,
}

struct UiUniforms {
    line_count: u32,
    _u0: u32,
    _u1: u32,
    _u2: u32,
}

struct PickGpu {
    kind: u32,
    chunk_idx: u32,
    art_id: u32,
    art_inst_idx: u32,
    terrain_cell: vec4<i32>,
    art_cell: vec4<i32>,
    world_pos: vec4<f32>,
    normal: vec4<f32>,
}

struct SceneDetail {
    micro: MicroHit,
    kind: u32,
    chunk_idx: u32,
    terrain_cell: vec4<i32>,
    art_cell: vec4<i32>,
    art_id: u32,
    art_inst_idx: u32,
    hit_world: vec4<f32>,
}

struct TerrainChunkHit {
    micro: MicroHit,
    chunk_idx: u32,
    cell: vec4<i32>,
}

struct ArtTraceHit {
    micro: MicroHit,
    cell: vec4<i32>,
    art_id: u32,
    inst_idx: u32,
}

const MACRO_RES: i32 = 32;
const MACRO_CELL: f32 = 8.0;
const VOX_RES_I: i32 = 64;
const DIR_AXIS: u32 = 8u;
const DIR_LEN: u32 = 512u;
const BRICK: u32 = 8u;
const BRICK_WORDS: u32 = 128u;
// LOD cascade ~100m
const MAX_RAY_DIST: f32 = 102.4;
const FOG_START: f32 = 70.0;
const FOG_END: f32 = 102.4;
const MACRO_MAX_STEPS: i32 = 768;
const EPSILON: f32 = 0.0001;

/// Face UV band near edges (creases) vs corners/interior. In 0..1 face space.
const FACE_EDGE_FRAC: f32 = 0.2;
const LUM_CREASE_EDGE: f32 = 0.5;
const LUM_FACE_BRIGHT: f32 = 1.0;

@group(0) @binding(0) var<uniform> ubo: Uniforms;
@group(0) @binding(1) var<storage, read> chunk_pos_half: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read> macro_grid_terrain: array<MacroCell>;
@group(0) @binding(3) var<storage, read> directories: array<u32>;
@group(0) @binding(4) var<storage, read> palette: array<vec4<f32>>;
@group(0) @binding(5) var output_tex: texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(6) var<storage, read> art_voxel_words: array<u32>;
@group(0) @binding(7) var<storage, read> art_instances: array<ArtInstance>;
@group(0) @binding(8) var art_sampler: sampler;
@group(0) @binding(9) var art_tex: texture_2d_array<f32>;
@group(0) @binding(10) var<storage, read> ui_lines: array<GpuLine>;
@group(0) @binding(11) var<storage, read_write> pick_gpu: PickGpu;
@group(0) @binding(12) var<uniform> ui: UiUniforms;
@group(0) @binding(13) var<storage, read> brick_pool: array<u32>;

fn sky_color(ray_dir: vec3<f32>) -> vec3<f32> {
    let horizon_haze = vec3<f32>(0.70, 0.78, 0.86);
    let mid_teal = vec3<f32>(0.20, 0.44, 0.57);
    let zenith_navy = vec3<f32>(0.04, 0.14, 0.36);
    let up = clamp(ray_dir.y, 0.0, 1.0);
    var sky = mix(horizon_haze, mid_teal, smoothstep(0.0, 0.16, up));
    sky = mix(sky, zenith_navy, smoothstep(0.12, 0.72, up));
    return sky;
}

/// Edit this vector to change where the sun sits (normalized inside `sun_dir`).
fn sun_dir() -> vec3<f32> {
    return normalize(vec3<f32>(0.3, 0.8, 0.4));
}

/// Directional light + ambient floor for voxel hits.
fn shade_diffuse(normal: vec3<f32>) -> f32 {
    let ambient: f32 = 0.2;
    return max(dot(normal, sun_dir()), ambient);
}

fn no_hit() -> MicroHit {
    return MicroHit(vec3<f32>(0.0), 1e30, vec3<f32>(0.0, 1.0, 0.0), 0u, 1.0);
}

fn empty_scene_detail() -> SceneDetail {
    return SceneDetail(
        no_hit(),
        0u,
        0u,
        vec4<i32>(0),
        vec4<i32>(0),
        0u,
        0u,
        vec4<f32>(0.0),
    );
}

fn merge_scene_detail(a: SceneDetail, b: SceneDetail) -> SceneDetail {
    if (a.micro.ok == 0u) { return b; }
    if (b.micro.ok == 0u) { return a; }
    if (a.micro.t_world <= b.micro.t_world) { return a; }
    return b;
}

fn write_pick_from_detail(d: SceneDetail) {
    if (d.micro.ok == 0u) {
        pick_gpu.kind = 0u;
        return;
    }
    if (d.kind == 1u) {
        pick_gpu.kind = 1u;
        pick_gpu.chunk_idx = d.chunk_idx;
        pick_gpu.art_id = 0u;
        pick_gpu.art_inst_idx = 0xffffffffu;
        pick_gpu.terrain_cell = d.terrain_cell;
        pick_gpu.art_cell = vec4<i32>(0);
        pick_gpu.world_pos = d.hit_world;
        pick_gpu.normal = vec4<f32>(d.micro.normal, 0.0);
    } else if (d.kind == 2u) {
        pick_gpu.kind = 2u;
        pick_gpu.chunk_idx = 0xffffffffu;
        pick_gpu.art_id = d.art_id;
        pick_gpu.art_inst_idx = d.art_inst_idx;
        pick_gpu.terrain_cell = vec4<i32>(0);
        pick_gpu.art_cell = d.art_cell;
        pick_gpu.world_pos = d.hit_world;
        pick_gpu.normal = vec4<f32>(d.micro.normal, 0.0);
    }
}

fn sd_segment(p: vec2<f32>, a: vec2<f32>, b: vec2<f32>) -> f32 {
    let pa = p - a;
    let ba = b - a;
    let h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-8), 0.0, 1.0);
    return length(pa - ba * h);
}

fn blend_ui_lines(pixel_xy: vec2<f32>, base: vec4<f32>) -> vec4<f32> {
    let n = ui.line_count;
    if (n == 0u) { return base; }
    var out_c = base;
    for (var i = 0u; i < n; i++) {
        let ln = ui_lines[i];
        let d = sd_segment(pixel_xy, ln.a, ln.b);
        let thick = max(ln.thickness, 1.0);
        let alpha = 1.0 - smoothstep(thick - 1.0, thick + 0.5, d);
        let glow = exp(-d * 0.18) * 0.22;
        let line_rgb = ln.color.rgb + vec3<f32>(glow);
        let a = clamp(ln.color.a * alpha + glow, 0.0, 1.0);
        out_c = vec4<f32>(mix(out_c.rgb, line_rgb, a), out_c.a);
    }
    return out_c;
}

fn art_voxel_byte_at(inst: ArtInstance, c: vec3<i32>) -> u32 {
    let dims_i = vec3<i32>(inst.dims);
    if (any(c < vec3<i32>(0)) || any(c >= dims_i)) {
        return 0xffu;
    }
    let linear = u32(c.x) + u32(c.y) * inst.dims.x + u32(c.z) * inst.dims.x * inst.dims.y;
    let word = art_voxel_words[inst.word_base + (linear >> 2u)];
    return (word >> ((linear & 3u) * 8u)) & 0xffu;
}

fn trace_art_instance_detail(
    inst_idx: u32,
    ray_origin: vec3<f32>,
    ray_dir: vec3<f32>,
    t_min: f32,
    t_max: f32,
) -> ArtTraceHit {
    if (t_max <= t_min) {
        return ArtTraceHit(no_hit(), vec4<i32>(0), 0u, inst_idx);
    }
    let inst = art_instances[inst_idx];
    if (any(inst.dims == vec3<u32>(0u))) {
        return ArtTraceHit(no_hit(), vec4<i32>(0), 0u, inst_idx);
    }
    let ray_origin_l = (inst.local_from_world * vec4<f32>(ray_origin, 1.0)).xyz;
    let ray_dir_l = (inst.local_from_world * vec4<f32>(ray_dir, 0.0)).xyz;
    let inv_rd_l = 1.0 / (ray_dir_l + vec3<f32>(1e-9));
    let bmin = vec3<f32>(0.0);
    let bmax = vec3<f32>(inst.dims);
    let t1 = (bmin - ray_origin_l) * inv_rd_l;
    let t2 = (bmax - ray_origin_l) * inv_rd_l;
    let seg = vec2<f32>(
        max(max(min(t1.x, t2.x), min(t1.y, t2.y)), min(t1.z, t2.z)),
        min(min(max(t1.x, t2.x), max(t1.y, t2.y)), max(t1.z, t2.z)),
    );
    let te = max(seg.x, t_min) - EPSILON;
    let tx = min(seg.y, t_max) + EPSILON;
    if (tx <= te) {
        return ArtTraceHit(no_hit(), vec4<i32>(0), 0u, inst_idx);
    }

    let start_p = ray_origin_l + ray_dir_l * (te + EPSILON);
    let dims_i = vec3<i32>(inst.dims);
    var cell = clamp(vec3<i32>(floor(start_p)), vec3<i32>(0), dims_i - vec3<i32>(1));
    let step_l = vec3<i32>(sign(ray_dir_l));
    let delta = abs(1.0 / (ray_dir_l + vec3<f32>(1e-9)));
    var side = (sign(ray_dir_l) * (vec3<f32>(cell) - ray_origin_l) + sign(ray_dir_l) * 0.5 + 0.5) * delta;
    var mask = vec3<f32>(0.0);

    for (var s = 0; s < 128; s++) {
        let voxel = art_voxel_byte_at(inst, cell);
        if (voxel != 0xffu) {
            let l_lo = vec3<f32>(cell);
            let l_hi = l_lo + vec3<f32>(1.0);
            let vt1 = (l_lo - ray_origin_l) * inv_rd_l;
            let vt2 = (l_hi - ray_origin_l) * inv_rd_l;
            let t_near = max(max(min(vt1.x, vt2.x), min(vt1.y, vt2.y)), min(vt1.z, vt2.z));
            let t_far = min(min(max(vt1.x, vt2.x), max(vt1.y, vt2.y)), max(vt1.z, vt2.z));
            if (t_far < te - EPSILON || t_near > tx + EPSILON) { break; }
            let t_world = clamp(max(t_near, te), te, tx);
            let nx = min(vt1.x, vt2.x);
            let ny = min(vt1.y, vt2.y);
            let nz = min(vt1.z, vt2.z);
            let teps = max(1e-5 * abs(t_near), 1e-6);
            var on_local = vec3<f32>(0.0, 1.0, 0.0);
            if (abs(nx - t_near) < teps) {
                on_local = vec3<f32>(select(1.0, -1.0, vt1.x < vt2.x), 0.0, 0.0);
            } else if (abs(ny - t_near) < teps) {
                on_local = vec3<f32>(0.0, select(1.0, -1.0, vt1.y < vt2.y), 0.0);
            } else if (abs(nz - t_near) < teps) {
                on_local = vec3<f32>(0.0, 0.0, select(1.0, -1.0, vt1.z < vt2.z));
            }
            let on_world = normalize((inst.world_from_local * vec4<f32>(on_local, 0.0)).xyz);
            var alb = palette[voxel & 63u].xyz;
            if ((inst.flags & 1u) != 0u && inst.fidelity > 0.0) {
                let f = clamp(inst.fidelity, 0.0, 1.0);
                // 0.0 -> 0.1: fade palette -> texture.
                let fade_t = clamp(f / 0.1, 0.0, 1.0);
                // 0.1 -> 1.0: increase texture sampling granularity (voxel grid -> full texture grid).
                let gran_t = clamp((f - 0.1) / 0.9, 0.0, 1.0);
                let dims_xy = max(vec2<f32>(f32(inst.dims.x), f32(inst.dims.y)), vec2<f32>(1.0, 1.0));
                let hit_l = ray_origin_l + ray_dir_l * t_world;
                let uv_l = clamp(hit_l.xy / dims_xy, vec2<f32>(0.0), vec2<f32>(1.0));
                let tex_dims_xy = max(inst.tex_dims, vec2<f32>(1.0, 1.0));
                // Granularity: ramp sample grid from voxel dims -> full source texture dims.
                // IMPORTANT: at gran_t=1 (fidelity=1), sample_res MUST equal tex_dims_xy.
                // Old min(dims*16, tex) left coarse grids when dims*16 < tex (e.g. 16² art vs 512² tex).
                let sample_res = max(
                    mix(dims_xy, tex_dims_xy, gran_t),
                    vec2<f32>(1.0, 1.0),
                );
                let uv_quant = (floor(uv_l * sample_res) + vec2<f32>(0.5, 0.5)) / sample_res;
                let uv_tex = vec2<f32>(
                    uv_quant.x * inst.tex_uv_scale.x,
                    (1.0 - uv_quant.y) * inst.tex_uv_scale.y,
                );
                let tex_rgb = textureSampleLevel(art_tex, art_sampler, uv_tex, i32(inst.tex_layer), 0.0).rgb;
                alb = mix(alb, tex_rgb, fade_t);
            }
            return ArtTraceHit(
                MicroHit(alb, t_world, on_world, 1u, 1.0),
                vec4<i32>(cell.x, cell.y, cell.z, 0),
                inst.art_id,
                inst_idx,
            );
        }

        mask = step(side.xyz, side.yzx) * step(side.xyz, side.zxy);
        side += mask * delta;
        cell += vec3<i32>(mask) * step_l;
        if (any(cell < vec3<i32>(0)) || any(cell >= dims_i)) { break; }
    }
    return ArtTraceHit(no_hit(), vec4<i32>(0), inst.art_id, inst_idx);
}

fn trace_arts_segment_scene_detail(
    ray_origin: vec3<f32>,
    ray_dir: vec3<f32>,
    t_min: f32,
    t_max: f32,
    current_best_t: f32,
) -> SceneDetail {
    var best = empty_scene_detail();
    var limit_t = min(t_max, current_best_t);
    if (limit_t <= t_min) { return best; }
    for (var i = 0u; i < ubo.terrain_params.w; i++) {
        let ah = trace_art_instance_detail(i, ray_origin, ray_dir, t_min, limit_t);
        if (ah.micro.ok != 0u && ah.micro.t_world < limit_t) {
            var sd: SceneDetail;
            sd.micro = ah.micro;
            sd.kind = 2u;
            sd.chunk_idx = 0u;
            sd.terrain_cell = vec4<i32>(0);
            sd.art_cell = ah.cell;
            sd.art_id = ah.art_id;
            sd.art_inst_idx = ah.inst_idx;
            sd.hit_world = vec4<f32>(ray_origin + ray_dir * ah.micro.t_world, 1.0);
            best = merge_scene_detail(best, sd);
            limit_t = ah.micro.t_world;
        }
    }
    return best;
}

fn trace_ray_detail(ray_origin: vec3<f32>, ray_dir: vec3<f32>) -> SceneDetail {
    let inv_ray_dir = 1.0 / (ray_dir + 1e-9);
    var tau = 0.0;
    var wm = vec3<i32>(floor(ray_origin / MACRO_CELL));
    var side_macro = (sign(ray_dir) * (vec3<f32>(wm) * MACRO_CELL - ray_origin) + sign(ray_dir) * 4.0 + 4.0) * abs(inv_ray_dir);
    let ray_step = vec3<i32>(sign(ray_dir));
    let delta_macro = MACRO_CELL * abs(inv_ray_dir);
    let anchor = ubo.grid_anchor.xyz;

    var best_d = empty_scene_detail();

    for (var m = 0; m < MACRO_MAX_STEPS; m++) {
        if (tau >= MAX_RAY_DIST) { break; }

        let t_exit_macro = min(side_macro.x, min(side_macro.y, side_macro.z));
        let t_exit_clamped = min(t_exit_macro, MAX_RAY_DIST);
        let cur_best_t = select(1e30, best_d.micro.t_world, best_d.micro.ok != 0u);
        let art_seg = trace_arts_segment_scene_detail(
            ray_origin,
            ray_dir,
            tau,
            t_exit_clamped,
            cur_best_t,
        );
        best_d = merge_scene_detail(best_d, art_seg);

        let d = wm - anchor;
        let ci = (d.x & 31) + (d.y & 31) * 32 + (d.z & 31) * 1024;
        let mcell = macro_grid_terrain[ci];

        if (mcell.chunk_indices[0] != 0xffffffffu) {
            for (var k = 0u; k < 16u; k++) {
                let chunk_idx = mcell.chunk_indices[k];
                if (chunk_idx == 0xffffffffu) { break; }

                let p4 = chunk_pos_half[chunk_idx];
                let bmin = p4.xyz - p4.w;
                let bmax = p4.xyz + p4.w;

                let t1 = (bmin - ray_origin) * inv_ray_dir;
                let t2 = (bmax - ray_origin) * inv_ray_dir;
                let seg = vec2<f32>(max(max(min(t1.x, t2.x), min(t1.y, t2.y)), min(t1.z, t2.z)),
                                    min(min(max(t1.x, t2.x), max(t1.y, t2.y)), max(t1.z, t2.z)));

                let te = max(seg.x, tau) - EPSILON;
                let tx = min(seg.y, t_exit_clamped) + EPSILON;

                if (tx > te && seg.x < t_exit_clamped && seg.y > tau && te < MAX_RAY_DIST) {
                    let th = trace_micro_chunk_detail(chunk_idx, p4.xyz, p4.w, ray_origin, ray_dir, te, tx);
                    if (th.micro.ok != 0u) {
                        var sd: SceneDetail;
                        sd.micro = th.micro;
                        sd.kind = 1u;
                        sd.chunk_idx = chunk_idx;
                        sd.terrain_cell = th.cell;
                        sd.art_cell = vec4<i32>(0);
                        sd.art_id = 0u;
                        sd.art_inst_idx = 0xffffffffu;
                        sd.hit_world = vec4<f32>(ray_origin + ray_dir * th.micro.t_world, 1.0);
                        best_d = merge_scene_detail(best_d, sd);
                    }
                }
            }
        }

        if (best_d.micro.ok != 0u && best_d.micro.t_world < t_exit_clamped) { break; }
        let mask_m = step(side_macro.xyz, side_macro.yzx) * step(side_macro.xyz, side_macro.zxy);
        side_macro += mask_m * delta_macro;
        wm += vec3<i32>(mask_m) * ray_step;
        tau = t_exit_macro;
        if (tau > MAX_RAY_DIST) { break; }
    }

    return best_d;
}

fn shade_scene_detail(d: SceneDetail, ray_dir: vec3<f32>) -> vec4<f32> {
    let sky = sky_color(ray_dir);
    if (d.micro.ok == 0u || d.micro.t_world > MAX_RAY_DIST) {
        return vec4<f32>(sky, 1.0);
    }
    let diffuse = shade_diffuse(d.micro.normal);
    let lit = d.micro.color * diffuse * d.micro.lum;
    let fog_w = clamp((d.micro.t_world - FOG_START) / (FOG_END - FOG_START), 0.0, 1.0);
    let final_color = mix(lit, sky, fog_w);
    let depth_norm = clamp(d.micro.t_world / MAX_RAY_DIST, 0.0, 1.0);
    return vec4<f32>(final_color, depth_norm);
}

/// 0..1 coordinates on the hit voxel face (axis of `on` ignored).
fn face_uv(on: vec3<f32>, hit_p: vec3<f32>, wx_lo: vec3<f32>, vox_scale: f32) -> vec2<f32> {
    var u: f32;
    var v: f32;
    if (abs(on.x) > 0.5) {
        u = (hit_p.y - wx_lo.y) / vox_scale;
        v = (hit_p.z - wx_lo.z) / vox_scale;
    } else if (abs(on.y) > 0.5) {
        u = (hit_p.x - wx_lo.x) / vox_scale;
        v = (hit_p.z - wx_lo.z) / vox_scale;
    } else {
        u = (hit_p.x - wx_lo.x) / vox_scale;
        v = (hit_p.y - wx_lo.y) / vox_scale;
    }
    return vec2<f32>(clamp(u, 0.0, 1.0), clamp(v, 0.0, 1.0));
}

fn brick_id_at(chunk_idx: u32, bx: u32, by: u32, bz: u32) -> u32 {
    return directories[chunk_idx * DIR_LEN + bx + by * DIR_AXIS + bz * DIR_AXIS * DIR_AXIS];
}

fn brick_voxel(brick_id: u32, lx: u32, ly: u32, lz: u32) -> u32 {
    let linear = lx + ly * BRICK + lz * BRICK * BRICK;
    let word = brick_pool[brick_id * BRICK_WORDS + (linear >> 2u)];
    return (word >> ((linear & 3u) * 8u)) & 0xffu;
}

fn voxel_byte_at(chunk_idx: u32, c: vec3<i32>) -> u32 {
    if (any(c < vec3<i32>(0)) || any(c >= vec3<i32>(VOX_RES_I))) {
        return 0xffu;
    }
    let bx = u32(c.x) >> 3u;
    let by = u32(c.y) >> 3u;
    let bz = u32(c.z) >> 3u;
    let brick_id = brick_id_at(chunk_idx, bx, by, bz);
    if (brick_id == 0u) { return 0xffu; }
    return brick_voxel(brick_id, u32(c.x) & 7u, u32(c.y) & 7u, u32(c.z) & 7u);
}

fn voxel_is_air(chunk_idx: u32, c: vec3<i32>) -> bool {
    return voxel_byte_at(chunk_idx, c) == 0xffu;
}

/// `face_uv` layout: ±X → (y,z), ±Y → (x,z), ±Z → (x,y). Offsets step across that edge into the neighbor cell.
fn crease_neighbor_u_lo(on: vec3<f32>) -> vec3<i32> {
    if (abs(on.x) > 0.5) {
        return vec3<i32>(0, -1, 0);
    }
    return vec3<i32>(-1, 0, 0);
}

fn crease_neighbor_u_hi(on: vec3<f32>) -> vec3<i32> {
    if (abs(on.x) > 0.5) {
        return vec3<i32>(0, 1, 0);
    }
    return vec3<i32>(1, 0, 0);
}

fn crease_neighbor_v_lo(on: vec3<f32>) -> vec3<i32> {
    if (abs(on.x) > 0.5) {
        return vec3<i32>(0, 0, -1);
    }
    if (abs(on.y) > 0.5) {
        return vec3<i32>(0, 0, -1);
    }
    return vec3<i32>(0, -1, 0);
}

fn crease_neighbor_v_hi(on: vec3<f32>) -> vec3<i32> {
    if (abs(on.x) > 0.5) {
        return vec3<i32>(0, 0, 1);
    }
    if (abs(on.y) > 0.5) {
        return vec3<i32>(0, 0, 1);
    }
    return vec3<i32>(0, 1, 0);
}

/// Darken only face edges that border air (real silhouette crease). Solid neighbor = coplanar joint = full bright.
fn world_crease_luminance(
    on: vec3<f32>,
    cell: vec3<i32>,
    uv: vec2<f32>,
    word_idx_base: u32,
) -> f32 {
    let w = FACE_EDGE_FRAC;
    let u = uv.x;
    let v = uv.y;
    if ((u < w || u > 1.0 - w) && (v < w || v > 1.0 - w)) {
        return LUM_FACE_BRIGHT;
    }

    var lum = LUM_FACE_BRIGHT;
    if (u < w && v >= w && v <= 1.0 - w && voxel_is_air(word_idx_base, cell + crease_neighbor_u_lo(on))) {
        lum = LUM_CREASE_EDGE;
    }
    if (u > 1.0 - w && v >= w && v <= 1.0 - w && voxel_is_air(word_idx_base, cell + crease_neighbor_u_hi(on))) {
        lum = LUM_CREASE_EDGE;
    }
    if (v < w && u >= w && u <= 1.0 - w && voxel_is_air(word_idx_base, cell + crease_neighbor_v_lo(on))) {
        lum = LUM_CREASE_EDGE;
    }
    if (v > 1.0 - w && u >= w && u <= 1.0 - w && voxel_is_air(word_idx_base, cell + crease_neighbor_v_hi(on))) {
        lum = LUM_CREASE_EDGE;
    }
    return lum;
}

fn tangent_all_solid(word_idx_base: u32, cell: vec3<i32>, on: vec3<f32>) -> bool {
    return !voxel_is_air(word_idx_base, cell + crease_neighbor_u_lo(on))
        && !voxel_is_air(word_idx_base, cell + crease_neighbor_u_hi(on))
        && !voxel_is_air(word_idx_base, cell + crease_neighbor_v_lo(on))
        && !voxel_is_air(word_idx_base, cell + crease_neighbor_v_hi(on));
}

/// West→center→east (or south→center→north) in smoothstep; t ∈ [0,1] across the face.
fn smooth_axis_albedo(c_lo: vec3<f32>, c_mid: vec3<f32>, c_hi: vec3<f32>, t: f32) -> vec3<f32> {
    let left = mix(c_lo, c_mid, smoothstep(0.0, 1.0, clamp(t * 2.0, 0.0, 1.0)));
    let right = mix(c_mid, c_hi, smoothstep(0.0, 1.0, clamp((t - 0.5) * 2.0, 0.0, 1.0)));
    return select(left, right, t > 0.5);
}

/// Only when all four tangent voxels are solid: blend palette colors toward neighbors from face center.
fn coplanar_smoothed_albedo(
    on: vec3<f32>,
    cell: vec3<i32>,
    uv: vec2<f32>,
    word_idx_base: u32,
    c_mid: vec3<f32>,
) -> vec3<f32> {
    if (!tangent_all_solid(word_idx_base, cell, on)) {
        return c_mid;
    }
    let iw = voxel_byte_at(word_idx_base, cell + crease_neighbor_u_lo(on));
    let ie = voxel_byte_at(word_idx_base, cell + crease_neighbor_u_hi(on));
    let is = voxel_byte_at(word_idx_base, cell + crease_neighbor_v_lo(on));
    let inn = voxel_byte_at(word_idx_base, cell + crease_neighbor_v_hi(on));
    let c_w = palette[iw & 63u].xyz;
    let c_e = palette[ie & 63u].xyz;
    let c_s = palette[is & 63u].xyz;
    let c_n = palette[inn & 63u].xyz;
    let cu = smooth_axis_albedo(c_w, c_mid, c_e, uv.x);
    let cv = smooth_axis_albedo(c_s, c_mid, c_n, uv.y);
    return 0.5 * (cu + cv);
}

fn hit_solid_voxel(
    chunk_idx: u32,
    chunk_pos: vec3<f32>,
    vox_scale: f32,
    cell: vec3<i32>,
    voxel: u32,
    ray_origin: vec3<f32>,
    ray_dir: vec3<f32>,
    inv_rd: vec3<f32>,
    t_entry: f32,
    t_exit: f32,
) -> TerrainChunkHit {
    let wx_lo = chunk_pos + (vec3<f32>(cell) - vec3<f32>(32.0)) * vox_scale;
    let wx_hi = wx_lo + vec3<f32>(vox_scale);
    let t1 = (wx_lo - ray_origin) * inv_rd;
    let t2 = (wx_hi - ray_origin) * inv_rd;
    let t_near = max(max(min(t1.x, t2.x), min(t1.y, t2.y)), min(t1.z, t2.z));
    let t_far = min(min(max(t1.x, t2.x), max(t1.y, t2.y)), max(t1.z, t2.z));
    if (t_far < t_entry - EPSILON || t_near > t_exit + EPSILON) {
        return TerrainChunkHit(MicroHit(vec3<f32>(0.0), 0.0, vec3<f32>(0.0), 0u, 1.0), chunk_idx, vec4<i32>(0));
    }
    let t_world = clamp(max(t_near, t_entry), t_entry, t_exit);
    let tx = min(t1.x, t2.x);
    let ty = min(t1.y, t2.y);
    let tz = min(t1.z, t2.z);
    let teps = max(1e-5 * abs(t_near), 1e-6);
    var on = vec3<f32>(0.0, 1.0, 0.0);
    if (abs(tx - t_near) < teps) {
        on = vec3<f32>(select(1.0, -1.0, t1.x < t2.x), 0.0, 0.0);
    } else if (abs(ty - t_near) < teps) {
        on = vec3<f32>(0.0, select(1.0, -1.0, t1.y < t2.y), 0.0);
    } else if (abs(tz - t_near) < teps) {
        on = vec3<f32>(0.0, 0.0, select(1.0, -1.0, t1.z < t2.z));
    }
    let hit_p = ray_origin + ray_dir * t_world;
    let uvf = face_uv(on, hit_p, wx_lo, vox_scale);
    let c_mid = palette[voxel & 63u].xyz;
    let alb = coplanar_smoothed_albedo(on, cell, uvf, chunk_idx, c_mid);
    let lum = world_crease_luminance(on, cell, uvf, chunk_idx);
    return TerrainChunkHit(
        MicroHit(alb, t_world, on, 1u, lum),
        chunk_idx,
        vec4<i32>(cell.x, cell.y, cell.z, 0),
    );
}

/// Directory DDA (8^3 bricks) then brick-local voxel DDA. Air bricks skipped.
fn trace_micro_chunk_detail(
    chunk_idx: u32,
    chunk_pos: vec3<f32>,
    half_extent: f32,
    ray_origin: vec3<f32>,
    ray_dir: vec3<f32>,
    t_entry: f32,
    t_exit: f32,
) -> TerrainChunkHit {
    let inv_rd = 1.0 / (ray_dir + vec3<f32>(1e-9));
    let vox_scale = half_extent / 32.0;
    let brick_scale = vox_scale * 8.0;
    let inv_b = 1.0 / brick_scale;
    let local_origin = (ray_origin - chunk_pos) * inv_b + 4.0;
    let local_dir = ray_dir * inv_b;
    let start_p = local_origin + local_dir * (t_entry + EPSILON);

    var bcell = clamp(vec3<i32>(floor(start_p)), vec3<i32>(0), vec3<i32>(7));
    let step_b = vec3<i32>(sign(local_dir));
    let delta_b = abs(1.0 / (local_dir + 1e-9));
    var side_b = (sign(local_dir) * (vec3<f32>(bcell) - local_origin) + sign(local_dir) * 0.5 + 0.5) * delta_b;
    var mask_b = vec3<f32>(0.0);

    for (var s = 0; s < 32; s++) {
        let brick_id = brick_id_at(chunk_idx, u32(bcell.x), u32(bcell.y), u32(bcell.z));
        if (brick_id != 0u) {
            // fine DDA inside this 8^3 brick
            let inv_s = 1.0 / vox_scale;
            let vox_origin = (ray_origin - chunk_pos) * inv_s + 32.0;
            let vox_dir = ray_dir * inv_s;
            let brick_min = vec3<f32>(bcell) * 8.0;
            let brick_max = brick_min + 8.0;
            let t1b = (brick_min - vox_origin) / (vox_dir + vec3<f32>(1e-9));
            let t2b = (brick_max - vox_origin) / (vox_dir + vec3<f32>(1e-9));
            let t_near_b = max(max(min(t1b.x, t2b.x), min(t1b.y, t2b.y)), min(t1b.z, t2b.z));
            let t_far_b = min(min(max(t1b.x, t2b.x), max(t1b.y, t2b.y)), max(t1b.z, t2b.z));
            let te = max(t_near_b, t_entry) + EPSILON;
            let tx = min(t_far_b, t_exit);
            if (tx > te) {
                let start_v = vox_origin + vox_dir * te;
                var cell = clamp(vec3<i32>(floor(start_v)), vec3<i32>(brick_min), vec3<i32>(brick_max) - vec3<i32>(1));
                let step_l = vec3<i32>(sign(vox_dir));
                let delta = abs(1.0 / (vox_dir + 1e-9));
                var side = (sign(vox_dir) * (vec3<f32>(cell) - vox_origin) + sign(vox_dir) * 0.5 + 0.5) * delta;
                var mask = vec3<f32>(0.0);
                for (var vs = 0; vs < 32; vs++) {
                    let lx = u32(cell.x) & 7u;
                    let ly = u32(cell.y) & 7u;
                    let lz = u32(cell.z) & 7u;
                    let voxel = brick_voxel(brick_id, lx, ly, lz);
                    if (voxel != 0xffu) {
                        let hit = hit_solid_voxel(
                            chunk_idx, chunk_pos, vox_scale, cell, voxel,
                            ray_origin, ray_dir, inv_rd, t_entry, t_exit,
                        );
                        if (hit.micro.ok != 0u) { return hit; }
                    }
                    mask = step(side.xyz, side.yzx) * step(side.xyz, side.zxy);
                    side += mask * delta;
                    cell += vec3<i32>(mask) * step_l;
                    if (any(cell < vec3<i32>(brick_min)) || any(cell >= vec3<i32>(brick_max))) { break; }
                }
            }
        }

        mask_b = step(side_b.xyz, side_b.yzx) * step(side_b.xyz, side_b.zxy);
        side_b += mask_b * delta_b;
        bcell += vec3<i32>(mask_b) * step_b;
        if (any(bcell < vec3<i32>(0)) || any(bcell >= vec3<i32>(8))) { break; }
    }
    return TerrainChunkHit(
        MicroHit(vec3<f32>(0.0), 0.0, vec3<f32>(0.0), 0u, 1.0),
        chunk_idx,
        vec4<i32>(0),
    );
}

@compute @workgroup_size(8, 8)
fn cs_main(@builtin(global_invocation_id) id: vec3<u32>) {
    if (id.x >= u32(ubo.resolution.x) || id.y >= u32(ubo.resolution.y)) { return; }
    let pixel = vec2<f32>(vec2<u32>(id.xy));
    let base_uv = (pixel + vec2<f32>(0.5)) / ubo.resolution;
    let cx = (u32(ubo.resolution.x) - 1u) / 2u;
    let cy = (u32(ubo.resolution.y) - 1u) / 2u;
    let is_center = id.x == cx && id.y == cy;

    let aspect = ubo.resolution.x / ubo.resolution.y;
    let p = (base_uv * 2.0 - 1.0) * vec2<f32>(aspect, 1.0);
    let ray_dir = normalize((ubo.viewInv * vec4<f32>(normalize(vec3<f32>(p, -1.5)), 0.0)).xyz);
    let ray_origin = (ubo.viewInv * vec4<f32>(0.0, 0.0, 0.0, 1.0)).xyz;
    let d = trace_ray_detail(ray_origin, ray_dir);
    if (is_center) {
        write_pick_from_detail(d);
    }
    var mosaic = shade_scene_detail(d, ray_dir);
    mosaic = blend_ui_lines(pixel, mosaic);
    textureStore(output_tex, vec2<i32>(id.xy), mosaic);
}