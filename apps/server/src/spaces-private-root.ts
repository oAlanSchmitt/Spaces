import path from "node:path";

declare const SPACES_BUILD_PRIVATE_ROOT: string | undefined;

// A frozen local release shares its original data/account directory without copying authentication.
export const SPACES_PRIVATE_ROOT =
  typeof SPACES_BUILD_PRIVATE_ROOT === "string"
    ? SPACES_BUILD_PRIVATE_ROOT
    : path.resolve(import.meta.dir, "../../../.rheo");
