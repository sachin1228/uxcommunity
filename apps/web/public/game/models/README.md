# Game models

Blender-made GLB models for the doodle game, loaded by `../src/assets.js`
and swapped onto the procedural view models at boot (missing files fall
back to the procedural meshes).

Regenerate the weapon models by running, on a machine with Blender:

```
blender --background --python scripts/game-blender/weapons.py
```

The script mirrors the game's procedural weapon geometry part for part,
so the first-person swap is seamless and the reload/pump/bolt animations
re-bind to the model's named parts (mag, foreEnd, bolt, cylinder, hand_L,
muzzle, eject, blade, tip).
