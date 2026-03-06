export class UnsupportedRuntimeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsupportedRuntimeError";
  }
}
