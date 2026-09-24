export function display(value: string | null | undefined): string {
  return value && value.trim() ? value : "Not provided";
}

export function location(city: string | null, state: string | null): string {
  const parts = [city, state].filter((part): part is string => Boolean(part && part.trim()));
  return parts.length > 0 ? parts.join(", ") : "Not provided";
}

export function formatWhen(value: string | null): string {
  if (!value) return "Time not recorded";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Time not recorded";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}
