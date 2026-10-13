import React from 'react';
import { Search } from 'lucide-react';
import { formatMinorMoney, parseMoneyToMinor } from '../../utils/money';

export function MoneyInput({ label, currency, valueMinor, onChange, error, required = false, id }: {
  label: string; currency: string; valueMinor: number | null; onChange: (minor: number | null) => void; error?: string; required?: boolean; id?: string;
}) {
  const inputId = id ?? `money-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
  const [draft, setDraft] = React.useState(valueMinor == null ? '' : formatMinorMoney(valueMinor, currency).replace(/^[^\d-]+\s?/, '').replace(/,/g, ''));
  React.useEffect(() => setDraft(valueMinor == null ? '' : formatMinorMoney(valueMinor, currency).replace(/^[^\d-]+\s?/, '').replace(/,/g, '')), [valueMinor, currency]);
  return <div className="form-field"><label htmlFor={inputId}>{label}{required && <span aria-hidden="true"> *</span>}</label><div className="money-input-wrap"><span>{currency}</span><input id={inputId} type="text" inputMode="decimal" autoComplete="off" value={draft} aria-invalid={Boolean(error)} aria-describedby={error ? `${inputId}-error` : undefined} onChange={event => { setDraft(event.target.value); onChange(parseMoneyToMinor(event.target.value, currency)); }} /> </div>{error && <small id={`${inputId}-error`} className="field-error">{error}</small>}</div>;
}

export function QuantityInput({ label, value, unit, onChange, error, id }: {
  label: string; value: string; unit: string; onChange: (value: string) => void; error?: string; id?: string;
}) {
  const inputId = id ?? `quantity-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
  return <div className="form-field"><label htmlFor={inputId}>{label}</label><div className="quantity-input-wrap"><input id={inputId} type="text" inputMode="decimal" value={value} aria-invalid={Boolean(error)} aria-describedby={error ? `${inputId}-error` : undefined} onChange={event => onChange(event.target.value.replace(/[^\d.,-]/g, '').replace(',', '.'))} /><span>{unit}</span></div>{error && <small id={`${inputId}-error`} className="field-error">{error}</small>}</div>;
}

export function SearchField({ label, value, onChange, placeholder, id }: {
  label: string; value: string; onChange: (value: string) => void; placeholder?: string; id?: string;
}) {
  const inputId = id ?? `search-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
  return <div className="form-field"><label htmlFor={inputId}>{label}</label><div className="search-field-wrap"><Search size={16} aria-hidden="true" /><input id={inputId} type="search" value={value} placeholder={placeholder} onChange={event => onChange(event.target.value)} /></div></div>;
}
