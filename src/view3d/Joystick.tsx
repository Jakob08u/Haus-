import { useRef, useState } from 'react';

/** Steuerkreuz-Eingabe fürs Begehen per Touch: x = rechts, y = vorwärts (je −1 … 1) */
export const walkInput = { x: 0, y: 0 };

const R = 56;

/** virtueller Joystick (unten links) zum Laufen auf dem iPad */
export function Joystick() {
  const base = useRef<HTMLDivElement>(null);
  const [knob, setKnob] = useState({ x: 0, y: 0 });
  const active = useRef<number | null>(null);
  const update = (e: React.PointerEvent) => {
    const r = base.current!.getBoundingClientRect();
    let dx = e.clientX - (r.left + r.width / 2);
    let dy = e.clientY - (r.top + r.height / 2);
    const l = Math.hypot(dx, dy);
    if (l > R) {
      dx = (dx / l) * R;
      dy = (dy / l) * R;
    }
    setKnob({ x: dx, y: dy });
    walkInput.x = dx / R;
    walkInput.y = -dy / R;
  };
  const end = () => {
    active.current = null;
    setKnob({ x: 0, y: 0 });
    walkInput.x = 0;
    walkInput.y = 0;
  };
  return (
    <div
      ref={base}
      className="joystick"
      onPointerDown={(e) => {
        e.stopPropagation();
        active.current = e.pointerId;
        (e.target as Element).setPointerCapture?.(e.pointerId);
        update(e);
      }}
      onPointerMove={(e) => active.current === e.pointerId && update(e)}
      onPointerUp={end}
      onPointerCancel={end}
    >
      <div className="joystick-knob" style={{ transform: `translate(${knob.x}px, ${knob.y}px)` }} />
    </div>
  );
}
