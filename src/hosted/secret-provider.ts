export interface SecretProvider {
  resolve(reference: string): Promise<string>;
}

export class EnvironmentSecretProvider implements SecretProvider {
  public async resolve(reference: string): Promise<string> {
    const match = /^env:\/\/([A-Z][A-Z0-9_]*)$/.exec(reference);
    if (!match) throw new Error("This runner only has the environment secret provider configured.");
    const value = process.env[match[1] as string];
    if (!value) throw new Error("The managed browser session secret is unavailable.");
    if (Buffer.byteLength(value, "utf8") > 1_048_576) throw new Error("The managed browser session secret exceeds 1 MiB.");
    return value;
  }
}
