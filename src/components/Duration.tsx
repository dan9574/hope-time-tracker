import { Fragment } from "react";
import { durationParts, UNIT_SPACE } from "../lib/time";
import "./Duration.css";

/** A large duration: numbers at the surrounding size, units smaller and grey (rebuild-plan 11.1). */
export function Duration({ ms }: { ms: number }) {
  const parts = durationParts(ms);
  return (
    <span className="duration tabular">
      {parts.map((p, i) => (
        <Fragment key={i}>
          {i > 0 && " "}
          {p.value}
          <span className="duration-unit">
            {UNIT_SPACE}
            {p.unit}
          </span>
        </Fragment>
      ))}
    </span>
  );
}
