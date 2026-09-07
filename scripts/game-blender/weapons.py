# Doodle District — weapon model builder.
#
# Run headless:  blender --background --python scripts/game-blender/weapons.py
#   or in Blender's UI: Scripting tab -> open this file -> Run Script.
#
# Builds the five first-person weapons (rifle, shotgun, revolver, sniper,
# katana) from primitives, mirroring the game's procedural meshes in
# public/game/src/weapons.js part for part, then exports each as GLB into
# apps/web/public/game/models/. Because the coordinates match exactly, the
# game's view-model swap (assets.js bridge) is seamless: reload/pump/bolt
# animations re-bind to the model's named parts.
#
# Part names the game looks up after the swap:
#   mag (rifle, sniper) · foreEnd (shotgun pump) · bolt (sniper, knob parented
#   under it) · cylinder (revolver group) · hand_L (left arm, reload anim) ·
#   muzzle / eject (empties, tracer + shell anchors) · blade / tip (katana).
#
# Colour comes from material names the bridge understands:
#   ink_blue · ink_black · ink_red_fill  ("fill" = solid scribble, not hatching)
#
# Orientation: the game's space is +Y up / -Z forward. Blender builds with +Z
# up / +Y forward, and the glTF exporter's +Y-up conversion maps it back
# exactly — so build in Blender coords (x, -z_game, y_game) and everything
# lands correctly in three.js.

import bpy
import math
import os
from mathutils import Vector

# Where the GLB files are written (adjust if the repo moves).
OUT = "/Users/sachin/Documents/GitHub/uxcommunity/apps/web/public/game/models"

INK_COLORS = {
    "ink_blue": (0.10, 0.19, 0.76),
    "ink_black": (0.18, 0.20, 0.26),
    "ink_red_fill": (0.86, 0.12, 0.20),
}

# ---------------------------------------------------------------- helpers ---

def clean_scene():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for block in (bpy.data.meshes, bpy.data.materials):
        for item in list(block):
            if item.users == 0:
                block.remove(item)


def make_materials():
    mats = {}
    for name, color in INK_COLORS.items():
        m = bpy.data.materials.new(name)
        m.use_nodes = True
        bsdf = m.node_tree.nodes.get("Principled BSDF")
        bsdf.inputs["Base Color"].default_value = (*color, 1.0)
        m.diffuse_color = (*color, 1.0)
        mats[name] = m
    return mats


def gb(p):
    """Game coords (x, y, z) -> Blender coords (x, -z, y)."""
    return (p[0], -p[2], p[1])


def _smooth(o):
    for poly in o.data.polygons:
        poly.use_smooth = True


def _attach(o, material, parent):
    if o.data is not None:
        o.data.materials.append(material)
    if parent is not None:
        bpy.context.view_layer.update()
        o.parent = parent
        o.matrix_parent_inverse = parent.matrix_world.inverted()


def box(name, w, h, d, x, y, z, material, rx=0.0, rz=0.0, parent=None):
    """Game box: size (w, h, d) at game (x, y, z), rotated about game X / Z."""
    bpy.ops.mesh.primitive_cube_add(size=1, location=gb((x, y, z)))
    o = bpy.context.object
    o.name = name
    o.scale = (w, d, h)  # blender: x = game w, y = game d, z = game h
    o.rotation_euler = (rx, -rz, 0.0)  # game rotX -> blender X, game rotZ -> blender -Y
    _attach(o, material, parent)
    return o


def cyl(name, r, length, x, y, z, material, seg=8, parent=None):
    """Game cylinder along game Z (as weapons.js builds them)."""
    bpy.ops.mesh.primitive_cylinder_add(
        radius=r, depth=length, vertices=seg, location=gb((x, y, z)))
    o = bpy.context.object
    o.name = name
    o.rotation_euler = (math.pi / 2, 0.0, 0.0)  # axis Z -> blender Y (= game -Z)
    _smooth(o)
    _attach(o, material, parent)
    return o


