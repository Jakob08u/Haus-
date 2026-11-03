import { useEffect, useState } from 'react';

const parseNum = (s: string) => {
  const t = s.replace(/\s/g, '').replace(',', '.');
  if (t === '' || t === '-') return NaN;
  return Number(t);
};
const fmt = (x: number, digits: number) => {
  const r = Math.round(x * 10 ** digits) / 10 ** digits;
  return String(r).replace('.', ',');
};

/** Zahleneingabe; Wert intern in mm, Anzeige in cm (factor 10) oder anderem Faktor */
export function NumInput({
  value, onChange, factor = 10, digits = 1, unit = 'cm', min, max, width = 72, title, disabled,
}: {
  value: number | undefined;
  onChange: (v: number) => void;
  factor?: number;
  digits?: number;
  unit?: string;
  min?: number;
  max?: number;
  width?: number;
  title?: string;
  disabled?: boolean;
}) {
  const shown = value == null || Number.isNaN(value) ? '' : fmt(value / factor, digits);
  const [text, setText] = useState(shown);
  const [focus, setFocus] = useState(false);
  useEffect(() => {
    if (!focus) setText(shown);
  }, [shown, focus]);
  const commit = () => {
    const n = parseNum(text);
    if (Number.isNaN(n)) {
      setText(shown);
      return;
    }
    let v = n * factor;
    if (min != null) v = Math.max(min, v);
    if (max != null) v = Math.min(max, v);
    if (v !== value) onChange(v);
  };
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
      <input
        type="text"
        inputMode="decimal"
        style={{ width }}
        value={text}
        title={title}
        disabled={disabled}
        onFocus={() => setFocus(true)}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          setFocus(false);
          commit();
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            commit();
            (e.target as HTMLInputElement).blur();
          }
          if (e.key === 'Escape') {
            setText(shown);
            (e.target as HTMLInputElement).blur();
          }
          e.stopPropagation();
        }}
      />
      {unit && <span className="unit">{unit}</span>}
    </span>
  );
}

export function Field({ label, children, tag }: { label: string; children: React.ReactNode; tag?: React.ReactNode }) {
  return (
    <div className="row">
      <label>{label}</label>
      {children}
      {tag}
    </div>
  );
}

export function TextInput({ value, onChange, width = 180, placeholder }: { value: string; onChange: (v: string) => void; width?: number; placeholder?: string }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  return (
    <input
      type="text"
      style={{ width }}
      value={text}
      placeholder={placeholder}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => text !== value && onChange(text)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        e.stopPropagation();
      }}
    />
  );
}

export function Select<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value as T)}>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function Check({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label style={{ display: 'inline-flex', gap: 5, alignItems: 'center', cursor: 'pointer' }}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} /> {label}
    </label>
  );
}

export const AssumeTag = ({ show = true }: { show?: boolean }) => (show ? <span className="tag assume" title="Annahme – bitte prüfen">Annahme</span> : null);
