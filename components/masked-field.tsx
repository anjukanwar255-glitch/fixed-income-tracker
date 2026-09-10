"use client";

import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * A form field for something that should not sit on screen in the open —
 * an account number, a demat id — hidden by default with a toggle to check
 * what was typed. The masking is for shoulders in the room; the value is
 * stored and sent as ordinary text.
 */
export function MaskedField({ label, value, setValue, ...props }: { label: string; value: string; setValue: (value: string) => void } & Omit<React.ComponentProps<typeof Input>, "value" | "onChange" | "type">) {
  const [revealed, setRevealed] = useState(false);
  const id = `field-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  return (
    <div className="form-field">
      <Label htmlFor={id}>{label}</Label>
      <div className="masked-field">
        <Input id={id} type={revealed ? "text" : "password"} value={value} onChange={(event) => setValue(event.target.value)} {...props} />
        <button
          type="button"
          onClick={() => setRevealed((shown) => !shown)}
          aria-label={revealed ? `Hide ${label}` : `Show ${label}`}
          aria-pressed={revealed}
        >
          {revealed ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
        </button>
      </div>
    </div>
  );
}