def sphere(name, r, x, y, z, material, seg=8, parent=None):
    bpy.ops.mesh.primitive_uv_sphere_add(
        radius=r, segments=seg, ring_count=seg, location=gb((x, y, z)))
    o = bpy.context.object
    o.name = name
    _smooth(o)
    _attach(o, material, parent)
    return o


def empty(name, x, y, z, parent=None):
    bpy.ops.object.empty_add(type="PLAIN_AXES", location=gb((x, y, z)))
    o = bpy.context.object
    o.name = name
    if parent is not None:
        bpy.context.view_layer.update()
        o.parent = parent
        o.matrix_parent_inverse = parent.matrix_world.inverted()
    return o


def hand(prefix, x, y, z, direction, parent=None):
    """Doodle fist + forearm, mirroring weapons.js hand(). The left arm is
    named hand_L so the game can re-bind its reload animation to it."""
    sphere(prefix + "_fist", 0.062, x, y, z, MATS["ink_blue"], seg=8, parent=parent)
    d = Vector(direction).normalized()
    L = 0.42
    mid = gb((x + d.x * L / 2, y + d.y * L / 2, z + d.z * L / 2))
    bpy.ops.mesh.primitive_cylinder_add(
        radius=0.045, depth=L, vertices=7, location=mid)
    o = bpy.context.object
    o.name = "hand_L" if prefix == "hand_L" else prefix + "_arm"
    o.rotation_mode = "QUATERNION"
    # align blender +Z (cylinder axis) with the direction, mapped to blender space
    o.rotation_quaternion = Vector((0, 0, 1)).rotation_difference(
        Vector((d.x, -d.z, d.y)))
    _smooth(o)
    _attach(o, MATS["ink_blue"], parent)
    return o


def sight_frame(name, w, h, t, d, x, y, z, parent=None):
    """weapons.js frame(): four thin bars forming a rectangle."""
    box(name + "_top", w, t, d, x, y + h / 2, z, MATS["ink_blue"], parent=parent)
    box(name + "_bot", w, t, d, x, y - h / 2, z, MATS["ink_blue"], parent=parent)
    box(name + "_l", t, h, d, x - w / 2, y, z, MATS["ink_blue"], parent=parent)
    box(name + "_r", t, h, d, x + w / 2, y, z, MATS["ink_blue"], parent=parent)


def export_weapon(root, filename):
    bpy.ops.object.select_all(action="DESELECT")
    root.select_set(True)
    for child in root.children_recursive:
        child.select_set(True)
    bpy.context.view_layer.objects.active = root
    path = os.path.join(OUT, filename)
    bpy.ops.export_scene.gltf(
        filepath=path, export_format="GLB", use_selection=True, export_apply=True)
    print("[weapons.py] wrote", path)


# ----------------------------------------------------------------- models ---

def build_rifle(root):
    box("receiver", 0.09, 0.12, 0.5, 0, 0, 0, MATS["ink_blue"], parent=root)
    box("handguard", 0.075, 0.085, 0.36, 0, 0, -0.42, MATS["ink_blue"], parent=root)
    cyl("barrel", 0.018, 0.42, 0, 0.02, -0.75, MATS["ink_black"], parent=root)
    box("mag", 0.06, 0.2, 0.1, 0, -0.16, -0.06, MATS["ink_blue"], rx=0.15, parent=root)
    box("stock", 0.07, 0.11, 0.3, 0, -0.01, 0.4, MATS["ink_blue"], parent=root)
    box("grip", 0.05, 0.14, 0.06, 0, -0.13, 0.12, MATS["ink_blue"], rx=0.3, parent=root)
    sight_frame("sight", 0.075, 0.07, 0.012, 0.03, 0, 0.12, -0.05, parent=root)
    box("sight_post", 0.03, 0.018, 0.05, 0, 0.062, -0.05, MATS["ink_black"], parent=root)
    sphere("sight_dot", 0.0012, 0, 0.12, -0.05, MATS["ink_red_fill"], seg=5, parent=root)
    hand("hand_R", 0.02, -0.15, 0.13, (0.5, -0.6, 1), parent=root)
    hand("hand_L", -0.05, -0.08, -0.4, (-0.35, -0.9, 0.9), parent=root)
    empty("muzzle", 0, 0.02, -0.98, parent=root)
    empty("eject", 0.06, 0.02, 0.02, parent=root)


