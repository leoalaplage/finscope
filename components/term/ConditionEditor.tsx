"use client";

import { FIELD_OF, FIELDS, OPERATORS, type Condition, type Field } from "@/lib/term/rules";

/**
 * A rule, written as lines a reader can read back: "RSI 14 · is below · 30",
 * "EMA 20 · crosses above · EMA 50", "Hammer · appears". Every line must hold.
 *
 * The scanner and the backtester both write their rules here, so a rule moves
 * from one to the other unchanged.
 */

const GROUPS = [...new Set(FIELDS.map((spec) => spec.group))];

function FieldSelect({ value, onChange, patterns, label }: { value: Field; onChange: (field: Field) => void; patterns: boolean; label: string }) {
  return (
    <select value={value} onChange={(event) => onChange(event.target.value as Field)} aria-label={label}>
      {GROUPS.filter((group) => patterns || group !== "Patterns").map((group) => (
        <optgroup key={group} label={group}>
          {FIELDS.filter((spec) => spec.group === group).map((spec) => <option key={spec.key} value={spec.key}>{spec.name}</option>)}
        </optgroup>
      ))}
    </select>
  );
}

const NUMBER = "__number";

export function ConditionEditor({ conditions, onChange, label }: { conditions: Condition[]; onChange: (next: Condition[]) => void; label: string }) {
  const set = (index: number, next: Condition) => onChange(conditions.map((item, at) => (at === index ? next : item)));
  return (
    <div className="t-rule" role="group" aria-label={label}>
      {conditions.map((condition, index) => {
        const pattern = FIELD_OF[condition.left].unit === "pattern";
        const numeric = typeof condition.right === "number";
        return (
          <div className="t-rule-row" key={index}>
            <span className="t-rule-and">{index ? "AND" : "IF"}</span>
            <FieldSelect
              value={condition.left} patterns label="Field"
              onChange={(left) => set(index, FIELD_OF[left].unit === "pattern" ? { left, op: "is" } : { left, op: condition.op === "is" ? ">" : condition.op, right: condition.right ?? 0 })}
            />
            {pattern ? <span className="t-rule-op">appears</span> : (
              <>
                <select value={condition.op} onChange={(event) => set(index, { ...condition, op: event.target.value as Condition["op"] })} aria-label="Comparison">
                  {OPERATORS.filter((op) => op.key !== "is").map((op) => <option key={op.key} value={op.key}>{op.name}</option>)}
                </select>
                <select
                  value={numeric ? NUMBER : condition.right}
                  onChange={(event) => set(index, { ...condition, right: event.target.value === NUMBER ? 0 : event.target.value as Field })}
                  aria-label="Compared with"
                >
                  <option value={NUMBER}>a number…</option>
                  {GROUPS.filter((group) => group !== "Patterns").map((group) => (
                    <optgroup key={group} label={group}>
                      {FIELDS.filter((spec) => spec.group === group).map((spec) => <option key={spec.key} value={spec.key}>{spec.name}</option>)}
                    </optgroup>
                  ))}
                </select>
                {numeric ? (
                  <input
                    type="number" step="any" value={condition.right as number} aria-label="Number"
                    onChange={(event) => set(index, { ...condition, right: Number(event.target.value) || 0 })}
                  />
                ) : null}
              </>
            )}
            <button type="button" className="t-chip" onClick={() => onChange(conditions.filter((_, at) => at !== index))} aria-label="Remove this condition">✕</button>
          </div>
        );
      })}
      <button type="button" className="t-text-button" onClick={() => onChange([...conditions, { left: "close", op: ">", right: "ema50" }])}>+ Condition</button>
    </div>
  );
}
