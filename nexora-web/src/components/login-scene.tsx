"use client";

import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { Canvas, useFrame } from "@react-three/fiber";
import { Float, MeshDistortMaterial } from "@react-three/drei";

const COUNT = 70;

/** A slow drift of small spheres that part gently around the cursor. */
function Swarm() {
  const mesh = useRef<THREE.InstancedMesh>(null!);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const seeds = useMemo(
    () =>
      Array.from({ length: COUNT }, () => ({
        base: new THREE.Vector3((Math.random() - 0.5) * 15, (Math.random() - 0.5) * 8.5, (Math.random() - 0.5) * 6 - 1),
        speed: 0.2 + Math.random() * 0.4,
        phase: Math.random() * Math.PI * 2,
        size: 0.07 + Math.random() * 0.2,
      })),
    []
  );
  const pos = useMemo(() => seeds.map((s) => s.base.clone()), [seeds]);

  useEffect(() => {
    const c = new THREE.Color();
    seeds.forEach((_, i) => {
      c.set(i % 5 === 0 ? "#ff4d4d" : i % 3 === 0 ? "#f3e3e6" : "#5a0f12");
      mesh.current.setColorAt(i, c);
    });
    mesh.current.instanceColor!.needsUpdate = true;
  }, [seeds]);

  useFrame(({ clock, pointer, viewport }) => {
    const t = clock.elapsedTime;
    const mx = (pointer.x * viewport.width) / 2;
    const my = (pointer.y * viewport.height) / 2;
    seeds.forEach((s, i) => {
      const p = pos[i];
      const tx = s.base.x + Math.sin(t * s.speed + s.phase) * 0.6;
      const ty = s.base.y + Math.cos(t * s.speed * 1.2 + s.phase) * 0.6;
      const dx = p.x - mx, dy = p.y - my, d = Math.hypot(dx, dy);
      let ox = 0, oy = 0;
      if (d < 2.4) {
        const k = (2.4 - d) / 2.4;
        ox = (dx / (d || 1)) * k * 1.6;
        oy = (dy / (d || 1)) * k * 1.6;
      }
      p.x += (tx + ox - p.x) * 0.05;
      p.y += (ty + oy - p.y) * 0.05;
      p.z = s.base.z + Math.sin(t * s.speed * 0.7 + s.phase) * 0.4;
      dummy.position.copy(p);
      dummy.scale.setScalar(s.size);
      dummy.updateMatrix();
      mesh.current.setMatrixAt(i, dummy.matrix);
    });
    mesh.current.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, COUNT]}>
      <sphereGeometry args={[1, 24, 24]} />
      <meshStandardMaterial roughness={0.3} metalness={0.2} />
    </instancedMesh>
  );
}

/** One large, slowly breathing orb. */
function Orb() {
  const ref = useRef<THREE.Mesh>(null!);
  useFrame(({ clock, pointer }) => {
    ref.current.rotation.y = clock.elapsedTime * 0.1;
    ref.current.position.x += (-3.3 + pointer.x * 0.5 - ref.current.position.x) * 0.04;
    ref.current.position.y += (pointer.y * 0.35 - ref.current.position.y) * 0.04;
  });
  return (
    <Float speed={1.1} floatIntensity={0.7} rotationIntensity={0.2}>
      <mesh ref={ref} position={[-3.3, 0, 0]} scale={2}>
        <icosahedronGeometry args={[1, 24]} />
        <MeshDistortMaterial color="#8f1511" distort={0.35} speed={1.3} roughness={0.25} metalness={0.3} />
      </mesh>
    </Float>
  );
}

export default function LoginScene() {
  return (
    <Canvas camera={{ position: [0, 0, 9], fov: 45 }} dpr={[1, 2]} gl={{ antialias: true }}>
      <fog attach="fog" args={["#000000", 8, 19]} />
      <ambientLight intensity={0.35} />
      <directionalLight position={[4, 5, 6]} intensity={1.1} />
      <pointLight position={[-5, 3, 4]} color="#ff3b30" intensity={60} />
      <Orb />
      <Swarm />
    </Canvas>
  );
}
