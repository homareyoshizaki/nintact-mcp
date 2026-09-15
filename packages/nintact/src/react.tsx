"use client";

import { useState, type CSSProperties, type FormEvent } from "react";
import { DEFAULT_API_URL, NintactError, submit } from "./index";

export type NintactFormField = {
  name: string;
  label: string;
  type?: "text" | "email" | "tel" | "textarea";
  required?: boolean;
  placeholder?: string;
};

export type NintactFormProps = {
  formId: string;
  fields?: NintactFormField[];
  submitLabel?: string;
  successMessage?: string;
  apiUrl?: string;
  className?: string;
  /** Set false to render unstyled markup and bring your own CSS. */
  styled?: boolean;
  onSuccess?: (result: { id: string | null }) => void;
  onError?: (error: unknown) => void;
};

const DEFAULT_FIELDS: NintactFormField[] = [
  { name: "name", label: "Name", type: "text", required: true },
  { name: "email", label: "Email", type: "email", required: true },
  { name: "message", label: "Message", type: "textarea", required: true },
];

const styles: Record<string, CSSProperties> = {
  form: { display: "flex", flexDirection: "column", gap: 14 },
  field: { display: "flex", flexDirection: "column", gap: 6 },
  input: {
    font: "inherit",
    padding: "10px 12px",
    border: "1px solid #ccc",
    borderRadius: 6,
    background: "#fff",
    color: "#111",
    width: "100%",
    boxSizing: "border-box",
  },
  textarea: { minHeight: 140, resize: "vertical" },
  button: {
    font: "inherit",
    padding: "12px 20px",
    border: 0,
    borderRadius: 6,
    background: "#111",
    color: "#fff",
    cursor: "pointer",
    alignSelf: "flex-start",
  },
  hidden: { position: "absolute", left: -9999, width: 1, height: 1, overflow: "hidden" },
};

/**
 * Drop-in contact form. Posts straight to the public form endpoint —
 * no API key in the browser, no server route to write.
 */
export function NintactForm({
  formId,
  fields = DEFAULT_FIELDS,
  submitLabel = "Send",
  successMessage = "Thanks — we'll get back to you shortly.",
  apiUrl = DEFAULT_API_URL,
  className,
  styled = true,
  onSuccess,
  onError,
}: NintactFormProps) {
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState<string | null>(null);

  const style = (key: keyof typeof styles): CSSProperties | undefined =>
    styled ? styles[key] : undefined;

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setState("sending");
    setError(null);

    const data = Object.fromEntries(new FormData(event.currentTarget)) as Record<string, string>;

    try {
      const result = await submit(formId, data, { apiUrl });
      setState("sent");
      onSuccess?.(result);
    } catch (caught) {
      setState("idle");
      setError(
        caught instanceof NintactError
          ? caught.message
          : "Could not send your message. Please try again.",
      );
      onError?.(caught);
    }
  }

  if (state === "sent") return <p className={className}>{successMessage}</p>;

  return (
    <form className={className} style={style("form")} onSubmit={onSubmit}>
      {fields.map((field) => (
        <div key={field.name} style={style("field")}>
          <label htmlFor={`nintact-${field.name}`}>
            {field.label}
            {field.required ? " *" : ""}
          </label>
          {field.type === "textarea" ? (
            <textarea
              id={`nintact-${field.name}`}
              name={field.name}
              required={field.required}
              placeholder={field.placeholder}
              style={styled ? { ...styles.input, ...styles.textarea } : undefined}
            />
          ) : (
            <input
              id={`nintact-${field.name}`}
              name={field.name}
              type={field.type ?? "text"}
              required={field.required}
              placeholder={field.placeholder}
              style={style("input")}
            />
          )}
        </div>
      ))}

      {/* honeypot: bots fill it, humans never see it */}
      <div style={styles.hidden} aria-hidden="true">
        <input type="text" name="_hp" tabIndex={-1} autoComplete="off" />
      </div>

      <button type="submit" style={style("button")} disabled={state === "sending"}>
        {state === "sending" ? "Sending…" : submitLabel}
      </button>

      {error ? <p role="alert">{error}</p> : null}
    </form>
  );
}
