import { Component, forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { ContactShadows, OrbitControls, RoundedBox } from '@react-three/drei';
import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { MATERIALS } from '../shared/design.js';
import { downloadBlob } from './download.js';

function textureFor(id) {
  const material = MATERIALS[id];
  if (material.kind === 'paint') return null;
  const canvas = document.createElement('canvas');
  canvas.width = 256; canvas.height = 512;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = material.color; ctx.fillRect(0, 0, 256, 512);
  let seed = 42;
  const random = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
  if (material.kind === 'wood') {
    for (let i = 0; i < 420; i++) {
      const x = random() * 256;
      ctx.beginPath(); ctx.moveTo(x, 0);
      ctx.bezierCurveTo(x + random() * 10 - 5, 170, x - random() * 10, 340, x, 512);
      ctx.strokeStyle = `rgba(${random() > 0.4 ? '53,31,13' : '255,245,212'},${0.025 + random() * 0.08})`;
      ctx.lineWidth = random() * 1.4; ctx.stroke();
    }
  } else {
    for (let i = 0; i < 7000; i++) {
      ctx.fillStyle = `rgba(92,68,43,${random() * 0.09})`;
      ctx.fillRect(random() * 256, random() * 512, random() * 4, random() * 2);
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace; texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = 4;
  return texture;
}

// A cabinet can contain many ribs. Reuse one material/texture per finish rather
// than uploading a new wood texture for every visible piece and every version.
const surfaceCache = new Map();
function Surface({ id }) {
  if (!surfaceCache.has(id)) {
    const texture = textureFor(id);
    surfaceCache.set(id, new THREE.MeshStandardMaterial({ color: texture ? '#ffffff' : MATERIALS[id].color, map: texture, roughness: MATERIALS[id].roughness }));
  }
  return <primitive object={surfaceCache.get(id)} attach="material" dispose={null} />;
}

function Part({ size, position, radius = 0.01, material, ...props }) {
  return <RoundedBox args={size} radius={Math.min(radius, ...size.map(n => n / 2 - 0.001))} smoothness={4} position={position} castShadow receiveShadow {...props}><Surface id={material} /></RoundedBox>;
}

function Furniture({ design, modelRef }) {
  const d = design;
  const bodyHeight = d.height - d.legHeight;
  const bottom = d.legHeight;
  const frontZ = d.depth / 2 + 0.006;
  const doorWidth = (d.width - 0.048) / d.doors;
  const doorHeight = bodyHeight - 0.064;
  const doorRadius = Math.min(d.cornerRadius * 0.55, 0.022);
  const feet = [-1, 1].flatMap(x => [-1, 1].map(z => [x * (d.width / 2 - 0.12), d.legHeight / 2, z * (d.depth / 2 - 0.09)]));
  return <group ref={modelRef} name="FORM-sideboard">
    <Part name="cabinet-body" size={[d.width, bodyHeight - 0.025, d.depth]} position={[0, bottom + bodyHeight / 2 - 0.0125, 0]} radius={d.cornerRadius} material={d.bodyMaterial} />
    <Part name="tabletop" size={[d.width + 0.012, 0.035, d.depth + 0.016]} position={[0, d.height - 0.0175, 0]} radius={0.014} material={d.topMaterial} />
    {Array.from({ length: d.doors }, (_, i) => {
      const x = (i - (d.doors - 1) / 2) * doorWidth;
      const fluteCount = Math.max(5, Math.floor(doorWidth / 0.019));
      return <group key={`${d.doors}-${i}`} name={`door-${i + 1}`}>
        <Part size={[doorWidth - 0.005, doorHeight, 0.026]} position={[x, bottom + bodyHeight / 2 - 0.004, frontZ]} radius={doorRadius} material={d.doorMaterial} />
        {d.detail === 'fluted' && Array.from({ length: fluteCount }, (_, j) => <Part key={j} name={`flute-${i + 1}-${j + 1}`} size={[0.010, doorHeight - 0.035, 0.011]} position={[x + (j - (fluteCount - 1) / 2) * ((doorWidth - 0.028) / fluteCount), bottom + bodyHeight / 2 - 0.004, frontZ + 0.014]} radius={0.004} material={d.doorMaterial} />)}
        {d.handleStyle !== 'none' && <mesh name={`handle-${i + 1}`} position={[x, bottom + bodyHeight - 0.10, frontZ + 0.035]} castShadow>
          <cylinderGeometry args={[0.007, 0.007, 0.07, 12]} />
          <meshStandardMaterial color={d.handleStyle === 'brass' ? '#a48b4d' : '#725337'} metalness={d.handleStyle === 'brass' ? 0.65 : 0} roughness={0.35} />
        </mesh>}
      </group>;
    })}
    {d.legStyle === 'plinth' && <Part name="recessed-plinth" size={[d.width - 0.18, d.legHeight, d.depth - 0.12]} position={[0, d.legHeight / 2, 0]} radius={0.012} material={d.bodyMaterial} />}
    {(d.legStyle === 'round' || d.legStyle === 'tapered') && feet.map((position, i) => <mesh name={`leg-${i + 1}`} key={i} position={position} castShadow receiveShadow>
      <cylinderGeometry args={[0.029, d.legStyle === 'tapered' ? 0.015 : 0.029, d.legHeight, 24]} />
      <Surface id={d.bodyMaterial} />
    </mesh>)}
  </group>;
}

function CameraRig({ view, design, controls }) {
  const { camera, invalidate } = useThree();
  useEffect(() => {
    const scale = Math.max(design.width / 1.6, design.height / 0.8, 1);
    const positions = { perspective: [2.35, 1.55, 2.8], front: [0, 0.7, 3.8], side: [3.8, 0.8, 0], back: [0, 0.85, -3.8], top: [0, 4.3, 0.001] };
    const pos = positions[view] || positions.perspective;
    camera.position.set(pos[0] * scale, pos[1] * scale, pos[2] * scale);
    camera.lookAt(0, design.height / 2, 0);
    if (controls.current) { controls.current.target.set(0, design.height / 2, 0); controls.current.update(); }
    camera.updateProjectionMatrix(); invalidate();
  }, [view, design.width, design.height, camera, controls, invalidate]);
  return null;
}

function SceneContent({ design, view, modelRef, controls }) {
  return <>
    <color attach="background" args={['#ebe8e0']} />
    <ambientLight intensity={1.2} />
    <hemisphereLight args={['#fffbef', '#a9a397', 1.6]} />
    <directionalLight position={[3, 5, 4]} intensity={3.2} castShadow shadow-mapSize={[2048, 2048]} shadow-camera-left={-4} shadow-camera-right={4} shadow-camera-top={4} shadow-camera-bottom={-4} shadow-normalBias={0.03} />
    <directionalLight position={[-4, 2, -3]} intensity={1.1} color="#ffffff" />
    <Furniture design={design} modelRef={modelRef} />
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.006, 0]} receiveShadow><planeGeometry args={[200, 200]} /><meshStandardMaterial color="#ebe8e0" roughness={1} /></mesh>
    <ContactShadows position={[0, -0.002, 0]} opacity={0.36} scale={8} blur={2.5} far={2} resolution={512} color="#514c40" />
    <OrbitControls ref={controls} makeDefault minDistance={1.5} maxDistance={8} maxPolarAngle={Math.PI / 2 - 0.02} enablePan={false} enableDamping />
    <CameraRig view={view} design={design} controls={controls} />
  </>;
}

class SceneErrorBoundary extends Component {
  state = { error: false };
  static getDerivedStateFromError() { return { error: true }; }
  render() {
    return this.state.error ? <div className="scene-fallback">三维预览未能启动。请使用支持 WebGL 的浏览器并开启硬件加速，设计仍可保存。</div> : this.props.children;
  }
}

const Scene = forwardRef(function Scene({ design, view = 'perspective', className = '' }, ref) {
  const canvasRef = useRef(); const modelRef = useRef(); const controls = useRef();
  useImperativeHandle(ref, () => ({
    async screenshot() {
      const canvas = canvasRef.current?.querySelector('canvas');
      if (!canvas) throw new Error('三维画面尚未就绪。');
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
      if (!blob) throw new Error('截图失败，请重试。');
      downloadBlob(blob, `FORM-${design.name}.png`);
    },
    async exportGLB() {
      if (!modelRef.current) throw new Error('模型尚未就绪。');
      modelRef.current.updateMatrixWorld(true);
      const result = await new GLTFExporter().parseAsync(modelRef.current, { binary: true, onlyVisible: true });
      downloadBlob(new Blob([result], { type: 'model/gltf-binary' }), `FORM-${design.name}.glb`);
    },
    resetCamera() {
      if (!controls.current) return;
      const scale = Math.max(design.width / 1.6, design.height / 0.8, 1);
      controls.current.object.position.set(2.35 * scale, 1.55 * scale, 2.8 * scale);
      controls.current.target.set(0, design.height / 2, 0); controls.current.update();
    },
  }), [design]);
  return <div className={`scene-canvas ${className}`} ref={canvasRef} aria-label="边柜三维预览，可拖动旋转、滚轮缩放">
    <SceneErrorBoundary>
      <Canvas shadows dpr={[1, 1.75]} camera={{ position: [2.35, 1.55, 2.8], fov: 35, near: 0.01, far: 250 }} gl={{ antialias: true, preserveDrawingBuffer: true }} fallback={<div className="scene-fallback">当前浏览器不支持 WebGL，暂时无法预览三维模型。</div>}>
        <SceneContent design={design} view={view} modelRef={modelRef} controls={controls} />
      </Canvas>
    </SceneErrorBoundary>
  </div>;
});

export default Scene;
