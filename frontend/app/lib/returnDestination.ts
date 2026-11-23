// Only known app destinations are accepted. Never decode an arbitrary URL into a redirect.
export function returnDestination(value: string | null | undefined): string | null {
  if (!value || /[\\\u0000-\u0020\u007f]/.test(value) || /%[0-9a-f]{2}/i.test(value)) return null;
  if (value === "/notifications" || value === "/appointments") return value;
  if (/^\/appointments\?reschedule=[1-9]\d{0,9}$/.test(value)) {
    const id = Number(value.split("=")[1]);
    return id <= 2147483647 ? value : null;
  }
  return null;
}