def build_shotgun(root):
    box("receiver", 0.09, 0.13, 0.42, 0, 0, 0.05, MATS["ink_blue"], parent=root)
    cyl("barrel", 0.021, 0.92, 0, 0.05, -0.62, MATS["ink_black"], parent=root)
    cyl("mag_tube", 0.019, 0.72, 0, -0.02, -0.5, MATS["ink_blue"], parent=root)
    box("foreEnd", 0.078, 0.085, 0.27, 0, 0.01, -0.46, MATS["ink_blue"], parent=root)
    box("stock", 0.07, 0.12, 0.34, 0, -0.04, 0.42, MATS["ink_blue"], rx=0.08, parent=root)
    box("grip", 0.05, 0.13, 0.06, 0, -0.13, 0.16, MATS["ink_blue"], rx=0.35, parent=root)
    sphere("bead", 0.013, 0, 0.095, -1.0, MATS["ink_red_fill"], seg=6, parent=root)
    box("bead_base", 0.03, 0.025, 0.02, 0, 0.085, -0.02, MATS["ink_black"], parent=root)
    hand("hand_R", 0.02, -0.16, 0.17, (0.5, -0.6, 1), parent=root)
    hand("hand_L", -0.04, -0.06, -0.45, (-0.35, -0.9, 0.9), parent=root)
    empty("muzzle", 0, 0.05, -1.09, parent=root)
    empty("eject", 0.06, 0.03, 0.05, parent=root)


def build_revolver(root):
    box("frame", 0.045, 0.09, 0.2, 0, 0, 0, MATS["ink_blue"], parent=root)
    cyl("barrel", 0.02, 0.3, 0, 0.035, -0.24, MATS["ink_black"], parent=root)
    box("topstrap", 0.03, 0.03, 0.26, 0, 0.005, -0.22, MATS["ink_blue"], parent=root)
    cg = empty("cylinder", 0, 0, -0.02, parent=root)
    cyl("cyl_body", 0.05, 0.11, 0, 0, -0.02, MATS["ink_blue"], seg=6, parent=cg)
    for i in range(6):
        a = i / 6 * math.tau
        cyl("chamber_%d" % i, 0.012, 0.115,
            math.cos(a) * 0.032, math.sin(a) * 0.032, -0.02,
            MATS["ink_black"], seg=5, parent=cg)
    box("grip", 0.045, 0.14, 0.055, 0, -0.1, 0.07, MATS["ink_black"], rx=0.4, parent=root)
    box("hammer", 0.02, 0.045, 0.035, 0, 0.05, 0.1, MATS["ink_blue"], rx=-0.4, parent=root)
    box("sight_front", 0.01, 0.03, 0.02, 0, 0.075, -0.34, MATS["ink_red_fill"], parent=root)
    box("sight_l", 0.012, 0.025, 0.015, -0.014, 0.06, 0.08, MATS["ink_blue"], parent=root)
    box("sight_r", 0.012, 0.025, 0.015, 0.014, 0.06, 0.08, MATS["ink_blue"], parent=root)
    hand("hand_R", 0.0, -0.13, 0.08, (0.45, -0.55, 1), parent=root)
    hand("hand_L", -0.05, -0.17, 0.02, (-0.4, -0.7, 1), parent=root)
    empty("muzzle", 0, 0.035, -0.4, parent=root)
    empty("eject", -0.05, 0.02, 0, parent=root)


