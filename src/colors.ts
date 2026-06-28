const USE_COLOR = process.stdout.isTTY && process.env.NO_COLOR === undefined;

function wrap(code: string, text: string): string {
  return USE_COLOR ? `\x1b[${code}m${text}\x1b[0m` : text;
}

export function bold(text: string): string {
  return wrap("1", text);
}

export function dim(text: string): string {
  return wrap("2", text);
}

export function red(text: string): string {
  return wrap("31", text);
}

export function green(text: string): string {
  return wrap("32", text);
}

export function yellow(text: string): string {
  return wrap("33", text);
}

export function cyan(text: string): string {
  return wrap("36", text);
}
