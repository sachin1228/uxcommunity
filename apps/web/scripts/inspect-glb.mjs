/**
 * Inspect the GLB furniture assets: per-mesh material + texture + geometry audit.
 * Usage: node scripts/inspect-glb.mjs [name...]   (defaults to all assets)
 */
import { readFile } from "node:fs/promises";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

const ASSETS = ["sofa", "coffee-table", "desk", "monitor", "chair", "floor-lamp", "plant"];
const names = process.argv.slice(2).length ? process.argv.slice(2) : ASSETS;

const typeName = (t) =>
  t ? `${t.constructor.name}(${t.image ? t.image.width + "x" + t.image.height : "?x?"})` : null;

function dumpTexture(label, t) {
  if (!t) return null;
  const cs = t.colorSpace === THREE.SRGBColorSpace ? "sRGB" : t.colorSpace === THREE.NoColorSpace ? "linear" : String(t.colorSpace);
  return `${label}:${typeName(t)} cs=${cs}`;
}

for (const name of names) {
  const buf = await readFile(new URL(`../public/designers/${name}.glb`, import.meta.url));
  const loader = new GLTFLoader();
  const gltf = await new Promise((res, rej) =>
    loader.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), "", res, rej)
  );

  let all = new THREE.Box3();
  let tris = 0;
  const meshes = [];
  gltf.scene.traverse((o) => {
    if (!o.isMesh) return;
    o.geometry.computeBoundingBox();
    all.union(o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld));
    if (o.geometry.index) tris += o.geometry.index.count / 3;
    else tris += o.geometry.attributes.position.count / 3;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    meshes.push({
      mesh: o.name || "(unnamed)",
      position: o.position.toArray().map((v) => +v.toFixed(3)),
      scale: o.scale.toArray().map((v) => +v.toFixed(3)),
      materials: mats.map((m) => ({
        name: m.name || "(unnamed)",
        type: m.type,
        color: m.color ? m.color.getHexString() : null,
        roughness: m.roughness,
        metalness: m.metalness,
        emissive: m.emissive && m.emissive.getHex() ? "#" + m.emissive.getHexString() : null,
        emissiveIntensity: m.emissiveIntensity,
        maps: [
          dumpTexture("map", m.map),
          dumpTexture("normal", m.normalMap),
          dumpTexture("rough", m.roughnessMap),
          dumpTexture("metal", m.metalnessMap),
          dumpTexture("ao", m.aoMap),
          dumpTexture("emissive", m.emissiveMap),
        ].filter(Boolean),
      })),
    });
  });

  const size = new THREE.Vector3();
  all.getSize(size);
  console.log(`\n=== ${name}.glb ===  (${buf.length} bytes)`);
  console.log(`bounds: min ${all.min.toArray().map((v) => +v.toFixed(3))} max ${all.max.toArray().map((v) => +v.toFixed(3))} size ${size.toArray().map((v) => +v.toFixed(3))}`);
  console.log(`triangles: ${Math.round(tris)}`);
  for (const m of meshes) {
    console.log(`  mesh "${m.mesh}" @${m.position} scale${m.scale}`);
    for (const mat of m.materials) {
      console.log(
        `    mat "${mat.name}" [${mat.type}] color=#${mat.color} rough=${mat.roughness} metal=${mat.metalness} emis=${mat.emissive}(${mat.emissiveIntensity})`
      );
      for (const map of mat.maps) console.log(`      ${map}`);
    }
  }
}