def build_sniper(root):
    box("body", 0.085, 0.115, 0.6, 0, 0, 0.05, MATS["ink_blue"], parent=root)
    cyl("barrel", 0.024, 1.25, 0, 0.02, -0.92, MATS["ink_black"], parent=root)
    cyl("muzzle_brake", 0.032, 0.16, 0, 0.02, -1.5, MATS["ink_black"], parent=root)
    box("mag", 0.055, 0.16, 0.14, 0, -0.14, -0.06, MATS["ink_blue"], parent=root)
    box("stock", 0.075, 0.13, 0.44, 0, -0.02, 0.5, MATS["ink_blue"], rx=0.04, parent=root)
    box("grip", 0.05, 0.14, 0.07, 0, -0.13, 0.2, MATS["ink_blue"], rx=0.3, parent=root)
    box("cheek_riser", 0.06, 0.05, 0.16, 0, 0.07, 0.42, MATS["ink_blue"], parent=root)
    cyl("scope_tube", 0.052, 0.56, 0, 0.135, -0.1, MATS["ink_blue"], parent=root)
    cyl("scope_objective", 0.066, 0.07, 0, 0.135, -0.36, MATS["ink_blue"], parent=root)
    cyl("scope_ocular", 0.062, 0.07, 0, 0.135, 0.14, MATS["ink_blue"], parent=root)
    box("ring_front", 0.03, 0.09, 0.035, 0, 0.085, -0.24, MATS["ink_black"], parent=root)
    box("ring_rear", 0.03, 0.09, 0.035, 0, 0.085, 0.02, MATS["ink_black"], parent=root)
    box("cross_h", 0.09, 0.006, 0.004, 0, 0.135, -0.38, MATS["ink_red_fill"], parent=root)
    box("cross_v", 0.006, 0.09, 0.004, 0, 0.135, -0.38, MATS["ink_red_fill"], parent=root)
    bolt = box("bolt", 0.026, 0.026, 0.16, 0.07, 0.05, 0.16, MATS["ink_black"], parent=root)
    sphere("bolt_knob", 0.032, 0.07, 0.05, 0.24, MATS["ink_black"], seg=6, parent=bolt)
    box("bipod_l", 0.02, 0.26, 0.02, -0.07, -0.13, -0.78, MATS["ink_black"], rz=0.35, parent=root)
    box("bipod_r", 0.02, 0.26, 0.02, 0.07, -0.13, -0.78, MATS["ink_black"], rz=-0.35, parent=root)
    hand("hand_R", 0.02, -0.16, 0.24, (0.5, -0.6, 1), parent=root)
    hand("hand_L", -0.05, -0.09, -0.5, (-0.35, -0.9, 0.9), parent=root)
    empty("muzzle", 0, 0.02, -1.6, parent=root)
    empty("eject", 0.06, 0.04, 0.06, parent=root)


def build_katana(root):
    box("blade", 0.012, 0.035, 1.0, 0, 0, -0.55, MATS["ink_blue"], parent=root)
    box("blade_tip", 0.012, 0.02, 0.08, 0, 0.007, -1.07, MATS["ink_blue"], rx=0.3, parent=root)
    box("tsuba", 0.1, 0.1, 0.02, 0, 0, -0.05, MATS["ink_black"], parent=root)
    box("tsuka", 0.03, 0.036, 0.3, 0, 0, 0.12, MATS["ink_black"], parent=root)
    for i in range(6):
        box("ito_%d" % i, 0.036, 0.04, 0.02, 0, 0, 0.02 + i * 0.045, MATS["ink_blue"], parent=root)
    hand("hand_R", 0.0, -0.005, 0.05, (0.5, -0.5, 1), parent=root)
    hand("hand_L", 0.0, -0.005, 0.2, (-0.4, -0.7, 1), parent=root)
    empty("tip", 0, 0, -1.05, parent=root)


# ------------------------------------------------------------------- main ---

WEAPONS = [
    ("rifle", build_rifle),
    ("shotgun", build_shotgun),
    ("revolver", build_revolver),
    ("sniper", build_sniper),
    ("katana", build_katana),
]

os.makedirs(OUT, exist_ok=True)

for weapon_name, build in WEAPONS:
    clean_scene()
    MATS = make_materials()
    root = empty(weapon_name + "_root", 0, 0, 0)
    build(root)
    export_weapon(root, weapon_name + ".glb")

print("[weapons.py] done — %d models in %s" % (len(WEAPONS), OUT))
