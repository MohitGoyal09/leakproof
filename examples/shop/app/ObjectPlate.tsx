import type { Shape } from "./products";

const SILHOUETTES: Record<Shape, React.ReactNode> = {
  mug: (
    <>
      <rect x="92" y="62" width="88" height="96" rx="10" />
      <path d="M180 84h14a22 22 0 0 1 0 44h-14v-12h14a10 10 0 0 0 0-20h-14z" />
    </>
  ),
  throw: (
    <>
      <rect x="70" y="58" width="160" height="104" rx="6" />
      <rect x="70" y="162" width="160" height="10" rx="2" opacity="0.6" />
    </>
  ),
  lamp: (
    <>
      <path d="M118 60h64l18 46h-100z" />
      <rect x="146" y="106" width="8" height="52" />
      <rect x="112" y="158" width="76" height="12" rx="3" />
    </>
  ),
  tray: (
    <>
      <rect x="58" y="104" width="184" height="36" rx="8" />
      <rect x="72" y="96" width="156" height="10" rx="3" opacity="0.6" />
    </>
  ),
};

interface ObjectPlateProps {
  shape: Shape;
  glaze: string;
  label: string;
}

export function ObjectPlate({ shape, glaze, label }: ObjectPlateProps) {
  return (
    <svg className="plate" viewBox="0 0 300 225" role="img" aria-label={label} style={{ background: glaze }}>
      <g fill="rgba(255,255,255,0.88)">{SILHOUETTES[shape]}</g>
    </svg>
  );
}
