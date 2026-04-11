import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

import { installAccountRouter } from "./install.js";

export default function install(pi: ExtensionAPI): void {
  installAccountRouter(pi);
}
